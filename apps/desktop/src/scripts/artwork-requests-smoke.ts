import assert from "node:assert/strict";
import { artworkObjectUrls, getArtworkObjectUrl } from "../renderer/artwork-requests.js";

const requests: Array<{ src: string; signal: AbortSignal; resolve: () => void }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
  const signal = init!.signal!;
  requests.push({ src: String(input), signal, resolve: () => resolve(new Response(new Blob(["cover"]))) });
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
})) as typeof fetch;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
try {
  const first = new AbortController();
  const duplicate = new AbortController();
  const second = new AbortController();
  const queued = new AbortController();
  const a = getArtworkObjectUrl("a", false, first.signal).catch((error) => error.name);
  const a2 = getArtworkObjectUrl("a", false, duplicate.signal);
  const b = getArtworkObjectUrl("b", false, second.signal).catch((error) => error.name);
  const c = getArtworkObjectUrl("c", false, queued.signal).catch((error) => error.name);
  const d = getArtworkObjectUrl("d");
  assert.deepEqual(requests.map((request) => request.src), ["a", "b"], "only two artwork requests may occupy connections");
  first.abort();
  assert.equal(await a, "AbortError");
  assert.equal(requests[0].signal.aborted, false, "one consumer cannot cancel another consumer's image");
  queued.abort();
  assert.equal(await c, "AbortError");
  second.abort();
  assert.equal(await b, "AbortError");
  await tick();
  assert.deepEqual(requests.map((request) => request.src), ["a", "b", "d"], "queued cancellations never start, active cancellations free a slot");
  requests[0].resolve();
  requests[2].resolve();
  const [aUrl] = await Promise.all([a2, d]);
  assert.equal(await getArtworkObjectUrl("a"), aUrl, "completed artwork is reused without another request");
  assert.equal(requests.length, 3);
  console.log("PASS: artwork concurrency, shared consumers, active/queued cancellation, and cache reuse");
} finally {
  globalThis.fetch = originalFetch;
  for (const url of artworkObjectUrls.values()) URL.revokeObjectURL(url);
  artworkObjectUrls.clear();
}
