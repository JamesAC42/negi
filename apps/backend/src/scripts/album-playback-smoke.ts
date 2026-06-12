import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-album-playback-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "albums");

  upsertAlbumFile(app, root.id, "02 - Second Song.mp3", {
    title: "Second Song",
    artist: "Album Smoke Artist",
    album: "Album Smoke",
    year: "1978",
    tracknumber: "2/3"
  });
  upsertAlbumFile(app, root.id, "01 - First Song.mp3", {
    title: "First Song",
    artist: "Album Smoke Artist",
    album: "Album Smoke",
    year: "1978",
    tracknumber: "1/3"
  });
  upsertAlbumFile(app, root.id, "03 - Third Song.flac", {
    title: "Third Song",
    artist: "Album Smoke Artist",
    album: "Album Smoke",
    year: "1978",
    tracknumber: "3/3"
  });
  upsertAlbumFile(app, root.id, "Loose Single.mp3", {
    title: "Loose Single",
    artist: "Album Smoke Artist",
    album: "",
    year: "1978"
  });

  const albums = app.library.listAlbumGroups();
  assert(albums.length === 1, `expected one album group, got ${albums.length}`);
  assert(albums[0].artist === "Album Smoke Artist", `expected artist label, got ${albums[0].artist}`);
  assert(albums[0].album === "Album Smoke", `expected album label, got ${albums[0].album}`);
  assert(albums[0].year === "1978", `expected year 1978, got ${albums[0].year}`);
  assert(albums[0].fileCount === 3, `expected three album files, got ${albums[0].fileCount}`);
  assert(albums[0].formats.join(",") === "FLAC,MP3", `expected FLAC,MP3 formats, got ${albums[0].formats.join(",")}`);
  assert(albums[0].files.map((file) => file.displayTags.title).join("|") === "First Song|Second Song|Third Song", "album files should sort by track number");

  const playbackFiles = app.library.getAlbumFiles(albums[0].id);
  assert(playbackFiles.map((file) => file.id).join("|") === albums[0].files.map((file) => file.id).join("|"), "album playback files should use album sort order");

  app.close();
  console.log(JSON.stringify({ ok: true, album: albums[0].album, fileCount: albums[0].fileCount }, null, 2));
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function upsertAlbumFile(
  app: ReturnType<typeof createBackendApp>,
  libraryRootId: string,
  filename: string,
  tags: Record<string, string>
): void {
  const path = join(libraryPath, filename);
  app.library.upsertFile({
    libraryRootId,
    path,
    normalizedPath: path.toLowerCase(),
    filename,
    extension: filename.split(".").at(-1) ?? "mp3",
    sizeBytes: 1024,
    mtime: new Date().toISOString(),
    ctime: null,
    sha256: `album-playback-${filename}`,
    quickHash: `quick-${filename}`,
    durationMs: 120_000,
    codec: filename.endsWith(".flac") ? "flac" : "mp3",
    container: filename.endsWith(".flac") ? "flac" : "mpeg",
    bitrate: filename.endsWith(".flac") ? 900_000 : 320_000,
    sampleRate: 44_100,
    channels: 2,
    scanStatus: "scanned",
    tags: Object.entries(tags)
      .filter((entry): entry is [string, string] => entry[1].trim().length > 0)
      .map(([key, value]) => ({ key, value, source: "smoke" }))
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
