import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DiscoveryDownloadJob } from "@music-os/core";
import { createBackendApp } from "../app.js";
import { getBackendConfig } from "../config.js";
import { rankDiscoveryResultsByAvailability } from "../services/discovery-availability.js";

const confirm = process.env.MUSIC_OS_LIVE_SLSKD_CONFIRM === "1";
const query = process.env.MUSIC_OS_LIVE_SLSKD_QUERY?.trim();
const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-live-slskd-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  if (!confirm) {
    throw new Error("Set MUSIC_OS_LIVE_SLSKD_CONFIRM=1 to run the live slskd transfer smoke test");
  }
  if (!query) {
    throw new Error("Set MUSIC_OS_LIVE_SLSKD_QUERY to a small, specific Soulseek search query");
  }

  const baseConfig = getBackendConfig();
  if (!baseConfig.slskdUrl) {
    throw new Error("MUSIC_OS_SLSKD_URL is required");
  }
  if (!baseConfig.slskdApiKey && (!baseConfig.slskdUsername || !baseConfig.slskdPassword)) {
    throw new Error("MUSIC_OS_SLSKD_API_KEY or MUSIC_OS_SLSKD_USERNAME/PASSWORD is required");
  }
  if (!baseConfig.slskdDownloadDirectory) {
    throw new Error("MUSIC_OS_SLSKD_DOWNLOAD_DIR is required");
  }

  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({
    ...baseConfig,
    databasePath,
    port: 0,
    musicBrainzEnabled: false
  });

  try {
    const root = app.library.addRoot(libraryPath, "live-slskd-smoke");
    const health = await app.discovery.health();
    assert(health.reachable, `slskd is not reachable: ${health.message ?? "no health message"}`);

    const search = await app.discovery.search(query, Number(process.env.MUSIC_OS_LIVE_SLSKD_RESPONSE_LIMIT ?? 25));
    const selected = rankDiscoveryResultsByAvailability(search.results.filter((result) => !result.isLocked))[0];
    assert(selected != null, `No unlocked slskd result found for "${query}"`);

    const batch = app.operations.createQueueDownloadBatch([selected], query, "agent");
    app.operations.approveBatch(batch.id);
    const applied = await app.operations.applyBatch(batch.id);
    assert(applied.status === "applied", `Expected applied queue_download batch, got ${applied.status}`);

    const jobId = readAppliedJobId(applied.operations[0]?.after) ?? app.discoveryDownloads.listJobs()[0]?.id;
    assert(jobId != null, "queue_download apply did not create a discovery download job");

    const completed = await waitForJob(app, jobId);
    assert(completed.imported != null, "completed download job did not create an import batch");
    assert(completed.imported.items.length > 0, "completed import batch has no import items");
    assert(
      completed.imported.items.every((item) => item.status === "needs_review"),
      `expected import items to remain in review, got ${completed.imported.items.map((item) => item.status).join(", ")}`
    );
    assert(app.library.countFiles() === 0, `download staging should not import directly into library, got ${app.library.countFiles()}`);
    await stat(completed.imported.items[0].stagingPath);

    console.log(
      JSON.stringify(
        {
          ok: true,
          query,
          selected: {
            username: selected.username,
            filename: selected.filename,
            sizeBytes: selected.sizeBytes,
            hasFreeUploadSlot: selected.hasFreeUploadSlot ?? null,
            queueLength: selected.queueLength ?? null,
            uploadSpeedBytesPerSecond: selected.uploadSpeedBytesPerSecond ?? null
          },
          job: {
            id: completed.id,
            status: completed.status,
            completedCount: completed.completedCount,
            importId: completed.imported.id
          }
        },
        null,
        2
      )
    );
  } finally {
    app.close();
  }
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

async function waitForJob(app: ReturnType<typeof createBackendApp>, jobId: string): Promise<DiscoveryDownloadJob> {
  const timeoutMs = Number(process.env.MUSIC_OS_LIVE_SLSKD_TIMEOUT_MS ?? 180_000);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = app.discoveryDownloads.getJob(jobId);
    if (job.status === "succeeded") {
      return job;
    }
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(job.error ?? `Discovery download job ended with ${job.status}`);
    }
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for discovery download job ${jobId}`);
}

function readAppliedJobId(value: unknown): string | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
