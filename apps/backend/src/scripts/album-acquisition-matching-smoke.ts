import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { CatalogueTrack, DiscoveryResult } from "@music-os/core";
import { matchReleaseFiles, inspectReleaseFiles, albumMatchFailure } from "../services/album-source-matching.js";
import { CatalogueService } from "../services/catalogue-service.js";
import { SlskdService } from "../services/slskd-service.js";
import type { LibraryRepository } from "../services/library-repository.js";

const tracks: CatalogueTrack[] = [
  { title: "First Song", number: 1, disc: 1, durationMs: 180000 },
  { title: "Second Song", number: 2, disc: 1, durationMs: 200000 },
];
function file(track = tracks[0], patch: Partial<DiscoveryResult> = {}): DiscoveryResult {
  const filename = String(track.number).padStart(2, "0") + " - " + track.title + ".flac";
  const folder = "Music/Artist/Album";
  return { id: filename, source: "slskd", username: "peer", filename,
    folder, path: folder + "/" + filename, sizeBytes: 25000000,
    extension: "flac", bitrate: null, sampleRate: 44100, lengthSeconds: (track.durationMs ?? 0) / 1000,
    isLocked: false, raw: {}, ...patch };
}
assert.equal(matchReleaseFiles(tracks.map((t) => file(t)), tracks, "Artist", "Album").length, 2);
const split = [file(tracks[0], { username: "one" }), file(tracks[1], { username: "two" })];
assert.equal(matchReleaseFiles(split, tracks, "Artist", "Album").length, 2, "Combine complete coverage across peers");
assert.equal(matchReleaseFiles([file()], tracks, "Artist", "Album").length, 0, "Never call a partial album complete");
const report = inspectReleaseFiles([file()], tracks, "Artist", "Album");
assert.equal(report.picks.length, 1);
assert.match(albumMatchFailure(report, 1, 2), /Matched 1\/2.*Second Song/);
assert.match(albumMatchFailure(inspectReleaseFiles([], tracks, "Artist", "Album"), 0, 3), /No files were returned/);

for (const patch of [
  { isLocked: true },
  { path: "Other/Album/First Song.flac" },
  { filename: "First Song (Live).flac" },
  { filename: "First Song (Instrumental).flac" },
  { filename: "First Song (DJ Remix).flac" },
  { lengthSeconds: 240 },
  { extension: "mp3", bitrate: 128 },
  { extension: "mp3", bitrate: null, sizeBytes: null, lengthSeconds: null },
]) assert.equal(matchReleaseFiles([file(tracks[0], patch)], [tracks[0]], "Artist", "Album").length, 0, JSON.stringify(patch));
for (const patch of [
  { filename: "01 - Artist - First Song.flac" },
  { filename: "First Song - Artist - Album.flac" },
  { filename: "01. First Song (2019 Remaster).flac" },
  { filename: "01. First Song [FLAC].flac" },
  { extension: "mp3", bitrate: 235, raw: { isVariableBitRate: true } },
  { extension: "mp3", bitrate: 320000 },
  { extension: "aac", bitrate: 256 },
  { extension: "opus", bitrate: 192 },
]) assert.equal(matchReleaseFiles([file(tracks[0], patch)], [tracks[0]], "Artist", "Album").length, 1, JSON.stringify(patch));

const queuedLossless = tracks.map((t) => file(t, { username: "queued-hirez", bitrate: 4000,
  hasFreeUploadSlot: false, queueLength: 15, uploadSpeedBytesPerSecond: 100000 }));
const availableLossless = tracks.map((t) => file(t, { username: "free-lossless", bitrate: 800,
  hasFreeUploadSlot: true, queueLength: 0, uploadSpeedBytesPerSecond: 2000000 }));
const availableLossy = tracks.map((t) => file(t, { username: "fast-mp3", extension: "mp3", bitrate: 320,
  hasFreeUploadSlot: true, queueLength: 0, uploadSpeedBytesPerSecond: 20000000 }));
assert.deepEqual(matchReleaseFiles([...queuedLossless, ...availableLossless, ...availableLossy], tracks, "Artist", "Album")
  .map((p) => p.result.username), ["free-lossless", "free-lossless"], "A free lossless folder beats a queued high-bitrate folder and fast lossy peers");
const fastSplit = tracks.map((t, i) => file(t, { username: "fast-split-" + i, bitrate: 800,
  hasFreeUploadSlot: true, queueLength: 0, uploadSpeedBytesPerSecond: 2000000 }));
const slowSplit = tracks.map((t, i) => file(t, { username: "slow-split-" + i, bitrate: 4000,
  hasFreeUploadSlot: true, queueLength: 3, uploadSpeedBytesPerSecond: 100000 }));
assert.deepEqual(matchReleaseFiles([...slowSplit, ...fastSplit], tracks, "Artist", "Album")
  .map((p) => p.result.username), ["fast-split-0", "fast-split-1"], "Availability ranks split peers as well as complete folders");
assert.equal(matchReleaseFiles([file(tracks[0], { username: "slow", bitrate: 4000, uploadSpeedBytesPerSecond: 1000 }),
  file(tracks[0], { username: "fast", bitrate: 800, uploadSpeedBytesPerSecond: 2000000 })], [tracks[0]], "Artist", "Album")[0].result.username,
  "fast", "Upload speed breaks equal slot and queue availability before bitrate");

const credited = file(tracks[0], { filename: "01 - First Song [feat. Guest].flac" });
assert.equal(matchReleaseFiles([credited], [tracks[0]], "Artist", "Album").length, 1);
for (const patch of [
  { filename: "11 - First Song (feat. Guest).flac" },
  { filename: "First Song (feat. Guest).flac" },
  { filename: "01 - First Song (feat. Guest Remix).flac" },
  { filename: "01 - First Song (feat. Guest) (Live).flac" },
  { lengthSeconds: null },
  { lengthSeconds: 184 },
  { path: "Artist/Album/CD2/01 First Song.flac" },
]) assert.equal(matchReleaseFiles([{ ...credited, ...patch }], [tracks[0]], "Artist", "Album").length, 0,
  "Featured credits require the right ordinal, disc and close verified duration without version changes: " + JSON.stringify(patch));
assert.equal(matchReleaseFiles([{ ...credited, username: "fast-credit", hasFreeUploadSlot: true },
  file(tracks[0], { username: "exact", hasFreeUploadSlot: false })], [tracks[0]], "Artist", "Album")[0].result.username,
  "exact", "Existing exact matches are preferred over inferred feature-credit variants");

const numeric = { ...tracks[0], title: "8/31" };
assert.equal(matchReleaseFiles([file(numeric, { filename: "01. 8_31.flac" })], [numeric], "Artist", "Album").length, 1);
assert.equal(matchReleaseFiles([file(numeric, { filename: "01. 31.flac" })], [numeric], "Artist", "Album").length, 0);
const repeated = [{ ...tracks[0], title: "Intro" }, { ...tracks[0], title: "Intro", disc: 2 }];
const discs = repeated.map((t) => file(t, { id: "disc" + t.disc, path: "Artist/Album/CD" + t.disc + "/01 Intro.flac", folder: "Artist/Album/CD" + t.disc, filename: "01 Intro.flac" }));
assert.equal(matchReleaseFiles(discs, repeated, "Artist", "Album").length, 2);
assert.equal(matchReleaseFiles([file(repeated[0])], repeated, "Artist", "Album").length, 0, "Ambiguous unnumbered discs cannot be assigned twice");

assert.equal(inspectReleaseFiles([file(repeated[0])], [repeated[1]], "Artist", "Album", repeated).picks.length, 0,
  "An already-owned disc does not make an ambiguous title safe for a different disc");
// A complete foreign-script album can use a duration-verified numbered folder
// even when its peer filenames use romanization instead of catalogue spelling.
const translatedTracks: CatalogueTrack[] = [
  { title: "旅の始まり", number: 1, disc: 1, durationMs: 180000 },
  { title: "遠い空", number: 2, disc: 1, durationMs: 223000 },
  { title: "帰り道", number: 3, disc: 1, durationMs: 267000 },
];
const translatedFiles = translatedTracks.map((t, i) => file(t, {
  filename: `${i + 1}. ${["Tabi no hajimari", "Tooi sora", "Kaerimichi"][i]}.flac`,
  path: `Music/Artist/Album/${i + 1}. romanized.flac`,
}));
assert.equal(matchReleaseFiles(translatedFiles, translatedTracks, "Artist", "Album").length, 3);
assert.equal(inspectReleaseFiles(translatedFiles, [translatedTracks[2]], "Artist", "Album", translatedTracks).picks.length, 1);
for (const files of [
  translatedFiles.slice(1),
  translatedFiles.map((f, i) => i === 1 ? { ...f, lengthSeconds: 240 } : f),
  translatedFiles.map((f, i) => i === 1 ? { ...f, lengthSeconds: null } : f),
  translatedFiles.map((f) => ({ ...f, path: f.path.replace("/Album/", "/Album Live/") })),
  translatedFiles.map((f, i) => i === 1 ? { ...f, filename: "1. Duplicate.flac" } : f),
]) assert.equal(matchReleaseFiles(files, translatedTracks, "Artist", "Album").length, 0,
  "Transliteration requires full unique sequence, all durations and no alternate version");
assert.equal(matchReleaseFiles(translatedFiles, translatedTracks.map((t) => ({ ...t, title: "Unrelated English title" })), "Artist", "Album").length, 0);
assert.equal(matchReleaseFiles(tracks.map((t) => file(t)), tracks, "Artist", "Album - EP").length, 2,
  "Apple's release-type suffix is not part of the shared album folder name");
assert.equal(matchReleaseFiles([file(tracks[0], { filename: "Artist_Album_01_First Song.flac" })], [tracks[0]], "Artist", "Album").length, 1);

const bilingualFiles = tracks.map((t) => file(t, { path: `Artist/MIDZY/${t.number}.flac`, folder: "Artist/MIDZY" }));
assert.equal(matchReleaseFiles(bilingualFiles, tracks, "Artist", "믿지 (MIDZY)").length, 2,
  "Bilingual release titles can use either explicit catalogue album name");
assert.equal(matchReleaseFiles(bilingualFiles, tracks, "Artist", "Album (MIDZY)").length, 0,
  "Ordinary parenthetical edition labels are not alternate album names");

const config = { host: "127.0.0.1", port: 0, databasePath: ":memory:", mpvPath: "mpv" };
const catalogue = new CatalogueService(config, { listAlbumGroups: () => [] } as unknown as LibraryRepository);
const requests: string[] = [];
catalogue.request = async <T>(path: string) => {
  requests.push(path);
  if (path.startsWith("release-group/")) return { id: "group", title: "Album", "artist-credit": [{ artist: { id: "artist" } }] } as T;
  if (path === "release") return { releases: [
    { id: "video-only", date: "1999", media: [{ position: 1, format: "DVD", "track-count": 9 }] },
    { id: "audio-with-bonus", date: "2000", media: [
      { position: 1, format: "CD", "track-count": 2 },
      { position: 2, format: "DVD", "track-count": 6 },
      { position: 3, format: "DVD-Audio", "track-count": 1 },
    ] },
  ] } as T;
  assert.equal(path, "release/audio-with-bonus");
  return { id: "audio-with-bonus", title: "Album", media: [
    { position: 1, format: "CD", tracks: [
      { position: 1, title: "Audio", length: 180000 },
      { position: 2, title: "Enhanced CD video", recording: { video: true } },
    ] },
    { position: 2, format: "DVD", tracks: [{ position: 1, title: "Bonus PV" }] },
    { position: 3, format: "DVD-Audio", tracks: [{ position: 1, title: "Audio DVD track" }] },
  ] } as T;
};
const release = await catalogue.release("group", "Artist");
assert.deepEqual(release.tracks.map((t) => t.title), ["Audio", "Audio DVD track"]);
assert.equal(release.tracks[1].disc, 3, "Preserve official disc positions");

let polls = 0;
const server = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method === "POST") {
    polls = 0;
    res.end(JSON.stringify({ id: "late-peers" }));
  } else {
    polls++;
    res.end(JSON.stringify({ isComplete: polls >= 3, responseCount: polls,
      responses: [
        { username: "early-peer", files: [{ filename: "Artist/Album/01 First Song.flac", size: 123 }] },
        ...(polls >= 3 ? [{ username: "late-peer", files: [{ filename: "Artist/Album/02 Second Song.flac", size: 456 }] }] : []),
      ],
    }));
  }
});
const envKeys = ["MUSIC_OS_SLSKD_SEARCH_INITIAL_POLL_MS", "MUSIC_OS_SLSKD_SEARCH_POLL_MAX_MS", "MUSIC_OS_SLSKD_SEARCH_PARTIAL_AFTER_MS"];
const previous = envKeys.map((key) => process.env[key]);
try {
  envKeys.forEach((key) => { process.env[key] = "1"; });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = new SlskdService({ ...config, slskdUrl: "http://127.0.0.1:" + (server.address() as AddressInfo).port });
  const preview = await client.search("Artist Album", 1);
  assert.equal(preview.results.length, 1, "Manual search still returns its quick preview");
  const complete = await client.search("Artist Album", 1, { waitForComplete: true });
  assert.equal(complete.results.length, 2, "Agent ignores early file/preview threshold and waits for late responses");
  assert.equal(polls, 3);
} finally {
  envKeys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
console.log("PASS: late peers, manual previews, split sources, source quality, filename variants, numeric titles, disc identity, diagnostic errors and video-only bonus media.");
