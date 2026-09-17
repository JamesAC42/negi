import assert from "node:assert/strict";
import { ArtworkMemoryCache, ArtworkWorkQueue } from "../services/artwork-service.js";

const cache = new ArtworkMemoryCache<{ artwork: { data: Buffer; mimeType: string } | null }>(3, 10);
const entry = (size: number) => ({ artwork: { data: Buffer.alloc(size), mimeType: "image/jpeg" } });
cache.set("a", entry(4));
cache.set("b", entry(4));
assert.ok(cache.get("a"));
cache.set("c", entry(4));
assert.equal(cache.get("b"), undefined, "least recently used image must be evicted");
assert.equal(cache.retainedBytes, 8);
cache.set("a", entry(2));
assert.equal(cache.retainedBytes, 6, "replacement must release previous bytes");
cache.set("large", entry(11));
assert.equal(cache.get("large"), undefined, "oversize images must not be retained");
cache.delete("c");
assert.equal(cache.retainedBytes, 2);
for (let i = 0; i < 100; i += 1) cache.set(String(i), { artwork: null });
assert.equal(cache.size, 3, "misses must also have bounded entry count");
assert.equal(cache.retainedBytes, 0);

const budget = 64 * 1024 * 1024;
const bigCache = new ArtworkMemoryCache<ReturnType<typeof entry>>(6000, budget);
const image = entry(1024 * 1024);
for (let i = 0; i < 6000; i += 1) bigCache.set(String(i), image);
assert.equal(bigCache.size, 64);
assert.equal(bigCache.retainedBytes, budget);

const queue = new ArtworkWorkQueue(4);
let active = 0;
let peak = 0;
const started: number[] = [];
const jobs = Array.from({ length: 80 }, (_, index) => queue.run(async () => {
  active += 1;
  peak = Math.max(peak, active);
  started.push(index);
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    if (index % 7 === 0) throw new Error("fixture failure");
    return index;
  } finally {
    active -= 1;
  }
}));
const results = await Promise.allSettled(jobs);
assert.equal(peak, 4, "large request bursts must respect the concurrency budget");
assert.equal(active, 0);
assert.equal(results.filter((result) => result.status === "rejected").length, 12);
assert.deepEqual(started, Array.from({ length: 80 }, (_, index) => index));
assert.equal(await queue.run(async () => 42), 42, "failures must not leak queue capacity");

console.log(JSON.stringify({
  ok: true,
  requests: jobs.length,
  peakConcurrency: peak,
  retainedImageMiB: bigCache.retainedBytes / 1024 / 1024,
  originalImageCount: 6000,
  retainedImageCount: bigCache.size
}, null, 2));
