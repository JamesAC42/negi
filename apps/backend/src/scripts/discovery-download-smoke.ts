import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DiscoveryResult } from "@music-os/core";
import { createBackendApp } from "../app.js";
import { DiscoveryDownloadService } from "../services/discovery-download-service.js";
import { OperationService } from "../services/operation-service.js";
import type { SlskdService } from "../services/slskd-service.js";

class FakeSlskd {
  constructor(private readonly completedPath: string) {}

  async queueDownloadResults(results: DiscoveryResult[]): Promise<DiscoveryResult[]> {
    await writeFile(this.completedPath, makeId3Fixture());
    return results;
  }

  async findCompletedDownloadPaths(): Promise<string[]> {
    return [this.completedPath];
  }
}

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-discovery-download-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");
const downloadPath = join(fixtureDir, "downloads", "Remote Artist - Remote Title.mp3");

try {
  await mkdir(libraryPath, { recursive: true });
  await mkdir(join(fixtureDir, "downloads"), { recursive: true });

  const app = createBackendApp({
    host: "127.0.0.1",
    port: 0,
    databasePath,
    mpvPath: "mpv",
    musicBrainzEnabled: false,
    slskdDownloadDirectory: join(fixtureDir, "downloads")
  });
  const root = app.library.addRoot(libraryPath, "library");
  const discovery = new FakeSlskd(downloadPath);
  const downloads = new DiscoveryDownloadService(app.db, discovery as unknown as SlskdService, app.imports);
  const result = makeDiscoveryResult();

  const created = downloads.createJob([result], root.id);
  assert(created.status === "queued" || created.status === "running", `expected queued/running job, got ${created.status}`);

  const completed = await waitForJob(downloads, created.id, "succeeded");
  assert(completed.progress === 1, `expected progress 1, got ${completed.progress}`);
  assert(completed.completedCount === 1, `expected one completed file, got ${completed.completedCount}`);
  assert(completed.imported != null, "expected completed job to create import batch");
  assert(completed.imported.items.length === 1, `expected one import item, got ${completed.imported.items.length}`);
  assert(completed.imported.items[0].status === "needs_review", `expected import needs_review, got ${completed.imported.items[0].status}`);
  assert(app.library.countFiles() === 0, `download staging should not mutate library, got ${app.library.countFiles()}`);
  await stat(completed.imported.items[0].stagingPath);

  const cancelled = downloads.cancelJob(downloads.createJob([result], root.id).id);
  assert(cancelled.status === "cancelled", `expected cancelled job, got ${cancelled.status}`);

  const retried = downloads.retryJob(cancelled.id);
  assert(retried.status === "queued" || retried.status === "running", `expected retried queued/running job, got ${retried.status}`);
  const retriedCompleted = await waitForJob(downloads, cancelled.id, "succeeded");
  assert(retriedCompleted.startedAt != null, "retried completed job should have startedAt");

  const operations = new OperationService(app.db, app.imports, app.library, downloads);
  const proposedDownload = operations.createQueueDownloadBatch([result], "remote artist remote title", "user", root.id);
  assert(proposedDownload.status === "proposed", `expected proposed download batch, got ${proposedDownload.status}`);
  assert(proposedDownload.source === "user", `expected user source, got ${proposedDownload.source}`);
  assert(proposedDownload.operations[0].type === "queue_download", `expected queue_download, got ${proposedDownload.operations[0].type}`);
  assert(operationPayload(proposedDownload.operations[0].payload).libraryRootId === root.id, "expected queue_download payload to keep selected root");

  const jobCountBeforeApply = downloads.listJobs().length;
  operations.approveBatch(proposedDownload.id);
  const appliedDownload = await operations.applyBatch(proposedDownload.id);
  assert(appliedDownload.status === "applied", `expected applied queue_download batch, got ${appliedDownload.status}`);
  assert(downloads.listJobs().length === jobCountBeforeApply + 1, "queue_download apply should create one monitored download job");
  const createdJobId = operationPayload(appliedDownload.operations[0].after).id;
  assert(typeof createdJobId === "string" && createdJobId.length > 0, "queue_download after-state should include created job id");
  const operationCompleted = await waitForJob(downloads, createdJobId, "succeeded");
  assert(operationCompleted.imported?.items.length === 1, "operation-created download job should create one import item");

  app.close();
  console.log(JSON.stringify({ ok: true, completed, retriedCompleted, appliedDownload, operationCompleted }, null, 2));
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

async function waitForJob(
  downloads: DiscoveryDownloadService,
  jobId: string,
  status: "succeeded" | "failed" | "cancelled"
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = downloads.getJob(jobId);
    if (job.status === status) {
      return job;
    }
    if (job.status === "failed" && status !== "failed") {
      throw new Error(job.error ?? "job failed");
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for discovery download job ${jobId} to reach ${status}`);
}

function makeDiscoveryResult(): DiscoveryResult {
  return {
    id: Buffer.from(["remote-user", "Remote Folder\\Remote Artist - Remote Title.mp3", "0"].join("\0")).toString("base64url"),
    source: "slskd",
    username: "remote-user",
    filename: "Remote Artist - Remote Title.mp3",
    path: "Remote Folder\\Remote Artist - Remote Title.mp3",
    folder: "Remote Folder",
    sizeBytes: null,
    extension: "mp3",
    bitrate: null,
    sampleRate: null,
    lengthSeconds: null,
    isLocked: false,
    raw: {
      filename: "Remote Folder\\Remote Artist - Remote Title.mp3"
    }
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function operationPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error("Expected operation payload object");
  }
  return value as Record<string, unknown>;
}

function makeId3Fixture(): Buffer {
  const frames = Buffer.concat([
    makeTextFrame("TIT2", "Remote Title"),
    makeTextFrame("TPE1", "Remote Artist"),
    makeTextFrame("TALB", "Remote Album"),
    makeTextFrame("TYER", "1985")
  ]);
  return Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0]), encodeSyncSafe(frames.length), frames]);
}

function makeTextFrame(id: string, value: string): Buffer {
  const body = Buffer.concat([Buffer.from([0]), Buffer.from(value, "latin1")]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  return Buffer.concat([Buffer.from(id, "ascii"), size, Buffer.from([0, 0]), body]);
}

function encodeSyncSafe(size: number): Buffer {
  return Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}
