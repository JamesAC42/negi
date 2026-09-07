import assert from "node:assert/strict";
import { artistSnapshot, cachedExploreApi, clearArtistSnapshots, readArtistResource } from "../renderer/ui/artist-resource.js";
const originalFetch = globalThis.fetch;
let calls = 0;
let release!: () => void;
try {
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = async () => { calls++; await gate; return new Response(JSON.stringify({ value: "shared" }), { status: 200 }); };
  const cancel = new AbortController();
  const cancelled = cachedExploreApi("/fixture/shared", undefined, cancel.signal);
  const kept = cachedExploreApi<{ value: string }>("/fixture/shared");
  const rejected = assert.rejects(cancelled, { name: "AbortError" });
  cancel.abort(); release();
  await rejected; assert.equal((await kept).value, "shared");
  await cachedExploreApi("/fixture/shared"); assert.equal(calls, 1, "Concurrent readers and warm revisits reuse one fetch");

  clearArtistSnapshots(); calls = 0;
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  globalThis.fetch = async () => { const index = ++calls; if (index === 1) await oldGate; return new Response(JSON.stringify({ index }), { status: 200 }); };
  const old = cachedExploreApi("/fixture/invalidation"); clearArtistSnapshots();
  await cachedExploreApi("/fixture/invalidation"); releaseOld(); await old;
  assert.equal(artistSnapshot<{ index: number }>("/fixture/invalidation")?.index, 2, "Old inflight responses cannot overwrite post-import data");

  clearArtistSnapshots(); calls = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ pending: ++calls === 1, stage: calls }), { status: 200 });
  const received: number[] = [];
  await readArtistResource<{ pending?: boolean; stage: number }>("/fixture/progressive", (data) => received.push(data.stage), new AbortController().signal);
  assert.deepEqual(received, [1, 2], "Publish early content then final enrichment");
  assert.equal(calls, 2);
  console.log("PASS artist resources: request deduplication, independent cancellation, warm revisit cache, import invalidation, progressive updates");
} finally { globalThis.fetch = originalFetch; clearArtistSnapshots(); }
