import { execFile } from "node:child_process";
import { catalogueIdSchema, type CatalogueArtist, type SimilarArtist, type SimilarArtistsResponse } from "@music-os/core";
import type { ArtistProfileService } from "./artist-profile-service.js";
import type { CatalogueService } from "./catalogue-service.js";
import type { LibraryRepository } from "./library-repository.js";
import { MusicMapService } from "./music-map-service.js";
import { ArtistBackgroundCache } from "./artist-background-cache.js";
import { musicKey } from "./catalogue-service.js";
import { CatalogueRequestScheduler } from "./catalogue-request-scheduler.js";

interface ArtistData {
  id: string; name: string; disambiguation?: string; country?: string; type?: string;
  "life-span"?: { begin?: string; end?: string };
  tags?: { name: string; count: number }[];
  relations?: { type?: string; artist?: ArtistData }[];
}
const algorithm = "session_based_days_7500_session_300_contribution_3_threshold_10_limit_100_filter_True_skip_30";
const listenerScheduler = new CatalogueRequestScheduler(300);
const validMbid = (value: unknown): value is string => typeof value === "string" && !value.startsWith("apple:") && catalogueIdSchema.safeParse(value).success;
const usable = (value: ArtistData) => validMbid(value?.id) && typeof value.name === "string" && Boolean(value.name.trim());
const tagsOf = (artist: ArtistData) => (artist.tags ?? []).filter((tag) => typeof tag.name === "string" && tag.count > 0)
  .sort((a, b) => b.count - a.count).slice(0, 8).map((tag) => tag.name);
function mapArtist(data: ArtistData): CatalogueArtist {
  return { id: data.id, name: data.name, description: data.disambiguation ?? "", country: data.country ?? null,
    type: data.type ?? null, begin: data["life-span"]?.begin ?? null, end: data["life-span"]?.end ?? null,
    tags: tagsOf(data), provider: "musicbrainz", sourceUrl: `https://musicbrainz.org/artist/${data.id}`, artworkUrl: null };
}
/** Public, keyless recommendations. Every cross-provider identity comes from a verified upstream link. */
export class SimilarArtistsService {
  private snapshots = new ArtistBackgroundCache<SimilarArtistsResponse>();
  constructor(private profiles: ArtistProfileService, private catalogue: CatalogueService,
    private library: Pick<LibraryRepository, "listAlbumGroups">, private userAgent = "MusicOS/0.1.0",
    private download: (url: URL, userAgent: string) => Promise<unknown> = similarJson,
    private musicMap: Pick<MusicMapService, "get"> = new MusicMapService()) {}

  async get(artistId: string, artistName: string): Promise<SimilarArtistsResponse> {
    const value = this.snapshots.get(artistId,
      () => ({ artistId, resolvedArtistId: validMbid(artistId) ? artistId : null, artists: [], sources: [], note: null }),
      (publish) => this.load(artistId, artistName, publish),
      (snapshot) => ({ ...snapshot, note: "Some artist connection sources are temporarily unavailable. You can keep exploring." }));
    if (!value.artists.length) return value;
    // Ownership stays fresh when albums are imported while recommendations are cached.
    const albums = this.library.listAlbumGroups();
    return { ...value, artists: value.artists.map((entry) => {
      const matches = albums.filter((album) => musicKey(album.artist) === musicKey(entry.artist.name));
      return { ...entry, artist: { ...entry.artist, libraryAlbumId: matches[0]?.id ?? null },
        libraryAlbumCount: matches.length, libraryMatch: matches.length ? "name" : "none" };
    }) };
  }
  async getComplete(artistId: string, artistName: string): Promise<SimilarArtistsResponse> {
    await this.get(artistId, artistName);
    await this.snapshots.complete(artistId);
    return this.get(artistId, artistName);
  }
  private async load(artistId: string, artistName: string, publish: (value: SimilarArtistsResponse) => void): Promise<SimilarArtistsResponse> {
    let canonical: SimilarArtistsResponse = { artistId, resolvedArtistId: null, artists: [], sources: [], note: null };
    let mapped: SimilarArtist[] = [];
    let mapSource: SimilarArtistsResponse["sources"] = [];
    const combined = () => ({ ...canonical, artists: [...mapped, ...canonical.artists].slice(0, 36),
      sources: [...mapSource, ...canonical.sources], note: mapped.length ? null : canonical.note });
    const mapWork = this.musicMap.get(artistName).then((value) => {
      mapped = value.artists.slice(0, 12).map((entry) => ({
        artist: { id: "musicmap:" + encodeURIComponent(entry.name.toLowerCase()), name: entry.name, description: "",
          country: null, type: null, begin: null, end: null, tags: [], sourceUrl: entry.url, artworkUrl: null,
          requiresArtistMatch: true },
        sources: ["musicmap"], connection: "listeners", reasons: ["Nearby on Music-Map · listeners’ shared tastes"],
        strength: Math.max(0.4, 1 - entry.rank * 0.025), sharedTags: [], libraryAlbumCount: 0, libraryMatch: "none",
      }));
      mapSource = [{ id: "musicmap", label: "Music-Map", url: value.sourceUrl, status: mapped.length ? "ok" : "empty" }];
      publish(combined());
    }, () => {
      mapSource = [{ id: "musicmap", label: "Music-Map", url: "https://www.music-map.com/", status: "unavailable" }];
      publish(combined());
    });
    const canonicalWork = this.loadCanonical(artistId, artistName, (value) => {
      canonical = value;
      publish(combined());
    }).then((value) => { canonical = value; });
    await Promise.allSettled([mapWork, canonicalWork]);
    return combined();
  }
  private async loadCanonical(artistId: string, artistName: string, publish: (value: SimilarArtistsResponse) => void): Promise<SimilarArtistsResponse> {
    const deadline = Date.now() + 19_000;
    const result: SimilarArtistsResponse = { artistId, resolvedArtistId: null, artists: [], sources: [], note: null };
    let mbid: string | undefined = validMbid(artistId) ? artistId : undefined;
    if (!mbid) {
      mbid = await this.profiles.musicBrainzArtistId(artistId, artistName) ?? undefined;
    }
    if (!mbid) {
      result.note = "This Apple Music artist has no verified MusicBrainz link yet. Search for the artist in the MusicBrainz catalogue to explore their connections.";
      return result;
    }
    const seedId = mbid;
    result.resolvedArtistId = seedId;
    const entries = new Map<string, SimilarArtist>();
    const add = (data: ArtistData, source: "listenbrainz" | "musicbrainz", connection: SimilarArtist["connection"], reason: string, strength: number) => {
      if (!usable(data) || data.id === seedId) return;
      const existing = entries.get(data.id);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        existing.strength = Math.max(existing.strength, strength);
        if (source === "listenbrainz") {
          existing.connection = "listeners";
          existing.sources.sort((a, b) => a === b ? 0 : a === "listenbrainz" ? -1 : 1);
        }
        if (data.tags?.length) existing.artist = { ...existing.artist, ...mapArtist(data) };
        return;
      }
      entries.set(data.id, { artist: mapArtist(data), sources: [source], connection, reasons: [reason], strength,
        sharedTags: [], libraryAlbumCount: 0, libraryMatch: "none" });
    };
    const listenerUrl = new URL("https://labs.api.listenbrainz.org/similar-artists/json");
    listenerUrl.searchParams.set("artist_mbids", seedId);
    listenerUrl.searchParams.set("algorithm", algorithm);
    const flush = () => {
      result.artists = [...entries.values()].sort((a, b) =>
        (b.strength + b.sharedTags.length * 0.04) - (a.strength + a.sharedTags.length * 0.04) || a.artist.name.localeCompare(b.artist.name)).slice(0, 24);
      publish(result);
    };
    const listening = (async () => {
      const listeners = await Promise.allSettled([this.download(listenerUrl, this.userAgent)]).then(([value]) => value!);
      let listenerCount = 0;
      if (listeners.status === "fulfilled" && Array.isArray(listeners.value)) {
        const rows = listeners.value.filter((row) => row && validMbid(row.artist_mbid) && row.reference_mbid === seedId &&
          typeof row.name === "string" && typeof row.score === "number" && Number.isFinite(row.score) && row.score > 0)
          .sort((a, b) => b.score - a.score).slice(0, 18);
        const highest = rows[0]?.score ?? 1;
        for (const row of rows) {
          add({ id: row.artist_mbid, name: row.name, disambiguation: row.comment ?? "", type: row.type ?? undefined },
            "listenbrainz", "listeners", "Played in the same listening sessions on ListenBrainz", 0.5 + 0.5 * row.score / highest);
          if (row.artist_mbid !== seedId) listenerCount++;
        }
      }
      result.sources.push({ id: "listenbrainz", label: "ListenBrainz", url: "https://listenbrainz.org/", status:
        listeners.status === "rejected" || !Array.isArray(listeners.value) ? "unavailable" : listenerCount ? "ok" : "empty" });
      flush();
    })();
    const metadataWork = (async () => {
      const metadata = await Promise.allSettled([this.catalogue.request<ArtistData>(`artist/${seedId}`, { inc: "tags+artist-rels" })]).then(([value]) => value!);
      let mbCount = 0;
      let mbUnavailable = metadata.status === "rejected";
      if (metadata.status === "fulfilled") {
        const seed = metadata.value;
        const seedTags = tagsOf(seed).filter((tag) => !/^(seen live|favorites?|favourites?|owned|[0-9]+s?)$/i.test(tag)).slice(0, 3);
        for (const relation of seed.relations ?? []) {
          if (relation.artist && ["member of band", "subgroup", "collaboration", "founder"].includes(relation.type ?? "")) {
            add(relation.artist, "musicbrainz", "related", `MusicBrainz connection: ${relation.type}`, 0.62);
            mbCount++;
          }
          if (mbCount >= 8) break;
        }
        flush();
        if (seedTags.length && Date.now() < deadline) {
          try {
            const quote = (value: string) => `"${value.replace(/[\\"]/g, "\\$&")}"`;
            const tagged = await this.catalogue.request<{ artists: ArtistData[] }>("artist", {
              query: seedTags.map((tag) => `tag:${quote(tag)}`).join(" OR "), limit: "24",
            });
            for (const artist of tagged.artists ?? []) {
              if (!usable(artist) || artist.id === seedId) continue;
              const shared = tagsOf(artist).filter((tag) => seedTags.some((seedTag) => musicKey(seedTag) === musicKey(tag)));
              if (!shared.length) continue;
              add(artist, "musicbrainz", "shared-tags", `Shared tags: ${shared.join(" · ")}`, 0.25 + shared.length * 0.1);
              entries.get(artist.id)!.sharedTags = shared;
              mbCount++;
            }
          } catch { mbUnavailable = true; }
        }
        // Listener cards already contain upstream names/IDs. Avoid six additional
        // rate-limited artist requests just to decorate recommendations with tags.
      }
      result.sources.push({ id: "musicbrainz", label: "MusicBrainz", url: `https://musicbrainz.org/artist/${seedId}`,
        status: mbUnavailable ? "unavailable" : mbCount ? "ok" : "empty" });
      flush();
    })();
    await Promise.allSettled([listening, metadataWork]);
    result.sources.sort((a, b) => a.id === b.id ? 0 : a.id === "listenbrainz" ? -1 : 1);
    flush();
    if (result.sources.some((source) => source.status === "unavailable")) result.note = result.artists.length
      ? "Some sources are temporarily unavailable. These connections come from the sources that responded."
      : "Artist connections are temporarily unavailable. Try again shortly.";
    else if (!result.artists.length) result.note = "There are no listening connections or shared tags for this artist yet. Try another artist to start a new trail.";
    return result;
  }
}
function similarJson(url: URL, userAgent: string): Promise<unknown> {
  return listenerScheduler.run(() => new Promise((resolve, reject) => {
    execFile("curl", ["-4", "--fail", "--silent", "--show-error", "--max-time", "8", "--user-agent", userAgent,
      "--header", "Accept: application/json", url.toString()], { timeout: 8500, maxBuffer: 1_000_000 }, (error, stdout) => {
      if (error) return reject(new Error("Listening connections are temporarily unavailable."));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Invalid listening connections response.")); }
    });
  }));
}
