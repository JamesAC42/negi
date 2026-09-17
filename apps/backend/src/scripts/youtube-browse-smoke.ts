import assert from "node:assert/strict";
import { youtubeBrowseRequestSchema } from "@music-os/core";
import { YoutubeBrowser, youtubeBrowsePlan, youtubeChannelUrl, youtubePlaylistUrl, youtubeVideoResult } from "../services/youtube-browse.js";

const request = youtubeBrowseRequestSchema.parse({q: "  jazz live  "});
assert.equal(request.q, "jazz live");
for (const page of [0, 21, 1.5, "nope"]) assert.throws(() => youtubeBrowseRequestSchema.parse({...request, page}));
assert.throws(() => youtubeBrowseRequestSchema.parse({...request, kind: "home"}));
const channel = "UC" + "a".repeat(22);
assert.equal(youtubeChannelUrl(channel), `https://www.youtube.com/channel/${channel}/videos`);
assert.equal(youtubeChannelUrl("https://www.youtube.com/@NPRMusic/featured?x=1"), "https://www.youtube.com/@NPRMusic/videos");
assert.equal(youtubeChannelUrl("@NPRMusic"), "https://www.youtube.com/@NPRMusic/videos");
assert.equal(youtubePlaylistUrl("https://music.youtube.com/watch?v=abcdefghijk&list=PLabcdefghijk"), "https://www.youtube.com/playlist?list=PLabcdefghijk");
for (const url of ["https://youtube.com.evil.test/@a", "https://user@youtube.com/@a", "https://youtube.com:444/@a", "file:///tmp/foo", "http://127.0.0.1/@a", "https://youtu.be/abcdefghijk", "https://www.youtube.com/redirect?q=https://example.com"]) {
  assert.throws(() => youtubeChannelUrl(url));
  assert.throws(() => youtubePlaylistUrl(url));
}
assert.throws(() => youtubeBrowsePlan({...request, q: "https://example.com"}));
const plan = youtubeBrowsePlan({...request, page: 2, sort: "date"});
assert.equal(plan.args.at(-1), "ytsearch49:jazz live");
assert.equal(plan.args[plan.args.indexOf("--playlist-items") + 1], "25:49");
assert.equal(youtubeBrowsePlan({...request, q: "https://youtu.be/abcdefghijk"}).sourceUrl, "https://www.youtube.com/watch?v=abcdefghijk");
const normalized = youtubeVideoResult({id: "abcdefghijk", channel_id: channel, upload_date: "20260917", timestamp: Infinity, duration: NaN, channel_url: "https://evil.test/", description: "desc"}, true)!;
assert.equal(normalized.channelUrl, `https://www.youtube.com/channel/${channel}/videos`);
assert.equal(normalized.uploadDate, "2026-09-17");
assert.equal(normalized.duration, null);
assert.equal(youtubeVideoResult({id: "playlist"}, true), null);
assert.equal(youtubeVideoResult({id: "abcdefghijk", timestamp: 1e300, channel_url: "https://evil.test/"}, true)?.channelUrl, undefined);

let calls = 0;
let now = 0;
const entries = Array.from({length: 25}, (_, i) => ({id: String(i).padStart(11, "0"), title: `Video ${i}`}));
const browser = new YoutubeBrowser(async () => { calls++; await Promise.resolve(); return JSON.stringify({title: "Channel", entries}); }, () => now);
const [first, duplicate] = await Promise.all([browser.browse(request), browser.browse(request)]);
assert.equal(calls, 1);
assert.equal(first, duplicate);
assert.equal(first.results.length, 24);
assert.equal(first.nextPage, 2);
assert.equal(browser.find(first.results[0].url)?.title, "Video 0");
await browser.browse(request);
assert.equal(calls, 1);
now = 300001;
await browser.browse(request);
assert.equal(calls, 2);
assert.equal((await browser.browse({...request, page: 20})).nextPage, null);
const short = new YoutubeBrowser(async () => JSON.stringify({entries: [null, entries[0], entries[0], {id: "not-video"}]}));
assert.equal((await short.browse(request)).results.length, 1);
assert.equal((await short.browse(request)).nextPage, null);
let attempts = 0;
const retry = new YoutubeBrowser(async () => { if (++attempts === 1) throw new Error("offline"); return JSON.stringify({entries: []}); });
await assert.rejects(retry.browse(request), /offline/);
await retry.browse(request);
assert.equal(attempts, 2);
const releases: ((value: string) => void)[] = [];
const blocked = new YoutubeBrowser(() => new Promise(resolve => { releases.push(resolve); }));
const pending = Array.from({length: 6}, (_, i) => blocked.browse({...request, q: String(i)}));
await assert.rejects(blocked.browse({...request, q: "overflow"}), /busy/);
for (const release of releases) release(JSON.stringify({entries: []}));
await Promise.all(pending);
const dated = new YoutubeBrowser(async () => JSON.stringify({entries: [
  {...entries[0], upload_date: "20200101"}, {...entries[1], upload_date: "20260917"}, entries[2],
]}));
assert.deepEqual((await dated.browse({...request, sort: "date"})).results.map(v => v.id), [entries[1].id, entries[0].id, entries[2].id]);
let evictions = 0;
const bounded = new YoutubeBrowser(async () => { evictions++; return JSON.stringify({entries: []}); });
for (let i = 0; i < 65; i++) await bounded.browse({...request, q: String(i)});
await bounded.browse({...request, q: "0"});
assert.equal(evictions, 66);
console.log("YouTube browse smoke passed: source allowlist, schema, normalization, pagination, deduplication, expiry, retry, concurrency and cache bounds.");
