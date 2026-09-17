import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-artwork-index-"));
const app = createBackendApp({
  host: "127.0.0.1", port: 0, databasePath: join(fixtureDir, "fixture.sqlite"),
  mpvPath: "mpv", musicBrainzEnabled: false
});
try {
  const root = app.library.addRoot(fixtureDir, "artwork index");
  const ids: string[] = [];
  app.db.transaction(() => {
    for (let index = 0; index < 500; index += 1) {
  const file = app.library.upsertFile({
    libraryRootId: root.id,
    path: join(fixtureDir, `track-${index}.flac`),
    normalizedPath: join(fixtureDir, `track-${index}.flac`).toLowerCase(),
    filename: `track-${index}.flac`,
    extension: "flac",
    sizeBytes: 1024,
    mtime: new Date().toISOString(),
    ctime: null,
    sha256: `fixture-${index}`,
    quickHash: `quick-${index}`,
    durationMs: 120_000,
    codec: "flac",
    container: "flac",
    bitrate: 900_000,
    sampleRate: 44_100,
    channels: 2,
    scanStatus: "scanned",
    tags: [
      { key: "title", value: "Smoke Track", source: "smoke" },
      { key: "artist", value: `Artist ${Math.floor(index / 20)}`, source: "smoke" },
      { key: "album", value: `Album ${Math.floor(index / 10)}`, source: "smoke" },
      { key: "year", value: "2026", source: "smoke" }
    ]
  });

      ids.push(file.id);
    }
    const insert = app.db.prepare(
      "INSERT INTO playback_events (id, file_id, event_type, reason) VALUES (?, ?, 'played', 'fixture')"
    );
    for (let index = 0; index < 20000; index += 1) insert.run(String(index), ids[index % ids.length]);
  })();
  const shape = (groups: ReturnType<typeof app.library.listAlbumGroups>) => groups.map((group) => ({
    id: group.id, artist: group.artist, album: group.album, year: group.year,
    files: group.files.map((file) => ({ id: file.id, path: file.path, mtime: file.mtime }))
  }));
  const compare = () => assert.deepEqual(
    shape(app.library.listArtworkAlbumGroups()), shape(app.library.listAlbumGroups())
  );
  compare();
  app.library.setFileMetadataOverrides(ids[0]!, { album: "Edited album", albumartist: "Edited artist", year: "2025" });
  compare();
  app.db.prepare("UPDATE files SET missing = 1 WHERE id = ?").run(ids[1]);
  app.db.prepare("UPDATE files SET staged = 1 WHERE id = ?").run(ids[2]);
  compare();
  const id = ids[0]!;
  const file = app.library.getFile(id);
  assert.deepEqual(app.library.getArtworkFile(id), { path: file.path, mtime: file.mtime });
  const measure = (run: () => unknown) => {
    const start = performance.now();
    for (let index = 0; index < 10; index += 1) run();
    return (performance.now() - start) / 10;
  };
  console.log(JSON.stringify({
    ok: true, fixtureFiles: ids.length, historyEvents: 20000,
    albumWithHistoryMs: measure(() => app.library.listAlbumGroups()),
    artworkAlbumMs: measure(() => app.library.listArtworkAlbumGroups()),
    fileWithHistoryMs: measure(() => app.library.getFile(id)),
    artworkFileMs: measure(() => app.library.getArtworkFile(id))
  }, null, 2));
} finally {
  app.close();
  await rm(fixtureDir, { recursive: true, force: true });
}
