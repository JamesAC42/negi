// Artwork and API calls share Chromium's HTTP/1 connection pool. Leave room
// for interactive data requests and the long-lived visualizer stream.
const concurrency = 2;
export const artworkObjectUrls = new Map<string, string>();
type Request = {
  controller: AbortController;
  promise: Promise<string>;
  consumers: number;
  settled: boolean;
};
const pending = new Map<string, Request>();
const queue: Array<{ run: () => void; highPriority: boolean }> = [];
let active = 0;

function schedule<T>(task: () => Promise<T>, signal: AbortSignal, highPriority: boolean): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const item = {
      highPriority,
      run: () => {
        signal.removeEventListener("abort", abort);
        active++;
        void task().then(resolve, reject).finally(() => {
          active--;
          const priorityIndex = queue.findIndex((entry) => entry.highPriority);
          queue.splice(priorityIndex < 0 ? 0 : priorityIndex, 1)[0]?.run();
        });
      },
    };
    const abort = () => {
      const index = queue.indexOf(item);
      if (index >= 0) queue.splice(index, 1);
      reject(new DOMException("Artwork request cancelled", "AbortError"));
    };
    if (signal.aborted) { abort(); return; }
    if (active < concurrency) item.run();
    else {
      queue.push(item);
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

export function getArtworkObjectUrl(src: string, highPriority = false, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new DOMException("Artwork request cancelled", "AbortError"));
  const cached = artworkObjectUrls.get(src);
  if (cached) return Promise.resolve(cached);
  let request = pending.get(src);
  if (!request) {
    const controller = new AbortController();
    request = { controller, promise: undefined!, consumers: 0, settled: false };
    const current = request;
    current.promise = schedule(async () => {
      const response = await fetch(src, { signal: controller.signal });
      if (!response.ok) throw new Error(`Artwork request failed with ${response.status}`);
      const blob = await response.blob();
      controller.signal.throwIfAborted();
      const objectUrl = URL.createObjectURL(blob);
      artworkObjectUrls.set(src, objectUrl);
      return objectUrl;
    }, controller.signal, highPriority).finally(() => {
      current.settled = true;
      if (pending.get(src) === current) pending.delete(src);
    });
    pending.set(src, current);
  }
  const current = request;
  current.consumers++;
  return new Promise<string>((resolve, reject) => {
    let done = false;
    const release = () => {
      if (done) return false;
      done = true;
      signal?.removeEventListener("abort", abort);
      current.consumers--;
      if (!current.consumers && !current.settled) {
        if (pending.get(src) === current) pending.delete(src);
        current.controller.abort();
      }
      return true;
    };
    const abort = () => {
      if (release()) reject(new DOMException("Artwork request cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    current.promise.then(
      (value) => { if (release()) resolve(value); },
      (error: unknown) => { if (release()) reject(error); },
    );
  });
}
