import assert from "node:assert/strict";
import type { CatalogueArtist } from "@music-os/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BackendApp } from "../app.js";
import { handleExplore } from "../explore-routes.js";
import { ArtistProfileService } from "../services/artist-profile-service.js";
import type { CatalogueService } from "../services/catalogue-service.js";
import type { AppleCatalogueService } from "../services/apple-catalogue-service.js";
const mbId = "11111111-1111-4111-8111-111111111111";
const appleArtist: CatalogueArtist = { id: "apple:123", name: "Fixture Artist", description: "", country: null,
  type: null, begin: null, end: null, tags: ["Rock"], provider: "apple", sourceUrl: "https://music.apple.com/us/artist/fixture/123" };
const artistData = { id: mbId, name: "Fixture Artist", type: "Group", country: "GB", area: { name: "United Kingdom" },
  "begin-area": { name: "Leeds" }, "life-span": { begin: "1998", ended: false }, tags: [{ name: "alternative rock", count: 9 }],
  relations: [
    { type: "streaming", url: { resource: "https://music.apple.com/us/artist/fixture/123" } },
    { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q123" } },
    { type: "official homepage", url: { resource: "javascript:alert(1)" } },
    { type: "official homepage", url: { resource: "https://fixture.example/" } },
  ] };
let detailCalls = 0;
let wikiCalls = 0;
const catalogue = { searchArtists: async () => [{ ...appleArtist, id: mbId }], request: async () => {
  detailCalls++; return structuredClone(artistData);
} } as unknown as CatalogueService;
const apple = { artist: async () => appleArtist } as unknown as AppleCatalogueService;
const download = async (url: URL) => {
  wikiCalls++;
  if (url.hostname === "www.wikidata.org") return { entities: { Q123: { sitelinks: { enwiki: { title: "Fixture Artist (band)" } } } } };
  assert.equal(url.hostname, "en.wikipedia.org");
  assert.equal(url.searchParams.get("titles"), "Fixture_Artist_(band)");
  return { query: { pages: [{ extract: "Fixture biography, sourced from the linked article.", fullurl: "https://en.wikipedia.org/wiki/Fixture_Artist_(band)",
    thumbnail: { source: "https://upload.wikimedia.org/fixture.jpg" }, pageimage: "Fixture artist.jpg" }] } };
};
const service = new ArtistProfileService(catalogue, apple, "Fixture/1", download);
const [profile, duplicate] = await Promise.all([service.getComplete("apple:123", "Local Alias"), service.getComplete("apple:123", "Local Alias")]);
assert.deepEqual(profile, duplicate, "Concurrent requests share enrichment");
assert.equal(profile.artist.id, "apple:123", "Metadata enrichment preserves selected catalogue identity");
assert.equal(profile.artist.provider, "apple");
assert.equal(profile.artist.begin, "1998");
assert.equal(profile.ended, false);
assert.equal(profile.beginArea, "Leeds");
assert.deepEqual(profile.artist.tags, ["Rock", "alternative rock"]);
assert.match(profile.biography!, /Fixture biography/);
assert.equal(profile.imageUrl, "https://upload.wikimedia.org/fixture.jpg");
assert.match(profile.imageSourceUrl!, /#\/media\/File:Fixture%20artist.jpg/);
assert.ok(profile.links.some((link) => link.label === "MusicBrainz"));
assert.ok(!profile.links.some((link) => link.url.startsWith("javascript:")));
await service.getComplete("apple:123", "Different local alias");
assert.equal(detailCalls, 1);
assert.equal(wikiCalls, 2);

// A name match is never enough to attach someone else's biography or dates.
const mismatchCatalogue = { ...catalogue, request: async () => ({ ...artistData, relations: [{ type: "streaming", url: {
  resource: "https://music.apple.com.evil.invalid/us/artist/fixture/123",
} }] }) } as unknown as CatalogueService;
const unmatched = await new ArtistProfileService(mismatchCatalogue, apple, "Fixture/1", async () => { throw new Error("Must not enrich mismatched identities"); }).getComplete("apple:123", "Fixture Artist");
assert.equal(unmatched.biography, null);
assert.equal(unmatched.artist.begin, null);
assert.match(unmatched.metadataNote!, /limited artist details/);

const unavailableCatalogue = { searchArtists: async () => { throw new Error("offline"); } } as unknown as CatalogueService;
const fallback = await new ArtistProfileService(unavailableCatalogue, apple).getComplete("apple:123", "Fixture Artist");
assert.equal(fallback.artist.name, "Fixture Artist");
assert.match(fallback.metadataNote!, /temporarily unavailable/);
const wikiOffline = await new ArtistProfileService(catalogue, apple, "Fixture/1", async () => { throw new Error("offline"); }).getComplete(mbId, "Fixture Artist");
assert.equal(wikiOffline.artist.id, mbId);
assert.equal(wikiOffline.artist.begin, "1998");
assert.equal(wikiOffline.biography, null);
assert.match(wikiOffline.metadataNote!, /temporarily unavailable/);

const routed: string[][] = [];
const app = { artistProfiles: { get: async (...args: string[]) => { routed.push(args); return profile; } } } as unknown as BackendApp;
async function route(path: string) {
  let result: unknown;
  await handleExplore({ method: "GET" } as IncomingMessage, {} as ServerResponse, new URL(path, "http://fixture.invalid"), app,
    async () => { throw new Error("GET must not read body"); }, (_response, status, body) => { assert.equal(status, 200); result = body; });
  return result;
}
assert.equal(await route("/explore/artist-profile?artistId=apple:123&artist=Local%20Alias"), profile);
assert.deepEqual(routed, [["apple:123", "Local Alias"]]);
await assert.rejects(route("/explore/artist-profile?artistId=invalid&artist=Artist"), { name: "ZodError" });
await assert.rejects(route(`/explore/artist-profile?artistId=${mbId}&artist=`), { name: "ZodError" });
assert.equal(routed.length, 1);
console.log("PASS: sourced profile, verified provider identity, unsafe link rejection, request deduplication/cache, metadata outage fallback, route validation");
