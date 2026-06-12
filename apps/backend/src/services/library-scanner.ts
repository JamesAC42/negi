import { parseFile } from "music-metadata";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { LibraryScanResult, LibraryRoot, WatchedLibraryScanResult } from "@music-os/core";
import type { LibraryRepository } from "./library-repository.js";

export const audioExtensions = new Set([
  ".aac",
  ".aiff",
  ".alac",
  ".ape",
  ".dsf",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
  ".wma"
]);

export class LibraryScanner {
  constructor(private readonly repository: LibraryRepository) {}

  async scanRoots(roots: LibraryRoot[]): Promise<WatchedLibraryScanResult> {
    const results: LibraryScanResult[] = [];
    for (const root of roots) {
      results.push(await this.scanRoot(root));
    }

    return {
      rootsScanned: results.length,
      results,
      totals: {
        scanned: sumScanResults(results, "scanned"),
        inserted: sumScanResults(results, "inserted"),
        updated: sumScanResults(results, "updated"),
        missingMarked: sumScanResults(results, "missingMarked"),
        skipped: sumScanResults(results, "skipped"),
        errors: results.reduce((total, result) => total + result.errors.length, 0)
      }
    };
  }

  async scanRoot(root: LibraryRoot): Promise<LibraryScanResult> {
    const seen = new Set<string>();
    const result: LibraryScanResult = {
      rootId: root.id,
      scanned: 0,
      inserted: 0,
      updated: 0,
      missingMarked: 0,
      skipped: 0,
      errors: []
    };

    for await (const filePath of walkAudioFiles(root.path)) {
      const normalizedPath = normalizePath(filePath);
      seen.add(normalizedPath);
      result.scanned += 1;

      try {
        const scannedFile = await scanAudioFile(root.id, filePath, normalizedPath);
        const upsert = this.repository.upsertFile(scannedFile);
        if (upsert.inserted) {
          result.inserted += 1;
        } else {
          result.updated += 1;
        }
      } catch (error) {
        result.errors.push({
          path: filePath,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    result.missingMarked = this.repository.markMissingFiles(root.id, seen);
    this.repository.markRootScanned(root.id);
    return result;
  }
}

function sumScanResults(results: LibraryScanResult[], key: keyof Omit<LibraryScanResult, "rootId" | "errors">): number {
  return results.reduce((total, result) => total + result[key], 0);
}

async function* walkAudioFiles(rootPath: string): AsyncGenerator<string> {
  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = resolve(rootPath, entry.name);
    if (entry.isDirectory()) {
      yield* walkAudioFiles(fullPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (audioExtensions.has(extname(entry.name).toLowerCase())) {
      yield fullPath;
    }
  }
}

export async function scanAudioFile(libraryRootId: string | null, filePath: string, normalizedPath = normalizePath(filePath)) {
  const fileStat = await stat(filePath);
  const sha256 = await hashFile(filePath);
  const extension = extname(filePath).toLowerCase().replace(/^\./, "");
  const tags: Array<{ key: string; value: string; source: string }> = [];
  let durationMs: number | null = null;
  let codec: string | null = null;
  let container: string | null = null;
  let bitrate: number | null = null;
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let scanStatus = "scanned";

  try {
    const metadata = await parseFile(filePath, { duration: true });
    durationMs = metadata.format.duration ? Math.round(metadata.format.duration * 1000) : null;
    codec = metadata.format.codec ?? null;
    container = metadata.format.container ?? null;
    bitrate = metadata.format.bitrate ? Math.round(metadata.format.bitrate) : null;
    sampleRate = metadata.format.sampleRate ?? null;
    channels = metadata.format.numberOfChannels ?? null;

    for (const [key, rawValue] of Object.entries(metadata.common)) {
      for (const value of normalizeTagValue(rawValue)) {
        tags.push({ key: key.toLowerCase(), value, source: "embedded" });
      }
    }
    appendPositionTags(tags, "track", metadata.common.track);
    appendPositionTags(tags, "disc", metadata.common.disk);
  } catch (error) {
    scanStatus = "metadata_error";
    tags.push({
      key: "scanner_warning",
      value: error instanceof Error ? error.message : String(error),
      source: "scanner"
    });
  }

  return {
    libraryRootId,
    path: filePath,
    normalizedPath,
    filename: basename(filePath),
    extension,
    sizeBytes: fileStat.size,
    mtime: fileStat.mtime.toISOString(),
    ctime: fileStat.ctime.toISOString(),
    sha256,
    quickHash: sha256.slice(0, 16),
    durationMs,
    codec,
    container,
    bitrate,
    sampleRate,
    channels,
    scanStatus,
    tags
  };
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function normalizeTagValue(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeTagValue(item));
  }

  if (typeof value === "object") {
    return [];
  }

  return [String(value)].filter((item) => item.length > 0);
}

function appendPositionTags(
  tags: Array<{ key: string; value: string; source: string }>,
  kind: "track" | "disc",
  value: unknown
): void {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return;
  }

  const position = value as { no?: unknown; of?: unknown };
  const number = normalizePositionNumber(position.no);
  const total = normalizePositionNumber(position.of);
  if (number != null) {
    tags.push({ key: kind === "track" ? "tracknumber" : "discnumber", value: String(number), source: "embedded" });
  }
  if (total != null) {
    tags.push({ key: kind === "track" ? "tracktotal" : "disctotal", value: String(total), source: "embedded" });
  }
}

function normalizePositionNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizePath(path: string): string {
  return resolve(path).toLowerCase();
}
