import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-taste-profile-"));
const databasePath = join(fixtureDir, "music-os.sqlite");

try {
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });

  const empty = app.tasteProfile.getProfile();
  assert(empty.profile.favoriteArtists.length === 0, "default profile should start empty");
  assert(empty.profile.qualityPreferences.preferLossless === true, "default profile should prefer lossless");

  const saved = app.tasteProfile.updateProfile({
    ...empty.profile,
    favoriteArtists: ["Steely Dan", "Haruomi Hosono"],
    preferredGenres: ["city pop", "fusion"],
    preferredEras: ["1977-1984"],
    blockedGenres: ["bro country"],
    preferredFormats: ["FLAC", "ALAC"],
    qualityPreferences: {
      preferLossless: true,
      allowMp3IfRare: false,
      minimumBitrateKbps: 320
    },
    taggingPreferences: "Use concise lowercase mood tags.",
    folderOrganizationPreferences: "Artist/Year - Album",
    playlistStylePreferences: "Short focused playlists.",
    notes: "Prefer groove-heavy records."
  });

  assert(saved.profile.favoriteArtists.includes("Steely Dan"), "saved favorite artist missing");
  assert(saved.profile.qualityPreferences.allowMp3IfRare === false, "quality preference was not saved");
  assert(saved.entries.length >= 16, `expected persisted taste profile entries, got ${saved.entries.length}`);

  app.close();

  const reopened = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const loaded = reopened.tasteProfile.getProfile();
  assert(loaded.profile.preferredGenres.includes("city pop"), "reopened profile lost preferred genre");
  assert(loaded.profile.qualityPreferences.minimumBitrateKbps === 320, "reopened profile lost bitrate preference");
  reopened.close();

  console.log(JSON.stringify({ ok: true, entries: loaded.entries.length, updatedAt: loaded.updatedAt }, null, 2));
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
