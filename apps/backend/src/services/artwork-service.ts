import { parseFile, selectCover } from "music-metadata";
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

const MAX_FILE_CACHE_ENTRIES = 500;
const EMBEDDED_PROBE_LIMIT = 4;
const MUSICBRAINZ_REQUEST_SPACING_MS = 1100;

/**
 * Serves cover art for indexed audio. File-level art comes from embedded
 * tags; album-level art tries embedded tags across the album's files and
 * falls back to the Cover Art Archive via a MusicBrainz release search.
 * Results (including misses) are cached in memory.
 */
export class ArtworkService {
  private readonly fileCache = new Map<string, FileArtworkCacheEntry>();
  private readonly albumCache = new Map<string, ArtworkResult | null>();
  private readonly pendingAlbums = new Map<string, Promise<ArtworkResult | null>>();
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

    const artwork = await extractEmbeddedArtwork(file.path);
    if (this.fileCache.size >= MAX_FILE_CACHE_ENTRIES) {
      const oldestKey = this.fileCache.keys().next().value;
      if (oldestKey != null) {
        this.fileCache.delete(oldestKey);
      }
    }
    this.fileCache.set(fileId, { mtime: file.mtime, artwork });
    return artwork;
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
    const album = this.library
      .listAlbumGroups(Number.MAX_SAFE_INTEGER)
      .find((group) => group.id === albumId);
    if (!album) {
      return null;
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
    for (const album of this.library.listAlbumGroups(Number.MAX_SAFE_INTEGER)) {
      if (album.files.some((file) => file.id === fileId)) {
        return album.id;
      }
    }
    return null;
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
