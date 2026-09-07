import assert from "node:assert/strict";
import { MusicMapService, musicMapUrl, parseMusicMap } from "../services/music-map-service.js";

const fixture = `<html><span id='the_title'>Hall &amp; Oates</span>
<div class=map_info><div>Related music</div></div>
<div id=gnodMap>
<a href="https://www.gnoosic.com/discussion/hall.html" class=S id=s0>Hall &amp; Oates</a>
<a href="steely+dan" class=S id=s1>Steely Dan</a>
<a id="s2" class="S" href='bj%C3%B6rk'>Bj&#246;rk</a>
<a href=earth%2C+wind+%26+fire id=s3>Earth, Wind &amp; Fire</a>
<a href="steely+dan" id=s4>Steely Dan</a>
<a href="https://evil.example/artist" id=s5>Wrong host</a>
<a href="javascript:alert(1)" id=s6>Script link</a>
<a href="/artist#foo" id=s7>Anchor link</a>
<a href="guns+n%27+roses" id=s8>Guns N&#x27; Roses</a>
<a href="hall+%26+oates" id=s9>Hall &amp; Oates</a>
</div><script>throw new Error('must never execute');</script></html>`;
const parsed = parseMusicMap(fixture, "Hall & Oates");
assert.deepEqual(parsed.artists, [
  { name: "Steely Dan", url: "https://www.music-map.com/steely+dan", rank: 1 },
  { name: "Björk", url: "https://www.music-map.com/bj%C3%B6rk", rank: 2 },
  { name: "Earth, Wind & Fire", url: "https://www.music-map.com/earth%2C+wind+%26+fire", rank: 3 },
  { name: "Guns N' Roses", url: "https://www.music-map.com/guns+n%27+roses", rank: 4 },
]);
assert.equal(musicMapUrl(" Hall & Oates "), "https://www.music-map.com/hall+%26+oates");
assert.throws(() => parseMusicMap(fixture, "Other Artist"), /different artist/);
assert.throws(() => parseMusicMap(fixture.replace("Hall &amp; Oates</span>", "Other Artist</span>"), "Hall & Oates"), /different artist title/);
assert.throws(() => parseMusicMap("<html>Search results</html>", "Hall & Oates"), /did not return/);
assert.equal(parseMusicMap(fixture, " HALL  & OATES ").artists.length, 4);

let now = 0;
let requests = 0;
const service = new MusicMapService({ now: () => now, fetch: async (input, init) => {
  requests++;
  assert.equal(String(input), "https://www.music-map.com/hall+%26+oates");
  assert.equal(init?.redirect, "error");
  assert.ok(init?.signal);
  return new Response(fixture);
} });
const [first, concurrent] = await Promise.all([service.get("Hall & Oates"), service.get("Hall & Oates")]);
assert.deepEqual(first, concurrent);
assert.equal(requests, 1, "Concurrent requests share provider work");
first.artists.pop();
assert.equal((await service.get("Hall & Oates")).artists.length, 4, "Callers cannot mutate cached results");
now = 86_399_999;
await service.get("Hall & Oates");
assert.equal(requests, 1);
now++;
await service.get("Hall & Oates");
assert.equal(requests, 2, "Cache expires after one day");

let failures = 0;
const failure = new MusicMapService({ fetch: async () => {
  failures++;
  return failures === 1 ? new Response("Forbidden", { status: 403 }) : new Response(fixture);
} });
await assert.rejects(failure.get("Hall & Oates"), /HTTP 403/);
await failure.get("Hall & Oates");
assert.equal(failures, 2, "Provider errors never become successful cache entries");
await assert.rejects(new MusicMapService({ fetch: async () => new Response("x".repeat(256_001)) }).get("Hall & Oates"), /too large/);
let signal: AbortSignal | null | undefined;
const stalled = new MusicMapService({ timeoutMs: 15, fetch: async (_, init) => {
  signal = init?.signal;
  return new Promise<Response>(() => undefined);
} });
const started = Date.now();
await assert.rejects(stalled.get("Hall & Oates"), /timed out/);
assert.ok(Date.now() - started < 1_000, "A stalled provider cannot hold navigation indefinitely");
assert.equal(signal?.aborted, true);
await assert.rejects(service.get("  "), /Invalid/);
console.log("Music-Map smoke passed: parsing, identity, safe URLs, caching, deduplication, bounds and timeout");
