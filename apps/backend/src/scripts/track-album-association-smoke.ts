import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-track-album-association-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "library");
  const file = app.library.upsertFile({
    libraryRootId: root.id,
    path: join(libraryPath, "Album Track.flac"),
    normalizedPath: join(libraryPath, "album track.flac"),
    filename: "Album Track.flac",
    extension: "flac",
    sizeBytes: 1024,
    mtime: new Date().toISOString(),
    ctime: null,
    sha256: "track-album-association-sha",
    quickHash: "track-album-quick",
    durationMs: 180000,
    codec: "flac",
    container: "flac",
    bitrate: 900000,
    sampleRate: 44100,
    channels: 2,
    scanStatus: "scanned",
    tags: [
      { key: "title", value: "Album Track", source: "smoke" },
      { key: "artist", value: "Track Album Artist", source: "smoke" }
    ]
  });

  app.db.prepare("INSERT INTO albums (id, title) VALUES (?, ?)").run("album-one", "Album One");
  app.db.prepare("INSERT INTO albums (id, title) VALUES (?, ?)").run("album-two", "Album Two");

  const playlistBatch = app.operations.createPlaylistBatch("Track Album Source", "creates a track", [file.id]);
  app.operations.approveBatch(playlistBatch.id);
  const appliedPlaylist = await app.operations.applyBatch(playlistBatch.id);
  assert(appliedPlaylist.status === "applied", `expected playlist applied, got ${appliedPlaylist.status}`);
  const playlistId = readCreatedPlaylistId(appliedPlaylist.operations[0]?.after);
  assert(playlistId != null, "expected playlist id");
  const trackId = app.playlists.getPlaylist(playlistId).items[0]?.track.id;
  assert(trackId != null, "expected track id");
  assert(readTrackAlbumId(app, trackId) == null, "track should start without album_id");

  const associateBatch = app.operations.createAssociateTrackWithAlbumBatch(trackId, "album-one");
  assert(associateBatch.operations[0].type === "associate_track_with_album", "expected associate_track_with_album operation");
  app.operations.approveBatch(associateBatch.id);
  const appliedAssociate = await app.operations.applyBatch(associateBatch.id);
  assert(appliedAssociate.status === "applied", `expected association applied, got ${appliedAssociate.status}`);
  assert(readTrackAlbumId(app, trackId) === "album-one", "expected track associated with album-one");

  const secondAssociateBatch = app.operations.createAssociateTrackWithAlbumBatch(trackId, "album-two");
  app.operations.approveBatch(secondAssociateBatch.id);
  const appliedSecondAssociate = await app.operations.applyBatch(secondAssociateBatch.id);
  assert(appliedSecondAssociate.status === "applied", `expected second association applied, got ${appliedSecondAssociate.status}`);
  assert(readTrackAlbumId(app, trackId) === "album-two", "expected track associated with album-two");
  const revertedSecond = await app.operations.revertBatch(secondAssociateBatch.id);
  assert(revertedSecond.status === "reverted", `expected second association reverted, got ${revertedSecond.status}`);
  assert(readTrackAlbumId(app, trackId) === "album-one", "expected revert to restore album-one");

  const revertedAssociate = await app.operations.revertBatch(associateBatch.id);
  assert(revertedAssociate.status === "reverted", `expected association reverted, got ${revertedAssociate.status}`);
  assert(readTrackAlbumId(app, trackId) == null, "expected original null album association restored");

  app.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        trackId,
        associate: appliedAssociate.status,
        secondAssociate: appliedSecondAssociate.status,
        revertSecond: revertedSecond.status,
        revert: revertedAssociate.status
      },
      null,
      2
    )
  );
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function readTrackAlbumId(app: ReturnType<typeof createBackendApp>, trackId: string): string | null {
  const row = app.db.prepare("SELECT album_id FROM tracks WHERE id = ?").get(trackId) as { album_id: string | null };
  return row.album_id;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function readCreatedPlaylistId(value: unknown): string | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
