/** Small snapshot cache: HTTP reads never wait for optional third-party enrichment. */
export class ArtistBackgroundCache<T extends { pending?: boolean }> {
  private values = new Map<string, { until: number; value: T }>();
  private jobs = new Map<string, Promise<T>>();
  constructor(private budgetMs = 20_000) {}
  get(key: string, seed: () => T, load: (publish: (value: T) => void) => Promise<T>, failed: (value: T) => T): T {
    const cached = this.values.get(key);
    if (this.jobs.has(key) || (cached && cached.until > Date.now())) return cached!.value;
    // Navigation cannot create an unbounded backlog on rate-limited providers.
    if (this.jobs.size >= 8) {
      const value = { ...failed(cached?.value ?? seed()), pending: false };
      this.values.set(key, { value, until: Date.now() + 5_000 });
      this.trim(key);
      return value;
    }
    let active = true;
    const publish = (value: T) => {
      if (!active) return;
      this.values.set(key, { until: 0, value: structuredClone({ ...value, pending: true }) });
    };
    publish(cached?.value ?? seed());
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("Artist enrichment timed out")), this.budgetMs); });
    let ttlMs = 3_600_000;
    const job = Promise.race([Promise.resolve().then(() => load(publish)), timeout])
      .then((value) => ({ ...value, pending: false }), () => { ttlMs = 60_000; return { ...failed(this.values.get(key)!.value), pending: false }; })
      .then((value) => {
        active = false;
        clearTimeout(timer);
        this.values.set(key, { value: structuredClone(value), until: Date.now() + ttlMs });
        this.jobs.delete(key);
        this.trim(key);
        return value;
      });
    this.jobs.set(key, job);
    return this.values.get(key)!.value;
  }
  private trim(key: string) {
    if (this.values.size <= 200) return;
    const oldest = [...this.values.keys()].find((id) => !this.jobs.has(id) && id !== key);
    if (oldest) this.values.delete(oldest);
  }
  async complete(key: string): Promise<T> { return this.jobs.get(key) ?? this.values.get(key)!.value; }
}
