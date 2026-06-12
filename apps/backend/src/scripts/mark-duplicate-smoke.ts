import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-mark-duplicate-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "library");
  const canonical = insertFile(app, root.id, "Canonical.flac", "Canonical Track", "canonical");
  const duplicate = insertFile(app, root.id, "Duplicate.mp3", "Duplicate Track", "duplicate");

  const batch = app.operations.createMarkDuplicateBatch(canonical.id, duplicate.id, "same recording");
  assert(batch.operations[0].type === "mark_duplicate", `unexpected operation ${batch.operations[0].type}`);
  app.operations.approveBatch(batch.id);
  const applied = await app.operations.applyBatch(batch.id);
  assert(applied.status === "applied", `expected mark applied, got ${applied.status}`);
  assert(countDuplicateMarks(app, canonical.id, duplicate.id) === 1, "expected one duplicate mark");
  assert(app.library.getFile(canonical.id).id === canonical.id, "canonical file should remain indexed");
  assert(app.library.getFile(duplicate.id).id === duplicate.id, "duplicate file should remain indexed");

  const idempotentBatch = app.operations.createMarkDuplicateBatch(canonical.id, duplicate.id, "already marked");
  app.operations.approveBatch(idempotentBatch.id);
  const appliedIdempotent = await app.operations.applyBatch(idempotentBatch.id);
  assert(appliedIdempotent.status === "applied", `expected idempotent mark applied, got ${appliedIdempotent.status}`);
  assert(countDuplicateMarks(app, canonical.id, duplicate.id) === 1, "idempotent mark should not duplicate rows");
  assert(readCreatedFlag(appliedIdempotent.operations[0]?.after) === false, "idempotent after-state should be created=false");

  const reverted = await app.operations.revertBatch(batch.id);
  assert(reverted.status === "reverted", `expected mark reverted, got ${reverted.status}`);
  assert(countDuplicateMarks(app, canonical.id, duplicate.id) === 0, "expected created duplicate mark removed on revert");

  app.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        mark: applied.status,
        idempotent: appliedIdempotent.status,
        revert: reverted.status
      },
      null,
      2
    )
  );
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function insertFile(
  app: ReturnType<typeof createBackendApp>,
  libraryRootId: string,
  filename: string,
  title: string,
  hashKey: string
) {
  const filePath = join(libraryPath, filename);
  return app.library.upsertFile({
    libraryRootId,
    path: filePath,
    normalizedPath: filePath.toLowerCase(),
    filename,
    extension: filename.split(".").pop() ?? "mp3",
    sizeBytes: 1024,
    mtime: new Date().toISOString(),
    ctime: null,
    sha256: `${hashKey}-sha`,
    quickHash: `${hashKey}-quick`,
    durationMs: 180000,
    codec: "mp3",
    container: "mp3",
    bitrate: 320000,
    sampleRate: 44100,
    channels: 2,
    scanStatus: "scanned",
    tags: [
      { key: "title", value: title, source: "smoke" },
      { key: "artist", value: "Duplicate Mark Artist", source: "smoke" },
      { key: "album", value: "Duplicate Mark Album", source: "smoke" }
    ]
  });
}

function countDuplicateMarks(app: ReturnType<typeof createBackendApp>, canonicalFileId: string, duplicateFileId: string): number {
  const row = app.db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM duplicate_marks
       WHERE canonical_file_id = ? AND duplicate_file_id = ?`
    )
    .get(canonicalFileId, duplicateFileId) as { total: number };
  return row.total;
}

function readCreatedFlag(value: unknown): boolean | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }
  const created = (value as { created?: unknown }).created;
  return typeof created === "boolean" ? created : null;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
