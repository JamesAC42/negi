import { catalogueAlbumSection } from "@music-os/core";
import { execFile } from "node:child_process";
import type Database from "better-sqlite3";
import type { CatalogueAlbum, CatalogueArtist, CataloguePage, CatalogueRelease, CatalogueSort, CatalogueSection, CatalogueTrack } from "@music-os/core";
import type { BackendConfig } from "../config.js";
import type { LibraryRepository } from "./library-repository.js";
import { CatalogueResponseCache } from "./catalogue-response-cache.js";
import { missingReleaseTracks, musicKey } from "./catalogue-service.js";

type Row = Record<string, unknown>;
interface Response { resultCount: number; results: Row[] }
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const id = (value: number) => `apple:${value}`;
function numericId(value: string): number {
  if (!/^apple:[1-9]\d*$/.test(value) || !positive(Number(value.slice(6))))
    throw new Error("Invalid Apple catalogue identifier.");
  return Number(value.slice(6));
}
function response(value: unknown): Response {
  const data = value as Response | null;
  if (!data || !Number.isInteger(data.resultCount) || !Array.isArray(data.results) || data.resultCount !== data.results.length ||
    data.results.some((row) => !row || typeof row !== "object" || Array.isArray(row)))
    throw new Error("Apple returned an invalid catalogue response. Please retry.");
  return data;
}
function safeUrl(value: unknown, artwork = false): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const allowed = artwork ? url.hostname.endsWith(".mzstatic.com") : ["music.apple.com", "itunes.apple.com"].includes(url.hostname);
    return url.protocol === "https:" && allowed && !url.username && !url.password && !url.port ? url.toString() : null;
  } catch { return null; }
}
function artwork(row: Row) {
  return safeUrl(row.artworkUrl100, true)?.replace(/\/100x100bb\./, "/600x600bb.") ?? null;
}
function date(row: Row): string | null {
  return typeof row.releaseDate === "string" && /^\d{4}-\d{2}-\d{2}T/.test(row.releaseDate) ? row.releaseDate.slice(0, 10) : null;
}
function mapArtist(row: Row): CatalogueArtist {
  if (!positive(row.artistId) || !nonempty(row.artistName)) throw new Error("Apple returned an invalid artist.");
  return { id: id(row.artistId), name: row.artistName, description: "", country: null, type: null, begin: null, end: null,
    tags: nonempty(row.primaryGenreName) ? [row.primaryGenreName] : [], provider: "apple",
    sourceUrl: safeUrl(row.artistLinkUrl ?? row.artistViewUrl) };
}
// Apple adds format labels to titles; retain every actual edition descriptor.
function albumTitle(row: Row): string {
  const original = String(row.collectionName);
  return original.replace(/ - (?:Single|EP)$/i, "").trim() || original;
}
function albumType(row: Row): string {
  return / - Single$/i.test(String(row.collectionName)) ? "Single" : / - EP$/i.test(String(row.collectionName)) ? "EP" : "Album";
}
function validAlbum(row: Row): void {
  if (!positive(row.collectionId) || !positive(row.artistId) || !nonempty(row.collectionName))
    throw new Error("Apple returned an invalid album.");
}
function releaseRows(data: Response, album: number): { collection: Row; tracks: CatalogueTrack[]; trackListingComplete: boolean; expectedTrackCount: number | null } {
  const collection = data.results.find((row) => row.wrapperType === "collection" && row.collectionId === album);
  if (!collection) throw new Error("This album is unavailable in Apple's US catalogue. Try the expanded MusicBrainz catalogue.");
  validAlbum(collection);
  const rows = data.results.filter((row) => row.wrapperType === "track" && row.kind === "song" && row.collectionId === album);
  const positions = new Set<string>();
  const tracks = rows.map((row): CatalogueTrack => {
    if (!nonempty(row.trackName) || !positive(row.discNumber) || !positive(row.trackNumber))
      throw new Error("Apple returned an invalid track listing. Try the expanded MusicBrainz catalogue.");
    const position = `${row.discNumber}:${row.trackNumber}`;
    if (positions.has(position)) throw new Error("Apple returned duplicate track positions. Try MusicBrainz for this album.");
    positions.add(position);
    return { title: row.trackName, disc: row.discNumber, number: row.trackNumber,
      durationMs: typeof row.trackTimeMillis === "number" && Number.isFinite(row.trackTimeMillis) && row.trackTimeMillis >= 0 ? row.trackTimeMillis : null };
  }).sort((a, b) => a.disc - b.disc || a.number - b.number);
  const expectedTrackCount = positive(collection.trackCount) ? collection.trackCount : null;
  return { collection, tracks, expectedTrackCount,
    trackListingComplete: expectedTrackCount !== null && tracks.length === expectedTrackCount };
}

/** Fast commercial catalogue; provider identifiers never masquerade as MusicBrainz IDs. */
export class AppleCatalogueService {
  private pending = new Map<string, Promise<Response>>();
  private cache: CatalogueResponseCache;
  private starts: number[] = [];
  constructor(private config: BackendConfig, private library: LibraryRepository, db: Database.Database,
    private download: (url: URL, userAgent: string) => Promise<unknown> = appleJson) {
    this.cache = new CatalogueResponseCache(db);
  }
  private async request(path: string, params: Record<string, string>, validate?: (data: Response) => unknown): Promise<Response> {
    const url = new URL(path, "https://itunes.apple.com/");
    Object.entries({ ...params, country: "US" }).forEach(([key, value]) => url.searchParams.set(key, value));
    const key = url.toString();
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      const data = response(cached);
      validate?.(data);
      return data;
    }
    const existing = this.pending.get(key);
    if (existing) {
      const data = await existing;
      validate?.(data);
      return data;
    }
    const now = Date.now();
    this.starts = this.starts.filter((start) => now - start < 60_000);
    if (this.starts.length >= 20)
      throw new Error("Apple's catalogue request budget is busy. Wait a minute or choose MusicBrainz; cached albums are still available.");
    this.starts.push(now);
    const pending = this.download(url, this.config.musicBrainzUserAgent ?? "MusicOS/0.1.0").then((value) => {
      const data = response(value);
      validate?.(data);
      const partialTracks = params.entity === "song" && !releaseRows(data, Number(params.id)).trackListingComplete;
      this.cache.set(key, data, data.results.length && !partialTracks ? 86_400_000 : 300_000);
      return data;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, pending);
    return pending;
  }
  async searchArtists(query: string): Promise<CatalogueArtist[]> {
    const data = await this.request("search", { term: query.trim(), entity: "musicArtist", limit: "12" }, (value) => {
      value.results.filter((row) => row.wrapperType === "artist").forEach(mapArtist);
    });
    const locals = this.library.listAlbumGroups();
    return data.results.filter((row) => row.wrapperType === "artist").map((row) => {
      const artist = mapArtist(row);
      return { ...artist, libraryAlbumId: locals.find((album) => musicKey(album.artist) === musicKey(artist.name))?.id ?? null };
    });
  }
  private async albums(artistId: string) {
    const artistNumber = numericId(artistId);
    const data = await this.request("lookup", { id: String(artistNumber), entity: "album", limit: "200" }, (value) => {
      const artist = value.results.find((row) => row.wrapperType === "artist" && row.artistId === artistNumber);
      if (!artist) throw new Error("This artist is unavailable in Apple's US catalogue. Try MusicBrainz.");
      mapArtist(artist);
      value.results.filter((row) => row.wrapperType === "collection" && row.artistId === artistNumber).forEach(validAlbum);
    });
    const artist = data.results.find((row) => row.wrapperType === "artist" && row.artistId === artistNumber);
    if (!artist) throw new Error("This artist is unavailable in Apple's US catalogue. Try MusicBrainz.");
    const all = data.results.filter((row) => row.wrapperType === "collection");
    const albums = [...new Map(all.filter((row) => row.artistId === artistNumber).map((row) => {
      validAlbum(row);
      return [row.collectionId as number, row] as const;
    })).values()];
    return { artist: mapArtist(artist), albums, truncated: all.length >= 200 };
  }
  async artist(artistId: string): Promise<CatalogueArtist> {
    return (await this.albums(artistId)).artist;
  }
  async browse(artistId: string, libraryArtist: string, offset = 0, sort: CatalogueSort = "newest", section?: CatalogueSection): Promise<CataloguePage> {
    const data = await this.albums(artistId);
    const groups = data.albums.filter((row) => !section || catalogueAlbumSection({ type: albumType(row), secondaryTypes: [] }) === section).sort((a, b) => {
      const byTitle = albumTitle(a).localeCompare(albumTitle(b)) || Number(a.collectionId) - Number(b.collectionId);
      if (sort === "title") return byTitle;
      const aDate = date(a), bDate = date(b);
      if (!aDate || !bDate) return aDate ? -1 : bDate ? 1 : byTitle;
      return (sort === "newest" ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate)) || byTitle;
    });
    const localAlbums = this.library.listAlbumGroups().filter((album) => musicKey(album.artist) === musicKey(libraryArtist));
    const incomplete = new Set(this.library.listIncompleteAlbums(Number.MAX_SAFE_INTEGER).map((album) => album.key));
    const albums = groups.slice(offset, offset + 24).map((row): CatalogueAlbum => {
      const matching = localAlbums.filter((album) => musicKey(album.album) === musicKey(albumTitle(row)));
      const local = matching.length === 1 ? matching[0] : undefined;
      return { id: id(row.collectionId as number), title: albumTitle(row), date: date(row),
        type: albumType(row),
        secondaryTypes: [], ownedTracks: local?.fileCount ?? 0, libraryAlbumId: local?.id ?? null,
        libraryStatus: !local ? "missing" : incomplete.has(local.id) ? "partial" : "unverified",
        provider: "apple", artworkUrl: artwork(row), sourceUrl: safeUrl(row.collectionViewUrl) };
    });
    return { artist: data.artist, albums, total: groups.length, nextOffset: offset + albums.length < groups.length ? offset + albums.length : null,
      provider: "apple", truncated: data.truncated };
  }
  async release(groupId: string, libraryArtist: string, albumId?: string): Promise<CatalogueRelease> {
    const albumNumber = numericId(groupId);
    const data = await this.request("lookup", { id: String(albumNumber), entity: "song", limit: "200" }, (value) => releaseRows(value, albumNumber));
    const { collection, tracks, trackListingComplete, expectedTrackCount } = releaseRows(data, albumNumber);
    const matches = this.library.listAlbumGroups().filter((album) =>
      musicKey(album.artist) === musicKey(libraryArtist) && musicKey(album.album) === musicKey(albumTitle(collection)) && (!albumId || album.id === albumId));
    const local = matches.length === 1 ? matches[0] : undefined;
    const missing = new Set(missingReleaseTracks(tracks, local?.files ?? []));
    for (const track of tracks) track.owned = !missing.has(track);
    const ownedTracks = tracks.length - missing.size;
    return { id: groupId, title: albumTitle(collection), artistIds: [id(collection.artistId as number)], date: date(collection),
      releaseId: groupId, tracks, trackListingComplete, expectedTrackCount, rating: null, votes: 0, ownedTracks,
      libraryStatus: !trackListingComplete ? "unverified" : ownedTracks === tracks.length ? "complete" : ownedTracks ? "partial" : "missing",
      provider: "apple", artworkUrl: artwork(collection), sourceUrl: safeUrl(collection.collectionViewUrl) };
  }
  async resolve(artist: string, album: string): Promise<{ artistId: string; groupId: string }> {
    const artists = (await this.searchArtists(artist)).filter((row) => musicKey(row.name) === musicKey(artist));
    if (artists.length !== 1) throw new Error("Artist identity is ambiguous. Search and choose the correct artist in Discovery.");
    const data = await this.albums(artists[0].id);
    const matches = data.albums.filter((row) => musicKey(albumTitle(row)) === musicKey(album));
    if (matches.length !== 1) throw new Error("Could not identify one matching Apple album. Choose a release in Discovery or use MusicBrainz.");
    return { artistId: artists[0].id, groupId: id(matches[0].collectionId as number) };
  }
}

// curl honors the host proxy configuration and avoids broken WSL IPv6 routes.
function appleJson(url: URL, userAgent: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile("curl", ["-4", "--fail", "--silent", "--show-error", "--max-time", "8", "--user-agent", userAgent, "--header", "Accept: application/json", url.toString()],
      { timeout: 8500, maxBuffer: 4_000_000 }, (error, stdout) => {
        if (error) { reject(new Error("Apple's catalogue is temporarily unavailable. Please retry or choose MusicBrainz.")); return; }
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Apple returned an unreadable catalogue response.")); }
      });
  });
}
