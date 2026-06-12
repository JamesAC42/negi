import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-duplicates-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");
const duplicateCopyPath = join(libraryPath, "copy.mp3");
const importPath = join(fixtureDir, "incoming.mp3");

try {
  await mkdir(libraryPath, { recursive: true });
  const fixture = makeId3Fixture("Duplicate Smoke Title");
  await writeFile(join(libraryPath, "one.mp3"), fixture);
  await writeFile(duplicateCopyPath, fixture);
  await writeFile(importPath, fixture);

  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "duplicates");
  const scan = await app.scanner.scanRoot(root);
  assert(scan.scanned === 2, `expected 2 scanned files, got ${scan.scanned}`);

  const groups = app.library.listDuplicateGroups();
  assert(groups.length === 1, `expected one duplicate group, got ${groups.length}`);
  assert(groups[0].count === 2, `expected two files in duplicate group, got ${groups[0].count}`);
  assert(groups[0].files.every((file) => file.sha256 === groups[0].key), "duplicate group files should share the group hash");

  const keepFile = groups[0].files[0];
  const removeFile = groups[0].files[1];
  const cleanup = app.operations.createDuplicateCleanupBatch(keepFile.id, [removeFile.id]);
  assert(cleanup.operations.length === 1, `expected one cleanup operation, got ${cleanup.operations.length}`);
  assert(cleanup.operations[0].type === "remove_file_from_library", `unexpected cleanup operation ${cleanup.operations[0].type}`);
  app.operations.approveBatch(cleanup.id);
  const appliedCleanup = await app.operations.applyBatch(cleanup.id);
  assert(appliedCleanup.status === "applied", `expected applied cleanup, got ${appliedCleanup.status}`);
  assert(app.library.listDuplicateGroups().length === 0, "expected duplicate group to be removed from index");
  await access(removeFile.path);

  const created = await app.imports.createFromPaths([importPath], root.id);
  const item = created.items[0];
  assert(item.duplicateCandidates.length === 1, `expected one import duplicate candidate, got ${item.duplicateCandidates.length}`);
  assert(
    item.warnings.some((warning) => warning.includes("Exact duplicate already indexed")),
    `expected duplicate warning, got ${item.warnings.join(", ")}`
  );

  app.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        duplicateGroups: groups.length,
        cleanupStatus: appliedCleanup.status,
        duplicateCandidates: item.duplicateCandidates.length,
        removedFileStillOnDisk: true
      },
      null,
      2
    )
  );
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function makeId3Fixture(title: string): Buffer {
  const frames = Buffer.concat([
    makeTextFrame("TIT2", title),
    makeTextFrame("TPE1", "Duplicate Smoke Artist"),
    makeTextFrame("TALB", "Duplicate Smoke Album"),
    makeTextFrame("TYER", "1982")
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
