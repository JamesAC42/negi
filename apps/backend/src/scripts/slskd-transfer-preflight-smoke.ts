import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";
import { getBackendConfig } from "../config.js";
import { rankDiscoveryResultsByAvailability } from "../services/discovery-availability.js";

const query = (process.env.MUSIC_OS_SLSKD_PREFLIGHT_QUERY ?? process.env.MUSIC_OS_LIVE_SLSKD_QUERY)?.trim();
const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-slskd-preflight-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  if (!query) {
    throw new Error("Set MUSIC_OS_SLSKD_PREFLIGHT_QUERY to a small, specific slskd search query");
  }

  const baseConfig = getBackendConfig();
  if (!baseConfig.slskdUrl) {
    throw new Error("MUSIC_OS_SLSKD_URL is required");
  }
  if (!baseConfig.slskdApiKey && (!baseConfig.slskdUsername || !baseConfig.slskdPassword)) {
    throw new Error("MUSIC_OS_SLSKD_API_KEY or MUSIC_OS_SLSKD_USERNAME/PASSWORD is required");
  }
  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({
    ...baseConfig,
    databasePath,
    port: 0,
    musicBrainzEnabled: false
  });

  try {
    const root = app.library.addRoot(libraryPath, "slskd-preflight");
    const health = await app.discovery.health();
    assert(health.reachable, `slskd is not reachable: ${health.message ?? "no health message"}`);

    const search = await app.discovery.search(query, Number(process.env.MUSIC_OS_SLSKD_PREFLIGHT_RESPONSE_LIMIT ?? 25));
    const selected = rankDiscoveryResultsByAvailability(search.results.filter((result) => !result.isLocked))[0];
    assert(selected != null, `No unlocked slskd result found for "${query}"`);

    const batch = app.operations.createQueueDownloadBatch([selected], query, "agent", root.id);
    assert(batch.status === "proposed", `expected proposed batch, got ${batch.status}`);
    assert(batch.operations.length === 1, `expected one queue_download operation, got ${batch.operations.length}`);
    assert(batch.operations[0]?.type === "queue_download", `expected queue_download operation, got ${batch.operations[0]?.type}`);
    assert(app.discoveryDownloads.listJobs().length === 0, "preflight should not create download jobs");
    assert(app.imports.listInbox().length === 0, "preflight should not create import batches");
    assert(app.library.countFiles() === 0, `preflight should not index files, got ${app.library.countFiles()}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          query,
          health: health.message,
          searched: search.results.length,
          selected: {
            username: selected.username,
            filename: selected.filename,
            sizeBytes: selected.sizeBytes,
            locked: selected.isLocked,
            hasFreeUploadSlot: selected.hasFreeUploadSlot ?? null,
            queueLength: selected.queueLength ?? null,
            uploadSpeedBytesPerSecond: selected.uploadSpeedBytesPerSecond ?? null
          },
          batch: {
            id: batch.id,
            status: batch.status,
            summary: batch.summary
          },
          downloadDirectoryConfigured: health.downloadsConfigured,
          mutated: {
            downloadJobs: app.discoveryDownloads.listJobs().length,
            imports: app.imports.listInbox().length,
            libraryFiles: app.library.countFiles()
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

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
