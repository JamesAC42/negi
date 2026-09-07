import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BackendApp } from "../app.js";
import type { ArtistProfileService } from "../services/artist-profile-service.js";
import type { CatalogueService } from "../services/catalogue-service.js";
import type { LibraryRepository } from "../services/library-repository.js";
import { SimilarArtistsService } from "../services/similar-artists-service.js";
import { handleExplore } from "../explore-routes.js";
const seed = "11111111-1111-4111-8111-111111111111";
const listener = "22222222-2222-4222-8222-222222222222";
const related = "33333333-3333-4333-8333-333333333333";
const namesake = "44444444-4444-4444-8444-444444444444";
const tags = [{ name: "dream pop", count: 8 }, { name: "shoegaze", count: 3 }];
const profile = { musicBrainzArtistId: async () => seed, get: async () => ({ links: [{ label: "MusicBrainz", url: `https://musicbrainz.org/artist/${seed}` }] }) } as unknown as ArtistProfileService;
let requests = 0;
const catalogue = { request: async (path: string) => {
  requests++;
  if (path === `artist/${seed}`) return { id: seed, name: "Seed", tags, relations: [{ type: "member of band", artist: { id: related, name: "Related" } }] };
  if (path === "artist") return { artists: [{ id: listener, name: "Listener", tags }, { id: namesake, name: "Listener", tags }, { id: seed, name: "Seed", tags }] };
  return { id: listener, name: "Listener", tags };
} } as unknown as CatalogueService;
let owned: { id: string; artist: string }[] = [];
const library = { listAlbumGroups: () => owned } as unknown as LibraryRepository;
let calls = 0;
const download = async (url: URL) => {
  calls++;
  assert.equal(url.hostname, "labs.api.listenbrainz.org");
  assert.equal(url.searchParams.get("artist_mbids"), seed);
  return [
    { artist_mbid: listener, reference_mbid: seed, name: "Listener", score: 100 },
    { artist_mbid: listener, reference_mbid: seed, name: "Listener", score: 90 },
    { artist_mbid: seed, reference_mbid: seed, name: "Seed", score: 100 },
    { artist_mbid: related, reference_mbid: namesake, name: "Incorrect seed", score: 999 },
    { artist_mbid: "invalid", reference_mbid: seed, name: "Bad ID", score: 300 },
    { artist_mbid: related, reference_mbid: seed, name: "Bad score", score: -100 },
  ];
};
const noMap = { get: async () => ({ artists: [], sourceUrl: "https://www.music-map.com/seed" }) };
const service = new SimilarArtistsService(profile, catalogue, library, "Fixture/1", download, noMap);
const [first, concurrent] = await Promise.all([service.getComplete("apple:123", "Seed"), service.getComplete("apple:123", "Seed")]);
assert.deepEqual(first, concurrent);
assert.equal(first.resolvedArtistId, seed, "Verified Apple identity exposes the canonical trail seed");
assert.equal(calls, 1);
assert.equal(first.artists.length, 3);
assert.ok(first.artists.every((entry) => entry.artist.id !== seed));
const item = first.artists.find((entry) => entry.artist.id === listener)!;
assert.deepEqual(item.sources, ["listenbrainz", "musicbrainz"]);
assert.deepEqual(item.sharedTags, ["dream pop", "shoegaze"]);
assert.equal(item.reasons.length, 2);
assert.ok(first.artists.some((entry) => entry.artist.id === namesake), "Distinct namesake MBIDs are never merged");
assert.equal(first.artists.find((entry) => entry.artist.id === related)?.connection, "related");
assert.ok(first.sources.filter((source) => source.id !== "musicmap").every((source) => source.status === "ok"));
assert.equal(first.note, null);
const previousRequests = requests;
owned = [{ id: "album", artist: "Listener" }];
const refreshed = await service.getComplete("apple:123", "Alias");
assert.equal(refreshed.artists.find((entry) => entry.artist.id === listener)?.libraryAlbumCount, 1);
assert.equal(refreshed.artists.find((entry) => entry.artist.id === listener)?.libraryMatch, "name");
assert.equal(calls, 1);
assert.equal(requests, previousRequests);

const unmatchedProfile = { musicBrainzArtistId: async () => null, get: async () => ({ links: [{ url: `https://musicbrainz.org.evil.invalid/artist/${seed}` }] }) } as unknown as ArtistProfileService;
const never = async () => { throw new Error("Must not run for unverified identity"); };
const unmatched = await new SimilarArtistsService(unmatchedProfile, { request: never } as unknown as CatalogueService, library, "Fixture", never, noMap).getComplete("apple:987", "Seed");
assert.equal(unmatched.artists.length, 0);
assert.equal(unmatched.resolvedArtistId, null);
assert.match(unmatched.note!, /no verified MusicBrainz link/);
const outage = await new SimilarArtistsService(profile, catalogue, library, "Fixture", async () => { throw new Error("offline"); }, noMap).getComplete(seed, "Seed");
assert.equal(outage.resolvedArtistId, seed);
assert.equal(outage.sources.find((source) => source.id === "listenbrainz")?.status, "unavailable");
assert.ok(outage.artists.length > 0, "MB tags and relations survive a listener API outage");
const onlyListeners = await new SimilarArtistsService(profile, { request: never } as unknown as CatalogueService, library, "Fixture", download, noMap).getComplete(seed, "Seed");
assert.equal(onlyListeners.artists.length, 1);
assert.equal(onlyListeners.sources.find((source) => source.id === "musicbrainz")?.status, "unavailable");
const empty = await new SimilarArtistsService(profile, { request: async () => ({ id: seed, name: "Seed" }) } as unknown as CatalogueService, library, "Fixture", async () => [], noMap).getComplete(seed, "Seed");
assert.equal(empty.artists.length, 0);
assert.ok(empty.sources.every((source) => source.status === "empty"));
assert.match(empty.note!, /no listening connections/);
let routed = 0;
const app = { similarArtists: { get: async (id: string, name: string) => { routed++; assert.equal(id, seed); assert.equal(name, "Seed"); return first; } } } as unknown as BackendApp;
async function route(id: string) {
  let body: unknown;
  await handleExplore({ method: "GET" } as IncomingMessage, {} as ServerResponse,
    new URL(`/explore/similar-artists?artistId=${id}&artist=Seed`, "http://fixture.invalid"), app,
    async () => { throw new Error("GET must not read"); }, (_response, status, value) => { assert.equal(status, 200); body = value; });
  return body;
}
assert.equal(await route(seed), first);
await assert.rejects(route("invalid"), { name: "ZodError" });
assert.equal(routed, 1);
console.log("PASS: similar artist multi-source merging, ID-only identity, bad row filtering, shared evidence, cache/deduplication, fresh library state, verified Apple links, partial outages, empty state, route validation");
