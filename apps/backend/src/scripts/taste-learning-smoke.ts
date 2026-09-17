import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMusicDatabase } from "@music-os/db";
import { tasteProfileResponseSchema } from "@music-os/core";
import { TasteProfileService } from "../services/taste-profile-service.js";
import { PlaybackHistoryService } from "../services/playback-history-service.js";

const fixture = await mkdtemp(join(tmpdir(), "music-os-taste-learning-"));
const path = join(fixture, "fixture.sqlite");
let db = openMusicDatabase({ path });
try {
  let taste = new TasteProfileService(db);
  const history = new PlaybackHistoryService(db);
  for (const id of ["one", "two", "failed"]) {
    db.prepare("INSERT INTO files (id, path, normalized_path, filename, extension, size_bytes, mtime) VALUES (?, ?, ?, ?, 'flac', 1, datetime('now'))").run(id, id, id, id);
    const tags = { artist: id === "failed" ? "Broken Artist" : "Listening Artist", album: "Listening Album", title: id, genre: "Jazz; Fusion", date: "1982-04-01", country: "JP", label: "Fixture Records" };
    for (const [key, value] of Object.entries(tags)) {
      db.prepare("INSERT INTO embedded_tags (id, file_id, tag_key, tag_value, source) VALUES (?, ?, ?, ?, 'fixture')").run(id + key, id, key, value);
    }
  }
  assert.equal(taste.getProfile().learned?.stats.qualifiedPlays, 0);
  // A started event and a failed/zero-position load cannot create positive taste.
  history.recordStarted("failed");
  history.recordEnded({ fileId: "failed", reason: "stop", positionMs: 0, durationMs: 180000 });
  history.recordEnded({ fileId: "failed", reason: "completed", positionMs: 0, durationMs: 180000 });
  assert.equal(taste.getProfile().learned?.signals.length, 0);

  history.recordEnded({ fileId: "one", reason: "stop", positionMs: 45000, durationMs: 180000 });
  const first = taste.getProfile();
  assert.equal(first.learned?.stats.qualifiedPlays, 1);
  assert.equal(first.profile.favoriteArtists.length, 0, "inference must not overwrite explicit settings");
  assert.equal(first.effectiveProfile?.favoriteArtists.length, 0, "one casual play must not steer acquisition");
  history.recordEnded({ fileId: "one", reason: "completed", positionMs: 180000, durationMs: 180000 });
  const learned = taste.getProfile();
  tasteProfileResponseSchema.parse(learned);
  assert.deepEqual(learned.effectiveProfile?.favoriteArtists, ["Listening Artist"]);
  assert.deepEqual(learned.learned?.profile.preferredEras, ["1980s"]);
  assert.deepEqual(learned.learned?.profile.preferredCountries, ["JP"]);
  assert.deepEqual(learned.learned?.profile.preferredLabels, ["Fixture Records"]);
  assert.deepEqual(learned.learned?.profile.preferredGenres, ["Fusion", "Jazz"]);
  assert.equal(learned.learned?.stats.completedPlays, 1);
  assert(learned.learned?.signals.every((signal) => signal.confidence > 0 && signal.sampleCount === 2));

  const changesBefore = db.prepare("SELECT total_changes() AS total").get() as { total: number };
  assert.equal(taste.getProfile().learned, learned.learned, "unchanged reads should reuse aggregation");
  const changesAfter = db.prepare("SELECT total_changes() AS total").get() as { total: number };
  assert.equal(changesBefore.total, changesAfter.total, "unchanged reads should perform no writes");

  const explicit = taste.updateProfile({
    ...learned.profile, favoriteArtists: ["Chosen Artist"], blockedGenres: ["jazz"], preferredFormats: ["ALAC"],
    qualityPreferences: { preferLossless: false, allowMp3IfRare: false, minimumBitrateKbps: 256 }
  });
  assert.deepEqual(explicit.effectiveProfile?.favoriteArtists, ["Chosen Artist"]);
  assert.deepEqual(explicit.effectiveProfile?.preferredGenres, ["Fusion"]);
  assert.deepEqual(explicit.effectiveProfile?.qualityPreferences, explicit.profile.qualityPreferences);

  db.prepare("INSERT INTO file_preferences (file_id, liked) VALUES ('two', 1)").run();
  const liked = taste.getProfile();
  assert.equal(liked.learned?.stats.likedTracks, 1);
  assert(liked.learned?.signals.some((signal) => signal.key === "favoriteTracks" && signal.value.endsWith("two") && signal.sources.includes("liked")));
  db.prepare("INSERT INTO file_metadata_overrides (file_id, tag_key, tag_value) VALUES ('two', 'genre', 'Ambient')").run();
  assert(taste.getProfile().learned?.profile.preferredGenres.includes("Ambient"), "metadata changes should invalidate only affected evidence");
  db.prepare("UPDATE file_preferences SET disliked = 1 WHERE file_id = 'two'").run();
  assert(!taste.getProfile().learned?.signals.some((signal) => signal.value.endsWith("two")), "explicit dislike must suppress positive evidence");

  for (let index = 0; index < 4; index++) {
    history.recordEnded({ fileId: "one", reason: "next", positionMs: 4000, durationMs: 180000 });
  }
  const skipped = taste.getProfile();
  assert.equal(skipped.learned?.stats.earlySkips, 4);
  assert.equal(skipped.effectiveProfile?.blockedArtists.length, 0, "skips must not invent artist blocks");
  assert((skipped.learned?.signals.find((signal) => signal.key === "favoriteArtists")?.score ?? Infinity) <
    (learned.learned?.signals.find((signal) => signal.key === "favoriteArtists")?.score ?? 0), "repeated early skips should soften inferred weight");

  db.close();
  db = openMusicDatabase({ path });
  taste = new TasteProfileService(db);
  assert.equal(taste.getProfile().learned?.stats.qualifiedPlays, 2, "evidence should survive restart");
  assert.deepEqual(taste.getEffectiveProfile().favoriteArtists, ["Chosen Artist"]);
  db.prepare("DELETE FROM playback_events WHERE file_id = 'one'").run();
  assert.equal(taste.getProfile().learned?.stats.qualifiedPlays, 0, "history repairs must invalidate evidence");
  assert.equal(taste.getProfile().learned?.signals.length, 0, "removed plays must not leave stale positive taste");
  db.prepare("DELETE FROM file_preferences WHERE file_id = 'two'").run();
  assert.equal(taste.getProfile().learned?.stats.trackedFiles, 0, "removing preferences should clear obsolete evidence");
  console.log(JSON.stringify({ ok: true, checks: ["qualified listening", "failed playback exclusion", "metadata dimensions", "cached reads", "explicit precedence", "likes and dislikes", "metadata invalidation", "cautious skips", "persistence", "history repair"] }, null, 2));
} finally {
  db.close();
  await rm(fixture, { recursive: true, force: true });
}