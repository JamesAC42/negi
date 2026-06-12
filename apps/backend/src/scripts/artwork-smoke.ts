import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BackendApp } from "../app.js";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-artwork-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");
let app: BackendApp | null = null;

try {
  await mkdir(libraryPath, { recursive: true });
  await writeFile(
    join(libraryPath, "01 - no embedded art.mp3"),
    makeId3Fixture("No Embedded Art", "Artwork Artist", "Artwork Album", "1991", null)
  );
  await writeFile(
    join(libraryPath, "02 - embedded art.mp3"),
    makeId3Fixture("Embedded Art", "Artwork Artist", "Artwork Album", "1991", onePixelPng())
  );

  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "artwork-smoke");
  const scan = await app.scanner.scanRoot(root);
  assert(scan.inserted === 2, `expected 2 inserted files, got ${scan.inserted}`);

  const files = app.library.listFiles("Artwork Album");
  const noEmbedded = files.find((file) => file.displayTags.title === "No Embedded Art");
  const withEmbedded = files.find((file) => file.displayTags.title === "Embedded Art");
  assert(noEmbedded != null, "expected no-art fixture to be indexed");
  assert(withEmbedded != null, "expected embedded-art fixture to be indexed");

  const directArtwork = await app.artwork.getFileArtwork(withEmbedded.id);
  assert(directArtwork != null, "expected direct embedded artwork");
  assert(directArtwork.mimeType === "image/png", `expected image/png direct art, got ${directArtwork.mimeType}`);

  const fallbackArtwork = await app.artwork.getFileArtwork(noEmbedded.id);
  assert(fallbackArtwork != null, "expected sibling album artwork fallback");
  assert(fallbackArtwork.mimeType === "image/png", `expected image/png fallback art, got ${fallbackArtwork.mimeType}`);
  assert(fallbackArtwork.data.equals(directArtwork.data), "expected fallback art to match sibling embedded art");

  console.log(
    JSON.stringify(
      {
        ok: true,
        directFileId: withEmbedded.id,
        fallbackFileId: noEmbedded.id,
        mimeType: fallbackArtwork.mimeType,
        bytes: fallbackArtwork.data.length
      },
      null,
      2
    )
  );
} finally {
  app?.close();
  await rm(fixtureDir, { recursive: true, force: true });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function makeId3Fixture(title: string, artist: string, album: string, year: string, artwork: Buffer | null): Buffer {
  const frames = [
    makeTextFrame("TIT2", title),
    makeTextFrame("TPE1", artist),
    makeTextFrame("TALB", album),
    makeTextFrame("TYER", year)
  ];
  if (artwork) {
    frames.push(makePictureFrame(artwork));
  }
  const body = Buffer.concat(frames);
  return Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0]), encodeSyncSafe(body.length), body]);
}

function makeTextFrame(id: string, value: string): Buffer {
  const body = Buffer.concat([Buffer.from([0]), Buffer.from(value, "latin1")]);
  return makeFrame(id, body);
}

function makePictureFrame(data: Buffer): Buffer {
  const body = Buffer.concat([
    Buffer.from([0]),
    Buffer.from("image/png", "ascii"),
    Buffer.from([0, 3, 0]),
    data
  ]);
  return makeFrame("APIC", body);
}

function makeFrame(id: string, body: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  return Buffer.concat([Buffer.from(id, "ascii"), size, Buffer.from([0, 0]), body]);
}

function encodeSyncSafe(size: number): Buffer {
  return Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}

function onePixelPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
}
