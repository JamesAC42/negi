import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-album-merge-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "album merge");

  const canonical = app.library.upsertFile(
    makeIndexedFile({
      rootId: root.id,
      path: join(libraryPath, "Artist", "Album", "One.mp3"),
      title: "One",
      artist: "Merge Artist",
      album: "Merge Album"
    })
  );
  const variant = app.library.upsertFile(
    makeIndexedFile({
      rootId: root.id,
      path: join(libraryPath, "Artist", "Album Deluxe", "Two.mp3"),
      title: "Two",
      artist: "Merge Artist",
      album: "Merge Album (Deluxe Edition)"
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

  const suggestions = app.library.listAlbumMergeSuggestions();
  assert(suggestions.length === 1, `expected one album merge suggestion, got ${suggestions.length}`);
  assert(suggestions[0].canonicalAlbum === "Merge Album", `expected canonical Merge Album, got ${suggestions[0].canonicalAlbum}`);
  assert(suggestions[0].variants.length === 2, `expected two variants, got ${suggestions[0].variants.length}`);

  const mergeBatch = app.operations.createAlbumMergeBatch(suggestions[0].canonicalAlbum, [variant.id]);
  assert(mergeBatch.operations.length === 1, `expected one album merge operation, got ${mergeBatch.operations.length}`);
  assert(mergeBatch.operations[0].type === "set_file_metadata", `expected set_file_metadata, got ${mergeBatch.operations[0].type}`);
  app.operations.approveBatch(mergeBatch.id);
  const applied = await app.operations.applyBatch(mergeBatch.id);
  assert(applied.status === "applied", `expected applied album merge, got ${applied.status}`);
  assert(app.library.getFile(canonical.id).displayTags.album === "Merge Album", "canonical album should remain unchanged");
  assert(app.library.getFile(variant.id).displayTags.album === "Merge Album", "variant album should be merged by override");
  assert(app.library.listAlbumMergeSuggestions().length === 0, "merged variants should no longer be suggested");

  app.close();
  console.log(JSON.stringify({ ok: true, suggestions: suggestions.length, mergeStatus: applied.status }, null, 2));
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
    extension: "mp3",
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
