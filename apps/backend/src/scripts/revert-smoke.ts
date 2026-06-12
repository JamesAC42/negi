import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-revert-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "library");
  const filePath = join(libraryPath, "Original Artist - Original Title.flac");
  const inserted = app.library.upsertFile({
    libraryRootId: root.id,
    path: filePath,
    normalizedPath: filePath,
    filename: "Original Artist - Original Title.flac",
    extension: "flac",
    sizeBytes: 1024,
    mtime: new Date().toISOString(),
    ctime: null,
    sha256: "revert-smoke-sha",
    quickHash: "revert-smoke-quick",
    durationMs: 180000,
    codec: "flac",
    container: "flac",
    bitrate: 900000,
    sampleRate: 44100,
    channels: 2,
    scanStatus: "scanned",
    tags: [
      { key: "title", value: "Original Title", source: "embedded" },
      { key: "artist", value: "Original Artist", source: "embedded" },
      { key: "album", value: "Original Album", source: "embedded" },
      { key: "year", value: "1977", source: "embedded" }
    ]
  });

  const metadataBatch = app.operations.createSetFileMetadataBatch(inserted.id, {
    title: "Changed Title",
    artist: "Changed Artist",
    album: "Changed Album",
    year: "1984"
  });
  app.operations.approveBatch(metadataBatch.id);
  const appliedMetadata = await app.operations.applyBatch(metadataBatch.id);
  assert(appliedMetadata.status === "applied", `expected metadata batch applied, got ${appliedMetadata.status}`);
  assert(app.library.getFile(inserted.id).displayTags.title === "Changed Title", "expected metadata override to apply");

  const revertedMetadata = await app.operations.revertBatch(metadataBatch.id);
  assert(revertedMetadata.status === "reverted", `expected metadata batch reverted, got ${revertedMetadata.status}`);
  assert(revertedMetadata.operations[0].status === "reverted", "expected metadata operation reverted");
  const restoredMetadata = app.library.getFile(inserted.id);
  assert(restoredMetadata.displayTags.title === "Original Title", "expected original title after metadata revert");
  assert(restoredMetadata.displayTags.artist === "Original Artist", "expected original artist after metadata revert");
  assert(restoredMetadata.displayTags.album === "Original Album", "expected original album after metadata revert");
  assert(restoredMetadata.displayTags.year === "1977", "expected original year after metadata revert");

  const ratingBatch = app.operations.createSetRatingBatch(inserted.id, 5);
  app.operations.approveBatch(ratingBatch.id);
  await app.operations.applyBatch(ratingBatch.id);
  assert(app.library.getFile(inserted.id).rating === 5, "expected rating to apply");
  const revertedRating = await app.operations.revertBatch(ratingBatch.id);
  assert(revertedRating.status === "reverted", `expected rating batch reverted, got ${revertedRating.status}`);
  assert(app.library.getFile(inserted.id).rating == null, "expected rating to revert to null");

  const favoriteBatch = app.operations.createSetFavoriteStatusBatch(inserted.id, { liked: true, disliked: false });
  app.operations.approveBatch(favoriteBatch.id);
  await app.operations.applyBatch(favoriteBatch.id);
  assert(app.library.getFile(inserted.id).liked === true, "expected liked status to apply");
  const revertedFavorite = await app.operations.revertBatch(favoriteBatch.id);
  assert(revertedFavorite.status === "reverted", `expected favorite batch reverted, got ${revertedFavorite.status}`);
  const neutralFile = app.library.getFile(inserted.id);
  assert(neutralFile.liked == null && neutralFile.disliked == null, "expected favorite status to revert to neutral");

  const playlistBatch = app.operations.createPlaylistBatch("Revert Smoke Playlist", "Reversible playlist proof", [inserted.id]);
  app.operations.approveBatch(playlistBatch.id);
  const appliedPlaylist = await app.operations.applyBatch(playlistBatch.id);
  assert(appliedPlaylist.status === "applied", `expected playlist batch applied, got ${appliedPlaylist.status}`);
  const playlistId = readCreatedPlaylistId(appliedPlaylist.operations[0]?.after);
  assert(playlistId != null, "expected playlist apply after-state to include playlist id");
  assert(app.playlists.getPlaylist(playlistId).items.length === 1, "expected playlist to include selected file");
  const revertedPlaylist = await app.operations.revertBatch(playlistBatch.id);
  assert(revertedPlaylist.status === "reverted", `expected playlist batch reverted, got ${revertedPlaylist.status}`);
  await assertRejects(() => Promise.resolve(app.playlists.getPlaylist(playlistId)), "playlist should be removed after revert");

  app.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        metadata: revertedMetadata.status,
        rating: revertedRating.status,
        favorite: revertedFavorite.status,
        playlist: revertedPlaylist.status
      },
      null,
      2
    )
  );
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejects(run: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await run();
  } catch {
    return;
  }
  throw new Error(message);
}

function readCreatedPlaylistId(value: unknown): string | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
