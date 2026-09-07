import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { AlbumHighlightsService } from "../services/album-highlights-service.js";
import type { ArtistProfileService } from "../services/artist-profile-service.js";
import type { CatalogueService } from "../services/catalogue-service.js";
import type { LibraryRepository } from "../services/library-repository.js";

const artist = "00000000-0000-4000-8000-000000000001";
const group = (index: number, rating: number | null, votes: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, title: `Album ${index}`, "primary-type": "Album",
  "artist-credit": [{ artist: { id: artist } }], rating: { value: rating, "votes-count": votes }, ...extra,
});
let local: { id: string; artist: string; album: string; fileCount: number }[] = [];
const library = { listAlbumGroups: () => local, listIncompleteAlbums: () => [{ key: "local" }] } as unknown as LibraryRepository;
const profiles = { musicBrainzArtistId: async () => artist } as unknown as ArtistProfileService;
let calls = 0;
let finish!: (value: unknown) => void;
const response = new Promise((resolve) => { finish = resolve; });
const catalogue = { request: async (path: string, params: Record<string, string>) => {
  calls++;
  assert.equal(path, "release-group");
  assert.equal(params.inc, "ratings+artist-credits");
  assert.equal(params.limit, "100");
  return response;
} } as unknown as CatalogueService;
const service = new AlbumHighlightsService(profiles, catalogue, library);
const start = performance.now();
const pending = await service.get("apple:7", "Fixture");
assert.equal(pending.pending, true);
assert.ok(performance.now() - start < 100, "Navigation returns immediately while upstream is stalled");
await service.get("apple:7", "Fixture");
finish({ "release-group-count": 150, "release-groups": [
  group(1, 4.5, 30), group(2, 5, 1), group(3, 4.8, 40), group(4, 4.8, 90),
  group(5, 5, 20, { "secondary-types": ["Live"] }), group(6, null, 100),
  group(7, 5, 20, { "artist-credit": [{ artist: { id: "someone-else" } }] }),
  group(8, 20, 30), group(9, 4.9, 3.5), group(1, 4.5, 30),
] });
const complete = await service.getComplete("apple:7", "Fixture");
assert.equal(complete.pending, false);
assert.equal(calls, 1, "Polling deduplicates the upstream job");
assert.deepEqual(complete.albums.map((album) => album.title), ["Album 4", "Album 3", "Album 1"]);
assert.deepEqual(complete.albums.map((album) => [album.rating, album.votes]), [[4.8, 90], [4.8, 40], [4.5, 30]]);
assert.equal(complete.resolvedArtistId, artist);
assert.match(complete.note!, /first 100/);
assert.equal(complete.albums[0].libraryStatus, "missing");
local = [{ id: "local", artist: "Fixture", album: "Album 4", fileCount: 3 }];
const refreshed = await service.get("apple:7", "Fixture");
assert.equal(refreshed.albums[0].libraryStatus, "partial", "Ownership is refreshed even while ratings stay cached");
assert.equal(refreshed.albums[0].ownedTracks, 3);
assert.equal(complete.albums[0].libraryStatus, "missing", "Ownership mapping does not mutate old responses");
assert.equal(calls, 1);
const ambiguous = new AlbumHighlightsService({ musicBrainzArtistId: async () => null } as unknown as ArtistProfileService, catalogue, library);
assert.equal((await ambiguous.getComplete("apple:8", "Other")).albums.length, 0);
assert.equal(calls, 1, "Unverified Apple identities cannot fetch somebody else's ratings");
const failed = new AlbumHighlightsService(profiles, { request: async () => { throw new Error("Offline"); } } as unknown as CatalogueService, library);
assert.equal((await failed.getComplete(artist, "Fixture")).pending, false);
assert.match((await failed.get(artist, "Fixture")).note!, /temporarily unavailable/);
console.log("Album highlights smoke passed: immediate snapshots, ranking provenance, vote threshold, identity, deduplication, fresh ownership, graceful failures.");
