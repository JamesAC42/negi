import { exploreApi } from "./explore-api";

type Progressive = { pending?: boolean };
let generation = 0;
const snapshots = new Map<string, { value: unknown; expires: number }>();
const requests = new Map<string, Promise<unknown>>();
export function artistSnapshot<T>(path: string): T | null {
  const entry = snapshots.get(path);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.value as T;
}
export function clearArtistSnapshots() { generation++; snapshots.clear(); requests.clear(); }
if (typeof window !== "undefined") window.addEventListener("music-library-changed", clearArtistSnapshots);

/** Reuse visited pages and share concurrent reads; mutations always go straight to the API. */
export async function cachedExploreApi<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (body !== undefined) return exploreApi<T>(path, body, signal);
  signal?.throwIfAborted();
  const cached = artistSnapshot<T>(path);
  if (cached !== null) return cached;
  let pending = requests.get(path);
  if (!pending) {
    const epoch = generation;
    pending = exploreApi<T>(path, undefined, AbortSignal.timeout(12000)).then((value) => {
      if (epoch !== generation) return value;
      if (snapshots.size >= 160) snapshots.delete(snapshots.keys().next().value!);
      const changing = Boolean((value as Progressive)?.pending);
      snapshots.set(path, { value, expires: Date.now() + (changing ? 350 : 300000) });
      return value;
    }).finally(() => { if (requests.get(path) === pending) requests.delete(path); });
    requests.set(path, pending);
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Request cancelled", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    pending!.then((value) => { if (!signal?.aborted) resolve(value as T); }, reject)
      .finally(() => signal?.removeEventListener("abort", abort));
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
    });
  }
}
