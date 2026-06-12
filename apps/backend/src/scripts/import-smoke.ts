import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";
import { inspectImportItem, inspectLibraryFile } from "../services/metadata-diagnostics.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-import-"));
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
  assert(created.items.length === 1, `expected one import item, got ${created.items.length}`);
  const item = created.items[0];
  assert(item.status === "needs_review", `expected needs_review, got ${item.status}`);
  assert(item.detectedTitle === "Import Smoke Title", `expected title tag, got ${item.detectedTitle}`);
  assert(item.metadataCandidates.length > 0, "expected metadata candidates to be stored");
  assert(item.selectedCandidate?.source === "embedded", `expected embedded selected candidate, got ${item.selectedCandidate?.source}`);
  const importDiagnostics = await inspectImportItem(item);
  assert(importDiagnostics.parserStatus === "ok", `expected import diagnostics ok, got ${importDiagnostics.parserStatus}`);
  assert(
    importDiagnostics.common.some((tag) => tag.key === "title" && tag.value === "Import Smoke Title"),
    "expected import diagnostics to expose embedded title"
  );
  const corrected = app.imports.updateItemMetadata(item.id, {
    artist: "Corrected Import Artist",
    album: "Corrected Import Album",
    title: "Corrected Import Title",
    year: "1982"
  });
  assert(corrected.detectedArtist === "Corrected Import Artist", `expected corrected artist, got ${corrected.detectedArtist}`);
  assert(corrected.detectedAlbum === "Corrected Import Album", `expected corrected album, got ${corrected.detectedAlbum}`);
  assert(corrected.detectedTitle === "Corrected Import Title", `expected corrected title, got ${corrected.detectedTitle}`);
  assert(corrected.detectedYear === 1982, `expected corrected year, got ${corrected.detectedYear}`);
  assert(corrected.selectedCandidate?.source === "manual", `expected manual selected candidate, got ${corrected.selectedCandidate?.source}`);
  assert(
    corrected.proposedDestination != null &&
      corrected.proposedDestination.includes(join("Corrected Import Artist", "1982 - Corrected Import Album", "Corrected Import Title.mp3")),
    `expected corrected destination, got ${corrected.proposedDestination}`
  );
  assert(app.library.countFiles() === 0, `staged file should not appear in library count, got ${app.library.countFiles()}`);

  await stat(sourcePath);
  const approved = await app.imports.approveItem(item.id, root.id);
  assert(approved.status === "imported", `expected imported, got ${approved.status}`);
  assert(app.library.countFiles() === 1, `expected one library file after approval, got ${app.library.countFiles()}`);
  assert(
    approved.proposedDestination != null && approved.proposedDestination.startsWith(libraryPath),
    "approved destination should be under library root"
  );
  await stat(approved.proposedDestination ?? "");
  assert(approved.fileId != null, "approved import should have fileId");
  const libraryDiagnostics = await inspectLibraryFile(app.library, approved.fileId);
  assert(libraryDiagnostics.parserStatus === "ok", `expected library diagnostics ok, got ${libraryDiagnostics.parserStatus}`);
  assert(
    libraryDiagnostics.common.some((tag) => tag.key === "artist" && tag.value === "Import Smoke Artist"),
    "expected library diagnostics to expose embedded artist"
  );

  const inbox = app.imports.listInbox();
  assert(inbox.length === 0, `completed import should leave inbox, got ${inbox.length}`);
  app.library.removeRoot(root.id);
  assert(app.library.countFiles() === 0, `root removal should clear imported file rows, got ${app.library.countFiles()}`);

  app.close();
  console.log(JSON.stringify({ ok: true, approved }, null, 2));
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
    makeTextFrame("TIT2", "Import Smoke Title"),
    makeTextFrame("TPE1", "Import Smoke Artist"),
    makeTextFrame("TALB", "Import Smoke Album"),
    makeTextFrame("TYER", "1981")
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
  return Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f
  ]);
}
