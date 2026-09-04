import { parseFile, selectCover } from "music-metadata";
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname } from "node:path";
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { AlbumArtworkCandidate } from "@music-os/core";
import type { BackendConfig } from "../config.js";
import type { LibraryRepository } from "./library-repository.js";

export interface ArtworkResult {
  data: Buffer;
  mimeType: string;
}

interface FileArtworkCacheEntry {
  mtime: string;
  artwork: ArtworkResult | null;
}

interface AlbumArtworkCacheEntry {
  artwork: ArtworkResult | null;
  cachedAt: number;
}

interface AlbumArtworkOverrideRow {
  image_data: Buffer;
  mime_type: string;
}

interface ArtworkSearchCacheEntry {
  candidates: AlbumArtworkCandidate[];
  cachedAt: number;
}

type ArtworkCandidateSource = AlbumArtworkCandidate["source"];

const MAX_FILE_CACHE_ENTRIES = 6000;
const EMBEDDED_PROBE_LIMIT = 8;
const MUSICBRAINZ_REQUEST_SPACING_MS = 1100;
const ALBUM_INDEX_TTL_MS = 10_000;
const FAILED_ALBUM_ARTWORK_RETRY_MS = 30_000;
const REMOTE_ARTWORK_TIMEOUT_MS = 25_000;
const ARTWORK_SEARCH_TIMEOUT_MS = 4_500;
const ARTWORK_SEARCH_CACHE_TTL_MS = 5 * 60_000;
const ARTWORK_SEARCH_MISS_CACHE_TTL_MS = 30_000;
const MAX_ARTWORK_SEARCH_CACHE_ENTRIES = 150;
const ARTWORK_SEARCH_RESULT_LIMIT = 30;
const DEFAULT_ARTWORK_SEARCH_SOURCES: ArtworkCandidateSource[] = ["apple_music", "deezer", "cover_art_archive"];
const MAX_OVERRIDE_BYTES = 12 * 1024 * 1024;
const SIDECAR_COVER_NAMES = new Set(["cover", "folder", "front", "album", "artwork"]);
const SIDECAR_COVER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const REMOTE_ARTWORK_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

/**
 * Serves cover art for indexed audio. File-level art comes from embedded
 * tags; album-level art tries embedded tags across the album's files and
 * falls back to Apple artwork search, then Cover Art Archive via MusicBrainz.
 * Results (including misses) are cached in memory.
 */
export class ArtworkService {
  private readonly fileCache = new Map<string, FileArtworkCacheEntry>();
  private readonly pendingFiles = new Map<string, Promise<ArtworkResult | null>>();
  private readonly albumCache = new Map<string, AlbumArtworkCacheEntry>();
  private readonly pendingAlbums = new Map<string, Promise<ArtworkResult | null>>();
  private readonly artworkSearchCache = new Map<string, ArtworkSearchCacheEntry>();
  private readonly pendingArtworkSearches = new Map<string, Promise<AlbumArtworkCandidate[]>>();
  private albumIndexBuiltAt = 0;
  private readonly albumById = new Map<string, ReturnType<LibraryRepository["listAlbumGroups"]>[number]>();
  private readonly fileToAlbumId = new Map<string, string>();
  private musicBrainzQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Database.Database,
    private readonly library: LibraryRepository,
    private readonly config: BackendConfig
  ) {}

  async getFileArtwork(fileId: string): Promise<ArtworkResult | null> {
    const albumId = this.findAlbumIdForFile(fileId);
    const override = albumId ? this.getAlbumArtworkOverride(albumId) : null;
    if (override) {
      return override;
    }
    const embedded = await this.getEmbeddedFileArtwork(fileId);
    if (embedded) {
      return embedded;
    }

    return albumId ? this.getAlbumArtwork(albumId) : null;
  }

  private async getEmbeddedFileArtwork(fileId: string): Promise<ArtworkResult | null> {
    const file = this.library.getFile(fileId);
    const cached = this.fileCache.get(fileId);
    if (cached && cached.mtime === file.mtime) {
      return cached.artwork;
    }

    const pending = this.pendingFiles.get(fileId);
    if (pending) {
      return pending;
    }

    const lookup = extractEmbeddedArtwork(file.path)
      .then((artwork) => {
        this.writeFileCache(fileId, file.mtime, artwork);
        return artwork;
      })
      .finally(() => {
        this.pendingFiles.delete(fileId);
      });
    this.pendingFiles.set(fileId, lookup);
    return lookup;
  }

  private writeFileCache(fileId: string, mtime: string, artwork: ArtworkResult | null): void {
    if (this.fileCache.size >= MAX_FILE_CACHE_ENTRIES) {
      const oldestKey = this.fileCache.keys().next().value;
      if (oldestKey != null) {
        this.fileCache.delete(oldestKey);
      }
    }
    this.fileCache.set(fileId, { mtime, artwork });
  }

  async getAlbumArtwork(albumId: string): Promise<ArtworkResult | null> {
    const cached = this.albumCache.get(albumId);
    if (cached) {
      if (cached.artwork || Date.now() - cached.cachedAt < FAILED_ALBUM_ARTWORK_RETRY_MS) {
        return cached.artwork;
      }
      this.albumCache.delete(albumId);
    }
    const pending = this.pendingAlbums.get(albumId);
    if (pending) {
      return pending;
    }

    const lookup = this.resolveAlbumArtwork(albumId)
      .then((artwork) => {
        const resolved = this.getAlbumArtworkOverride(albumId) ?? artwork;
        this.albumCache.set(albumId, { artwork: resolved, cachedAt: Date.now() });
        return resolved;
      })
      .finally(() => {
        this.pendingAlbums.delete(albumId);
      });
    this.pendingAlbums.set(albumId, lookup);
    return lookup;
  }

  private async resolveAlbumArtwork(albumId: string): Promise<ArtworkResult | null> {
    const override = this.getAlbumArtworkOverride(albumId);
    if (override) {
      return override;
    }
    const album = this.getAlbumFromIndex(albumId);
    if (!album) {
      return null;
    }

    const localArtwork = await findSidecarArtwork(album.files.map((file) => file.path));
    if (localArtwork) {
      return localArtwork;
    }

    for (const file of album.files.slice(0, EMBEDDED_PROBE_LIMIT)) {
      const embedded = await this.getEmbeddedFileArtwork(file.id).catch(() => null);
      if (embedded) {
        return embedded;
      }
    }

    return this.lookupRemoteArtwork(album.artist, album.album);
  }

  async searchAlbumArtwork(albumId: string, query?: string, requestedSource?: string): Promise<AlbumArtworkCandidate[]> {
    const album = this.getAlbumFromIndex(albumId);
    if (!album) {
      throw new Error(`Album not found: ${albumId}`);
    }
    const searchQuery = query?.trim() || `${album.artist} ${album.album}`;
    const sources = requestedSource
      ? [parseArtworkCandidateSource(requestedSource)]
      : DEFAULT_ARTWORK_SEARCH_SOURCES;
    const cacheKey = `${sources.join(",")}:${normalizeArtworkLabel(searchQuery)}`;
    const cached = this.artworkSearchCache.get(cacheKey);
    if (cached) {
      const ttl = cached.candidates.length > 0 ? ARTWORK_SEARCH_CACHE_TTL_MS : ARTWORK_SEARCH_MISS_CACHE_TTL_MS;
      if (Date.now() - cached.cachedAt < ttl) {
        return cached.candidates;
      }
      this.artworkSearchCache.delete(cacheKey);
    }
    const pending = this.pendingArtworkSearches.get(cacheKey);
    if (pending) {
      return pending;
    }

    const lookup = Promise.all(
      sources.map((source) => this.searchArtworkSource(source, searchQuery, album.artist, album.album))
    )
      .then((providerResults) => interleaveArtworkCandidates(providerResults, ARTWORK_SEARCH_RESULT_LIMIT))
      .then((candidates) => {
        if (this.artworkSearchCache.size >= MAX_ARTWORK_SEARCH_CACHE_ENTRIES) {
          const oldestKey = this.artworkSearchCache.keys().next().value;
          if (oldestKey != null) {
            this.artworkSearchCache.delete(oldestKey);
          }
        }
        this.artworkSearchCache.set(cacheKey, { candidates, cachedAt: Date.now() });
        return candidates;
      })
      .finally(() => {
        this.pendingArtworkSearches.delete(cacheKey);
      });
    this.pendingArtworkSearches.set(cacheKey, lookup);
    return lookup;
  }

  private async searchArtworkSource(
    source: ArtworkCandidateSource,
    query: string,
    artist: string,
    album: string
  ): Promise<AlbumArtworkCandidate[]> {
    if (source === "apple_music") {
      return searchAppleArtworkCandidates(query, this.userAgent());
    }
    if (source === "deezer") {
      return searchDeezerArtworkCandidates(query, this.userAgent());
    }
    if (this.config.musicBrainzEnabled === false) {
      return [];
    }
    return withDeadline(
      this.enqueueMusicBrainz(() => searchCoverArtArchiveCandidates(query, artist, album, this.userAgent())),
      ARTWORK_SEARCH_TIMEOUT_MS,
      []
    );
  }

  async setAlbumArtworkFromPath(albumId: string, path: string): Promise<void> {
    const extension = extname(path).toLowerCase();
    if (!SIDECAR_COVER_EXTENSIONS.has(extension)) {
      throw new Error("Album artwork must be a JPG, PNG, WebP, GIF, or AVIF image");
    }
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size <= 0) {
      throw new Error("The selected album artwork file could not be read");
    }
    if (info.size > MAX_OVERRIDE_BYTES) {
      throw new Error("Album artwork must be smaller than 12 MB");
    }
    const data = await readFile(path);
    this.writeAlbumArtworkOverride(albumId, data, mimeTypeForImagePath(path), "local", path);
  }

  async setAlbumArtworkFromUrl(albumId: string, sourceUrl: string): Promise<void> {
    const url = new URL(sourceUrl);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !isAllowedRemoteArtworkHostname(hostname)) {
      throw new Error("Unsupported remote artwork source");
    }
    const response = await fetch(url, {
      headers: { accept: "image/*", "user-agent": this.userAgent() },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) {
      throw new Error(`Remote artwork download failed with ${response.status}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0 || data.length > MAX_OVERRIDE_BYTES) {
      throw new Error("Remote artwork was empty or larger than 12 MB");
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    if (!REMOTE_ARTWORK_MIME_TYPES.has(mimeType)) {
      throw new Error("Remote artwork did not return an image");
    }
    this.writeAlbumArtworkOverride(albumId, data, mimeType, "remote", sourceUrl);
  }

  removeAlbumArtworkOverride(albumId: string): void {
    const album = this.getAlbumFromIndex(albumId);
    if (!album) {
      throw new Error(`Album not found: ${albumId}`);
    }
    const fileIds = album.files.map((file) => file.id);
    this.deleteAlbumArtworkOverrides(fileIds);
    this.albumCache.delete(albumId);
  }

  private getAlbumArtworkOverride(albumId: string): ArtworkResult | null {
    const album = this.getAlbumFromIndex(albumId);
    if (!album) {
      return null;
    }
    for (const fileIds of chunkArray(album.files.map((file) => file.id), 800)) {
      const placeholders = fileIds.map(() => "?").join(",");
      const row = this.db
        .prepare(
          `SELECT image_data, mime_type
           FROM album_artwork_overrides
           WHERE anchor_file_id IN (${placeholders})
           ORDER BY updated_at DESC
           LIMIT 1`
        )
        .get(...fileIds) as AlbumArtworkOverrideRow | undefined;
      if (row) {
        return { data: row.image_data, mimeType: row.mime_type };
      }
    }
    return null;
  }

  private writeAlbumArtworkOverride(
    albumId: string,
    data: Buffer,
    mimeType: string,
    sourceType: "local" | "remote",
    sourceRef: string
  ): void {
    const album = this.getAlbumFromIndex(albumId);
    const anchorFileId = album?.files[0]?.id;
    if (!album || !anchorFileId) {
      throw new Error(`Album not found: ${albumId}`);
    }
    const fileIds = album.files.map((file) => file.id);
    const write = this.db.transaction(() => {
      this.deleteAlbumArtworkOverrides(fileIds);
      this.db.prepare(
        `INSERT INTO album_artwork_overrides
           (id, anchor_file_id, image_data, mime_type, source_type, source_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).run(nanoid(), anchorFileId, data, mimeType, sourceType, sourceRef);
    });
    write();
    this.albumCache.set(albumId, { artwork: { data, mimeType }, cachedAt: Date.now() });
  }

  private deleteAlbumArtworkOverrides(fileIds: string[]): void {
    for (const chunk of chunkArray(fileIds, 800)) {
      const placeholders = chunk.map(() => "?").join(",");
      this.db.prepare(`DELETE FROM album_artwork_overrides WHERE anchor_file_id IN (${placeholders})`).run(...chunk);
    }
  }

  private async lookupRemoteArtwork(artist: string, album: string): Promise<ArtworkResult | null> {
    const appleArtwork = await lookupAppleArtwork(artist, album, this.userAgent());
    if (appleArtwork) {
      return appleArtwork;
    }
    if (this.config.musicBrainzEnabled === false) {
      return null;
    }
    return this.lookupCoverArtArchive(artist, album);
  }

  private async lookupCoverArtArchive(artist: string, album: string): Promise<ArtworkResult | null> {
    let releaseIds = await this.enqueueMusicBrainz(() => searchReleaseIds(artist, album, this.userAgent()));
    if (releaseIds.length === 0) {
      // Edition qualifiers like "(Japan Red Vinyl)" or "[Deluxe]" often break
      // the release search; retry with them stripped.
      const cleaned = album.replace(/\s*[([][^)\]]*[)\]]\s*$/g, "").trim();
      if (cleaned && cleaned !== album) {
        releaseIds = await this.enqueueMusicBrainz(() => searchReleaseIds(artist, cleaned, this.userAgent()));
      }
    }
    for (const releaseId of releaseIds.slice(0, 3)) {
      try {
        const response = await fetch(`https://coverartarchive.org/release/${releaseId}/front-250`, {
          headers: { "user-agent": this.userAgent() },
          signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) {
          continue;
        }
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length === 0) {
          continue;
        }
        return { data, mimeType: response.headers.get("content-type") ?? "image/jpeg" };
      } catch {
        continue;
      }
    }
    return null;
  }

  /** Serializes MusicBrainz searches to respect the 1 request/second limit. */
  private enqueueMusicBrainz<T>(task: () => Promise<T>): Promise<T> {
    const run = this.musicBrainzQueue.then(task);
    this.musicBrainzQueue = run
      .catch(() => undefined)
      .then(() => new Promise((resolveDelay) => setTimeout(resolveDelay, MUSICBRAINZ_REQUEST_SPACING_MS)));
    return run;
  }

  private userAgent(): string {
    return this.config.musicBrainzUserAgent ?? "MusicOS/0.1.0 (local-dev)";
  }

  private findAlbumIdForFile(fileId: string): string | null {
    this.refreshAlbumIndex();
    return this.fileToAlbumId.get(fileId) ?? null;
  }

  private getAlbumFromIndex(albumId: string): ReturnType<LibraryRepository["listAlbumGroups"]>[number] | null {
    this.refreshAlbumIndex();
    return this.albumById.get(albumId) ?? null;
  }

  private refreshAlbumIndex(): void {
    if (Date.now() - this.albumIndexBuiltAt < ALBUM_INDEX_TTL_MS && this.albumById.size > 0) {
      return;
    }
    const albums = this.library.listAlbumGroups(Number.MAX_SAFE_INTEGER);
    this.albumById.clear();
    this.fileToAlbumId.clear();
    for (const album of albums) {
      this.albumById.set(album.id, album);
      for (const file of album.files) {
        this.fileToAlbumId.set(file.id, album.id);
      }
    }
    this.albumIndexBuiltAt = Date.now();
  }
}

async function extractEmbeddedArtwork(path: string): Promise<ArtworkResult | null> {
  try {
    const metadata = await parseFile(path, { duration: false, skipPostHeaders: true });
    const cover = selectCover(metadata.common.picture);
    if (cover && cover.data.length > 0) {
      return { data: Buffer.from(cover.data), mimeType: cover.format || "image/jpeg" };
    }
  } catch {
    // unreadable file or unsupported container: treat as no artwork
  }
  return null;
}

async function findSidecarArtwork(paths: string[]): Promise<ArtworkResult | null> {
  const directories = [...new Set(paths.map((path) => dirname(path)))];
  for (const directory of directories) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const candidates = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => {
          const extension = extname(name).toLowerCase();
          const base = name.slice(0, name.length - extension.length).toLowerCase().trim();
          return SIDECAR_COVER_EXTENSIONS.has(extension) && SIDECAR_COVER_NAMES.has(base);
        })
        .sort((left, right) => sidecarRank(left) - sidecarRank(right) || left.localeCompare(right));

      for (const candidate of candidates) {
        const path = `${directory}/${candidate}`;
        const info = await stat(path).catch(() => null);
        if (!info?.isFile() || info.size <= 0) {
          continue;
        }
        return { data: await readFile(path), mimeType: mimeTypeForImagePath(path) };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function sidecarRank(name: string): number {
  const base = name.slice(0, name.length - extname(name).length).toLowerCase().trim();
  return ["cover", "folder", "front", "album", "artwork"].indexOf(base);
}

function mimeTypeForImagePath(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".avif") {
    return "image/avif";
  }
  return "image/jpeg";
}

async function searchReleaseIds(artist: string, album: string, userAgent: string): Promise<string[]> {
  const url = new URL("https://musicbrainz.org/ws/2/release/");
  url.searchParams.set("query", `release:"${escapeLucene(album)}" AND artist:"${escapeLucene(artist)}"`);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "5");
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": userAgent },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as { releases?: Array<{ id?: string }> };
    return (payload.releases ?? []).map((release) => release.id).filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

async function lookupAppleArtwork(artist: string, album: string, userAgent: string): Promise<ArtworkResult | null> {
  const cleanedAlbum = stripArtworkNoise(album);
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", `${artist} ${cleanedAlbum}`);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "album");
  url.searchParams.set("limit", "10");

  try {
    const searchData = await curlBytes(url.toString(), userAgent, "application/json");
    if (!searchData) {
      return null;
    }
    const payload = JSON.parse(searchData.toString("utf8")) as {
      results?: Array<{ artistName?: string; collectionName?: string; artworkUrl100?: string }>;
    };
    const targetArtist = normalizeArtworkLabel(artist);
    const targetAlbums = artworkLabelVariants(album);
    const match = (payload.results ?? []).find((candidate) => {
      if (!candidate.artworkUrl100) {
        return false;
      }
      const candidateArtist = normalizeArtworkLabel(candidate.artistName ?? "");
      const candidateAlbums = artworkLabelVariants(candidate.collectionName ?? "");
      const artistMatches = candidateArtist === targetArtist ||
        (candidateArtist.length >= 3 && targetArtist.length >= 3 &&
          (candidateArtist.includes(targetArtist) || targetArtist.includes(candidateArtist)));
      const albumMatches = candidateAlbums.some((candidateAlbum) => targetAlbums.includes(candidateAlbum));
      return Boolean(targetArtist && targetAlbums.length > 0 && artistMatches && albumMatches);
    });
    if (!match?.artworkUrl100) {
      return null;
    }

    const artworkUrl = match.artworkUrl100.replace(/\/\d+x\d+bb\./, "/600x600bb.");
    const data = await curlBytes(artworkUrl, userAgent, "image/*");
    return data && data.length > 0
      ? { data, mimeType: "image/jpeg" }
      : null;
  } catch {
    return null;
  }
}

async function searchAppleArtworkCandidates(query: string, userAgent: string): Promise<AlbumArtworkCandidate[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "album");
  url.searchParams.set("limit", "24");

  try {
    const searchData = await curlBytes(url.toString(), userAgent, "application/json", ARTWORK_SEARCH_TIMEOUT_MS);
    if (!searchData) {
      return [];
    }
    const payload = JSON.parse(searchData.toString("utf8")) as {
      results?: Array<{
        collectionId?: number;
        artistName?: string;
        collectionName?: string;
        artworkUrl100?: string;
      }>;
    };
    const candidates: AlbumArtworkCandidate[] = [];
    const seenUrls = new Set<string>();
    for (const result of payload.results ?? []) {
      const artist = result.artistName?.trim();
      const album = result.collectionName?.trim();
      const imageUrl = result.artworkUrl100?.replace(/\/\d+x\d+bb\./, "/600x600bb.");
      if (!artist || !album || !imageUrl || seenUrls.has(imageUrl)) {
        continue;
      }
      seenUrls.add(imageUrl);
      candidates.push({
        id: String(result.collectionId ?? imageUrl),
        source: "apple_music",
        artist,
        album,
        imageUrl
      });
    }
    return candidates;
  } catch {
    return [];
  }
}

async function searchDeezerArtworkCandidates(query: string, userAgent: string): Promise<AlbumArtworkCandidate[]> {
  const url = new URL("https://api.deezer.com/search/album");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "24");

  try {
    const searchData = await curlBytes(url.toString(), userAgent, "application/json", ARTWORK_SEARCH_TIMEOUT_MS);
    if (!searchData) {
      return [];
    }
    const payload = JSON.parse(searchData.toString("utf8")) as {
      data?: Array<{
        id?: number;
        title?: string;
        cover_xl?: string;
        cover_big?: string;
        cover_medium?: string;
        artist?: { name?: string };
      }>;
    };
    const candidates: AlbumArtworkCandidate[] = [];
    const seenUrls = new Set<string>();
    for (const result of payload.data ?? []) {
      const artist = result.artist?.name?.trim();
      const album = result.title?.trim();
      const imageUrl = result.cover_xl ?? result.cover_big ?? result.cover_medium;
      if (!artist || !album || !imageUrl || seenUrls.has(imageUrl)) {
        continue;
      }
      seenUrls.add(imageUrl);
      candidates.push({
        id: String(result.id ?? imageUrl),
        source: "deezer",
        artist,
        album,
        imageUrl
      });
    }
    return candidates;
  } catch {
    return [];
  }
}

async function searchCoverArtArchiveCandidates(
  query: string,
  artist: string,
  album: string,
  userAgent: string
): Promise<AlbumArtworkCandidate[]> {
  const url = new URL("https://musicbrainz.org/ws/2/release/");
  const isDefaultQuery = normalizeArtworkLabel(query) === normalizeArtworkLabel(`${artist} ${album}`);
  url.searchParams.set(
    "query",
    isDefaultQuery
      ? `release:"${escapeLucene(stripArtworkNoise(album))}" AND artist:"${escapeLucene(artist)}"`
      : query.split(/\s+/).map(escapeLucene).join(" ")
  );
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "20");

  try {
    const searchData = await curlBytes(url.toString(), userAgent, "application/json", ARTWORK_SEARCH_TIMEOUT_MS);
    if (!searchData) {
      return [];
    }
    const payload = JSON.parse(searchData.toString("utf8")) as {
      releases?: Array<{
        id?: string;
        title?: string;
        date?: string;
        "artist-credit"?: Array<{ name?: string; joinphrase?: string; artist?: { name?: string } }>;
        "cover-art-archive"?: { artwork?: boolean; front?: boolean };
      }>;
    };
    const candidates: AlbumArtworkCandidate[] = [];
    for (const release of payload.releases ?? []) {
      const releaseId = release.id?.trim();
      const releaseAlbum = release.title?.trim();
      const releaseArtist = formatMusicBrainzArtistCredit(release["artist-credit"]) || artist;
      if (!releaseId || !releaseAlbum || release["cover-art-archive"]?.front !== true) {
        continue;
      }
      candidates.push({
        id: releaseId,
        source: "cover_art_archive",
        artist: releaseArtist,
        album: releaseAlbum,
        imageUrl: `https://coverartarchive.org/release/${releaseId}/front-500`
      });
    }
    return candidates;
  } catch {
    return [];
  }
}

async function curlBytes(
  url: string,
  userAgent: string,
  accept: string,
  timeoutMs = REMOTE_ARTWORK_TIMEOUT_MS
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(
      "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--connect-timeout",
        String(Math.ceil(timeoutMs / 1000)),
        "--max-time",
        String(Math.ceil(timeoutMs / 1000)),
        "--user-agent",
        userAgent,
        "--header",
        `accept: ${accept}`,
        url
      ],
      {
        encoding: null,
        maxBuffer: 12 * 1024 * 1024,
        timeout: timeoutMs + 1000,
        windowsHide: true
      },
      (error, stdout) => {
        if (error || !Buffer.isBuffer(stdout) || stdout.length === 0) {
          resolve(null);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function formatMusicBrainzArtistCredit(
  credits: Array<{ name?: string; joinphrase?: string; artist?: { name?: string } }> | undefined
): string {
  return (credits ?? [])
    .map((credit) => `${credit.name?.trim() || credit.artist?.name?.trim() || ""}${credit.joinphrase ?? ""}`)
    .join("")
    .trim();
}

function parseArtworkCandidateSource(source: string): ArtworkCandidateSource {
  if (source === "apple_music" || source === "deezer" || source === "cover_art_archive") {
    return source;
  }
  throw new Error(`Unsupported artwork search source: ${source}`);
}

function isAllowedRemoteArtworkHostname(hostname: string): boolean {
  return hostname === "mzstatic.com" ||
    hostname.endsWith(".mzstatic.com") ||
    hostname === "dzcdn.net" ||
    hostname.endsWith(".dzcdn.net") ||
    hostname === "cdn-images.deezer.com" ||
    hostname === "coverartarchive.org" ||
    hostname.endsWith(".coverartarchive.org");
}

function interleaveArtworkCandidates(
  providerResults: AlbumArtworkCandidate[][],
  limit: number
): AlbumArtworkCandidate[] {
  const candidates: AlbumArtworkCandidate[] = [];
  const seen = new Set<string>();
  const largestResult = Math.max(0, ...providerResults.map((result) => result.length));
  for (let resultIndex = 0; resultIndex < largestResult && candidates.length < limit; resultIndex += 1) {
    for (const providerResult of providerResults) {
      const candidate = providerResult[resultIndex];
      if (!candidate) {
        continue;
      }
      const key = `${candidate.source}:${candidate.id}:${candidate.imageUrl}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push(candidate);
      if (candidates.length >= limit) {
        break;
      }
    }
  }
  return candidates;
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function stripEditionQualifier(value: string): string {
  return value.replace(/\s*[([][^)\]]*[)\]]\s*$/g, "").trim();
}

function stripArtworkNoise(value: string): string {
  let cleaned = stripEditionQualifier(value).trim();
  cleaned = cleaned
    .replace(/\s*[-–—]\s*(?:19|20)\d{2}\s*[-–—]\s*(?:flac|alac|wav|aiff?|mp3|aac|ogg|opus|lossless)\s*$/i, "")
    .replace(/\s*[-–—]\s*(?:flac|alac|wav|aiff?|mp3|aac|ogg|opus|lossless)\s*$/i, "")
    .replace(/\s*[-–—]\s*(?:19|20)\d{2}\s*$/i, "")
    .replace(/\s+(?:cd|disc|disk)\s*\d+\s*$/i, "")
    .trim();
  return stripEditionQualifier(cleaned);
}

function artworkLabelVariants(value: string): string[] {
  const candidates = [value, stripEditionQualifier(value), stripArtworkNoise(value)]
    .map(normalizeArtworkLabel)
    .filter(Boolean);
  return [...new Set(candidates)];
}

function normalizeArtworkLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function escapeLucene(value: string): string {
  return value.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, "\\$1");
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
