import assert from "node:assert/strict";
import type { CatalogueService } from "../services/catalogue-service.js";
import type { AppleCatalogueService } from "../services/apple-catalogue-service.js";
import type { LibraryRepository } from "../services/library-repository.js";
import { ArtistBackgroundCache } from "../services/artist-background-cache.js";
import { ArtistProfileService } from "../services/artist-profile-service.js";
import { SimilarArtistsService } from "../services/similar-artists-service.js";
const seed = "11111111-1111-4111-8111-111111111111";
const peer = "22222222-2222-4222-8222-222222222222";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise((done) => setTimeout(done, 5));
const wiki = deferred<unknown>();
const details = { id: seed, name: "Seed", tags: [{ name: "rock", count: 1 }], relations: [
  { type: "streaming", url: { resource: "https://music.apple.com/artist/123" } },
  { type: "wikipedia", url: { resource: "https://en.wikipedia.org/wiki/Seed" } },
] };
let profileCalls = 0;
const catalogue = { searchArtists: async () => [{ id: seed, name: "Seed" }], request: async () => { profileCalls++; return details; } } as unknown as CatalogueService;
const apple = { artist: async () => ({ id: "apple:123", name: "Seed", tags: [], provider: "apple", sourceUrl: "https://music.apple.com/artist/123" }) } as unknown as AppleCatalogueService;
const profiles = new ArtistProfileService(catalogue, apple, "Fixture", () => wiki.promise);
const start = performance.now();
const initial = await profiles.get("apple:123", "Seed");
const coldMs = performance.now() - start;
assert.ok(coldMs < 100, `Cold snapshot took ${coldMs}ms`);
assert.equal(initial.pending, true);
assert.equal(initial.artist.name, "Seed");
assert.equal(initial.biography, null);
await tick();
assert.equal(await profiles.musicBrainzArtistId("apple:123", "Seed"), seed, "Wikipedia cannot gate identity lookup");
assert.equal((await profiles.get("apple:123", "Seed")).pending, true);
assert.equal(initial.links.some((link) => link.label === "MusicBrainz"), false, "Published snapshots must not mutate");
await profiles.get("apple:123", "Seed");
assert.equal(profileCalls, 1, "Polls reuse the same background job");
wiki.resolve({ query: { pages: [{ extract: "A biography" }] } });
assert.equal((await profiles.getComplete("apple:123", "Seed")).biography, "A biography");
assert.equal((await profiles.get("apple:123", "Seed")).pending, false);

const mb = deferred<unknown>();
let metadataRequests = 0;
let mapRequests = 0;
let listenerRequests = 0;
const similar = new SimilarArtistsService(profiles, { request: async () => { metadataRequests++; return mb.promise; } } as unknown as CatalogueService,
  { listAlbumGroups: () => [] } as unknown as LibraryRepository, "Fixture",
  async () => { listenerRequests++; return [{ artist_mbid: peer, reference_mbid: seed, name: "Peer", score: 10 }]; },
  { get: async () => { mapRequests++; return { artists: [{ name: "Map artist", url: "https://www.music-map.com/map+artist", rank: 0 }], sourceUrl: "https://www.music-map.com/seed" }; } });
const similarityStart = performance.now();
assert.equal((await similar.get(seed, "Seed")).pending, true);
const similarColdMs = performance.now() - similarityStart;
assert.ok(similarColdMs < 100);
await tick();
const partial = await similar.get(seed, "Seed");
assert.equal(partial.pending, true);
assert.ok(partial.artists.some((entry) => entry.sources.includes("musicmap")), "Music-Map renders while MB is stalled");
assert.ok(partial.artists.some((entry) => entry.artist.id === peer), "ListenBrainz renders while MB is stalled");
await Promise.all(Array.from({ length: 20 }, () => similar.get(seed, "Seed")));
assert.equal(metadataRequests, 1);
assert.equal(mapRequests, 1);
assert.equal(listenerRequests, 1);
mb.resolve({ id: seed, name: "Seed" });
assert.equal((await similar.getComplete(seed, "Seed")).pending, false);
assert.equal(metadataRequests, 1, "No extra per-recommendation MusicBrainz lookups");

// Provider promises that never settle cannot leave the UI polling forever.
const cache = new ArtistBackgroundCache<{ pending?: boolean; rows: string[]; note?: string }>(15);
let publishLate!: (value: { rows: string[] }) => void;
cache.get("timeout", () => ({ rows: [] }), async (publish) => {
  publishLate = publish;
  publish({ rows: ["fast source"] });
  return new Promise(() => {});
}, (value) => ({ ...value, note: "Timed out" }));
const timeout = await cache.complete("timeout");
assert.equal(timeout.pending, false);
assert.deepEqual(timeout.rows, ["fast source"]);
publishLate({ rows: ["late source"] });
assert.deepEqual((await cache.complete("timeout")).rows, ["fast source"], "Late results cannot overwrite a settled snapshot");
const crowded = new ArtistBackgroundCache<{ pending?: boolean; rows: string[] }>(15);
let crowdLoads = 0;
for (let index = 0; index < 30; index++) {
  crowded.get(String(index), () => ({ rows: [] }), async () => { crowdLoads++; return new Promise(() => {}); }, (value) => value);
}
assert.equal((await crowded.complete("29")).pending, false);
await Promise.all(Array.from({ length: 8 }, (_, index) => crowded.complete(String(index))));
assert.equal(crowdLoads, 8, "Rapid navigation cannot build unlimited upstream work");
console.log(`PASS: cold profile ${coldMs.toFixed(2)}ms, cold recommendations ${similarColdMs.toFixed(2)}ms; independent sources, identity before Wikipedia, immutable snapshots, polling deduplication, timeout preserves partial results`);
