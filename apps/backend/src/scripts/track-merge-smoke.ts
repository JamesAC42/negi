import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-track-merge-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "library");
  const canonicalFile = insertFile(app, root.id, "Canonical.flac", "Merged Track", "canonical");
  const duplicateFile = insertFile(app, root.id, "Duplicate.mp3", "Merged Track", "duplicate");
  const canonicalTrackId = "canonical-track";
  const duplicateTrackId = "duplicate-track";

  app.db.prepare("INSERT INTO tracks (id, title, duration_ms) VALUES (?, ?, ?)").run(canonicalTrackId, "Merged Track", 180000);
  app.db.prepare("INSERT INTO tracks (id, title, duration_ms) VALUES (?, ?, ?)").run(duplicateTrackId, "Merged Track", 180000);
  app.db
    .prepare("INSERT INTO track_files (id, track_id, file_id, quality_rank, is_preferred, source) VALUES (?, ?, ?, ?, ?, ?)")
    .run("canonical-link", canonicalTrackId, canonicalFile.id, 1, 1, "smoke");
  app.db
    .prepare("INSERT INTO track_files (id, track_id, file_id, quality_rank, is_preferred, source) VALUES (?, ?, ?, ?, ?, ?)")
    .run("duplicate-link", duplicateTrackId, duplicateFile.id, 0, 0, "smoke");
  app.db
    .prepare("INSERT INTO playlists (id, name, description, type, created_by) VALUES (?, ?, ?, ?, ?)")
    .run("merge-playlist", "Merge Playlist", null, "manual", "smoke");
  app.db
    .prepare("INSERT INTO playlist_items (id, playlist_id, track_id, position, added_by, reason) VALUES (?, ?, ?, ?, ?, ?)")
    .run("duplicate-playlist-item", "merge-playlist", duplicateTrackId, 0, "smoke", "duplicate before merge");
  app.db.prepare("INSERT INTO user_tags (id, name, category) VALUES (?, ?, ?)").run("duplicate-tag", "duplicate-tag", "internal");
  app.db
    .prepare("INSERT INTO track_user_tags (track_id, user_tag_id, source) VALUES (?, ?, ?)")
    .run(duplicateTrackId, "duplicate-tag", "smoke");

  const batch = app.operations.createMergeDuplicateTracksBatch(canonicalTrackId, duplicateTrackId);
  assert(batch.operations[0].type === "merge_duplicate_tracks", `unexpected operation ${batch.operations[0].type}`);
  app.operations.approveBatch(batch.id);
  const applied = await app.operations.applyBatch(batch.id);
  assert(applied.status === "applied", `expected merge applied, got ${applied.status}`);
  assert(readTrackFileCount(app, canonicalTrackId) === 2, "canonical track should own both file links after merge");
  assert(readTrackFileCount(app, duplicateTrackId) === 0, "duplicate track should have no file links after merge");
  assert(readPlaylistItemTrack(app, "duplicate-playlist-item") === canonicalTrackId, "playlist item should point to canonical track");
  assert(readTagCount(app, canonicalTrackId, "duplicate-tag") === 1, "canonical track should receive duplicate tag");
  assert(readTagCount(app, duplicateTrackId, "duplicate-tag") === 0, "duplicate tag link should move off duplicate track");
  assert(readMergedInto(app, duplicateTrackId) === canonicalTrackId, "duplicate track should record merged target");

  const reverted = await app.operations.revertBatch(batch.id);
  assert(reverted.status === "reverted", `expected merge reverted, got ${reverted.status}`);
  assert(readTrackFileCount(app, canonicalTrackId) === 1, "canonical track should return to one file link after revert");
  assert(readTrackFileCount(app, duplicateTrackId) === 1, "duplicate track file link should be restored");
  assert(readPlaylistItemTrack(app, "duplicate-playlist-item") === duplicateTrackId, "playlist item should point back to duplicate track");
  assert(readTagCount(app, canonicalTrackId, "duplicate-tag") === 0, "copied canonical tag should be removed on revert");
  assert(readTagCount(app, duplicateTrackId, "duplicate-tag") === 1, "duplicate tag link should be restored");
  assert(readMergedInto(app, duplicateTrackId) == null, "duplicate merged target should be cleared on revert");

  app.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        merge: applied.status,
        revert: reverted.status
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
      { key: "artist", value: "Track Merge Artist", source: "smoke" },
      { key: "album", value: "Track Merge Album", source: "smoke" }
    ]
  });
}

function readTrackFileCount(app: ReturnType<typeof createBackendApp>, trackId: string): number {
  const row = app.db.prepare("SELECT COUNT(*) AS total FROM track_files WHERE track_id = ?").get(trackId) as { total: number };
  return row.total;
}

function readPlaylistItemTrack(app: ReturnType<typeof createBackendApp>, itemId: string): string {
  const row = app.db.prepare("SELECT track_id FROM playlist_items WHERE id = ?").get(itemId) as { track_id: string };
  return row.track_id;
}

function readTagCount(app: ReturnType<typeof createBackendApp>, trackId: string, tagId: string): number {
  const row = app.db
    .prepare("SELECT COUNT(*) AS total FROM track_user_tags WHERE track_id = ? AND user_tag_id = ?")
    .get(trackId, tagId) as { total: number };
  return row.total;
}

function readMergedInto(app: ReturnType<typeof createBackendApp>, trackId: string): string | null {
  const row = app.db.prepare("SELECT merged_into_track_id FROM tracks WHERE id = ?").get(trackId) as {
    merged_into_track_id: string | null;
  };
  return row.merged_into_track_id;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
