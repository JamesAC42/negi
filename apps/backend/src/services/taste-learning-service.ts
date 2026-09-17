import type Database from "better-sqlite3";
import { tasteProfileSchema, type TasteProfile, type TasteProfileResponse } from "@music-os/core";

type LearnedTaste = NonNullable<TasteProfileResponse["learned"]>;
type Signal = LearnedTaste["signals"][number];
type TasteKey = Signal["key"];
interface Evidence {
  values: Partial<Record<TasteKey, string[]>>;
  qualifiedPlays: number;
  completedPlays: number;
  earlySkips: number;
  liked: boolean;
  rating: number | null;
  disliked: boolean;
  lastPlayedAt: string | null;
  lastObservedAt: string;
}
const limits: Record<TasteKey, number> = {
  favoriteArtists: 16, favoriteAlbums: 16, favoriteTracks: 20, preferredGenres: 12,
  preferredEras: 8, preferredCountries: 8, preferredLabels: 12
};

/** Trigger-driven dirty files make refresh proportional to changed listening history,
 * not library size. Evidence survives restarts; unchanged reads use the cached rollup. */
export class TasteLearningService {
  private cached: { revision: number; day: string; value: LearnedTaste } | null = null;

  constructor(private readonly db: Database.Database) {}

  getProfile(): LearnedTaste {
    const revision = (this.db.prepare("SELECT revision FROM taste_learning_state WHERE id = 1").get() as { revision: number }).revision;
    const day = new Date().toISOString().slice(0, 10);
    if (this.cached?.revision === revision && this.cached.day === day) return this.cached.value;

    this.db.transaction(() => {
      const dirty = this.db.prepare("SELECT file_id FROM taste_learning_dirty").all() as { file_id: string }[];
      const save = this.db.prepare(
        "INSERT INTO taste_learning_files (file_id, evidence_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET evidence_json = excluded.evidence_json, updated_at = excluded.updated_at"
      );
      for (const { file_id: fileId } of dirty) {
        const evidence = this.readEvidence(fileId);
        if (evidence.qualifiedPlays > 0 || evidence.liked || evidence.rating != null || evidence.disliked) {
          save.run(fileId, JSON.stringify(evidence), new Date().toISOString());
        } else {
          this.db.prepare("DELETE FROM taste_learning_files WHERE file_id = ?").run(fileId);
        }
      }
      this.db.prepare("DELETE FROM taste_learning_dirty").run();
    })();

    const rows = this.db.prepare("SELECT evidence_json FROM taste_learning_files").all() as { evidence_json: string }[];
    const value = aggregate(rows.map((row) => JSON.parse(row.evidence_json) as Evidence));
    this.cached = { revision, day, value };
    return value;
  }

  private readEvidence(fileId: string): Evidence {
    // Only successful, substantial listening is positive evidence. Merely starting,
    // skipping, zero-duration EOF, and failed loads never become a preference.
    const history = this.db.prepare(
      `SELECT
         SUM(CASE WHEN event_type = 'played' AND listened_ms >=
           CASE WHEN duration_ms > 0 THEN MIN(30000, duration_ms * 0.5) ELSE 30000 END THEN 1 ELSE 0 END) AS qualifiedPlays,
         SUM(CASE WHEN event_type = 'played' AND reason = 'completed' AND listened_ms >=
           CASE WHEN duration_ms > 0 THEN MIN(30000, duration_ms * 0.5) ELSE 30000 END THEN 1 ELSE 0 END) AS completedPlays,
         SUM(CASE WHEN event_type = 'skipped' AND reason = 'next' AND listened_ms > 0 AND listened_ms < 10000 THEN 1 ELSE 0 END) AS earlySkips,
         MAX(CASE WHEN event_type = 'played' AND listened_ms >=
           CASE WHEN duration_ms > 0 THEN MIN(30000, duration_ms * 0.5) ELSE 30000 END THEN created_at END) AS lastPlayedAt,
         MAX(CASE WHEN (event_type = 'played' AND listened_ms >=
           CASE WHEN duration_ms > 0 THEN MIN(30000, duration_ms * 0.5) ELSE 30000 END)
           OR (event_type = 'skipped' AND reason = 'next' AND listened_ms > 0 AND listened_ms < 10000)
           THEN created_at END) AS lastObservedAt
       FROM playback_events WHERE file_id = ?`
    ).get(fileId) as { qualifiedPlays: number | null; completedPlays: number | null; earlySkips: number | null; lastPlayedAt: string | null; lastObservedAt: string | null };
    const preference = this.db.prepare("SELECT liked, disliked, rating, updated_at FROM file_preferences WHERE file_id = ?").get(fileId) as
      { liked: number | null; disliked: number | null; rating: number | null; updated_at: string } | undefined;
    const tagRows = this.db.prepare(
      "SELECT tag_key, tag_value FROM embedded_tags WHERE file_id = ? ORDER BY rowid"
    ).all(fileId) as { tag_key: string; tag_value: string }[];
    const overrides = this.db.prepare("SELECT tag_key, tag_value FROM file_metadata_overrides WHERE file_id = ?").all(fileId) as typeof tagRows;
    const tags = new Map<string, string>();
    for (const row of [...tagRows, ...overrides]) tags.set(row.tag_key.toLowerCase(), row.tag_value.trim());
    const get = (...keys: string[]) => keys.map((key) => tags.get(key)).find((value) => value && !/^(unknown|unknown artist|unknown album)$/i.test(value));
    const artist = get("albumartist", "album_artist", "artist");
    const album = get("album");
    const title = get("title");
    const year = get("originaldate", "originalyear", "date", "year")?.match(/(?:^|\D)(19\d{2}|20\d{2})(?:\D|$)/)?.[1];
    const genre = get("genre");
    const country = get("country", "releasecountry");
    const label = get("label", "publisher", "organization");
    const values: Evidence["values"] = {};
    if (artist) values.favoriteArtists = [artist];
    if (album) values.favoriteAlbums = [artist ? `${artist} — ${album}` : album];
    if (title) values.favoriteTracks = [artist ? `${artist} — ${title}` : title];
    if (genre) values.preferredGenres = genre.split(/\s*;\s*/).filter(Boolean);
    if (year) values.preferredEras = [`${Math.floor(Number(year) / 10) * 10}s`];
    if (country) values.preferredCountries = [country];
    if (label) values.preferredLabels = [label];
    return {
      values,
      qualifiedPlays: history.qualifiedPlays ?? 0,
      completedPlays: history.completedPlays ?? 0,
      earlySkips: history.earlySkips ?? 0,
      liked: preference?.liked === 1,
      disliked: preference?.disliked === 1,
      rating: preference?.rating ?? null,
      lastPlayedAt: history.lastPlayedAt ? toIso(history.lastPlayedAt) : null,
      lastObservedAt: [history.lastObservedAt, preference?.updated_at].filter((value): value is string => Boolean(value)).map(toIso).sort().at(-1) ?? new Date().toISOString()
    };
  }
}

function aggregate(evidence: Evidence[]): LearnedTaste {
  const profile = tasteProfileSchema.parse({});
  const stats: LearnedTaste["stats"] = { qualifiedPlays: 0, completedPlays: 0, earlySkips: 0, likedTracks: 0, ratedTracks: 0, trackedFiles: evidence.length };
  const combined = new Map<string, Signal>();
  let updatedAt: string | null = null;
  const now = Date.now();
  for (const item of evidence) {
    stats.qualifiedPlays += item.qualifiedPlays;
    stats.completedPlays += item.completedPlays;
    stats.earlySkips += item.earlySkips;
    stats.likedTracks += Number(item.liked);
    stats.ratedTracks += Number(item.rating != null);
    if (updatedAt == null || item.lastObservedAt > updatedAt) updatedAt = item.lastObservedAt;
    // Dislikes/low ratings remove that file's positive evidence. Repeated skips
    // only soften its score; they never silently create artist or genre blocks.
    if (item.disliked || (item.rating != null && item.rating <= 2)) continue;
    const ageDays = item.lastPlayedAt ? Math.max(0, (now - Date.parse(toIso(item.lastPlayedAt))) / 86_400_000) : 0;
    const recency = Math.pow(0.5, ageDays / 120);
    const playScore = Math.log2(1 + item.qualifiedPlays) + Math.log2(1 + item.completedPlays) * 0.5;
    const skipPenalty = item.earlySkips >= 3 ? Math.min(0.5, item.earlySkips / Math.max(1, item.qualifiedPlays) * 0.15) : 0;
    const score = playScore * recency * (1 - skipPenalty) + (item.liked ? 4 : 0) + (item.rating != null && item.rating >= 4 ? item.rating - 2 : 0);
    if (score <= 0) continue;
    const sources: Signal["sources"] = [];
    if (item.qualifiedPlays) sources.push("listening");
    if (item.liked) sources.push("liked");
    if (item.rating != null && item.rating >= 4) sources.push("rating");
    const sampleCount = item.qualifiedPlays + Number(item.liked) + Number(item.rating != null && item.rating >= 4);
    for (const [key, values] of Object.entries(item.values) as [TasteKey, string[]][]) {
      for (const value of values) {
        const identity = `${key}:${normalize(value)}`;
        const previous = combined.get(identity);
        if (previous) {
          previous.score += score;
          previous.sampleCount += sampleCount;
          previous.sources = [...new Set([...previous.sources, ...sources])];
          if (item.lastObservedAt > previous.lastObservedAt) previous.lastObservedAt = item.lastObservedAt;
        } else {
          combined.set(identity, { key, value, score, confidence: 0, sampleCount, sources, lastObservedAt: item.lastObservedAt });
        }
      }
    }
  }
  const signals: Signal[] = [];
  for (const key of Object.keys(limits) as TasteKey[]) {
    const ranked = [...combined.values()].filter((signal) => signal.key === key)
      .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value)).slice(0, limits[key]);
    for (const signal of ranked) {
      signal.score = Math.round(signal.score * 100) / 100;
      signal.confidence = Math.min(0.95, Math.round((1 - Math.exp(-signal.sampleCount / 8)) * 100) / 100);
      signals.push(signal);
      // One casual play is visible as evidence, but does not steer downloads.
      if (signal.sampleCount >= 2 || signal.sources.includes("liked") || signal.sources.includes("rating")) {
        profile[key].push(signal.value);
      }
    }
  }
  return { profile, signals, stats, updatedAt };
}

export function effectiveTasteProfile(explicit: TasteProfile, learned: TasteProfile): TasteProfile {
  const effective = structuredClone(explicit);
  const blockedArtists = new Set(explicit.blockedArtists.map(normalize));
  const blockedGenres = new Set(explicit.blockedGenres.map(normalize));
  const overplayed = new Set(explicit.overplayedTracks.map(normalize));
  for (const key of Object.keys(limits) as TasteKey[]) {
    const values = explicit[key].length ? explicit[key] : learned[key];
    effective[key] = values.filter((value) => {
      if (key === "favoriteArtists") return !blockedArtists.has(normalize(value));
      if (key === "preferredGenres") return !blockedGenres.has(normalize(value));
      if (key === "favoriteTracks" && overplayed.has(normalize(value))) return false;
      if (key === "favoriteAlbums" || key === "favoriteTracks") {
        return !blockedArtists.has(normalize(value.split(" — ")[0] ?? ""));
      }
      return true;
    });
  }
  return effective;
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}
function toIso(value: string): string {
  return value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
}