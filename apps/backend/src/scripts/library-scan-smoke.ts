import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-scan-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  await writeFile(join(fixtureDir, "library-placeholder"), "");
  await rm(join(fixtureDir, "library-placeholder"));
  await mkdir(libraryPath, { recursive: true });
  await writeFile(join(libraryPath, "one.mp3"), makeId3Fixture());
  await writeFile(join(libraryPath, "two.flac"), "fixture two");
  await writeFile(join(libraryPath, "ignored.txt"), "not audio");

  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv" });
  const root = app.library.addRoot(libraryPath, "fixture");

  const first = await app.scanner.scanRoot(root);
  assert(first.scanned === 2, `expected 2 scanned on first scan, got ${first.scanned}`);
  assert(first.inserted === 2, `expected 2 inserted on first scan, got ${first.inserted}`);
  assert(app.library.countFiles() === 2, `expected 2 files after first scan, got ${app.library.countFiles()}`);
  const taggedFile = app.library.listFiles("Smoke Title")[0];
  assert(taggedFile?.displayTags.title === "Smoke Title", "expected embedded title tag to be indexed");
  assert(taggedFile.displayTags.artist === "Smoke Artist", "expected embedded artist tag to be indexed");
  assert(taggedFile.displayTags.album === "Smoke Album", "expected embedded album tag to be indexed");
  assert(taggedFile.displayTags.tracknumber === "3", "expected embedded track number to be indexed");
  assert(taggedFile.displayTags.discnumber === "1", "expected embedded disc number to be indexed");

  const second = await app.scanner.scanRoot(root);
  assert(second.scanned === 2, `expected 2 scanned on second scan, got ${second.scanned}`);
  assert(second.inserted === 0, `expected 0 inserted on second scan, got ${second.inserted}`);
  assert(second.updated === 2, `expected 2 updated on second scan, got ${second.updated}`);
  assert(app.library.countFiles() === 2, `expected no duplicate rows after rescan, got ${app.library.countFiles()}`);

  await rm(join(libraryPath, "two.flac"));
  const third = await app.scanner.scanRoot(root);
  assert(third.missingMarked === 1, `expected 1 missing file after delete, got ${third.missingMarked}`);
  app.library.removeRoot(root.id);
  const total = app.library.countFiles();
  assert(total === 0, `expected root removal to clear indexed files, got ${total}`);
  assert(app.library.listRoots().length === 0, "expected root removal to delete the library root");

  app.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        first,
        second,
        third,
        total
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
    makeTextFrame("TIT2", "Smoke Title"),
    makeTextFrame("TPE1", "Smoke Artist"),
    makeTextFrame("TALB", "Smoke Album"),
    makeTextFrame("TYER", "1980"),
    makeTextFrame("TRCK", "3/10"),
    makeTextFrame("TPOS", "1/2")
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
