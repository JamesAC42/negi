import type Database from "better-sqlite3";

const MAX_ENTRIES = 400;

/** Persist provider JSON so renderer refreshes and backend restarts stay warm. */
export class CatalogueResponseCache {
  private accessed: number;
  private readonly lookup: Database.Statement;
  private readonly touch: Database.Statement;
  private readonly remove: Database.Statement;
  private readonly store: (key: string, json: string, expires: number) => void;

  constructor(
    db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS catalogue_response_cache (
        key TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        expires INTEGER NOT NULL,
        accessed INTEGER NOT NULL
      )
    `);
    this.accessed = (
      db.prepare("SELECT COALESCE(MAX(accessed), 0) value FROM catalogue_response_cache").get() as { value: number }
    ).value;
    this.lookup = db.prepare(
      "SELECT json, expires FROM catalogue_response_cache WHERE key = ?",
    );
    this.touch = db.prepare(
      "UPDATE catalogue_response_cache SET accessed = ? WHERE key = ?",
    );
    this.remove = db.prepare("DELETE FROM catalogue_response_cache WHERE key = ?");
    const insert = db.prepare(
      "INSERT OR REPLACE INTO catalogue_response_cache (key, json, expires, accessed) VALUES (?, ?, ?, ?)",
    );
    const pruneExpired = db.prepare(
      "DELETE FROM catalogue_response_cache WHERE expires <= ?",
    );
    const pruneOldest = db.prepare(`
      DELETE FROM catalogue_response_cache WHERE key IN (
        SELECT key FROM catalogue_response_cache
        ORDER BY accessed DESC, key LIMIT -1 OFFSET ?
      )
    `);
    this.store = db.transaction((key: string, json: string, expires: number) => {
      insert.run(key, json, expires, ++this.accessed);
      pruneExpired.run(this.now());
      pruneOldest.run(MAX_ENTRIES);
    });
  }

  get(key: string): unknown | undefined {
    const cached = this.lookup.get(key) as { json: string; expires: number } | undefined;
    if (!cached) return undefined;
    if (cached.expires <= this.now()) {
      this.remove.run(key);
      return undefined;
    }
    let value: unknown;
    try {
      value = JSON.parse(cached.json);
    } catch {
      this.remove.run(key);
      return undefined;
    }
    this.touch.run(++this.accessed, key);
    return value;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    const json = JSON.stringify(value);
    // Undefined is the miss sentinel and is not a valid provider JSON response.
    if (json === undefined) return;
    this.store(key, json, this.now() + ttlMs);
  }
}
