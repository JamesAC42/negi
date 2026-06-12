import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-playback-history-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "library");
  const filePath = join(libraryPath, "Playback History Artist - Played Song.mp3");
  const inserted = app.library.upsertFile({
    libraryRootId: root.id,
    path: filePath,
    normalizedPath: filePath.toLowerCase(),
    filename: "Playback History Artist - Played Song.mp3",
    extension: "mp3",
    sizeBytes: 1024,
    mtime: new Date().toISOString(),
    ctime: null,
    sha256: "playback-history-hash",
    quickHash: "playback-history-quick",
    durationMs: 180_000,
    codec: "mp3",
    container: "mpeg",
    bitrate: 320_000,
    sampleRate: 44_100,
    channels: 2,
    scanStatus: "scanned",
    tags: [
      { key: "artist", value: "Playback History Artist", source: "embedded" },
      { key: "title", value: "Played Song", source: "embedded" }
    ]
  });

  app.playbackHistory.recordStarted(inserted.id);
  app.playbackHistory.recordEnded({
    fileId: inserted.id,
    reason: "stop",
    positionMs: 45_000,
    durationMs: 180_000
  });
  app.playbackHistory.recordStarted(inserted.id);
  app.playbackHistory.recordEnded({
    fileId: inserted.id,
    reason: "next",
    positionMs: 5_000,
    durationMs: 180_000
  });

  const file = app.library.getFile(inserted.id);
  assert(file.playCount === 1, `expected one played event, got ${file.playCount}`);
  assert(file.skipCount === 1, `expected one skipped event, got ${file.skipCount}`);
  assert(file.lastPlayedAt != null, "expected lastPlayedAt to be populated");
  assert(file.lastSkippedAt != null, "expected lastSkippedAt to be populated");

  const listed = app.library.listFiles("played song").find((item) => item.id === inserted.id);
  assert(listed != null, "expected file to appear in library search");
  assert(listed.playCount === 1, `expected listed play count 1, got ${listed.playCount}`);
  assert(listed.skipCount === 1, `expected listed skip count 1, got ${listed.skipCount}`);

  app.close();
  console.log(JSON.stringify({ ok: true, playCount: file.playCount, skipCount: file.skipCount }, null, 2));
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
