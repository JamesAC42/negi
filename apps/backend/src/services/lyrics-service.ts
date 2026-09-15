import { createHash } from "node:crypto";
import { z } from "zod";
import { lyricsResponseSchema, type LyricsLine, type LyricsResponse, type LibraryFilesResponse } from "@music-os/core";
import type Database from "better-sqlite3";
type LyricsLibrary = { getFile(fileId: string): Pick<LibraryFilesResponse["files"][number], "displayTags" | "durationMs"> };

const providerRecordSchema = z.object({
  trackName: z.string(), artistName: z.string(), albumName: z.string().nullable().optional(),
  duration: z.number().finite().nonnegative().nullable().optional(), instrumental: z.boolean(),
  plainLyrics: z.string().nullable().optional(), syncedLyrics: z.string().nullable().optional()
});
type ProviderRecord = z.infer<typeof providerRecordSchema>;
type Result = Omit<LyricsResponse, "fileId" | "cached">;
interface SongMetadata { title: string; artist: string; album: string; durationMs: number | null }
interface LyricsServiceOptions { fetch?: typeof fetch; timeoutMs?: number; errorCooldownMs?: number; now?: () => number }
interface CacheRow { status: string; plain_lyrics: string | null; lines_json: string; fetched_at: string | null }
class ProviderError extends Error {
  constructor(readonly retryAfterMs?: number) { super("Lyrics provider temporarily unavailable"); }
}

export class LyricsService {
  private readonly pending = new Map<string, Promise<Result>>();
  private readonly failures = new Map<string, number>();
  private readonly controllers = new Set<AbortController>();
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly errorCooldownMs: number;
  private closed = false;

  constructor(private readonly db: Database.Database, private readonly library: LyricsLibrary, options: LyricsServiceOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 4_000;
    this.errorCooldownMs = options.errorCooldownMs ?? 15_000;
  }

  async getLyrics(fileId: string): Promise<LyricsResponse> {
    // Read current tags each time: retagging changes the song's cache identity.
    const file = this.library.getFile(fileId);
    const song: SongMetadata = {
      title: file.displayTags.title?.trim() ?? "",
      artist: (file.displayTags.artist || file.displayTags.albumartist)?.trim() ?? "",
      album: file.displayTags.album?.trim() ?? "",
      durationMs: file.durationMs != null && file.durationMs > 0 ? file.durationMs : null
    };
    const key = createHash("sha256").update(JSON.stringify([
      "lrclib-v1", identity(song.title), identity(song.artist), identity(song.album), song.durationMs
    ])).digest("hex");
    const row = this.db.prepare("SELECT * FROM lyrics_cache WHERE cache_key = ?").get(key) as CacheRow | undefined;
    if (row) {
      try {
        return lyricsResponseSchema.parse({ fileId, status: row.status, plainLyrics: row.plain_lyrics,
          lines: JSON.parse(row.lines_json), provider: "lrclib", cached: true, fetchedAt: row.fetched_at });
      } catch {
        this.db.prepare("DELETE FROM lyrics_cache WHERE cache_key = ?").run(key);
      }
    }
    const retryAfterMs = (this.failures.get(key) ?? 0) - this.now();
    if (this.closed || retryAfterMs > 0) return this.response(fileId, this.error(Math.max(0, retryAfterMs)));
    const existing = this.pending.get(key);
    if (existing) return this.response(fileId, await existing);
    if (this.pending.size >= 8) return this.response(fileId, this.error(1_000));
    const lookup = this.loadAndStore(key, song).finally(() => this.pending.delete(key));
    this.pending.set(key, lookup);
    return this.response(fileId, await lookup);
  }

  close(): void {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.failures.clear();
  }

  private response(fileId: string, result: Result): LyricsResponse { return { ...result, fileId, cached: false }; }
  private error(retryAfterMs: number): Result {
    return { status: "error", provider: "lrclib", plainLyrics: null, lines: [], fetchedAt: null, retryAfterMs };
  }

  private async loadAndStore(key: string, song: SongMetadata): Promise<Result> {
    try {
      const result = song.title && song.artist ? await this.lookup(song)
        : { status: "not_found" as const, provider: "lrclib" as const, plainLyrics: null, lines: [], fetchedAt: null };
      if (!this.closed) {
        this.db.prepare(`INSERT OR REPLACE INTO lyrics_cache
          (cache_key, status, plain_lyrics, lines_json, fetched_at) VALUES (?, ?, ?, ?, ?)`)
          .run(key, result.status, result.plainLyrics, JSON.stringify(result.lines), result.fetchedAt);
      }
      this.failures.delete(key);
      return result;
    } catch (error) {
      const retryAfterMs = error instanceof ProviderError && error.retryAfterMs != null
        ? Math.max(this.errorCooldownMs, error.retryAfterMs) : this.errorCooldownMs;
      if (this.failures.size >= 256) this.failures.delete(this.failures.keys().next().value!);
      this.failures.set(key, this.now() + retryAfterMs);
      return this.error(retryAfterMs);
    }
  }

  private async lookup(song: SongMetadata): Promise<Result> {
    const controller = new AbortController();
    this.controllers.add(controller);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.lookupProvider(song, controller.signal),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => { controller.abort(); reject(new ProviderError()); }, this.timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  private async lookupProvider(song: SongMetadata, signal: AbortSignal): Promise<Result> {
    const query = new URLSearchParams({ track_name: song.title, artist_name: song.artist });
    if (song.album) query.set("album_name", song.album);
    // LRCLIB accepts duration only between 1 second and 1 hour.
    if (song.durationMs != null && song.durationMs >= 1_000 && song.durationMs <= 3_600_000) query.set("duration", String(song.durationMs / 1_000));
    const direct = await this.request("get", query, signal);
    if (direct != null) {
      const record = providerRecordSchema.parse(direct);
      if (matchesSong(record, song, false)) return this.fromRecord(record, song);
    }
    // One search handles metadata misses without fuzzy title or artist guessing.
    query.delete("duration");
    const search = await this.request("search", query, signal);
    if (!Array.isArray(search)) throw new ProviderError();
    const records = z.array(providerRecordSchema).max(200).parse(search)
      .filter((record) => matchesSong(record, song, true))
      .sort((a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)) || durationDistance(a, song) - durationDistance(b, song));
    if (records[0]) return this.fromRecord(records[0], song);
    return { status: "not_found", provider: "lrclib", plainLyrics: null, lines: [], fetchedAt: new Date(this.now()).toISOString() };
  }

  private async request(endpoint: "get" | "search", query: URLSearchParams, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const response = await this.fetcher(`https://lrclib.net/api/${endpoint}?${query}`, {
      signal, headers: { accept: "application/json", "user-agent": "MusicOS/0.1 (desktop lyrics)", "Lrclib-Client": "MusicOS/0.1" }
    });
    if (response.status === 404 && endpoint === "get") {
      // A JSON TrackNotFound is authoritative; a proxy's bare 404 is an outage.
      const body = await response.json();
      if (body && typeof body === "object" && "name" in body && body.name === "TrackNotFound") return null;
      throw new ProviderError();
    }
    if (!response.ok) {
      const value = response.headers.get("retry-after");
      const seconds = value ? Number(value) : NaN;
      const until = value ? Date.parse(value) - this.now() : NaN;
      const delay = Number.isFinite(seconds) ? seconds * 1_000 : until;
      throw new ProviderError(Number.isFinite(delay) ? Math.min(300_000, Math.max(0, Math.ceil(delay))) : undefined);
    }
    if (Number(response.headers.get("content-length")) > 1_000_000 || !response.body) throw new ProviderError();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_000_000) throw new ProviderError();
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    signal.throwIfAborted();
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  private fromRecord(record: ProviderRecord, song: SongMetadata): Result {
    const fetchedAt = new Date(this.now()).toISOString();
    if (record.instrumental) return { status: "instrumental", provider: "lrclib", plainLyrics: null, lines: [], fetchedAt };
    const parsed = parseLrc(record.syncedLyrics ?? "");
    const lines = song.durationMs == null ? parsed : parsed.filter((line) => line.timeMs <= song.durationMs! + 3_000);
    const plainLyrics = record.plainLyrics?.trim() || parsed.map((line) => line.text).join("\n").trim() || null;
    return { status: lines.some((line) => line.text) ? "synced" : plainLyrics ? "plain" : "not_found", provider: "lrclib", plainLyrics, lines, fetchedAt };
  }
}

function identity(value: string): string {
  // Preserve Unicode, symbol-only titles, and edition qualifiers.
  return value.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[‐‑–—]/g, "-").replace(/\s+/g, " ").trim();
}
function durationDistance(record: ProviderRecord, song: SongMetadata): number {
  return record.duration != null && song.durationMs != null ? Math.abs(record.duration * 1_000 - song.durationMs) : Infinity;
}
function matchesSong(record: ProviderRecord, song: SongMetadata, search: boolean): boolean {
  if (identity(record.trackName) !== identity(song.title) || identity(record.artistName) !== identity(song.artist)) return false;
  if (song.album && identity(record.albumName ?? "") !== identity(song.album)) return false;
  if (song.durationMs != null) return durationDistance(record, song) <= 2_000;
  return !search || Boolean(song.album);
}

/** Positive LRC offsets advance lyrics; timestamps are returned in playback milliseconds. */
export function parseLrc(source: string): LyricsLine[] {
  const offsetMatches = [...source.matchAll(/\[offset\s*:\s*([+-]?\d+)\]/gi)];
  const parsedOffset = Number(offsetMatches.at(-1)?.[1] ?? 0);
  const offset = Number.isFinite(parsedOffset) ? parsedOffset : 0;
  const lines: LyricsLine[] = [];
  for (const raw of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const timestamps = [...raw.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    if (!timestamps.length) continue;
    const text = raw.replace(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g, "")
      .replace(/<\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?>/g, "").trim();
    for (const timestamp of timestamps) {
      const fraction = Number((timestamp[3] ?? "").padEnd(3, "0"));
      lines.push({ timeMs: Math.max(0, Number(timestamp[1]) * 60_000 + Number(timestamp[2]) * 1_000 + fraction - offset), text });
    }
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  const grouped: LyricsLine[] = [];
  for (const line of lines) {
    const last = grouped.at(-1);
    if (last?.timeMs === line.timeMs) {
      if (line.text && !last.text.split("\n").includes(line.text)) last.text = last.text ? `${last.text}\n${line.text}` : line.text;
    } else grouped.push({ ...line });
  }
  return grouped;
}
