import { parseFile, selectCover } from "music-metadata";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname } from "node:path";
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

const MAX_FILE_CACHE_ENTRIES = 6000;
const EMBEDDED_PROBE_LIMIT = 8;
const MUSICBRAINZ_REQUEST_SPACING_MS = 1100;
const ALBUM_INDEX_TTL_MS = 10_000;
const SIDECAR_COVER_NAMES = new Set(["cover", "folder", "front", "album", "artwork"]);
const SIDECAR_COVER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/**
 * Serves cover art for indexed audio. File-level art comes from embedded
 * tags; album-level art tries embedded tags across the album's files and
 * falls back to the Cover Art Archive via a MusicBrainz release search.
 * Results (including misses) are cached in memory.
 */
export class ArtworkService {
  private readonly fileCache = new Map<string, FileArtworkCacheEntry>();
  private readonly pendingFiles = new Map<string, Promise<ArtworkResult | null>>();
  private readonly albumCache = new Map<string, ArtworkResult | null>();
  private readonly pendingAlbums = new Map<string, Promise<ArtworkResult | null>>();
  private albumIndexBuiltAt = 0;
  private readonly albumById = new Map<string, ReturnType<LibraryRepository["listAlbumGroups"]>[number]>();
  private readonly fileToAlbumId = new Map<string, string>();
  private musicBrainzQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly library: LibraryRepository,
    private readonly config: BackendConfig
  ) {}

  async getFileArtwork(fileId: string): Promise<ArtworkResult | null> {
    const embedded = await this.getEmbeddedFileArtwork(fileId);
    if (embedded) {
      return embedded;
    }

    const albumId = this.findAlbumIdForFile(fileId);
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
    if (cached !== undefined) {
      return cached;
    }
    const pending = this.pendingAlbums.get(albumId);
    if (pending) {
      return pending;
    }

    const lookup = this.resolveAlbumArtwork(albumId)
      .then((artwork) => {
        this.albumCache.set(albumId, artwork);
        return artwork;
      })
      .finally(() => {
        this.pendingAlbums.delete(albumId);
      });
    this.pendingAlbums.set(albumId, lookup);
    return lookup;
  }

  private async resolveAlbumArtwork(albumId: string): Promise<ArtworkResult | null> {
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

    if (this.config.musicBrainzEnabled === false) {
      return null;
    }
    return this.lookupCoverArtArchive(album.artist, album.album);
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

function escapeLucene(value: string): string {
  return value.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, "\\$1");
}
