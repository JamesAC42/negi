import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-album-artwork-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const imagePath = join(fixtureDir, "chosen-cover.png");
const imageData = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

try {
  await writeFile(imagePath, imageData);
  const app = createBackendApp({
    host: "127.0.0.1",
    port: 0,
    databasePath,
    mpvPath: "mpv",
    musicBrainzEnabled: false
  });
  const root = app.library.addRoot(fixtureDir, "artwork");
  const file = app.library.upsertFile({
    libraryRootId: root.id,
    path: join(fixtureDir, "track.flac"),
    normalizedPath: join(fixtureDir, "track.flac").toLowerCase(),
    filename: "track.flac",
    extension: "flac",
    sizeBytes: 1024,
    mtime: new Date().toISOString(),
    ctime: null,
    sha256: "album-artwork-override-smoke",
    quickHash: "album-artwork-override-smoke-quick",
    durationMs: 120_000,
    codec: "flac",
    container: "flac",
    bitrate: 900_000,
    sampleRate: 44_100,
    channels: 2,
    scanStatus: "scanned",
    tags: [
      { key: "title", value: "Smoke Track", source: "smoke" },
      { key: "artist", value: "Smoke Artist", source: "smoke" },
      { key: "album", value: "Smoke Album", source: "smoke" },
      { key: "year", value: "2026", source: "smoke" }
    ]
  });
  const album = app.library.listAlbumGroups()[0];
  assert(album, "expected an album group");

  await app.artwork.setAlbumArtworkFromPath(album.id, imagePath);
  const albumArtwork = await app.artwork.getAlbumArtwork(album.id);
  const fileArtwork = await app.artwork.getFileArtwork(file.id);
  assert(albumArtwork?.mimeType === "image/png", "album override should retain its MIME type");
  assert(albumArtwork?.data.equals(imageData), "album endpoint should return the chosen image");
  assert(fileArtwork?.data.equals(imageData), "file artwork should honor the album override");
  app.close();

  const reopened = createBackendApp({
    host: "127.0.0.1",
    port: 0,
    databasePath,
    mpvPath: "mpv",
    musicBrainzEnabled: false
  });
  const reopenedAlbum = reopened.library.listAlbumGroups()[0];
  assert(reopenedAlbum, "expected the album after reopening");
  const persistedArtwork = await reopened.artwork.getAlbumArtwork(reopenedAlbum.id);
  assert(persistedArtwork?.data.equals(imageData), "chosen artwork should survive an app restart");

  reopened.artwork.removeAlbumArtworkOverride(reopenedAlbum.id);
  const remaining = reopened.db.prepare("SELECT COUNT(*) AS total FROM album_artwork_overrides").get() as { total: number };
  assert(remaining.total === 0, "automatic artwork reset should remove the override");
  reopened.close();

  console.log(JSON.stringify({ ok: true, persisted: true, fileArtworkOverridden: true }, null, 2));
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
