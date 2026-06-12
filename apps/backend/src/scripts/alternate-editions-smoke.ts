import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-alternate-editions-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "alternate editions");

  app.library.upsertFile(
    makeIndexedFile({
      rootId: root.id,
      path: join(libraryPath, "Artist", "Blue Train", "01 - Blue Train.mp3"),
      title: "Blue Train",
      artist: "John Coltrane",
      album: "Blue Train"
    })
  );
  app.library.upsertFile(
    makeIndexedFile({
      rootId: root.id,
      path: join(libraryPath, "Artist", "Blue Train Remastered", "01 - Blue Train.flac"),
      title: "Blue Train",
      artist: "John Coltrane",
      album: "Blue Train (Remastered)"
    })
  );
  app.library.upsertFile(
    makeIndexedFile({
      rootId: root.id,
      path: join(libraryPath, "Artist", "Blue Train Mono", "01 - Blue Train.m4a"),
      title: "Blue Train",
      artist: "John Coltrane",
      album: "Blue Train (Mono Edition)"
    })
  );
  app.library.upsertFile(
    makeIndexedFile({
      rootId: root.id,
      path: join(libraryPath, "Other", "Other.mp3"),
      title: "Other",
      artist: "Other Artist",
      album: "Other Album"
    })
  );

  const groups = app.library.listAlternateEditionGroups();
  assert(groups.length === 1, `expected one alternate edition group, got ${groups.length}`);
  assert(groups[0].artist === "John Coltrane", `expected John Coltrane, got ${groups[0].artist}`);
  assert(groups[0].baseAlbum === "Blue Train", `expected Blue Train base album, got ${groups[0].baseAlbum}`);
  assert(groups[0].editions.length === 3, `expected three editions, got ${groups[0].editions.length}`);
  assert(groups[0].editions[0].edition === "Standard", `expected Standard first, got ${groups[0].editions[0].edition}`);
  assert(
    groups[0].editions.some((edition) => edition.edition === "Remastered"),
    `expected Remastered label, got ${groups[0].editions.map((edition) => edition.edition).join(", ")}`
  );
  assert(
    groups[0].editions.some((edition) => edition.edition === "Mono Edition"),
    `expected Mono Edition label, got ${groups[0].editions.map((edition) => edition.edition).join(", ")}`
  );
  assert(app.library.countFiles() === 4, `alternate edition scan should not mutate files, got ${app.library.countFiles()}`);

  app.close();
  console.log(JSON.stringify({ ok: true, groups: groups.length, editions: groups[0].editions.length }, null, 2));
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function makeIndexedFile(input: {
  rootId: string;
  path: string;
  title: string;
  artist: string;
  album: string;
}) {
  const now = new Date().toISOString();
  return {
    libraryRootId: input.rootId,
    path: input.path,
    normalizedPath: input.path.toLowerCase(),
    filename: input.path.split(/[\\/]/).pop() ?? input.path,
    extension: input.path.split(".").pop() ?? "mp3",
    sizeBytes: 4_000_000,
    mtime: now,
    ctime: now,
    sha256: input.path,
    quickHash: input.path.slice(0, 16),
    durationMs: 180_000,
    codec: "mp3",
    container: "mp3",
    bitrate: 320_000,
    sampleRate: 44_100,
    channels: 2,
    scanStatus: "scanned",
    tags: [
      { key: "title", value: input.title, source: "smoke" },
      { key: "artist", value: input.artist, source: "smoke" },
      { key: "album", value: input.album, source: "smoke" }
    ]
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
