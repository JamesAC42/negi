import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-playlist-edit-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "library");
  const first = insertFile(app, root.id, libraryPath, "Playlist Artist - One.flac", "One", "playlist-edit-one");
  const second = insertFile(app, root.id, libraryPath, "Playlist Artist - Two.flac", "Two", "playlist-edit-two");

  const createBatch = app.operations.createPlaylistBatch("Editable Playlist", "Playlist edit smoke", [first.id]);
  app.operations.approveBatch(createBatch.id);
  const appliedCreate = await app.operations.applyBatch(createBatch.id);
  const playlistId = readCreatedPlaylistId(appliedCreate.operations[0]?.after);
  assert(playlistId != null, "expected created playlist id");
  assert(app.playlists.getPlaylist(playlistId).items.length === 1, "expected initial playlist item");

  const updateBatch = app.operations.createUpdatePlaylistBatch(playlistId, {
    name: "Renamed Editable Playlist",
    description: "Updated playlist description"
  });
  app.operations.approveBatch(updateBatch.id);
  const appliedUpdate = await app.operations.applyBatch(updateBatch.id);
  assert(appliedUpdate.status === "applied", `expected update batch applied, got ${appliedUpdate.status}`);
  const renamed = app.playlists.getPlaylist(playlistId);
  assert(renamed.name === "Renamed Editable Playlist", `expected playlist rename, got ${renamed.name}`);
  assert(renamed.description === "Updated playlist description", "expected playlist description update");

  const duplicateCreate = app.operations.createPlaylistBatch("Existing Playlist", "Name collision proof");
  app.operations.approveBatch(duplicateCreate.id);
  await app.operations.applyBatch(duplicateCreate.id);
  const duplicateUpdate = app.operations.createUpdatePlaylistBatch(playlistId, {
    name: "Existing Playlist",
    description: null
  });
  app.operations.approveBatch(duplicateUpdate.id);
  const failedDuplicateUpdate = await app.operations.applyBatch(duplicateUpdate.id);
  assert(
    failedDuplicateUpdate.status === "failed",
    `expected duplicate update batch failed, got ${failedDuplicateUpdate.status}`
  );
  assert(app.playlists.getPlaylist(playlistId).name === "Renamed Editable Playlist", "failed duplicate update should not rename");

  const revertedUpdate = await app.operations.revertBatch(updateBatch.id);
  assert(revertedUpdate.status === "reverted", `expected update batch reverted, got ${revertedUpdate.status}`);
  const restored = app.playlists.getPlaylist(playlistId);
  assert(restored.name === "Editable Playlist", `expected original playlist name, got ${restored.name}`);
  assert(restored.description === "Playlist edit smoke", "expected original playlist description");

  const addBatch = app.operations.createAddTracksToPlaylistBatch(playlistId, [first.id, second.id]);
  app.operations.approveBatch(addBatch.id);
  const appliedAdd = await app.operations.applyBatch(addBatch.id);
  assert(appliedAdd.status === "applied", `expected add batch applied, got ${appliedAdd.status}`);
  assert(app.playlists.getPlaylist(playlistId).items.length === 2, "expected one new item after duplicate-skipping add");
  const addAfter = readPlaylistEditAfter(appliedAdd.operations[0]?.after);
  assert(addAfter.addedCount === 1, `expected one added item, got ${addAfter.addedCount}`);
  assert(addAfter.skippedCount === 1, `expected one skipped duplicate, got ${addAfter.skippedCount}`);

  const revertedAdd = await app.operations.revertBatch(addBatch.id);
  assert(revertedAdd.status === "reverted", `expected add batch reverted, got ${revertedAdd.status}`);
  assert(app.playlists.getPlaylist(playlistId).items.length === 1, "expected add revert to remove only new item");

  const itemToRemove = app.playlists.getPlaylist(playlistId).items[0];
  const removeBatch = app.operations.createRemoveTracksFromPlaylistBatch(playlistId, [itemToRemove.id]);
  app.operations.approveBatch(removeBatch.id);
  const appliedRemove = await app.operations.applyBatch(removeBatch.id);
  assert(appliedRemove.status === "applied", `expected remove batch applied, got ${appliedRemove.status}`);
  assert(app.playlists.getPlaylist(playlistId).items.length === 0, "expected playlist item removed");

  const revertedRemove = await app.operations.revertBatch(removeBatch.id);
  assert(revertedRemove.status === "reverted", `expected remove batch reverted, got ${revertedRemove.status}`);
  assert(app.playlists.getPlaylist(playlistId).items.length === 1, "expected removed item restored");

  app.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        playlistId,
        update: appliedUpdate.status,
        duplicateUpdate: failedDuplicateUpdate.status,
        revertUpdate: revertedUpdate.status,
        add: appliedAdd.status,
        revertAdd: revertedAdd.status,
        remove: appliedRemove.status,
        revertRemove: revertedRemove.status
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
    normalizedPath: filePath,
    filename,
    extension: "flac",
    sizeBytes: 1024,
    mtime: new Date().toISOString(),
    ctime: null,
    sha256: `${hashKey}-sha`,
    quickHash: `${hashKey}-quick`,
    durationMs: 180000,
    codec: "flac",
    container: "flac",
    bitrate: 900000,
    sampleRate: 44100,
    channels: 2,
    scanStatus: "scanned",
    tags: [
      { key: "title", value: title, source: "embedded" },
      { key: "artist", value: "Playlist Artist", source: "embedded" },
      { key: "album", value: "Playlist Album", source: "embedded" }
    ]
  });
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

function readPlaylistEditAfter(value: unknown): { addedCount: number; skippedCount: number } {
  if (typeof value !== "object" || value == null) {
    throw new Error("expected playlist edit after-state");
  }
  const after = value as { addedCount?: unknown; skippedCount?: unknown };
  if (typeof after.addedCount !== "number" || typeof after.skippedCount !== "number") {
    throw new Error("expected playlist edit add/skip counts");
  }
  return { addedCount: after.addedCount, skippedCount: after.skippedCount };
}
