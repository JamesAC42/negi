import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMusicDatabase } from "@music-os/db";
import type { CatalogueTrack } from "@music-os/core";
import { LibraryRepository } from "../services/library-repository.js";
import { missingReleaseTracks } from "../services/album-completeness.js";

const fixture = await mkdtemp(join(tmpdir(), "music-os-incomplete-albums-"));
const db = openMusicDatabase({ path: join(fixture, "test.sqlite") });
const library = new LibraryRepository(db);
const root = library.addRoot(fixture, "fixture");
let next = 0;
function add(album: string, number: number, total: number, options: { disc?: number; compound?: boolean; title?: string; year?: string } = {}) {
  const filename = `${number}-${++next}.flac`;
  const path = join(fixture, album, filename);
  return library.upsertFile({ libraryRootId: root.id, path, normalizedPath: path, filename, extension: "flac", sizeBytes: 100,
    mtime: new Date().toISOString(), ctime: null, sha256: null, quickHash: null, durationMs: 120000, codec: "flac", container: "flac",
    bitrate: 1000000, sampleRate: 44100, channels: 2, scanStatus: "scanned", tags: Object.entries({
      artist: "Test Artist", album, year: options.year ?? "2026", title: options.title ?? `Song ${number}`,
      tracknumber: options.compound ? `${number}/${total}` : String(number), tracktotal: String(total),
      discnumber: String(options.disc ?? 1),
    }).map(([key, value]) => ({ key, value, source: "fixture" })) }).id;
}
const tracks = (count: number): CatalogueTrack[] => Array.from({ length: count }, (_, i) => ({ title: `Song ${i + 1}`, number: i + 1, disc: 1, durationMs: 120000, owned: false }));
function snapshot(album: string, count: number, overrides: Record<string, unknown> = {}, date = "2026-09-07T12:00:00Z") {
  db.prepare("INSERT INTO jobs(id,type,status,payload_json,created_at,started_at) VALUES(?, 'album_acquisition', 'succeeded', ?, ?, ?)")
    .run(`job-${++next}`, JSON.stringify({ artist: "Test Artist", album, artistId: "apple:artist:1", releaseGroupId: "apple:album:2", year: "2026", tracks: tracks(count), ...overrides }), date, date);
}
const find = (name: string) => library.listIncompleteAlbums().find((album) => album.album === name);
try {
  for (const number of [1, 2, 4]) add("Incomplete", number, 4, { compound: true });
  add("Incomplete", 1, 4, { compound: true });
  assert.equal(find("Incomplete")?.presentTracks, 3, "Duplicate files must not inflate track count");
  assert.deepEqual(find("Incomplete")?.missingTrackNumbers, [3]);
  assert.equal(find("Incomplete")?.source, "tags");

  const future = Array.from({ length: 12 }, (_, i) => add("Future Past", i + 1, 15));
  snapshot("Future Past", 12);
  assert.equal(find("Future Past"), undefined, "Validated selected 12-track release overrides stale raw total 15");
  db.prepare("UPDATE files SET missing=1 WHERE id=?").run(future[4]);
  const missing = find("Future Past")!;
  assert.equal(missing.source, "catalogue");
  assert.equal(missing.presentTracks, 11);
  assert.equal(missing.expectedTracks, 12);
  assert.deepEqual(missing.missingTracks?.map((track) => [track.disc, track.number, track.title]), [[1, 5, "Song 5"]]);
  assert.equal(missing.releaseGroupId, "apple:album:2");
  db.prepare("UPDATE files SET missing=0 WHERE id=?").run(future[4]);
  assert.equal(find("Future Past"), undefined, "Completeness recomputes from live files, not stale completed flags");

  const overridden = add("Compound", 1, 15);
  library.setFileMetadataOverrides(overridden, { tracknumber: "1/2" });
  add("Compound", 2, 2, { compound: true });
  assert.equal(library.getDisplayTags(overridden).tracktotal, "2");
  assert.equal(library.getDisplayTags(overridden).totaltracks, "2");
  assert.equal(find("Compound"), undefined, "Explicit compound override controls raw aliases consistently");

  add("Two discs", 1, 2, { disc: 1 }); add("Two discs", 2, 2, { disc: 1 });
  add("Two discs", 1, 2, { disc: 2 }); add("Two discs", 1, 2, { disc: 2 });
  assert.equal(find("Two discs")?.expectedTracks, 4);
  assert.equal(find("Two discs")?.presentTracks, 3);
  assert.deepEqual(find("Two discs")?.missingTrackPositions, [{ disc: 2, number: 2 }]);
  assert.deepEqual(find("Two discs")?.missingTrackNumbers, [], "Do not flatten ambiguous multi-disc track numbers");

  add("Wrong year", 1, 3); snapshot("Wrong year", 1, { year: "1999" });
  assert.equal(find("Wrong year")?.source, "tags");
  add("Wrong identity", 1, 3); snapshot("Wrong identity", 1, { albumId: "unrelated-album" });
  assert.equal(find("Wrong identity")?.source, "tags");
  add("Malformed", 1, 3); snapshot("Malformed", 1, { tracks: [{ title: "Song 1", number: 0, disc: 1 }] });
  assert.equal(find("Malformed")?.source, "tags");
  add("Latest", 1, 3); snapshot("Latest", 1); snapshot("Latest", 2, {}, "2026-09-07T13:00:00Z");
  assert.equal(find("Latest")?.expectedTracks, 2, "Latest selected snapshot wins deterministically");
  const album = library.listAlbumGroups().find((album) => album.album === "Latest")!;
  assert.equal(library.getAlbumCatalogue(album)?.tracks.length, 2);

  const symbols: CatalogueTrack[] = [
    { ...tracks(1)[0]!, title: "&", number: 2 },
    { ...tracks(1)[0]!, title: "+ +", number: 7 },
  ];
  assert.deepEqual(missingReleaseTracks(symbols, [{ displayTags: { title: "&" } }, { displayTags: { title: "++" } }]), [],
    "Distinct symbol titles count as owned even without disc metadata");
  for (const title of ["", " ", "-", "+ +"]) {
    assert.equal(missingReleaseTracks([symbols[0]], [{ displayTags: { title, discnumber: "1" } }]).length, 1,
      "Blank or unrelated symbolic titles cannot fill a missing symbolic track: " + title);
  }
  assert.equal(missingReleaseTracks([symbols[0]], [{ displayTags: { discnumber: "1" } }]).length, 1,
    "Missing title tags cannot fill a symbolic track");
  assert.deepEqual(missingReleaseTracks([symbols[1]], [{ displayTags: { title: "\uFF0B \uFF0B" } }], symbols), [],
    "Source matching and recovered file completeness use the same symbol normalization");
  const symbolDiscs = [symbols[0], { ...symbols[0], disc: 2 }];
  assert.equal(missingReleaseTracks(symbolDiscs, [{ displayTags: { title: "&" } }]).length, 2,
    "Repeated symbolic titles still require explicit disc identity");

  const repeated = [{ ...tracks(1)[0]!, title: "Same", number: 1 }, { ...tracks(1)[0]!, title: "Same", number: 2 }];
  assert.equal(missingReleaseTracks(repeated, [{ displayTags: { title: "Same", tracknumber: "1", discnumber: "1" } }, { displayTags: { title: "Same", tracknumber: "1", discnumber: "1" } }]).length, 1);
  const discTwo = [{ ...tracks(1)[0]!, disc: 2 }];
  assert.deepEqual(missingReleaseTracks(discTwo, [{ displayTags: { title: "Song 1" } }]), [], "Unknown disc can own an unambiguous title on disc two");
  const repeatedDiscs = [{ ...discTwo[0]!, disc: 1 }, discTwo[0]!];
  assert.equal(missingReleaseTracks(repeatedDiscs, [{ displayTags: { title: "Song 1" } }, { displayTags: { title: "Song 1" } }]).length, 2,
    "Unknown-disc duplicate titles cannot be assigned to both discs");
  assert.equal(missingReleaseTracks(discTwo, [{ displayTags: { title: "Song 1" } }], repeatedDiscs).length, 1,
    "A subset can retain full-release title ambiguity");
  console.log("PASS: catalogue completeness, deletion/restoration, stale and compound totals, unique disc positions, symbolic title identity, snapshot identity/year/latest validation");
} finally {
  db.close();
  await rm(fixture, { recursive: true, force: true });
}
