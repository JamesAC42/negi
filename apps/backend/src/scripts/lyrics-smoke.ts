import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMusicDatabase } from "@music-os/db";
import { lyricsResponseSchema, type LibraryFilesResponse } from "@music-os/core";
import { LyricsService, parseLrc } from "../services/lyrics-service.js";

const dir = mkdtempSync(join(tmpdir(), "music-os-lyrics-"));
const databasePath = join(dir, "fixture.sqlite");
let db = openMusicDatabase({ path: databasePath });
const services: LyricsService[] = [];
const files = new Map<string, Pick<LibraryFilesResponse["files"][number], "displayTags" | "durationMs">>();
const library = { getFile(id: string) { const file = files.get(id); if (!file) throw new Error("File not found"); return file; } };
const file = (id: string, tags: Record<string, string> = {}, durationMs: number | null = 180_000) => {
  files.set(id, { durationMs, displayTags: { title: "Fixture Song", artist: "Fixture Artist", album: "Fixture Album", ...tags } });
  return id;
};
const record = (overrides: Record<string, unknown> = {}) => ({ trackName: "Fixture Song", artistName: "Fixture Artist", albumName: "Fixture Album", duration: 180, instrumental: false, plainLyrics: "First fixture line\nSecond fixture line", syncedLyrics: "[00:01.20]First fixture line\n[00:04.567]Second fixture line", ...overrides });
const response = (value: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const missing = () => response({ name: "TrackNotFound", message: "No lyrics", statusCode: 404 }, 404);
const makeService = (fetcher: typeof fetch, options: { timeoutMs?: number; now?: () => number; errorCooldownMs?: number } = {}) => {
  const service = new LyricsService(db, library, { fetch: fetcher, ...options }); services.push(service); return service;
};
try {
  assert.deepEqual(parseLrc("[ar:fixture]\n[offset:+100]\n[00:02.3][00:01.25]Repeated\n[00:02.300]Repeated\n[00:02.300]Translation\n[00:03]\n[99:70.00]Invalid\n[00:04.001]<00:04.002>Word"), [
    { timeMs: 1150, text: "Repeated" }, { timeMs: 2200, text: "Repeated\nTranslation" }, { timeMs: 2900, text: "" }, { timeMs: 3901, text: "Word" }
  ]);
  assert.deepEqual(parseLrc("[offset:-150]\n[00:00.01]Early"), [{ timeMs: 160, text: "Early" }]);
  assert.deepEqual(parseLrc("plain text without timestamps"), []);

  let requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = makeService(async (input) => { requests++; assert.match(String(input), /\/api\/get\?/); await gate; return response(record()); });
  const a = file("first"); const duplicate = file("duplicate");
  const concurrent = [first.getLyrics(a), first.getLyrics(a), first.getLyrics(duplicate)];
  assert.equal(requests, 1, "same metadata is deduplicated across concurrent requests and duplicate files");
  release!();
  const found = await Promise.all(concurrent);
  assert.equal(found[0].status, "synced");
  assert.equal(found[2].fileId, duplicate);
  assert.equal(found[0].lines[1].timeMs, 4567);
  assert.equal(lyricsResponseSchema.parse(found[0]).cached, false);
  assert.equal((await first.getLyrics(a)).cached, true);
  assert.equal(requests, 1);
  first.close(); db.close(); db = openMusicDatabase({ path: databasePath });
  const reopened = makeService(async () => { throw new Error("Persistent cache must avoid provider"); });
  assert.equal((await reopened.getLyrics(a)).cached, true, "lyrics survive database and service recreation");

  let missRequests = 0;
  const miss = makeService(async (url) => { missRequests++; return String(url).includes("/search?") ? response([]) : missing(); });
  const absent = file("absent", { title: "Missing Song" });
  assert.equal((await miss.getLyrics(absent)).status, "not_found");
  assert.equal(missRequests, 2);
  assert.equal((await miss.getLyrics(absent)).cached, true);
  assert.equal(missRequests, 2, "authoritative missing result is permanent");
  assert.equal((await reopened.getLyrics(absent)).status, "not_found");

  let fallbackRequests = 0;
  const fallback = makeService(async (url) => { fallbackRequests++; return String(url).includes("/search?") ? response([
    record({ trackName: "Search Song", artistName: "Wrong Artist" }),
    record({ trackName: "Search Song (Live)" }),
    record({ trackName: "Search Song", albumName: "Other edition" }),
    record({ trackName: "Search Song", duration: 200 }),
    record({ trackName: "Search Song", duration: 181 })
  ]) : missing(); });
  assert.equal((await fallback.getLyrics(file("search", { title: "Search Song" }))).status, "synced");
  assert.equal(fallbackRequests, 2);
  const wrong = makeService(async (url) => String(url).includes("/search?") ? response([record({ artistName: "Wrong Artist" })]) : response(record({ artistName: "Wrong Artist" })));
  assert.equal((await wrong.getLyrics(file("wrong", { title: "Wrong song" }))).status, "not_found");

  let plainCalls = 0;
  const plain = makeService(async () => { plainCalls++; return response(record({ trackName: "Plain Song", syncedLyrics: null })); });
  assert.equal((await plain.getLyrics(file("plain", { title: "Plain Song" }))).status, "plain");
  assert.equal((await reopened.getLyrics("plain")).cached, true);
  assert.equal(plainCalls, 1);
  const instrumental = makeService(async () => response(record({ trackName: "Instrumental", instrumental: true, plainLyrics: null, syncedLyrics: null })));
  assert.equal((await instrumental.getLyrics(file("instrumental", { title: "Instrumental" }))).status, "instrumental");
  assert.equal((await reopened.getLyrics("instrumental")).cached, true);

  let now = 1_800_000_000_000; let errorCalls = 0;
  const retry = makeService(async () => { errorCalls++; return errorCalls === 1 ? response({ name: "ServerOverloaded" }, 503, { "retry-after": "20" }) : response(record({ trackName: "Retry Song" })); }, { now: () => now });
  const retryFile = file("retry", { title: "Retry Song" });
  const error = await retry.getLyrics(retryFile);
  assert.equal(error.status, "error"); assert.equal(error.retryAfterMs, 20_000);
  assert.equal((await retry.getLyrics(retryFile)).status, "error"); assert.equal(errorCalls, 1);
  now += 20_001;
  assert.equal((await retry.getLyrics(retryFile)).status, "synced"); assert.equal(errorCalls, 2);

  const timeout = makeService(async () => new Promise<Response>(() => {}), { timeoutMs: 20 });
  const start = performance.now(); const timeoutFile = file("timeout", { title: "Timeout Song" });
  assert.equal((await timeout.getLyrics(timeoutFile)).status, "error");
  assert.ok(performance.now() - start < 500, "even an uncooperative fetch is time bounded");
  const recover = makeService(async () => response(record({ trackName: "Timeout Song" })));
  assert.equal((await recover.getLyrics(timeoutFile)).status, "synced", "timeouts must never persist as absence");

  const searchError = makeService(async (url) => String(url).includes("/search?") ? response({}, 429) : missing());
  assert.equal((await searchError.getLyrics(file("search-error", { title: "Search error" }))).status, "error");
  const proxyError = makeService(async () => new Response("", { status: 404 }));
  assert.equal((await proxyError.getLyrics(file("proxy-error", { title: "Proxy error" }))).status, "error");
  const malformed = makeService(async () => response({ plainLyrics: "wrong shape" }));
  assert.equal((await malformed.getLyrics(file("malformed", { title: "Malformed" }))).status, "error");

  let unicodeCalls = 0;
  const unicode = makeService(async (input) => { unicodeCalls++; const url = new URL(String(input)); const title = url.searchParams.get("track_name"); assert.equal(title, "夜の_歌"); return response(record({ trackName: title })); });
  assert.equal((await unicode.getLyrics(file("unicode", { title: "夜の_歌" }))).status, "synced");
  assert.equal(unicodeCalls, 1);
  file(a, { title: "Changed tags" });
  assert.equal((await miss.getLyrics(a)).cached, false, "metadata edits invalidate old results");
  const noTags = file("no-tags", { title: "", artist: "" });
  assert.equal((await reopened.getLyrics(noTags)).status, "not_found", "missing tags do not cause a provider request");
  await assert.rejects(() => reopened.getLyrics("unknown"), /File not found/);
  console.log("lyrics smoke ok: durable cache, deduplication, matching, Unicode, LRC, fallbacks, missing, retry, timeout");
} finally {
  services.forEach((service) => service.close());
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
