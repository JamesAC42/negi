import { exploreApi } from "./explore-api";

type Progressive = { pending?: boolean };
type SharedRequest = { promise: Promise<unknown>; controller: AbortController; readers: number; settled: boolean };
let generation = 0;
const snapshots = new Map<string, { value: unknown; expires: number }>();
const requests = new Map<string, SharedRequest>();
// Leave connection capacity for artwork, the visualizer stream, and playback controls.
const maxReads = 2;
let activeReads = 0;
const queuedReads: Array<() => void> = [];

/** Bound catalogue/enrichment traffic so a large page cannot monopolize the connection pool. */
function scheduleRead<T>(path: string, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      const index = queuedReads.indexOf(start);
      if (index >= 0) queuedReads.splice(index, 1);
      reject(signal.reason);
    };
    const start = () => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) { reject(signal.reason); return; }
      activeReads++;
      void exploreApi<T>(path, undefined, AbortSignal.any([signal, AbortSignal.timeout(12000)]))
        .then(resolve, reject).finally(() => {
          activeReads--;
          queuedReads.shift()?.();
        });
    };
    if (signal.aborted) { reject(signal.reason); return; }
    if (activeReads < maxReads) start();
    else { queuedReads.push(start); signal.addEventListener("abort", abort, { once: true }); }
  });
}

export function artistSnapshot<T>(path: string): T | null {
  const entry = snapshots.get(path);
  if (!entry) return null;
  if (entry.expires < Date.now()) { snapshots.delete(path); return null; }
  return entry.value as T;
}
export function clearArtistSnapshots() { generation++; snapshots.clear(); requests.clear(); }
if (typeof window !== "undefined") window.addEventListener("music-library-changed", clearArtistSnapshots);

/** Reuse visited pages and share reads until their final consumer leaves. Mutations bypass the cache. */
export async function cachedExploreApi<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (body !== undefined) return exploreApi<T>(path, body, signal);
  signal?.throwIfAborted();
  const cached = artistSnapshot<T>(path);
  if (cached !== null) return cached;
  let pending = requests.get(path);
  if (!pending) {
    const epoch = generation;
    const controller = new AbortController();
    const entry: SharedRequest = { controller, readers: 0, settled: false, promise: Promise.resolve() };
    entry.promise = scheduleRead<T>(path, controller.signal).then((value) => {
      if (epoch !== generation || controller.signal.aborted) return value;
      if (snapshots.size >= 160) snapshots.delete(snapshots.keys().next().value!);
      const changing = Boolean((value as Progressive)?.pending);
      snapshots.set(path, { value, expires: Date.now() + (changing ? 350 : 300000) });
      return value;
    }).finally(() => {
      entry.settled = true;
      if (requests.get(path) === entry) requests.delete(path);
    });
    pending = entry;
    requests.set(path, entry);
  }
  const shared = pending;
  shared.readers++;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener("abort", abort);
      shared.readers--;
      if (!shared.readers && !shared.settled) {
        if (requests.get(path) === shared) requests.delete(path);
        shared.controller.abort();
      }
      return true;
    };
    const abort = () => { if (finish()) reject(new DOMException("Request cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    shared.promise.then((value) => { if (finish()) resolve(value as T); }, (error) => { if (finish()) reject(error); });
    if (signal?.aborted) abort();
  });
}

/** Keep useful data on screen while bounded background enrichment is still running. */
export async function readArtistResource<T extends Progressive>(path: string, receive: (value: T) => void, signal: AbortSignal): Promise<void> {
  for (let poll = 0; poll < 24; poll++) {
    signal.throwIfAborted();
    const value = await cachedExploreApi<T>(path, undefined, signal);
    if (signal.aborted) return;
    receive(value);
    if (!value.pending) return;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Request cancelled", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, poll < 3 ? 800 : 2000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
