import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { copyFile, mkdir, readdir, rename, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { DuplicateCandidate, ImportBatch, ImportItem, LibraryRoot, MetadataCandidate } from "@music-os/core";
import type { BackendConfig } from "../config.js";
import { LibraryRepository } from "./library-repository.js";
import { audioExtensions, normalizePath, scanAudioFile } from "./library-scanner.js";
import type { MetadataResolver } from "./metadata-resolver.js";
import type { AcousticFingerprintService } from "./acoustic-fingerprint-service.js";

export class ImportService {
  private readonly stagingRoot: string;

  constructor(
    private readonly db: Database.Database,
    private readonly library: LibraryRepository,
    config: BackendConfig,
    private readonly metadataResolver: MetadataResolver,
    private readonly fingerprints: AcousticFingerprintService
  ) {
    this.stagingRoot = join(dirname(config.databasePath), "staging");
  }

  async createFromPaths(paths: string[], libraryRootId?: string): Promise<ImportBatch> {
    return this.createFromSourcePaths(paths, libraryRootId, "manual_paths", { originalPaths: paths });
  }

  async createFromSlskdDownloads(
    paths: string[],
    libraryRootId: string | undefined,
    context: Record<string, unknown>
  ): Promise<ImportBatch> {
    return this.createFromSourcePaths(paths, libraryRootId, "slskd_download", context);
  }

  private async createFromSourcePaths(
    paths: string[],
    libraryRootId: string | undefined,
    source: string,
    sourceContext: Record<string, unknown>
  ): Promise<ImportBatch> {
    const sourcePaths = await expandImportPaths(paths);
    if (sourcePaths.length === 0) {
      throw new Error("No supported audio files found in selected import path");
    }

    const importId = nanoid();
    const targetRoot = libraryRootId ? this.library.getRoot(libraryRootId) : this.library.listRoots()[0] ?? null;

    this.db
      .prepare(
        `INSERT INTO imports (id, source, source_context_json, status)
         VALUES (?, ?, ?, 'needs_review')`
      )
      .run(importId, source, JSON.stringify({ ...sourceContext, originalPaths: paths, expandedPaths: sourcePaths }));

    const importStageDir = join(this.stagingRoot, importId);
    await mkdir(importStageDir, { recursive: true });

    for (const sourcePath of sourcePaths) {
      await this.createItemFromPath(importId, sourcePath, importStageDir, targetRoot);
    }

    return this.getImport(importId);
  }

  listInbox(): ImportBatch[] {
    const imports = this.db
      .prepare(
        `SELECT * FROM imports
         WHERE status NOT IN ('completed')
         ORDER BY created_at DESC`
      )
      .all() as ImportRow[];

    return imports.map((row) => mapImport(row, this.listItems(row.id)));
  }

  getImport(importId: string): ImportBatch {
    const row = this.db.prepare("SELECT * FROM imports WHERE id = ?").get(importId) as ImportRow | undefined;
    if (!row) {
      throw new Error(`Import not found: ${importId}`);
    }

    return mapImport(row, this.listItems(importId));
  }

  async approveItem(importItemId: string, libraryRootId: string): Promise<ImportItem> {
    const item = this.getItem(importItemId);
    if (item.status === "imported") {
      return item;
    }
    if (item.status === "rejected") {
      throw new Error("Rejected import item cannot be approved");
    }

    const root = this.library.getRoot(libraryRootId);
    const destination = item.proposedDestination ?? buildDestinationPath(root, item, item.stagingPath);
    await mkdir(dirname(destination), { recursive: true });

    const finalPath = await uniqueDestination(destination);
    await rename(item.stagingPath, finalPath);

    const scanned = await scanAudioFile(root.id, finalPath);
    const upsert = this.library.upsertFile({ ...scanned, staged: false, importItemId: null });
    await this.storeFingerprint(upsert.id, finalPath);

    this.db
      .prepare(
        `UPDATE import_items
         SET file_id = ?, staging_path = ?, status = 'imported', proposed_destination = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(upsert.id, finalPath, finalPath, importItemId);
    this.deleteStagedFile(item.fileId);

    this.refreshImportStatus(item.importId);
    return this.getItem(importItemId);
  }

  rejectItem(importItemId: string): ImportItem {
    const item = this.getItem(importItemId);
    if (item.status === "imported") {
      throw new Error("Imported item cannot be rejected");
    }

    this.db
      .prepare("UPDATE import_items SET status = 'rejected', updated_at = datetime('now') WHERE id = ?")
      .run(importItemId);
    this.refreshImportStatus(item.importId);
    return this.getItem(importItemId);
  }

  updateItemMetadata(
    importItemId: string,
    metadata: { artist?: string | number | null; album?: string | number | null; title?: string | number | null; year?: string | number | null }
  ): ImportItem {
    const item = this.getItem(importItemId);
    if (item.status !== "needs_review") {
      throw new Error(`Import item metadata cannot be edited from status ${item.status}`);
    }

    const detected = {
      detectedArtist: cleanOptionalString(metadata.artist),
      detectedAlbum: cleanOptionalString(metadata.album),
      detectedTitle: cleanOptionalString(metadata.title),
      detectedYear: parseYearValue(metadata.year)
    };
    const root = this.chooseProposalRoot(item.proposedDestination);
    const proposedDestination = root ? buildDestinationPath(root, detected, item.stagingPath) : item.proposedDestination;
    const manualCandidate: MetadataCandidate = {
      source: "manual",
      externalId: null,
      title: detected.detectedTitle,
      artist: detected.detectedArtist,
      album: detected.detectedAlbum,
      year: detected.detectedYear,
      score: 1,
      reason: "User-edited during import review",
      externalUrl: null
    };
    const candidates = [manualCandidate, ...item.metadataCandidates.filter((candidate) => candidate.source !== "manual")];
    const warnings = item.warnings.filter((warning) => warning !== "Low metadata confidence; review before approval");

    this.db
      .prepare(
        `UPDATE import_items
         SET detected_artist = ?,
             detected_album = ?,
             detected_title = ?,
             detected_year = ?,
             metadata_candidates_json = ?,
             selected_candidate_json = ?,
             confidence_score = 1,
             proposed_destination = ?,
             warnings_json = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        detected.detectedArtist,
        detected.detectedAlbum,
        detected.detectedTitle,
        detected.detectedYear,
        JSON.stringify(candidates),
        JSON.stringify(manualCandidate),
        proposedDestination,
        JSON.stringify(warnings),
        importItemId
      );

    return this.getItem(importItemId);
  }

  private async createItemFromPath(
    importId: string,
    sourcePath: string,
    importStageDir: string,
    targetRoot: LibraryRoot | null
  ): Promise<void> {
    const extension = extname(sourcePath).toLowerCase();
    const warnings: string[] = [];
    const itemId = nanoid();

    if (!audioExtensions.has(extension)) {
      warnings.push("Unsupported audio extension");
    }

    await stat(sourcePath);
    const stagedPath = join(importStageDir, `${itemId}-${basename(sourcePath)}`);
    await copyFile(sourcePath, stagedPath);

    this.db
      .prepare(
        `INSERT INTO import_items (
          id, import_id, staging_path, status, warnings_json
        )
        VALUES (?, ?, ?, 'scanning', ?)`
      )
      .run(itemId, importId, stagedPath, JSON.stringify(warnings));

    const scanned = await scanAudioFile(null, stagedPath);
    const stagedFile = this.library.upsertFile({
      ...scanned,
      scanStatus: warnings.length > 0 ? "import_warning" : scanned.scanStatus,
      staged: true,
      importItemId: itemId
    });
    await this.storeFingerprint(stagedFile.id, stagedPath);
    const duplicateCandidates = this.library.findDuplicateCandidates(scanned.sha256, stagedFile.id);
    if (duplicateCandidates.length > 0) {
      warnings.push(`Exact duplicate already indexed (${duplicateCandidates.length} match${duplicateCandidates.length === 1 ? "" : "es"})`);
    }
    const tags = Object.fromEntries(scanned.tags.map((tag) => [tag.key, tag.value]));
    const metadata = await this.metadataResolver.resolve({
      filePath: sourcePath,
      durationMs: scanned.durationMs,
      tags
    });
    warnings.push(...metadata.warnings);
    const detected = metadata.selected ? candidateToImportItem(metadata.selected) : tagsToImportItem(tags);
    const proposal = targetRoot ? buildDestinationPath(targetRoot, detected, stagedPath) : null;
    const qualityScore = calculateQualityScore(scanned);

    this.db
      .prepare(
        `UPDATE import_items
         SET file_id = ?,
             status = 'needs_review',
             detected_artist = ?,
             detected_album = ?,
             detected_title = ?,
             detected_year = ?,
             metadata_candidates_json = ?,
             selected_candidate_json = ?,
             quality_score = ?,
             confidence_score = ?,
             proposed_destination = ?,
             duplicate_candidates_json = ?,
             warnings_json = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        stagedFile.id,
        detected.detectedArtist,
        detected.detectedAlbum,
        detected.detectedTitle,
        detected.detectedYear,
        JSON.stringify(metadata.candidates),
        metadata.selected ? JSON.stringify(metadata.selected) : null,
        qualityScore,
        metadata.confidenceScore,
        proposal,
        JSON.stringify(duplicateCandidates),
        JSON.stringify(warnings),
        itemId
      );
  }

  private listItems(importId: string): ImportItem[] {
    return (this.db
      .prepare("SELECT * FROM import_items WHERE import_id = ? ORDER BY created_at ASC")
      .all(importId) as ImportItemRow[]).map(mapItem);
  }

  getItem(importItemId: string): ImportItem {
    const row = this.db.prepare("SELECT * FROM import_items WHERE id = ?").get(importItemId) as
      | ImportItemRow
      | undefined;
    if (!row) {
      throw new Error(`Import item not found: ${importItemId}`);
    }
    return mapItem(row);
  }

  private deleteStagedFile(fileId: string | null): void {
    if (!fileId) {
      return;
    }
    this.db.prepare("DELETE FROM embedded_tags WHERE file_id = ?").run(fileId);
    this.db.prepare("DELETE FROM audio_fingerprints WHERE file_id = ?").run(fileId);
    this.db.prepare("DELETE FROM files WHERE id = ? AND staged = 1").run(fileId);
  }

  private async storeFingerprint(fileId: string, path: string): Promise<void> {
    const fingerprint = await this.fingerprints.fingerprint(path);
    if (!fingerprint) {
      return;
    }

    this.library.upsertAudioFingerprint({
      fileId,
      algorithm: fingerprint.algorithm,
      fingerprint: fingerprint.fingerprint,
      durationMs: fingerprint.durationMs
    });
  }

  private refreshImportStatus(importId: string): void {
    const rows = this.listItems(importId);
    const completed = rows.every((item) => item.status === "imported" || item.status === "rejected");
    this.db
      .prepare(
        `UPDATE imports
         SET status = ?, completed_at = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(completed ? "completed" : "needs_review", completed ? new Date().toISOString() : null, importId);
  }

  private chooseProposalRoot(proposedDestination: string | null): LibraryRoot | null {
    const roots = this.library.listRoots();
    if (roots.length === 0) {
      return null;
    }

    const matchingRoot = proposedDestination
      ? roots.find((root) => normalizePath(proposedDestination).startsWith(normalizePath(root.path)))
      : null;
    return matchingRoot ?? roots[0];
  }
}

async function expandImportPaths(paths: string[]): Promise<string[]> {
  const expanded: string[] = [];
  for (const sourcePath of paths) {
    const stats = await stat(sourcePath);
    if (stats.isDirectory()) {
      expanded.push(...(await listAudioFiles(sourcePath)));
      continue;
    }
    expanded.push(sourcePath);
  }
  return [...new Set(expanded)];
}

async function listAudioFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listAudioFiles(path)));
      continue;
    }
    if (entry.isFile() && audioExtensions.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files;
}

interface ImportRow {
  id: string;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ImportItemRow {
  id: string;
  import_id: string;
  file_id: string | null;
  staging_path: string;
  status: string;
  detected_artist: string | null;
  detected_album: string | null;
  detected_title: string | null;
  detected_year: number | null;
  proposed_destination: string | null;
  confidence_score: number | null;
  quality_score: number | null;
  metadata_candidates_json: string;
  selected_candidate_json: string | null;
  warnings_json: string;
  duplicate_candidates_json: string;
  created_at: string;
  updated_at: string;
}

function mapImport(row: ImportRow, items: ImportItem[]): ImportBatch {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    items
  };
}

function mapItem(row: ImportItemRow): ImportItem {
  return {
    id: row.id,
    importId: row.import_id,
    fileId: row.file_id,
    stagingPath: row.staging_path,
    status: row.status,
    detectedArtist: row.detected_artist,
    detectedAlbum: row.detected_album,
    detectedTitle: row.detected_title,
    detectedYear: row.detected_year,
    proposedDestination: row.proposed_destination,
    confidenceScore: row.confidence_score,
    qualityScore: row.quality_score,
    warnings: parseWarnings(row.warnings_json),
    metadataCandidates: parseMetadataCandidates(row.metadata_candidates_json),
    selectedCandidate: row.selected_candidate_json ? parseMetadataCandidate(row.selected_candidate_json) : null,
    duplicateCandidates: parseDuplicateCandidates(row.duplicate_candidates_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function tagsToImportItem(tags: Record<string, string>): Pick<ImportItem, "detectedArtist" | "detectedAlbum" | "detectedTitle" | "detectedYear"> {
  return {
    detectedArtist: tags.artist ?? tags.albumartist ?? null,
    detectedAlbum: tags.album ?? null,
    detectedTitle: tags.title ?? null,
    detectedYear: parseYear(tags.year ?? tags.date)
  };
}

function candidateToImportItem(
  candidate: MetadataCandidate
): Pick<ImportItem, "detectedArtist" | "detectedAlbum" | "detectedTitle" | "detectedYear"> {
  return {
    detectedArtist: candidate.artist,
    detectedAlbum: candidate.album,
    detectedTitle: candidate.title,
    detectedYear: candidate.year
  };
}

function buildDestinationPath(
  root: LibraryRoot,
  item: Pick<ImportItem, "detectedArtist" | "detectedAlbum" | "detectedTitle" | "detectedYear">,
  sourcePath: string
): string {
  const artist = sanitizePathSegment(item.detectedArtist ?? "Unknown Artist");
  const year = item.detectedYear ? String(item.detectedYear) : "Unknown Year";
  const album = sanitizePathSegment(item.detectedAlbum ?? "Unknown Album");
  const title = sanitizePathSegment(item.detectedTitle ?? basename(sourcePath, extname(sourcePath)));
  return join(root.path, artist, `${year} - ${album}`, `${title}${extname(sourcePath).toLowerCase()}`);
}

async function uniqueDestination(path: string): Promise<string> {
  let candidate = path;
  let counter = 1;
  while (await exists(candidate)) {
    const extension = extname(path);
    candidate = join(dirname(path), `${basename(path, extension)} (${counter})${extension}`);
    counter += 1;
  }
  return candidate;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function parseYear(value: string | undefined): number | null {
  const match = value?.match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}

function parseWarnings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseDuplicateCandidates(value: string): DuplicateCandidate[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item != null)
      .map((item) => ({
        fileId: String(item.fileId ?? ""),
        path: String(item.path ?? ""),
        filename: String(item.filename ?? ""),
        title: typeof item.title === "string" ? item.title : null,
        artist: typeof item.artist === "string" ? item.artist : null,
        album: typeof item.album === "string" ? item.album : null,
        reason: String(item.reason ?? "Exact file hash match")
      }))
      .filter((item) => item.fileId.length > 0 && item.path.length > 0 && item.filename.length > 0);
  } catch {
    return [];
  }
}

function parseMetadataCandidates(value: string): MetadataCandidate[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeMetadataCandidate).filter((item): item is MetadataCandidate => item != null);
  } catch {
    return [];
  }
}

function parseMetadataCandidate(value: string): MetadataCandidate | null {
  try {
    return normalizeMetadataCandidate(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function normalizeMetadataCandidate(value: unknown): MetadataCandidate | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }

  const item = value as Record<string, unknown>;
  const source =
    item.source === "embedded" || item.source === "filename" || item.source === "musicbrainz" || item.source === "manual"
      ? item.source
      : null;
  const score = typeof item.score === "number" ? item.score : Number(item.score);
  if (!source || !Number.isFinite(score)) {
    return null;
  }

  return {
    source,
    externalId: typeof item.externalId === "string" ? item.externalId : null,
    title: typeof item.title === "string" ? item.title : null,
    artist: typeof item.artist === "string" ? item.artist : null,
    album: typeof item.album === "string" ? item.album : null,
    year: typeof item.year === "number" ? item.year : null,
    score: Math.max(0, Math.min(1, score)),
    reason: typeof item.reason === "string" ? item.reason : "Metadata candidate",
    externalUrl: typeof item.externalUrl === "string" ? item.externalUrl : null
  };
}

function cleanOptionalString(value: string | number | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const cleaned = String(value).trim();
  return cleaned.length > 0 ? cleaned : null;
}

function parseYearValue(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  return parseYear(typeof value === "string" ? value : undefined);
}

function calculateQualityScore(scanned: Awaited<ReturnType<typeof scanAudioFile>>): number {
  let score = 0.25;
  if (scanned.codec?.toLowerCase().includes("flac") || scanned.extension === "flac") {
    score += 0.4;
  } else if (scanned.extension === "m4a" || scanned.extension === "mp3") {
    score += 0.15;
  }
  if (scanned.bitrate) {
    score += Math.min(0.25, scanned.bitrate / 1_000_000);
  }
  if (scanned.sampleRate && scanned.sampleRate >= 44100) {
    score += 0.05;
  }
  if (scanned.channels && scanned.channels >= 2) {
    score += 0.05;
  }
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "Unknown";
}
