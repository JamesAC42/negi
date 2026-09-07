import { get } from "node:https";
import type Database from "better-sqlite3";
import type { ArtworkResult } from "./artwork-service.js";

/** Keeps source thumbnails local, including for imports made before this feature. */
export class YoutubeArtwork {
  private pending = new Map<string, Promise<ArtworkResult | null>>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private db: Database.Database,
    private download = downloadThumbnail,
  ) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS youtube_artwork (video_id TEXT PRIMARY KEY, image_data BLOB, mime_type TEXT, retry_at INTEGER NOT NULL DEFAULT 0)",
    );
  }
  async forFile(fileId: string): Promise<ArtworkResult | null> {
    const source = this.db
      .prepare(
        "SELECT json_extract(i.source_context_json, '$.videoId') AS video_id FROM import_items item JOIN imports i ON i.id = item.import_id WHERE item.file_id = ? AND i.source = 'youtube_download' ORDER BY item.created_at DESC LIMIT 1",
      )
      .get(fileId) as { video_id: string | null } | undefined;
    return source?.video_id ? this.get(source.video_id) : null;
  }
  async get(videoId: string): Promise<ArtworkResult | null> {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    const cached = this.db
      .prepare("SELECT * FROM youtube_artwork WHERE video_id = ?")
      .get(videoId) as
      | { image_data: Buffer | null; mime_type: string; retry_at: number }
      | undefined;
    if (cached?.image_data)
      return { data: cached.image_data, mimeType: cached.mime_type };
    if (cached && cached.retry_at > Date.now()) return null;
    const pending = this.pending.get(videoId);
    if (pending) return pending;
    const work = this.load(videoId).finally(() => this.pending.delete(videoId));
    this.pending.set(videoId, work);
    return work;
  }
  private async load(videoId: string) {
    if (this.active >= 4)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      const artwork = await this.download(videoId).catch(() => null);
      if (this.db.open)
        this.db
          .prepare(
            "INSERT OR REPLACE INTO youtube_artwork(video_id,image_data,mime_type,retry_at) VALUES (?,?,?,?)",
          )
          .run(
            videoId,
            artwork?.data ?? null,
            artwork?.mimeType ?? null,
            artwork ? 0 : Date.now() + 15 * 60_000,
          );
      return artwork;
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
function downloadThumbnail(videoId: string): Promise<ArtworkResult | null> {
  return new Promise((resolve, reject) => {
    const request = get(
      "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg",
      { family: 4 },
      (response) => {
        const mime = (response.headers["content-type"] ?? "").split(";")[0];
        if (
          response.statusCode !== 200 ||
          !["image/jpeg", "image/png", "image/webp"].includes(mime)
        ) {
          response.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024)
            request.destroy(new Error("Thumbnail too large"));
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve(
            bytes ? { data: Buffer.concat(chunks), mimeType: mime } : null,
          ),
        );
        response.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("Thumbnail timed out")),
      8000,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
}
