import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-incomplete-albums-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "incomplete albums");

  upsertTrack(app, root.id, "01 - Present One.mp3", "1/4");
  upsertTrack(app, root.id, "02 - Present Two.mp3", "2/4");
  upsertTrack(app, root.id, "04 - Present Four.mp3", "4/4");
  upsertTrack(app, root.id, "01 - Complete One.mp3", "1/2", "Complete Album");
  upsertTrack(app, root.id, "02 - Complete Two.mp3", "2/2", "Complete Album");

  const albums = app.library.listIncompleteAlbums();
  assert(albums.length === 1, `expected one incomplete album, got ${albums.length}`);
  assert(albums[0].artist === "Incomplete Smoke Artist", `expected artist, got ${albums[0].artist}`);
  assert(albums[0].album === "Incomplete Smoke Album", `expected album, got ${albums[0].album}`);
  assert(albums[0].expectedTracks === 4, `expected total 4, got ${albums[0].expectedTracks}`);
  assert(albums[0].presentTracks === 3, `expected present 3, got ${albums[0].presentTracks}`);
  assert(albums[0].missingTrackNumbers.join(",") === "3", `expected missing track 3, got ${albums[0].missingTrackNumbers.join(",")}`);

  app.close();
  console.log(JSON.stringify({ ok: true, album: albums[0].album, missing: albums[0].missingTrackNumbers }, null, 2));
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function upsertTrack(
  app: ReturnType<typeof createBackendApp>,
  libraryRootId: string,
  filename: string,
  tracknumber: string,
  album = "Incomplete Smoke Album"
): void {
  const path = join(libraryPath, album, filename);
  app.library.upsertFile({
    libraryRootId,
    path,
    normalizedPath: path.toLowerCase(),
    filename,
    extension: filename.split(".").at(-1) ?? "mp3",
    sizeBytes: 1024,
    mtime: new Date().toISOString(),
    ctime: null,
    sha256: `incomplete-${album}-${filename}`,
    quickHash: `quick-${album}-${filename}`,
    durationMs: 120_000,
    codec: "mp3",
    container: "mpeg",
    bitrate: 320_000,
    sampleRate: 44_100,
    channels: 2,
    scanStatus: "scanned",
    tags: [
      { key: "artist", value: "Incomplete Smoke Artist", source: "smoke" },
      { key: "album", value: album, source: "smoke" },
      { key: "title", value: filename.replace(/\.[^.]+$/, ""), source: "smoke" },
      { key: "year", value: "1982", source: "smoke" },
      { key: "tracknumber", value: tracknumber, source: "smoke" }
    ]
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
