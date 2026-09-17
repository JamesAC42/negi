// Artwork and API calls share Chromium's HTTP/1 connection pool. Leave room
// for interactive data requests and the long-lived visualizer stream.
const concurrency = 2;
const cacheEntryLimit = 128;
const cacheByteLimit = 64 * 1024 * 1024;
const transferTimeoutMs = 20_000;
export const artworkObjectUrls = new Map<string, string>();
type CacheEntry = { url: string; bytes: number; users: number; retired: boolean };
const cache = new Map<string, CacheEntry>();
let cachedBytes = 0;
type Request = {
  controller: AbortController;
  promise: Promise<string>;
  consumers: number;
  settled: boolean;
  highPriority: boolean;
};
const pending = new Map<string, Request>();
const queue: Array<{ run: () => void; priority: () => boolean }> = [];
let active = 0;
const cancelled = () => new DOMException('Artwork request cancelled', 'AbortError');

function trimCache() {
  for (const [src, entry] of cache) {
    if (cache.size <= cacheEntryLimit && cachedBytes <= cacheByteLimit) break;
    if (entry.users) continue;
    cache.delete(src); artworkObjectUrls.delete(src); cachedBytes -= entry.bytes;
    URL.revokeObjectURL(entry.url);
  }
}

/** Cached URL leases live until the consumer's cleanup signal aborts. */
export function retainArtworkObjectUrl(src: string, signal: AbortSignal): string | undefined {
  if (signal.aborted) return undefined;
  const entry = cache.get(src);
  if (!entry) return undefined;
  cache.delete(src); cache.set(src, entry); // Least recently used first.
  entry.users++;
  signal.addEventListener('abort', () => {
    entry.users--;
    if (entry.retired && !entry.users) URL.revokeObjectURL(entry.url);
    trimCache();
  }, { once: true });
  return entry.url;
}

/** Refresh future consumers without breaking an image still using the old URL. */
export function invalidateArtworkObjectUrl(src: string): void {
  const entry = cache.get(src);
  cache.delete(src); artworkObjectUrls.delete(src);
  if (!entry) return;
  cachedBytes -= entry.bytes; entry.retired = true;
  if (!entry.users) URL.revokeObjectURL(entry.url);
}

function schedule<T>(task: () => Promise<T>, signal: AbortSignal, priority: () => boolean): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const item = {
      priority,
      run: () => {
        signal.removeEventListener('abort', abort);
        active++;
        // Race cancellation as well as passing the signal into fetch: even a
        // stalled response body must release its scheduler slot promptly.
        void new Promise<T>((finish, fail) => {
          const cancel = () => fail(signal.reason ?? cancelled());
          signal.addEventListener('abort', cancel, { once: true });
          if (signal.aborted) { cancel(); return; }
          void task().then(finish, fail).finally(() => signal.removeEventListener('abort', cancel));
        }).then(resolve, reject).finally(() => {
          active--;
          const priorityIndex = queue.findIndex(entry => entry.priority());
          queue.splice(priorityIndex < 0 ? 0 : priorityIndex, 1)[0]?.run();
        });
      },
    };
    const abort = () => {
      const index = queue.indexOf(item);
      if (index >= 0) queue.splice(index, 1);
      reject(signal.reason ?? cancelled());
    };
    if (signal.aborted) { abort(); return; }
    if (active < concurrency) item.run();
    else { queue.push(item); signal.addEventListener('abort', abort, { once: true }); }
  });
}

// Callers displaying a URL supply a signal and abort it on replacement/unmount.
// Calls without a signal are prefetches and do not pin cache storage.
export function getArtworkObjectUrl(src: string, highPriority = false, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(cancelled());
  const cached = signal ? retainArtworkObjectUrl(src, signal) : cache.get(src)?.url;
  if (cached) return Promise.resolve(cached);
  let request = pending.get(src);
  if (!request) {
    const controller = new AbortController();
    request = { controller, promise: undefined!, consumers: 0, settled: false, highPriority };
    const current = request;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    current.promise = schedule(async () => {
      timeout = setTimeout(() => controller.abort(new DOMException('Artwork request timed out', 'TimeoutError')), transferTimeoutMs);
      const response = await fetch(src, { signal: controller.signal });
      if (!response.ok) throw new Error(`Artwork request failed with ${response.status}`);
      const blob = await response.blob();
      controller.signal.throwIfAborted();
      const objectUrl = URL.createObjectURL(blob);
      invalidateArtworkObjectUrl(src);
      cache.set(src, { url: objectUrl, bytes: blob.size, users: 0, retired: false });
      cachedBytes += blob.size; artworkObjectUrls.set(src, objectUrl);
      return objectUrl;
    }, controller.signal, () => current.highPriority).finally(() => {
      clearTimeout(timeout);
      current.settled = true;
      if (pending.get(src) === current) pending.delete(src);
    });
    pending.set(src, current);
  } else if (highPriority) {
    // An already queued thumbnail may become the current album before starting.
    request.highPriority = true;
  }
  const current = request;
  current.consumers++;
  return new Promise<string>((resolve, reject) => {
    let done = false;
    const release = () => {
      if (done) return false;
      done = true;
      signal?.removeEventListener('abort', abort);
      current.consumers--;
      if (!current.consumers && !current.settled) {
        if (pending.get(src) === current) pending.delete(src);
        current.controller.abort();
      }
      return true;
    };
    const abort = () => { if (release()) reject(cancelled()); };
    signal?.addEventListener('abort', abort, { once: true });
    current.promise.then(
      (value) => {
        if (!release()) { if (!current.consumers) trimCache(); return; }
        if (signal) retainArtworkObjectUrl(src, signal);
        resolve(value);
        // All shared consumers must establish their leases before eviction.
        if (!current.consumers) trimCache();
      },
      (error: unknown) => { if (release()) reject(error); },
    );
  });
}
