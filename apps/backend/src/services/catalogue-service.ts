import { catalogueAlbumSection } from "@music-os/core";
import { musicKey, missingReleaseTracks } from "./album-completeness.js";
import { get } from "node:https";
import type Database from "better-sqlite3";
import { CatalogueResponseCache } from "./catalogue-response-cache.js";
import { catalogueRequestScheduler } from "./catalogue-request-scheduler.js";
import type {
  CatalogueArtist,
  CatalogueAlbum,
  CataloguePage,
  CatalogueSort,
  CatalogueSection,
  CatalogueRelease,
  CatalogueTrack,
} from "@music-os/core";
import type { BackendConfig } from "../config.js";
import type { LibraryRepository } from "./library-repository.js";

interface ArtistData {
  id: string;
  name: string;
  disambiguation?: string;
  country?: string;
  type?: string;
  "life-span"?: { begin?: string; end?: string };
  tags?: { name: string; count: number }[];
}
interface GroupData {
  id: string;
  title: string;
  "first-release-date"?: string;
  "primary-type"?: string;
  "secondary-types"?: string[];
  "artist-credit"?: { artist: { id: string } }[];
  rating?: { value: number | null; "votes-count": number };
}
interface ReleaseData {
  id: string;
  title: string;
  date?: string;
  media?: {
    position: number;
    format?: string;
    "track-count": number;
    tracks?: {
      title: string;
      position: number;
      length?: number;
      recording?: { title: string; video?: boolean };
    }[];
  }[];
}
// DVD and other video-only media should not prevent an audio album completing.
// DVD-Audio, SACD and other audio formats remain eligible.
function audioMedium(medium: NonNullable<ReleaseData["media"]>[number]) {
  return !/^(?:DVD(?:-Video)?|Blu-ray(?:-R)?|HD-DVD|VCD|SVCD|VHS|Betamax|LaserDisc|Video8|Data CD)$/i.test(medium.format ?? "");
}
function audioCount(release: ReleaseData) {
  return release.media?.filter(audioMedium).reduce((sum, medium) => sum + medium["track-count"], 0) ?? 0;
}
export { musicKey, missingReleaseTracks } from "./album-completeness.js";
export class CatalogueService {
  private pending = new Map<string, Promise<unknown>>();
  private persistentCache?: CatalogueResponseCache;
  private cache = new Map<string, { until: number; value: unknown }>();
  private indexes = new Map<string, { until: number; groups: GroupData[] }>();
  constructor(
    private config: BackendConfig,
    private library: LibraryRepository,
    db?: Database.Database,
    private download: (url: URL, userAgent: string) => Promise<unknown> = catalogueJson,
  ) {
    if (db) this.persistentCache = new CatalogueResponseCache(db);
  }
  async request<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    if (this.config.musicBrainzEnabled === false)
      throw new Error(
        "MusicBrainz is disabled. Enable MUSIC_OS_MUSICBRAINZ_ENABLED to browse the catalogue.",
      );
    const url = new URL(path, "https://musicbrainz.org/ws/2/");
    Object.entries({ ...params, fmt: "json" }).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    );
    const key = url.toString();
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value as T;
    const persisted = this.persistentCache?.get(key);
    if (persisted !== undefined) return persisted as T;
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;
    const result = this.download(
      url,
      this.config.musicBrainzUserAgent ?? "MusicOS/0.1.0",
    ).then((value) => {
      // Evict only the oldest entry instead of flushing all warmed metadata.
      if (this.cache.size >= 400) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { until: Date.now() + 3600000, value });
      this.persistentCache?.set(key, value, 3600000);
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    return result as Promise<T>;
  }
  async searchArtists(query: string): Promise<CatalogueArtist[]> {
    const data = await this.request<{ artists: ArtistData[] }>("artist", {
      query,
      limit: "12",
    });
    const libraryAlbums = new Map<string, string>();
    for (const album of this.library.listAlbumGroups()) {
      const artistKey = musicKey(album.artist);
      if (!libraryAlbums.has(artistKey)) libraryAlbums.set(artistKey, album.id);
    }
    return (data.artists ?? []).map((artist) => ({
      ...mapArtist(artist),
      libraryAlbumId: libraryAlbums.get(musicKey(artist.name)) ?? null,
    }));
  }
  private async releaseGroups(artistId: string): Promise<GroupData[]> {
    const cached = this.indexes.get(artistId);
    if (cached && cached.until > Date.now()) return cached.groups;
    // MusicBrainz browse pages have a fixed upstream order, not chronological order.
    // Cache lightweight metadata in maximum-size batches, then paginate our sorted
    // index. Covers, editions and track lists are still fetched only on demand.
    const groups = new Map<string, GroupData>();
    let offset = 0;
    let total = 1;
    while (offset < total) {
      const data = await this.request<{
        "release-groups": GroupData[];
        "release-group-count": number;
      }>("release-group", { artist: artistId, limit: "100", offset: String(offset) });
      const batch = data["release-groups"] ?? [];
      total = data["release-group-count"] ?? offset + batch.length;
      if (!batch.length && offset < total)
        throw new Error("The catalogue returned an incomplete release list. Please retry.");
      for (const group of batch) groups.set(group.id, group);
      offset += batch.length;
    }
    const result = [...groups.values()];
    if (this.indexes.size >= 100) this.indexes.clear();
    this.indexes.set(artistId, { until: Date.now() + 3600000, groups: result });
    return result;
  }
  async browse(
    artistId: string,
    libraryArtist: string,
    offset = 0,
    sort: CatalogueSort = "newest",
    section?: CatalogueSection,
  ): Promise<CataloguePage> {
    const [artist, releaseGroups] = await Promise.all([
      this.request<ArtistData>("artist/" + artistId, { inc: "tags" }),
      this.releaseGroups(artistId),
    ]);
    const groups = releaseGroups.filter((group) => !section || catalogueAlbumSection({
      type: group["primary-type"] ?? "Other", secondaryTypes: group["secondary-types"] ?? [],
    }) === section).sort((a, b) => {
      const byTitle = a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
      if (sort === "title") return byTitle;
      const aDate = a["first-release-date"];
      const bDate = b["first-release-date"];
      // Undated releases belong at the end in both date orders.
      if (!aDate || !bDate) return aDate ? -1 : bDate ? 1 : byTitle;
      return (sort === "newest" ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate)) || byTitle;
    });
    const owned = this.library
      .listAlbumGroups()
      .filter((a) => musicKey(a.artist) === musicKey(libraryArtist));
    const incomplete = new Set(
      this.library
        .listIncompleteAlbums(Number.MAX_SAFE_INTEGER)
        .map((a) => a.key),
    );
    const albums: CatalogueAlbum[] = groups.slice(offset, offset + 24).map((g) => {
      const local = owned.find((a) => musicKey(a.album) === musicKey(g.title));
      const taggedTotal =
        local?.files.reduce(
          (n, f) =>
            Math.max(
              n,
              parseInt(
                f.displayTags.totaltracks ??
                  f.displayTags.tracktotal ??
                  f.displayTags.tracknumber?.split("/")[1] ??
                  "0",
                10,
              ) || 0,
            ),
          0,
        ) ?? 0;
      const knownComplete =
        local &&
        taggedTotal > 0 &&
        !local.files.some(
          (f) => parseInt(f.displayTags.discnumber ?? "1", 10) > 1,
        ) &&
        new Set(
          local.files
            .map((f) => parseInt(f.displayTags.tracknumber ?? f.filename, 10))
            .filter(Number.isFinite),
        ).size >= taggedTotal;
      return {
        id: g.id,
        title: g.title,
        date: g["first-release-date"] || null,
        type: g["primary-type"] ?? "Other",
        secondaryTypes: g["secondary-types"] ?? [],
        ownedTracks: local?.fileCount ?? 0,
        libraryAlbumId: local?.id ?? null,
        libraryStatus: !local
          ? "missing"
          : incomplete.has(local.id)
            ? "partial"
            : knownComplete
              ? "complete"
              : "unverified",
      };
    });
    const total = groups.length;
    return {
      artist: mapArtist(artist),
      albums,
      total,
      nextOffset:
        offset + albums.length < total ? offset + albums.length : null,
    };
  }
  async release(
    groupId: string,
    libraryArtist: string,
    albumId?: string,
  ): Promise<CatalogueRelease> {
    const [group, editions] = await Promise.all([
      this.request<GroupData>("release-group/" + groupId, {
        inc: "ratings+artist-credits",
      }),
      this.request<{ releases: ReleaseData[] }>("release", {
        "release-group": groupId,
        inc: "media",
        limit: "100",
        status: "official",
      }),
    ]);
    const local = this.library
      .listAlbumGroups()
      .find((a) =>
        albumId
          ? a.id === albumId
          : musicKey(a.artist) === musicKey(libraryArtist) &&
            musicKey(a.album) === musicKey(group.title),
      );
    const totalHint =
      local?.files.reduce(
        (max, f) =>
          Math.max(
            max,
            Number(
              f.displayTags.totaltracks ??
                f.displayTags.tracktotal ??
                f.displayTags.tracknumber?.split("/")[1],
            ) || 0,
          ),
        0,
      ) ?? 0;
    const sorted = [...(editions.releases ?? [])].sort((a, b) => {
      const count = audioCount;
      return (
        (totalHint
          ? Math.abs(count(a) - totalHint) - Math.abs(count(b) - totalHint)
          : 0) ||
        (a.date || "9999").localeCompare(b.date || "9999") ||
        count(a) - count(b)
      );
    });
    const edition = sorted.find((r) =>
      r.media?.some((m) => audioMedium(m) && m["track-count"] > 0),
    );
    if (!edition)
      throw new Error(
        "No official track listing is available for this release.",
      );
    const full = await this.request<ReleaseData>("release/" + edition.id, {
      inc: "recordings",
    });
    const tracks: CatalogueTrack[] = (full.media ?? []).filter(audioMedium).flatMap((m) =>
      (m.tracks ?? []).filter((t) => !t.recording?.video).map((t) => ({
        title: t.title || t.recording?.title || "",
        disc: m.position,
        number: t.position,
        durationMs: t.length ?? null,
      })),
    );
    if (!tracks.length) throw new Error("This edition has no track listing.");
    const missing = new Set(missingReleaseTracks(tracks, local?.files ?? []));
    for (const track of tracks) track.owned = !missing.has(track);
    const ownedTracks = tracks.length - missing.size;
    return {
      id: group.id,
      title: group.title,
      artistIds: (group["artist-credit"] ?? []).map((c) => c.artist.id),
      date: full.date ?? group["first-release-date"] ?? null,
      releaseId: full.id,
      tracks,
      rating: group.rating?.value ?? null,
      votes: group.rating?.["votes-count"] ?? 0,
      ownedTracks,
      libraryStatus:
        ownedTracks === tracks.length
          ? "complete"
          : ownedTracks
            ? "partial"
            : "missing",
    };
  }
  async resolve(
    artist: string,
    album: string,
  ): Promise<{ artistId: string; groupId: string }> {
    const artists = (await this.searchArtists(artist)).filter(
      (a) => musicKey(a.name) === musicKey(artist),
    );
    if (artists.length !== 1)
      throw new Error(
        "Artist identity is ambiguous. Open Browse discography and select the correct artist.",
      );
    const data = await this.request<{ "release-groups": GroupData[] }>(
      "release-group",
      {
        query:
          "arid:" +
          artists[0].id +
          ' AND releasegroup:"' +
          album.replace(/["\\]/g, " ") +
          '"',
        limit: "100",
      },
    );
    const matches = (data["release-groups"] ?? []).filter(
      (g) => musicKey(g.title) === musicKey(album),
    );
    if (matches.length !== 1)
      throw new Error(
        "Could not identify one matching album. Choose a release in Browse discography.",
      );
    return { artistId: artists[0].id, groupId: matches[0].id };
  }
}
function mapArtist(a: ArtistData): CatalogueArtist {
  return {
    id: a.id,
    name: a.name,
    description: a.disambiguation ?? "",
    country: a.country ?? null,
    type: a.type ?? null,
    begin: a["life-span"]?.begin ?? null,
    end: a["life-span"]?.end ?? null,
    tags: [...(a.tags ?? [])]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((t) => t.name),
  };
}

// WSL may resolve an IPv6 address even when only IPv4 has internet connectivity.
async function catalogueJson<T>(url: URL, userAgent: string): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await catalogueRequestScheduler.run(() => new Promise<T>((resolve, reject) => {
        const request = get(
          url,
          {
            family: 4,
            headers: { "User-Agent": userAgent, Accept: "application/json" },
          },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              body += chunk;
              if (body.length > 8_000_000)
                request.destroy(new Error("Catalogue response was too large."));
            });
            response.on("end", () => {
              if (response.statusCode !== 200) {
                reject(
                  new CatalogueHttpError(
                    response.statusCode ?? 0,
                    "MusicBrainz is temporarily unavailable (HTTP " +
                      response.statusCode +
                      "). Please retry shortly.",
                  ),
                );
                return;
              }
              try {
                resolve(JSON.parse(body) as T);
              } catch {
                reject(
                  new Error("MusicBrainz returned an unreadable response."),
                );
              }
            });
            response.on("error", reject);
          },
        );
        const deadline = setTimeout(
          () =>
            request.destroy(
              new Error("MusicBrainz connection timed out. Please retry."),
            ),
          20000,
        );
        request.on("close", () => clearTimeout(deadline));
        request.on("error", reject);
      }));
    } catch (error) {
      if (attempt === 1 || (error instanceof CatalogueHttpError &&
        error.status !== 429 && error.status < 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1500));
    }
  }
  throw new Error("MusicBrainz is unavailable.");
}

class CatalogueHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
