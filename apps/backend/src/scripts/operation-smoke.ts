import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-operations-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const sourceDir = join(fixtureDir, "source");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(sourceDir, { recursive: true });
  await mkdir(libraryPath, { recursive: true });
  const sourcePath = join(sourceDir, "incoming.mp3");
  await writeFile(sourcePath, makeId3Fixture());

  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "library");
  const created = await app.imports.createFromPaths([sourcePath], root.id);
  const importItem = created.items[0];

  const proposed = app.operations.createImportApprovalBatch(importItem.id, root.id);
  assert(proposed.status === "proposed", `expected proposed batch, got ${proposed.status}`);
  assert(proposed.operations[0].type === "import_file", `expected import_file operation, got ${proposed.operations[0].type}`);
  assert(app.library.countFiles() === 0, "proposed batch should not mutate library");

  const approved = app.operations.approveBatch(proposed.id);
  assert(approved.status === "approved", `expected approved batch, got ${approved.status}`);
  assert(app.library.countFiles() === 0, "approved batch should not mutate before apply");

  const applied = await app.operations.applyBatch(proposed.id);
  assert(applied.status === "applied", `expected applied batch, got ${applied.status}`);
  assert(applied.operations[0].status === "applied", `expected applied operation, got ${applied.operations[0].status}`);
  assert(applied.operations[0].before != null, "applied operation should capture before state");
  assert(applied.operations[0].after != null, "applied operation should capture after state");
  assert(app.library.countFiles() === 1, `expected one library file after apply, got ${app.library.countFiles()}`);

  const completedItem = app.imports.getItem(importItem.id);
  assert(completedItem.status === "imported", `expected imported item, got ${completedItem.status}`);
  await stat(completedItem.proposedDestination ?? "");
  assert(completedItem.fileId != null, "imported item should have fileId");

  const bulkRenamePath = join(
    libraryPath,
    "Operation Smoke Artist",
    "1983 - Operation Smoke Album",
    "Operation Smoke Artist - Operation Smoke Title.mp3"
  );
  const bulkRenameBatch = app.operations.createBulkRenameFilesBatch([completedItem.fileId], "{artist} - {title}.{ext}");
  assert(bulkRenameBatch.operations.length === 1, `expected one bulk rename operation, got ${bulkRenameBatch.operations.length}`);
  assert(bulkRenameBatch.operations[0].type === "rename_file", `expected rename_file, got ${bulkRenameBatch.operations[0].type}`);
  app.operations.approveBatch(bulkRenameBatch.id);
  const appliedBulkRename = await app.operations.applyBatch(bulkRenameBatch.id);
  assert(appliedBulkRename.status === "applied", `expected bulk rename batch applied, got ${appliedBulkRename.status}`);
  await stat(bulkRenamePath);

  const renamedPath = join(libraryPath, "Operation Smoke Artist", "1983 - Operation Smoke Album", "Renamed Operation Smoke.mp3");
  const renameBatch = app.operations.createRenameFileBatch(completedItem.fileId, "Renamed Operation Smoke.mp3");
  app.operations.approveBatch(renameBatch.id);
  const appliedRename = await app.operations.applyBatch(renameBatch.id);
  assert(appliedRename.status === "applied", `expected rename batch applied, got ${appliedRename.status}`);
  await stat(renamedPath);

  const movedPath = join(libraryPath, "Moved", "Renamed Operation Smoke.mp3");
  const moveBatch = app.operations.createMoveFileBatch(completedItem.fileId, movedPath);
  app.operations.approveBatch(moveBatch.id);
  const appliedMove = await app.operations.applyBatch(moveBatch.id);
  assert(appliedMove.status === "applied", `expected move batch applied, got ${appliedMove.status}`);
  await stat(movedPath);

  const metadataBatch = app.operations.createSetFileMetadataBatch(completedItem.fileId, {
    title: "Corrected Operation Smoke Title",
    artist: "Corrected Operation Smoke Artist",
    album: "Corrected Operation Smoke Album",
    year: "1984"
  });
  app.operations.approveBatch(metadataBatch.id);
  const appliedMetadata = await app.operations.applyBatch(metadataBatch.id);
  assert(appliedMetadata.status === "applied", `expected metadata batch applied, got ${appliedMetadata.status}`);
  const correctedFile = app.library.getFile(completedItem.fileId);
  assert(correctedFile.displayTags.title === "Corrected Operation Smoke Title", "expected corrected title override");
  assert(correctedFile.displayTags.artist === "Corrected Operation Smoke Artist", "expected corrected artist override");
  assert(correctedFile.displayTags.album === "Corrected Operation Smoke Album", "expected corrected album override");
  assert(correctedFile.displayTags.year === "1984", "expected corrected year override");

  const playlist = app.operations.createPlaylistBatch("Operation Smoke Playlist", "Created by operation smoke");
  app.operations.approveBatch(playlist.id);
  const appliedPlaylist = await app.operations.applyBatch(playlist.id);
  assert(appliedPlaylist.status === "applied", `expected playlist batch applied, got ${appliedPlaylist.status}`);

  const duplicatePlaylist = app.operations.createPlaylistBatch("Operation Smoke Playlist", "Should fail safely");
  app.operations.approveBatch(duplicatePlaylist.id);
  const failedPlaylist = await app.operations.applyBatch(duplicatePlaylist.id);
  assert(failedPlaylist.status === "failed", `expected failed duplicate playlist batch, got ${failedPlaylist.status}`);
  assert(failedPlaylist.operations[0].status === "failed", `expected failed operation, got ${failedPlaylist.operations[0].status}`);
  assert(failedPlaylist.operations[0].error != null, "failed operation should capture error details");

  const trackId = "operation-smoke-track";
  app.db
    .prepare("INSERT INTO tracks (id, title) VALUES (?, ?)")
    .run(trackId, "Operation Smoke Track");
  const tagsBatch = app.operations.createSetInternalTagsBatch(trackId, ["reviewed", "favorite"]);
  app.operations.approveBatch(tagsBatch.id);
  const appliedTags = await app.operations.applyBatch(tagsBatch.id);
  assert(appliedTags.status === "applied", `expected tag batch applied, got ${appliedTags.status}`);

  const bulkTagsBatch = app.operations.createBulkSetInternalTagsBatch([completedItem.fileId], ["phase9", "reviewed"]);
  assert(bulkTagsBatch.operations.length === 1, `expected one bulk tag operation, got ${bulkTagsBatch.operations.length}`);
  assert(bulkTagsBatch.operations[0].type === "set_internal_tags", `expected set_internal_tags, got ${bulkTagsBatch.operations[0].type}`);
  app.operations.approveBatch(bulkTagsBatch.id);
  const appliedBulkTags = await app.operations.applyBatch(bulkTagsBatch.id);
  assert(appliedBulkTags.status === "applied", `expected bulk tag batch applied, got ${appliedBulkTags.status}`);

  const removeBatch = app.operations.createRemoveFileBatch(completedItem.fileId);
  app.operations.approveBatch(removeBatch.id);
  const appliedRemove = await app.operations.applyBatch(removeBatch.id);
  assert(appliedRemove.status === "applied", `expected remove batch applied, got ${appliedRemove.status}`);
  assert(app.library.countFiles() === 0, `expected zero indexed files after remove, got ${app.library.countFiles()}`);
  await stat(movedPath);

  app.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        applied,
        appliedBulkRename,
        appliedRename,
        appliedMove,
        appliedMetadata,
        appliedPlaylist,
        failedPlaylist,
        appliedTags,
        appliedBulkTags,
        appliedRemove
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

function makeId3Fixture(): Buffer {
  const frames = Buffer.concat([
    makeTextFrame("TIT2", "Operation Smoke Title"),
    makeTextFrame("TPE1", "Operation Smoke Artist"),
    makeTextFrame("TALB", "Operation Smoke Album"),
    makeTextFrame("TYER", "1983")
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
