import assert from 'node:assert/strict';
import { artworkObjectUrls, getArtworkObjectUrl, invalidateArtworkObjectUrl, retainArtworkObjectUrl } from '../renderer/artwork-requests.js';

const requests: Array<{ src: string; signal: AbortSignal; resolve: () => void }> = [];
const originalFetch = globalThis.fetch;
const originalRevoke = URL.revokeObjectURL;
const originalTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
const revoked = new Set<string>();
const controllers: AbortController[] = [];
const consumer = () => { const controller = new AbortController(); controllers.push(controller); return controller; };
URL.revokeObjectURL = url => { revoked.add(url); originalRevoke(url); };
globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  const timer = originalTimeout(callback, ms, ...args);
  if (ms === 20_000) timers.set(timer, () => callback(...args));
  return timer;
}) as typeof setTimeout;
globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => { timers.delete(timer); originalClearTimeout(timer); }) as typeof clearTimeout;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
  const signal = init!.signal!;
  requests.push({ src: String(input), signal, resolve: () => resolve(new Response(new Blob(['cover']))) });
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
})) as typeof fetch;
const tick = () => new Promise(resolve => originalTimeout(resolve, 0));
try {
  const first = consumer(), duplicate = consumer(), second = consumer(), queued = consumer();
  const a = getArtworkObjectUrl('a', false, first.signal).catch(error => error.name);
  const a2 = getArtworkObjectUrl('a', false, duplicate.signal);
  const b = getArtworkObjectUrl('b', false, second.signal).catch(error => error.name);
  const c = getArtworkObjectUrl('c', false, queued.signal).catch(error => error.name);
  const d = getArtworkObjectUrl('d');
  assert.deepEqual(requests.map(request => request.src), ['a', 'b'], 'only two artwork requests occupy connections');
  first.abort(); assert.equal(await a, 'AbortError');
  assert.equal(requests[0].signal.aborted, false, 'one consumer cannot cancel a shared image');
  queued.abort(); assert.equal(await c, 'AbortError');
  second.abort(); assert.equal(await b, 'AbortError'); await tick();
  assert.deepEqual(requests.map(request => request.src), ['a', 'b', 'd'], 'queued cancellation never starts and active cancellation frees a slot');
  requests[0].resolve(); requests[2].resolve();
  const [aUrl] = await Promise.all([a2, d]);
  assert.equal(await getArtworkObjectUrl('a'), aUrl); assert.equal(requests.length, 3);
  await tick();

  const x = getArtworkObjectUrl('x'), y = getArtworkObjectUrl('y');
  const background = getArtworkObjectUrl('background');
  const promoted = getArtworkObjectUrl('promoted');
  const sharedPromoted = getArtworkObjectUrl('promoted', true);
  requests.find(request => request.src === 'x')!.resolve(); await x; await tick();
  assert.equal(requests.at(-1)!.src, 'promoted', 'urgent duplicate promotes the existing queued request');
  requests.find(request => request.src === 'promoted')!.resolve(); await Promise.all([promoted, sharedPromoted]); await tick();
  requests.find(request => request.src === 'background')!.resolve();
  requests.find(request => request.src === 'y')!.resolve(); await Promise.all([background, y]); await tick();
  assert.equal(requests.filter(request => request.src === 'promoted').length, 1);

  // A body that ignores cancellation still cannot monopolize a scheduler slot.
  globalThis.fetch = (async () => ({ ok: true, blob: () => new Promise<Blob>(() => {}) })) as unknown as typeof fetch;
  const hung = getArtworkObjectUrl('hung').catch(error => error.name);
  const hungSecond = getArtworkObjectUrl('hung-second').catch(error => error.name);
  const behindHungBodies = getArtworkObjectUrl('behind-hung-bodies');
  await tick();
  assert.equal(timers.size, 2, 'queued wait does not consume the transfer timeout');
  globalThis.fetch = (async () => new Response(new Blob(['cover']))) as typeof fetch;
  const expired = [...timers.values()]; expired[0]();
  assert.equal(await hung, 'TimeoutError');
  assert.ok(await behindHungBodies, 'timeout frees a slot despite a body ignoring cancellation');
  expired[1](); assert.equal(await hungSecond, 'TimeoutError');
  await tick(); assert.equal(timers.size, 0);
  assert.ok(await getArtworkObjectUrl('hung'), 'timed out request can retry');

  // Keep one old image displayed while scrolling far beyond the cache budget.
  for (let i = 0; i < 150; i++) await getArtworkObjectUrl(`scroll-${i}`);
  assert.ok(artworkObjectUrls.size <= 128);
  assert.equal(artworkObjectUrls.get('a'), aUrl, 'mounted image survives cache pressure');
  assert.equal(revoked.has(aUrl), false);
  const anotherViewer = consumer();
  assert.equal(retainArtworkObjectUrl('a', anotherViewer.signal), aUrl);
  invalidateArtworkObjectUrl('a');
  assert.equal(artworkObjectUrls.has('a'), false);
  assert.equal(revoked.has(aUrl), false, 'invalidation preserves existing consumers');
  const replacementViewer = consumer();
  const replacementUrl = await getArtworkObjectUrl('a', false, replacementViewer.signal);
  assert.notEqual(replacementUrl, aUrl);
  duplicate.abort(); assert.equal(revoked.has(aUrl), false, 'second viewer keeps retired URL alive');
  anotherViewer.abort(); assert.equal(revoked.has(aUrl), true, 'last viewer releases retired storage');
  assert.equal(revoked.has(replacementUrl), false, 'retiring old URL cannot revoke replacement');

  globalThis.fetch = (async () => new Response(new Blob([new Uint8Array(40 * 1024 * 1024)]))) as typeof fetch;
  const large = consumer(); const largeUrl = await getArtworkObjectUrl('large', false, large.signal);
  assert.equal(revoked.has(largeUrl), false, 'new consumers pin before budget eviction');
  await getArtworkObjectUrl('large-prefetch');
  assert.equal(revoked.has(largeUrl), false, 'byte-budget eviction skips a displayed image');
  assert.equal(artworkObjectUrls.has('large-prefetch'), false, 'byte budget evicts unused large blobs');
  large.abort();
  console.log('PASS: artwork concurrency, shared cancellation, priority promotion, hung-body timeout/retry, LRU/byte budgets, and active URL leases');
} finally {
  controllers.forEach(controller => controller.abort());
  for (const src of [...artworkObjectUrls.keys()]) invalidateArtworkObjectUrl(src);
  for (const timer of timers.keys()) originalClearTimeout(timer);
  globalThis.fetch = originalFetch; URL.revokeObjectURL = originalRevoke;
  globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClearTimeout;
}
