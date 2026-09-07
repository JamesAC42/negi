/** Space request starts, without making unrelated lookups wait for a slow response. */
export class CatalogueRequestScheduler {
  private tail: Promise<void> = Promise.resolve();
  private nextStart = 0;

  constructor(private spacingMs = 1100) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const ready = this.tail.then(async () => {
      const delay = this.nextStart - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      this.nextStart = Date.now() + this.spacingMs;
    });
    this.tail = ready.catch(() => {});
    return ready.then(task);
  }
}

export const catalogueRequestScheduler = new CatalogueRequestScheduler();
