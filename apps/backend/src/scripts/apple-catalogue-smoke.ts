import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type { BackendConfig } from "../config.js";
import type { LibraryRepository } from "../services/library-repository.js";
import { AppleCatalogueService } from "../services/apple-catalogue-service.js";

const artist = { wrapperType: "artist", artistId: 7, artistName: "Fixture", artistLinkUrl: "https://music.apple.com/us/artist/fixture/7" };
const album = (collectionId: number, collectionName: string, releaseDate: string, artistId = 7) => ({ wrapperType: "collection", artistId, collectionId, collectionName, releaseDate,
  trackCount: 2, artworkUrl100: "https://is1-ssl.mzstatic.com/image/100x100bb.jpg", collectionViewUrl: `https://music.apple.com/us/album/fixture/${collectionId}` });
const first = album(10, "First", "2000-01-01T00:00:00Z");
const song = (discNumber: number) => ({ wrapperType: "track", kind: "song", collectionId: 10, discNumber, trackNumber: 1, trackName: "Same title", trackTimeMillis: 120000 });
const local = { id: "local", album: "First", artist: "Fixture", fileCount: 1, files: [{ displayTags: { title: "Same title", discnumber: "2" } }] };
const library = { listAlbumGroups: () => [local], listIncompleteAlbums: () => [] } as unknown as LibraryRepository;
const config = {} as BackendConfig;
const db = new Database(":memory:");
let calls = 0;
const result = (results: unknown[]) => ({ resultCount: results.length, results });
const download = async (url: URL) => {
  calls++;
  if (url.pathname === "/search") return result([artist]);
  if (url.searchParams.get("entity") === "song") return result([first, song(2), song(1)]);
  return result([artist, first, album(11, "Second", "2020-01-01T00:00:00Z"), album(12, "Unrelated", "2025-01-01T00:00:00Z", 8)]);
};
try {
  const service = new AppleCatalogueService(config, library, db, download);
  const searches = await Promise.all([service.searchArtists("Fixture"), service.searchArtists("Fixture")]);
  assert.equal(calls, 1, "Concurrent request deduplication");
  assert.equal(searches[0][0].id, "apple:7");
  assert.equal(searches[0][0].libraryAlbumId, "local");
  const newest = await service.browse("apple:7", "Fixture");
  assert.deepEqual(newest.albums.map((row) => row.id), ["apple:11", "apple:10"]);
  assert.equal(newest.total, 2, "Unrelated credited artist albums excluded");
  assert.equal(newest.albums[1].libraryStatus, "unverified", "Track count does not falsely establish ownership");
  assert.equal(newest.albums[1].artworkUrl, "https://is1-ssl.mzstatic.com/image/600x600bb.jpg");
  assert.deepEqual((await service.browse("apple:7", "Fixture", 0, "oldest")).albums.map((row) => row.id), ["apple:10", "apple:11"]);
  assert.deepEqual((await service.browse("apple:7", "Fixture", 0, "title")).albums.map((row) => row.id), ["apple:10", "apple:11"]);
  assert.equal((await service.browse("apple:7", "Fixture", 1)).albums.length, 1);
  const release = await service.release("apple:10", "Fixture");
  assert.deepEqual(release.artistIds, ["apple:7"]);
  assert.equal(release.releaseId, "apple:10");
  assert.equal(release.trackListingComplete, true);
  assert.equal(release.expectedTrackCount, 2);
  assert.deepEqual(release.tracks.map((track) => [track.disc, track.number, track.owned]), [[1, 1, false], [2, 1, true]]);
  assert.equal(release.libraryStatus, "partial");
  assert.equal((await service.release("apple:10", "Unrelated", "local")).ownedTracks, 0, "Explicit library ID cannot bypass artist identity");
  assert.deepEqual(await service.resolve("Fixture", "First"), { artistId: "apple:7", groupId: "apple:10" });
  const restarted = new AppleCatalogueService(config, library, db, async () => { throw new Error("Should remain cached"); });
  await restarted.release("apple:10", "Fixture");
  await restarted.browse("apple:7", "Fixture");
  assert.equal(calls, 3, "Sorting, repeated requests, resolve, and service restarts use persistent cache");
  await assert.rejects(service.release("10", "Fixture"), /identifier/);
  await assert.rejects(service.browse("apple:0", "Fixture"), /identifier/);
} finally { db.close(); }

async function fixture(data: unknown, test: (service: AppleCatalogueService) => Promise<void>) {
  const fixtureDb = new Database(":memory:");
  try { await test(new AppleCatalogueService(config, library, fixtureDb, async () => data)); }
  finally { fixtureDb.close(); }
}
for (const rows of [[first, song(1)], [first, song(2)], [first], [{ ...first, trackCount: undefined }, song(1)]]) {
  await fixture(result(rows), async (service) => {
    const release = await service.release("apple:10", "Fixture");
    assert.equal(release.trackListingComplete, false);
    assert.equal(release.expectedTrackCount, ("trackCount" in rows[0] ? rows[0].trackCount : null) ?? null);
    assert.equal(release.tracks.length, rows.length - 1);
    assert.equal(release.libraryStatus, "unverified", "Owning every returned track must not mark a partial album complete");
    assert.deepEqual((await service.release("apple:10", "Fixture")).tracks, release.tracks, "Partial listings remain browsable from cache");
  });
}
await fixture(result([first, song(1), song(1)]), async (service) => {
  await assert.rejects(service.release("apple:10", "Fixture"), /duplicate track positions/);
});
await fixture({ resultCount: 4, results: [] }, async (service) => {
  await assert.rejects(service.searchArtists("Fixture"), /invalid catalogue response/);
});
await fixture(result([artist, ...Array.from({ length: 200 }, (_, index) => album(index + 100, `Album ${index}`, "2020-01-01T00:00:00Z"))]), async (service) => {
  const page = await service.browse("apple:7", "Fixture");
  assert.equal(page.truncated, true);
  assert.equal(page.albums.length, 24);
  assert.equal(page.nextOffset, 24);
});
await fixture(result([artist, { ...first, artworkUrl100: "https://mzstatic.com.evil.invalid/image.jpg", collectionViewUrl: "javascript:alert(1)" }]), async (service) => {
  const page = await service.browse("apple:7", "Fixture");
  assert.equal(page.albums[0].artworkUrl, null);
  assert.equal(page.albums[0].sourceUrl, null);
});
await fixture(result([]), async (service) => {
  for (let index = 0; index < 20; index++) await service.searchArtists(`query ${index}`);
  await assert.rejects(service.searchArtists("over budget"), /budget is busy/);
  assert.deepEqual(await service.searchArtists("query 0"), [], "Budget does not block cached empty responses");
});
for (const [suffix, type] of [[" - Single", "Single"], [" - eP", "EP"]]) {
  const formatDb = new Database(":memory:");
  try {
    const labeled = { ...first, collectionName: `First${suffix}` };
    const service = new AppleCatalogueService(config, library, formatDb, async (url) => url.pathname === "/search"
      ? result([artist]) : url.searchParams.get("entity") === "song"
        ? result([labeled, song(1), song(2)]) : result([artist, labeled]));
    const page = await service.browse("apple:7", "Fixture");
    assert.equal(page.albums[0].title, "First");
    assert.equal(page.albums[0].type, type);
    assert.equal(page.albums[0].libraryAlbumId, "local");
    const release = await service.release("apple:10", "Fixture");
    assert.equal(release.title, "First");
    assert.equal(release.ownedTracks, 1);
    assert.deepEqual(await service.resolve("Fixture", "First"), { artistId: "apple:7", groupId: "apple:10" });
  } finally { formatDb.close(); }
}
await fixture(result([artist, { ...first, collectionName: "First (Live Remix Edition) - EP" }]), async (service) => {
  assert.equal((await service.browse("apple:7", "Fixture")).albums[0].title, "First (Live Remix Edition)");
});
await fixture(result([artist, ...Array.from({ length: 60 }, (_, index) => album(index + 100,
  `Release ${String(index).padStart(2, "0")}${index % 2 ? index % 4 === 1 ? " - EP" : " - Single" : ""}`, "2020-01-01T00:00:00Z"))]), async (service) => {
  for (const section of ["albums", "eps-singles"] as const) {
    const first = await service.browse("apple:7", "Fixture", 0, "title", section);
    const last = await service.browse("apple:7", "Fixture", first.nextOffset!, "title", section);
    assert.equal(first.total, 30);
    assert.equal(first.nextOffset, 24);
    assert.equal(last.total, 30);
    assert.equal(last.nextOffset, null);
    assert.equal(last.albums.length, 6);
    const albums = [...first.albums, ...last.albums];
    assert.equal(new Set(albums.map((row) => row.id)).size, 30);
    assert(albums.every((row) => section === "albums" ? row.type === "Album" : ["EP", "Single"].includes(row.type)));
    assert.deepEqual(albums.map((row) => row.title), [...albums.map((row) => row.title)].sort());
  }
  for (const section of ["live-compilations", "other"] as const) {
    const empty = await service.browse("apple:7", "Fixture", 0, "newest", section);
    assert.equal(empty.total, 0);
    assert.equal(empty.nextOffset, null);
    assert.deepEqual(empty.albums, []);
  }
});
const recoveryDb = new Database(":memory:");
try {
  let malformed = true;
  const service = new AppleCatalogueService(config, library, recoveryDb, async (url) => url.pathname === "/search"
    ? result([{ ...artist, artistName: malformed ? null : "Fixture" }])
    : result([artist, { ...first, collectionName: malformed ? null : "First" }]));
  await assert.rejects(service.searchArtists("Fixture"), /invalid artist/);
  await assert.rejects(service.browse("apple:7", "Fixture"), /invalid album/);
  malformed = false;
  assert.equal((await service.searchArtists("Fixture"))[0].name, "Fixture", "Malformed artist was not cached");
  assert.equal((await service.browse("apple:7", "Fixture")).albums[0].title, "First", "Malformed album was not cached");
} finally { recoveryDb.close(); }
console.log("PASS: Apple search, namespaced identities, sorted pagination, multidisc ownership, persistent deduplication, capped results, partial listing display and malformed rejection, safe artwork and request budget.");
