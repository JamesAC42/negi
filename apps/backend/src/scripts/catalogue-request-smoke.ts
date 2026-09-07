import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { CatalogueRequestScheduler } from "../services/catalogue-request-scheduler.js";
import { CatalogueService } from "../services/catalogue-service.js";
import type { BackendConfig } from "../config.js";
import type { LibraryRepository } from "../services/library-repository.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const scheduler = new CatalogueRequestScheduler(30);
const slow = deferred<string>();
const starts: number[] = [];
const first = scheduler.run(() => { starts.push(Date.now()); return slow.promise; });
const second = scheduler.run(async () => { starts.push(Date.now()); return "fast"; });
assert.equal(await second, "fast", "A stalled response must not block another request start");
assert(starts[1] - starts[0] >= 28, "Request starts remain rate limited");
slow.resolve("slow");
assert.equal(await first, "slow");
await assert.rejects(scheduler.run(async () => { throw new Error("upstream failed"); }));
assert.equal(await scheduler.run(async () => "recovered"), "recovered");

const config = { musicBrainzEnabled: true } as BackendConfig;
const library = { listAlbumGroups: () => [], listIncompleteAlbums: () => [] } as unknown as LibraryRepository;
let calls = 0;
const download = deferred<unknown>();
const service = new CatalogueService(config, library, undefined, async () => {
  calls++;
  return download.promise;
});
const a = service.request("artist", { query: "Test" });
const b = service.request("artist", { query: "Test" });
assert.equal(calls, 1, "Concurrent identical requests share one upstream request");
download.resolve({ artists: [] });
assert.deepEqual(await a, await b);
await service.request("artist", { query: "Test" });
assert.equal(calls, 1, "Warm requests bypass the scheduler");

let attempts = 0;
const retry = new CatalogueService(config, library, undefined, async () => {
  if (++attempts === 1) throw new Error("temporary failure");
  return { artists: [] };
});
await assert.rejects(retry.request("artist"));
assert.deepEqual(await retry.request("artist"), { artists: [] }, "Failed pending entries can be retried");

const artist = deferred<unknown>();
const groups = deferred<unknown>();
const paths: string[] = [];
service.request = async <T>(path: string): Promise<T> => {
  paths.push(path);
  return (path.startsWith("artist/") ? artist.promise : groups.promise) as Promise<T>;
};
const browse = service.browse("artist-id", "Test");
assert.deepEqual(paths, ["artist/artist-id", "release-group"], "Release indexing need not wait for artist details");
artist.resolve({ id: "artist-id", name: "Test" });
groups.resolve({ "release-groups": [], "release-group-count": 0 });
assert.equal((await browse).total, 0);
const db = new Database(":memory:");
try {
  const original = new CatalogueService(config, library, db, async () => ({ artists: [] }));
  await original.request("artist", { query: "Persisted" });
  const restarted = new CatalogueService(config, library, db, async () => {
    throw new Error("A restarted service should not refetch a warm response");
  });
  assert.deepEqual(await restarted.request("artist", { query: "Persisted" }), { artists: [] });
} finally {
  db.close();
}
console.log("PASS: request start spacing, slow-request isolation, failure recovery, deduplication, warm cache and independent catalogue loads");
