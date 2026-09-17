import assert from "node:assert/strict";
import { artistSnapshot, cachedExploreApi, clearArtistSnapshots, readArtistResource } from "../renderer/ui/artist-resource.js";
const originalFetch = globalThis.fetch;
let calls = 0;
let release!: () => void;
try {
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let sharedSignal: AbortSignal | null = null;
  globalThis.fetch = async (_url, options) => { sharedSignal = options?.signal ?? null; calls++; await gate; return new Response(JSON.stringify({ value: "shared" }), { status: 200 }); };
  const cancel = new AbortController();
  const cancelled = cachedExploreApi("/fixture/shared", undefined, cancel.signal);
  const kept = cachedExploreApi<{ value: string }>("/fixture/shared");
  const rejected = assert.rejects(cancelled, { name: "AbortError" });
  cancel.abort();
  assert.equal((sharedSignal as AbortSignal | null)?.aborted, false, "One cancelled reader must not abort another reader transport");
  release();
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
  const transports: AbortSignal[] = [];
  const completions: Array<() => void> = [];
  globalThis.fetch = async (_url, options) => {
    calls++;
    const signal = options!.signal!;
    transports.push(signal);
    await new Promise<void>((resolve, reject) => {
      completions.push(resolve);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const reads = controllers.map((controller, index) => cachedExploreApi(`/fixture/bounded/${index}`, undefined, controller.signal));
  const outcomes = Promise.allSettled(reads);
  assert.equal(calls, 2, "At most two artist reads run at once");
  controllers[2].abort();
  controllers[0].abort();
  assert.equal(transports[0].aborted, true, "Last reader leaving cancels its transport");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 3, "A freed slot starts the next live request, skipping cancelled queued reads");
  completions.forEach((complete) => complete());
  const results = await outcomes;
  assert.deepEqual(results.map((result) => result.status), ["rejected", "fulfilled", "rejected", "fulfilled"]);
  assert.equal(artistSnapshot("/fixture/bounded/0"), null, "Cancelled data is never cached");
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
  await cachedExploreApi("/fixture/bounded/0");
  assert.equal(calls, 4, "A cancelled request can be retried immediately");
  clearArtistSnapshots(); calls = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ pending: ++calls === 1, stage: calls }), { status: 200 });
  const received: number[] = [];
  await readArtistResource<{ pending?: boolean; stage: number }>("/fixture/progressive", (data) => received.push(data.stage), new AbortController().signal);
  assert.deepEqual(received, [1, 2], "Publish early content then final enrichment");
  assert.equal(calls, 2);
  console.log("PASS artist resources: request deduplication, independent cancellation, warm revisit cache, import invalidation, bounded reads, transport and queue cancellation, progressive updates");
} finally { globalThis.fetch = originalFetch; clearArtistSnapshots(); }
