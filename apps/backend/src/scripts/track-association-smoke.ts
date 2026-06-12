import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-track-association-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "library");
  const canonical = insertFile(app, root.id, libraryPath, "Canonical.flac", "Canonical Track", "canonical");
  const alternate = insertFile(app, root.id, libraryPath, "Alternate.mp3", "Alternate Copy", "alternate");

  const playlistBatch = app.operations.createPlaylistBatch("Track Association Source", "creates canonical track", [canonical.id]);
  app.operations.approveBatch(playlistBatch.id);
  const appliedPlaylist = await app.operations.applyBatch(playlistBatch.id);
  assert(appliedPlaylist.status === "applied", `expected playlist applied, got ${appliedPlaylist.status}`);
  const playlistId = readCreatedPlaylistId(appliedPlaylist.operations[0]?.after);
  assert(playlistId != null, "expected playlist id");
  const trackId = app.playlists.getPlaylist(playlistId).items[0]?.track.id;
  assert(trackId != null, "expected canonical track id");
  assert(countTrackLinks(app, alternate.id, trackId) === 0, "alternate should start unassociated with canonical track");

  const associateBatch = app.operations.createAssociateFileWithTrackBatch(alternate.id, trackId);
  assert(associateBatch.operations[0].type === "associate_file_with_track", "expected associate_file_with_track operation");
  app.operations.approveBatch(associateBatch.id);
  const appliedAssociate = await app.operations.applyBatch(associateBatch.id);
  assert(appliedAssociate.status === "applied", `expected association applied, got ${appliedAssociate.status}`);
  assert(countTrackLinks(app, alternate.id, trackId) === 1, "expected alternate linked to canonical track");

  const idempotentBatch = app.operations.createAssociateFileWithTrackBatch(alternate.id, trackId);
  app.operations.approveBatch(idempotentBatch.id);
  const appliedIdempotent = await app.operations.applyBatch(idempotentBatch.id);
  assert(appliedIdempotent.status === "applied", `expected idempotent association applied, got ${appliedIdempotent.status}`);
  assert(countTrackLinks(app, alternate.id, trackId) === 1, "idempotent association should not duplicate link");

  const revertedAssociate = await app.operations.revertBatch(associateBatch.id);
  assert(revertedAssociate.status === "reverted", `expected association reverted, got ${revertedAssociate.status}`);
  assert(countTrackLinks(app, alternate.id, trackId) === 0, "expected created association removed on revert");
  assert(app.playlists.getPlaylist(playlistId).items.length === 1, "canonical playlist item should stay intact");

  app.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        trackId,
        associate: appliedAssociate.status,
        idempotent: appliedIdempotent.status,
        revert: revertedAssociate.status
      },
      null,
      2
    )
  );
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function insertFile(
  app: ReturnType<typeof createBackendApp>,
  libraryRootId: string,
  libraryPath: string,
  filename: string,
  title: string,
  hashKey: string
) {
  const filePath = join(libraryPath, filename);
  return app.library.upsertFile({
    libraryRootId,
    path: filePath,
    normalizedPath: filePath.toLowerCase(),
    filename,
    extension: filename.split(".").pop() ?? "mp3",
    sizeBytes: 1024,
    mtime: new Date().toISOString(),
    ctime: null,
    sha256: `${hashKey}-sha`,
    quickHash: `${hashKey}-quick`,
    durationMs: 180000,
    codec: "mp3",
    container: "mp3",
    bitrate: 320000,
    sampleRate: 44100,
    channels: 2,
    scanStatus: "scanned",
    tags: [
      { key: "title", value: title, source: "smoke" },
      { key: "artist", value: "Track Association Artist", source: "smoke" },
      { key: "album", value: "Track Association Album", source: "smoke" }
    ]
  });
}

function countTrackLinks(app: ReturnType<typeof createBackendApp>, fileId: string, trackId: string): number {
  const row = app.db
    .prepare("SELECT COUNT(*) AS total FROM track_files WHERE file_id = ? AND track_id = ?")
    .get(fileId, trackId) as { total: number };
  return row.total;
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
