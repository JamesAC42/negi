import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { extname } from "node:path";
import type { DiscoveryDownloadJob, DiscoveryResult, ImportBatch } from "@music-os/core";
import type { ImportService } from "./import-service.js";
import type { SlskdDownloadInspection, SlskdService } from "./slskd-service.js";

type DownloadJobPayload = {
  results: DiscoveryResult[];
  libraryRootId?: string;
};

type DownloadJobResult = {
  importId?: string;
  completedPaths: string[];
  completedCount: number;
};

export class DiscoveryDownloadService {
  private readonly activeJobs = new Set<string>();

  constructor(
    private readonly db: Database.Database,
    private readonly discovery: SlskdService,
    private readonly imports: ImportService
  ) {
    for (const job of this.listJobs().filter((job) => job.status === "queued" || job.status === "running")) {
      this.startJob(job.id);
    }
  }

  listJobs(): DiscoveryDownloadJob[] {
    return (this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE type = 'discovery_download'
         ORDER BY created_at DESC
         LIMIT 50`
      )
      .all() as JobRow[]).map((row) => this.mapJob(row));
  }

  getJob(jobId: string): DiscoveryDownloadJob {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ? AND type = 'discovery_download'").get(jobId) as JobRow | undefined;
    if (!row) {
      throw new Error(`Discovery download job not found: ${jobId}`);
    }
    return this.mapJob(row);
  }

  createJob(results: DiscoveryResult[], libraryRootId?: string): DiscoveryDownloadJob {
    const unlocked = results.filter((result) => !result.isLocked && isAudioDiscoveryResult(result));
    if (unlocked.length === 0) {
      throw new Error("No unlocked audio discovery results were selected");
    }

    const id = nanoid();
    const payload: DownloadJobPayload = { results: unlocked, libraryRootId };
    this.db
      .prepare(
        `INSERT INTO jobs (id, type, status, progress, payload_json)
         VALUES (?, 'discovery_download', 'queued', 0, ?)`
      )
      .run(id, JSON.stringify(payload));
    this.addEvent(id, "info", `Queued ${unlocked.length} selected discovery result${unlocked.length === 1 ? "" : "s"}`);
    this.startJob(id);
    return this.getJob(id);
  }

  retryJob(jobId: string): DiscoveryDownloadJob {
    const job = this.getJob(jobId);
    if (job.status !== "failed" && job.status !== "cancelled") {
      throw new Error(`Only failed or cancelled jobs can be retried from status ${job.status}`);
    }

    this.db
      .prepare(
        `UPDATE jobs
         SET status = 'queued',
             progress = 0,
             result_json = NULL,
             error_json = NULL,
             started_at = NULL,
             completed_at = NULL,
             cancel_requested = 0
         WHERE id = ?`
      )
      .run(jobId);
    this.db.prepare("DELETE FROM job_events WHERE job_id = ?").run(jobId);
    this.addEvent(jobId, "info", "Retry requested");
    this.startJob(jobId);
    return this.getJob(jobId);
  }

  cancelJob(jobId: string): DiscoveryDownloadJob {
    const job = this.getJob(jobId);
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return job;
    }

    this.db
      .prepare(
        `UPDATE jobs
         SET status = 'cancelled',
             completed_at = datetime('now'),
             cancel_requested = 1
         WHERE id = ?`
      )
      .run(jobId);
    this.addEvent(jobId, "warning", "Music OS monitoring cancelled; slskd transfer may still continue");
    return this.getJob(jobId);
  }

  private startJob(jobId: string): void {
    if (this.activeJobs.has(jobId)) {
      return;
    }
    this.activeJobs.add(jobId);
    void this.runJob(jobId).finally(() => {
      this.activeJobs.delete(jobId);
    });
  }

  private async runJob(jobId: string): Promise<void> {
    try {
      const payload = this.getPayload(jobId);
      this.db
        .prepare(
          `UPDATE jobs
           SET status = 'running',
               started_at = COALESCE(started_at, datetime('now')),
               completed_at = NULL,
               error_json = NULL
           WHERE id = ? AND status IN ('queued', 'running')`
        )
        .run(jobId);

      const alreadySentToSlskd = this.hasSentToSlskdEvent(jobId);
      const queued = alreadySentToSlskd
        ? payload.results.filter((result) => !result.isLocked)
        : await this.discovery.queueDownloadResults(payload.results);
      this.addEvent(
        jobId,
        "info",
        alreadySentToSlskd
          ? `Resumed monitoring ${queued.length} existing slskd transfer${queued.length === 1 ? "" : "s"}`
          : `Sent ${queued.length} result${queued.length === 1 ? "" : "s"} to slskd`
      );

      let completedPaths: string[] = [];
      let lastInspection: SlskdDownloadInspection | null = null;
      let lastInspectionSignature: string | null = null;
      let nextInspectionAt = Date.now() + downloadInspectionIntervalMs();
      let nextLocalScanAt = 0;
      let nextHeartbeatAt = Date.now() + downloadHeartbeatIntervalMs();
      const deadline = Date.now() + discoveryDownloadTimeoutMs();
      for (let attempt = 0; Date.now() < deadline; attempt += 1) {
        if (this.isCancelRequested(jobId)) {
          return;
        }
        await delay(attempt === 0 ? 1200 : discoveryDownloadPollIntervalMs());
        if (Date.now() >= nextLocalScanAt) {
          completedPaths = await this.discovery.findCompletedDownloadPaths(queued);
          this.updateProgress(jobId, queued.length, completedPaths.length);
          if (completedPaths.length >= queued.length) {
            break;
          }
        }

        if (Date.now() >= nextInspectionAt) {
          lastInspection = await this.discovery.inspectDownloadResults(queued);
          const signature = downloadInspectionSignature(lastInspection);
          const shouldRecordEvent = signature !== lastInspectionSignature || Date.now() >= nextHeartbeatAt;
          if (shouldRecordEvent) {
            this.addEvent(jobId, "info", formatDownloadInspectionEvent(lastInspection));
            lastInspectionSignature = signature;
            nextHeartbeatAt = Date.now() + downloadHeartbeatIntervalMs();
          }
          if (lastInspection.completedPaths.length > completedPaths.length) {
            completedPaths = lastInspection.completedPaths;
            this.updateProgress(jobId, queued.length, completedPaths.length);
          }
          if (completedPaths.length >= queued.length) {
            break;
          }
          nextLocalScanAt = Date.now() + nextLocalScanDelayMs(lastInspection);
          nextInspectionAt = Date.now() + downloadInspectionIntervalMs();
          if (allKnownTransfersFailed(lastInspection, queued.length)) {
            throw new Error(formatNoCompletedDownloadsError(lastInspection));
          }
        }
      }

      if (this.isCancelRequested(jobId)) {
        return;
      }

      if (completedPaths.length === 0) {
        const inspection = lastInspection ?? (await this.discovery.inspectDownloadResults(queued));
        this.addEvent(jobId, "warning", formatDownloadInspectionEvent(inspection));
        throw new Error(formatNoCompletedDownloadsError(inspection));
      }

      const imported = await this.imports.createFromSlskdDownloads(completedPaths, payload.libraryRootId, {
        downloadJobId: jobId,
        selectedResults: payload.results.map((item) => ({
          id: item.id,
          username: item.username,
          path: item.path,
          sizeBytes: item.sizeBytes
        }))
      });
      const result: DownloadJobResult = {
        importId: imported.id,
        completedPaths,
        completedCount: completedPaths.length
      };
      this.db
        .prepare(
          `UPDATE jobs
           SET status = 'succeeded',
               progress = 1,
               result_json = ?,
               started_at = COALESCE(started_at, datetime('now')),
               completed_at = datetime('now')
           WHERE id = ?`
        )
        .run(JSON.stringify(result), jobId);
      this.addEvent(jobId, "info", `Staged ${completedPaths.length} completed file${completedPaths.length === 1 ? "" : "s"} into Imports`);
    } catch (error) {
      this.db
        .prepare(
          `UPDATE jobs
           SET status = 'failed',
               error_json = ?,
               started_at = COALESCE(started_at, datetime('now')),
               completed_at = datetime('now')
           WHERE id = ?`
        )
        .run(JSON.stringify({ message: getErrorMessage(error) }), jobId);
      this.addEvent(jobId, "error", getErrorMessage(error));
    }
  }

  private getPayload(jobId: string): DownloadJobPayload {
    const row = this.db.prepare("SELECT payload_json FROM jobs WHERE id = ?").get(jobId) as { payload_json: string } | undefined;
    if (!row) {
      throw new Error(`Discovery download job not found: ${jobId}`);
    }
    return JSON.parse(row.payload_json) as DownloadJobPayload;
  }

  private isCancelRequested(jobId: string): boolean {
    const row = this.db.prepare("SELECT cancel_requested FROM jobs WHERE id = ?").get(jobId) as { cancel_requested: number } | undefined;
    return row?.cancel_requested === 1;
  }

  private hasSentToSlskdEvent(jobId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM job_events
         WHERE job_id = ? AND message LIKE 'Sent % to slskd'
         LIMIT 1`
      )
      .get(jobId) as { 1: number } | undefined;
    return row != null;
  }

  private updateProgress(jobId: string, selectedCount: number, completedCount: number): void {
    this.db
      .prepare("UPDATE jobs SET progress = ? WHERE id = ?")
      .run(selectedCount > 0 ? Math.min(1, completedCount / selectedCount) : 0, jobId);
  }

  private addEvent(jobId: string, level: string, message: string): void {
    this.db
      .prepare(
        `INSERT INTO job_events (id, job_id, timestamp, level, message)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(nanoid(), jobId, new Date().toISOString(), level, message);
  }

  private mapJob(row: JobRow): DiscoveryDownloadJob {
    const payload = safeParse<DownloadJobPayload>(row.payload_json, { results: [] });
    const result = row.result_json ? safeParse<DownloadJobResult>(row.result_json, { completedPaths: [], completedCount: 0 }) : null;
    const error = row.error_json ? safeParse<{ message?: string }>(row.error_json, {}) : null;
    const imported = result?.importId ? this.safeGetImport(result.importId) : null;
    return {
      id: row.id,
      status: row.status as DiscoveryDownloadJob["status"],
      progress: Math.max(0, Math.min(1, row.progress)),
      selectedCount: payload.results.length,
      completedCount: result?.completedCount ?? Math.round(Math.max(0, Math.min(1, row.progress)) * payload.results.length),
      imported,
      message: latestJobMessage(this.db, row.id),
      error: error?.message ?? null,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at
    };
  }

  private safeGetImport(importId: string): ImportBatch | null {
    try {
      return this.imports.getImport(importId);
    } catch {
      return null;
    }
  }
}

interface JobRow {
  id: string;
  status: string;
  progress: number;
  payload_json: string;
  result_json: string | null;
  error_json: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function latestJobMessage(db: Database.Database, jobId: string): string | null {
  const row = db
    .prepare(
      `SELECT message FROM job_events
       WHERE job_id = ?
       ORDER BY timestamp DESC, id DESC
       LIMIT 1`
    )
    .get(jobId) as { message: string } | undefined;
  return row?.message ?? null;
}

function safeParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function discoveryDownloadTimeoutMs(): number {
  return readPositiveIntegerEnv("MUSIC_OS_DISCOVERY_DOWNLOAD_TIMEOUT_MS", 30 * 60 * 1000);
}

function discoveryDownloadPollIntervalMs(): number {
  return readPositiveIntegerEnv("MUSIC_OS_DISCOVERY_DOWNLOAD_POLL_MS", 2000);
}

function downloadInspectionIntervalMs(): number {
  return readPositiveIntegerEnv("MUSIC_OS_DISCOVERY_DOWNLOAD_INSPECT_MS", 15 * 1000);
}

function downloadHeartbeatIntervalMs(): number {
  return readPositiveIntegerEnv("MUSIC_OS_DISCOVERY_DOWNLOAD_HEARTBEAT_MS", 5 * 60 * 1000);
}

function queuedLocalScanIntervalMs(): number {
  return readPositiveIntegerEnv("MUSIC_OS_DISCOVERY_DOWNLOAD_QUEUED_SCAN_MS", 30 * 1000);
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function allKnownTransfersFailed(inspection: SlskdDownloadInspection, selectedCount: number): boolean {
  return inspection.transfers.matched >= selectedCount && inspection.transfers.failed >= selectedCount;
}

function formatDownloadInspectionEvent(inspection: SlskdDownloadInspection): string {
  if (allKnownTransfersQueued(inspection)) {
    const samples = formatTransferSamples(inspection);
    return `Waiting for remote Soulseek slots; ${inspection.transfers.queued} matching transfer${inspection.transfers.queued === 1 ? "" : "s"} queued remotely${samples ? `; ${samples}` : ""}`;
  }
  const transferParts = [
    `${inspection.transfers.matched}/${inspection.transfers.total} matching transfer records`,
    `${inspection.transfers.completed} completed`,
    `${inspection.transfers.active} active`,
    `${inspection.transfers.queued} queued`,
    `${inspection.transfers.failed} failed`
  ];
  if (inspection.transfers.error) {
    transferParts.push(`transfer check failed: ${inspection.transfers.error}`);
  }
  const samples = formatTransferSamples(inspection);
  return `Checked slskd downloads in ${inspection.downloadDirectory}; ${inspection.filesSeen} local file${inspection.filesSeen === 1 ? "" : "s"} seen; ${transferParts.join(", ")}${samples ? `; ${samples}` : ""}`;
}

function downloadInspectionSignature(inspection: SlskdDownloadInspection): string {
  return [
    inspection.filesSeen,
    inspection.completedPaths.length,
    inspection.transfers.matched,
    inspection.transfers.completed,
    inspection.transfers.active,
    inspection.transfers.queued,
    inspection.transfers.failed,
    inspection.transfers.other,
    inspection.transfers.error ?? ""
  ].join("|");
}

function nextLocalScanDelayMs(inspection: SlskdDownloadInspection): number {
  return allKnownTransfersQueued(inspection) ? queuedLocalScanIntervalMs() : discoveryDownloadPollIntervalMs();
}

function allKnownTransfersQueued(inspection: SlskdDownloadInspection): boolean {
  return (
    inspection.transfers.matched > 0 &&
    inspection.transfers.queued > 0 &&
    inspection.transfers.completed === 0 &&
    inspection.transfers.active === 0 &&
    inspection.transfers.failed === 0
  );
}

function formatNoCompletedDownloadsError(inspection: SlskdDownloadInspection): string {
  const base = `No completed files were found in ${inspection.downloadDirectory}`;
  if (inspection.directoryError) {
    return `${base}; Music OS could not scan that folder: ${inspection.directoryError}`;
  }
  if (inspection.transfers.error) {
    return `${base}; ${inspection.filesSeen} local file${inspection.filesSeen === 1 ? "" : "s"} were scanned, but slskd transfer status could not be read: ${inspection.transfers.error}`;
  }
  if (inspection.transfers.failed > 0) {
    const samples = formatTransferSamples(inspection);
    return `${base}; slskd reports ${inspection.transfers.failed} matching transfer${inspection.transfers.failed === 1 ? "" : "s"} failed${samples ? ` (${samples})` : ""}.`;
  }
  if (inspection.transfers.completed > 0) {
    return `${base}; slskd reports ${inspection.transfers.completed} matching transfer${inspection.transfers.completed === 1 ? "" : "s"} completed, so MUSIC_OS_SLSKD_DOWNLOAD_DIR may not match slskd's download folder.`;
  }
  if (inspection.transfers.active > 0 || inspection.transfers.queued > 0) {
    return `${base}; slskd still reports ${inspection.transfers.active} active and ${inspection.transfers.queued} queued matching transfer${inspection.transfers.active + inspection.transfers.queued === 1 ? "" : "s"}.`;
  }
  if (inspection.transfers.matched === 0) {
    return `${base}; slskd did not return matching transfer records for the selected files, and Music OS scanned ${inspection.filesSeen} local file${inspection.filesSeen === 1 ? "" : "s"}.`;
  }
  return `${base}; Music OS scanned ${inspection.filesSeen} local file${inspection.filesSeen === 1 ? "" : "s"} and found no selected filenames with matching sizes.`;
}

function formatTransferSamples(inspection: SlskdDownloadInspection): string | null {
  const failed = inspection.transfers.samples.filter((sample) => /fail|error|cancel|abort|reject/i.test(sample.state));
  const samples = failed.length > 0 ? failed : inspection.transfers.samples;
  if (samples.length === 0) {
    return null;
  }
  return samples
    .slice(0, 3)
    .map((sample) => {
      const owner = sample.username ? `${sample.username}: ` : "";
      const detail = sample.message ? ` - ${sample.message}` : "";
      const pathDetail = sample.paths.length > 0 ? ` paths: ${sample.paths.join(" | ")}` : "";
      return `${owner}${sample.filename} [${sample.state}]${detail}${pathDetail}`;
    })
    .join("; ");
}

function isAudioDiscoveryResult(result: DiscoveryResult): boolean {
  const extension = result.extension ?? extname(result.filename || result.path).replace(/^\./, "");
  return audioExtensions.has(extension.toLowerCase());
}

const audioExtensions = new Set([
  "aac",
  "aiff",
  "alac",
  "ape",
  "dsf",
  "flac",
  "m4a",
  "mp3",
  "ogg",
  "opus",
  "wav",
  "wma"
]);
