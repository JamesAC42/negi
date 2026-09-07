import { get } from "node:https";
import type Database from "better-sqlite3";
import type { ArtworkResult } from "./artwork-service.js";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 256;
export class CatalogueArtworkCache {
  private pending = new Map<string, Promise<ArtworkResult | null>>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private db: Database.Database,
    private download = downloadCover,
  ) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS catalogue_artwork_cache (id TEXT PRIMARY KEY, data BLOB, mime TEXT, expires INTEGER NOT NULL, accessed INTEGER NOT NULL)",
    );
  }
  async get(id: string): Promise<ArtworkResult | null> {
    const cached = this.db
      .prepare(
        "SELECT data, mime, expires FROM catalogue_artwork_cache WHERE id = ?",
      )
      .get(id) as
      | { data: Buffer | null; mime: string; expires: number }
      | undefined;
    if (cached && cached.expires > Date.now()) {
      this.db
        .prepare("UPDATE catalogue_artwork_cache SET accessed = ? WHERE id = ?")
        .run(Date.now(), id);
      return cached.data ? { data: cached.data, mimeType: cached.mime } : null;
    }
    const pending = this.pending.get(id);
    if (pending) return pending;
    const request = this.load(id).finally(() => this.pending.delete(id));
    this.pending.set(id, request);
    return request;
  }
  private async load(id: string) {
    if (this.active >= 4)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      const artwork = await this.download(
        new URL(
          "https://coverartarchive.org/release-group/" + id + "/front-250",
        ),
      );
      const now = Date.now();
      this.db
        .prepare(
          "INSERT OR REPLACE INTO catalogue_artwork_cache (id,data,mime,expires,accessed) VALUES (?,?,?,?,?)",
        )
        .run(
          id,
          artwork?.data ?? null,
          artwork?.mimeType ?? null,
          now + (artwork ? 7 * 86400000 : 900000),
          now,
        );
      this.db
        .prepare(
          "DELETE FROM catalogue_artwork_cache WHERE id IN (SELECT id FROM catalogue_artwork_cache ORDER BY accessed DESC LIMIT -1 OFFSET ?)",
        )
        .run(MAX_ENTRIES);
      return artwork;
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
function downloadCover(
  url: URL,
  redirects = 0,
  deadline = Date.now() + 15000,
): Promise<ArtworkResult | null> {
  const host = url.hostname;
  if (url.protocol === "http:") url.protocol = "https:";
  if (
    url.protocol !== "https:" ||
    (host !== "coverartarchive.org" &&
      host !== "archive.org" &&
      !host.endsWith(".archive.org")) ||
    redirects > 5
  )
    return Promise.reject(new Error("Invalid cover redirect"));
  return new Promise((resolve, reject) => {
    const request = get(
      url,
      {
        family: 4,
        headers: { "User-Agent": "MusicOS/0.1.0", Accept: "image/*" },
      },
      (response) => {
        if (
          [301, 302, 303, 307, 308].includes(response.statusCode ?? 0) &&
          response.headers.location
        ) {
          response.resume();
          resolve(
            downloadCover(
              new URL(response.headers.location, url),
              redirects + 1,
              deadline,
            ),
          );
          return;
        }
        if (response.statusCode === 404) {
          response.resume();
          resolve(null);
          return;
        }
        const mime = (response.headers["content-type"] ?? "").split(";")[0];
        if (
          response.statusCode !== 200 ||
          ![
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/avif",
          ].includes(mime)
        ) {
          response.resume();
          reject(new Error("Cover provider unavailable"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) request.destroy(new Error("Cover too large"));
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({ data: Buffer.concat(chunks), mimeType: mime }),
        );
        response.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("Cover request timed out")),
      Math.max(1, deadline - Date.now()),
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
}
