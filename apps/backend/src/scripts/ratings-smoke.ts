import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-ratings-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "ratings");
  const filePath = join(libraryPath, "Rated Song.mp3");
  const inserted = app.library.upsertFile({
    libraryRootId: root.id,
    path: filePath,
    normalizedPath: filePath.toLowerCase(),
    filename: "Rated Song.mp3",
    extension: "mp3",
    sizeBytes: 1024,
    mtime: new Date().toISOString(),
    ctime: null,
    sha256: "ratings-smoke-hash",
    quickHash: "ratings-smoke-quick",
    durationMs: 180_000,
    codec: "mp3",
    container: "mpeg",
    bitrate: 320_000,
    sampleRate: 44_100,
    channels: 2,
    scanStatus: "scanned",
    tags: [
      { key: "artist", value: "Ratings Smoke Artist", source: "smoke" },
      { key: "title", value: "Rated Song", source: "smoke" }
    ]
  });

  const ratingBatch = app.operations.createSetRatingBatch(inserted.id, 5);
  assert(app.library.getFile(inserted.id).rating == null, "proposed rating should not mutate before apply");
  app.operations.approveBatch(ratingBatch.id);
  const appliedRating = await app.operations.applyBatch(ratingBatch.id);
  assert(appliedRating.status === "applied", `expected applied rating batch, got ${appliedRating.status}`);
  assert(app.library.getFile(inserted.id).rating === 5, `expected rating 5, got ${app.library.getFile(inserted.id).rating}`);

  const favoriteBatch = app.operations.createSetFavoriteStatusBatch(inserted.id, { liked: true, disliked: false });
  app.operations.approveBatch(favoriteBatch.id);
  const appliedFavorite = await app.operations.applyBatch(favoriteBatch.id);
  assert(appliedFavorite.status === "applied", `expected applied favorite batch, got ${appliedFavorite.status}`);
  const liked = app.library.getFile(inserted.id);
  assert(liked.liked === true, "expected liked true");
  assert(liked.disliked === false, "expected disliked false");

  const dislikedBatch = app.operations.createSetFavoriteStatusBatch(inserted.id, { liked: false, disliked: true });
  app.operations.approveBatch(dislikedBatch.id);
  await app.operations.applyBatch(dislikedBatch.id);
  const disliked = app.library.getFile(inserted.id);
  assert(disliked.liked === false, "expected liked false after dislike");
  assert(disliked.disliked === true, "expected disliked true after dislike");

  app.close();
  console.log(JSON.stringify({ ok: true, rating: disliked.rating, liked: disliked.liked, disliked: disliked.disliked }, null, 2));
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
