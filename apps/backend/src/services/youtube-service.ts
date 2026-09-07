import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { execFile, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  VideoJob,
  VideoResult,
  YoutubeReviewRequest,
} from "@music-os/core";
import type { BackendConfig } from "../config.js";
import type { ImportService } from "./import-service.js";
import type { LibraryRepository } from "./library-repository.js";

export function youtubeUrl(input: string): string {
  const url = new URL(input);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Enter a YouTube video link.");
  const host = url.hostname.toLowerCase();
  if (
    ![
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
    ].includes(host)
  )
    throw new Error("Only YouTube video links are supported.");
  const id =
    host === "youtu.be"
      ? url.pathname.slice(1)
      : url.pathname === "/watch"
        ? url.searchParams.get("v")
        : /^\/(?:shorts|embed|live)\/([^/]+)$/.exec(url.pathname)?.[1];
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id))
    throw new Error("Use a single video link, not a playlist or channel.");
  return "https://www.youtube.com/watch?v=" + id;
}
interface VideoInfo {
  id: string;
  title?: string;
  track?: string;
  artist?: string;
  creator?: string;
  uploader?: string;
  channel?: string;
  album?: string;
  release_year?: number;
  duration?: number;
  thumbnail?: string;
  thumbnails?: { url: string; width?: number }[];
  view_count?: number;
  upload_date?: string;
  timestamp?: number;
  live_status?: string;
  entries?: VideoInfo[];
  acodec?: string;
}
export function guessVideoMetadata(info: VideoInfo) {
  const clean = (s: string) =>
    s
      .replace(
        /\s*[\[(](?:official\s*(?:music\s*)?video|official audio|lyrics?|audio|visuali[sz]er|hd|4k)[\])]/gi,
        "",
      )
      .trim();
  const title = clean(info.track || info.title || "Untitled");
  const split = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return {
    artist:
      info.artist ||
      info.creator ||
      split?.[1]?.trim() ||
      (info.channel || info.uploader || "Unknown Artist").replace(
        /\s*-\s*Topic$/,
        "",
      ),
    title: info.track || split?.[2]?.trim() || title,
    album: info.album || "YouTube Singles",
    year: info.release_year ? String(info.release_year) : "",
  };
}
type Payload = {
  url: string;
  libraryRootId?: string;
  stage?: string;
  message?: string;
  importId?: string;
  itemId?: string;
  artist?: string;
  title?: string;
  album?: string;
  year?: string;
  codec?: string;
};
type Row = {
  id: string;
  status: string;
  payload_json: string;
  error_json: string | null;
  created_at: string;
  progress: number;
};

export class YoutubeService {
  private searchCache = new Map<
    string,
    { until: number; results: VideoResult[] }
  >();
  private pendingSearches = new Map<string, Promise<VideoResult[]>>();
  private children = new Map<string, ChildProcess>();
  private reviewing = new Set<string>();
  private directory: string;
  constructor(
    private db: Database.Database,
    private config: BackendConfig,
    private imports: ImportService,
    private library: LibraryRepository,
  ) {
    this.directory = join(dirname(config.databasePath), "youtube");
    this.db
      .prepare(
        "UPDATE jobs SET status='failed',error_json=? WHERE type='youtube_download' AND status IN ('queued','running') AND json_extract(payload_json,'$.stage') IS NOT 'review'",
      )
      .run(
        JSON.stringify({
          message:
            "Download interrupted by a backend restart. Retry the download.",
        }),
      );
  }
  close() {
    for (const child of this.children.values()) child.kill();
  }
  private run(
    args: string[],
    id: string,
    timeout = 120000,
    onProgress?: (value: number) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        process.env.MUSIC_OS_YT_DLP_PATH || this.config.ytDlpPath || "yt-dlp",
        [
          "--ignore-config",
          "--no-playlist",
          "--no-warnings",
          "--force-ipv4",
          "--js-runtimes",
          "node:" + process.execPath,
          ...args,
        ],
        { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          this.children.delete(id);
          if (error)
            reject(
              new Error(
                ("yt-dlp: " + (stderr.trim() || error.message)).slice(0, 1000),
              ),
            );
          else resolve(stdout);
        },
      );
      if (onProgress) {
        let buffered = "";
        child.stdout?.on("data", (chunk: string | Buffer) => {
          buffered += chunk.toString();
          const lines = buffered.split(/\r?\n/);
          buffered = lines.pop() ?? "";
          for (const line of lines) {
            const match = /negi-progress:\s*([\d.]+)%/.exec(line);
            if (match)
              onProgress(Math.min(1, Math.max(0, Number(match[1]) / 100)));
          }
        });
      }
      this.children.set(id, child);
    });
  }
  async health() {
    try {
      const version = (await this.run(["--version"], nanoid(), 10000)).trim();
      return {
        available: true,
        version,
        message: "Best available audio · metadata review before import",
      };
    } catch {
      return {
        available: false,
        version: null,
        message:
          "Run npm run setup:youtube in WSL and ensure FFmpeg is installed, or configure MUSIC_OS_YT_DLP_PATH and MUSIC_OS_FFMPEG_PATH. No YouTube API key is needed.",
      };
    }
  }
  async search(query: string): Promise<VideoResult[]> {
    query = query.trim();
    const direct = /^https?:\/\//i.test(query);
    const input = direct ? youtubeUrl(query) : "ytsearch12:" + query;
    const key = direct ? input : query.toLocaleLowerCase();
    const cached = this.searchCache.get(key);
    if (cached && cached.until > Date.now()) return cached.results;
    const pending = this.pendingSearches.get(key);
    if (pending) return pending;
    const work = this.searchUncached(input, direct)
      .then((results) => {
        if (this.searchCache.size >= 64)
          this.searchCache.delete(this.searchCache.keys().next().value!);
        this.searchCache.set(key, { until: Date.now() + 10 * 60_000, results });
        return results;
      })
      .finally(() => this.pendingSearches.delete(key));
    this.pendingSearches.set(key, work);
    return work;
  }
  private async searchUncached(
    input: string,
    direct: boolean,
  ): Promise<VideoResult[]> {
    const info = JSON.parse(
      await this.run(
        [
          "--dump-single-json",
          "--skip-download",
          "--flat-playlist",
          "--socket-timeout",
          "10",
          "--extractor-retries",
          "1",
          "--retries",
          "1",
          ...(direct
            ? []
            : ["--extractor-args", "youtubetab:approximate_date;skip=webpage"]),
          "--",
          input,
        ],
        nanoid(),
        45000,
      ),
    ) as VideoInfo;
    return (info.entries ?? [info])
      .filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.id))
      .map((v) => ({
        id: v.id,
        url: "https://www.youtube.com/watch?v=" + v.id,
        title: v.title ?? v.id,
        channel: v.channel ?? v.uploader ?? "",
        duration: v.duration ?? null,
        thumbnail:
          v.thumbnail ??
          v.thumbnails?.find((t) => (t.width ?? 0) >= 320)?.url ??
          "https://i.ytimg.com/vi/" + v.id + "/mqdefault.jpg",
        viewCount: v.view_count ?? null,
        uploadDate:
          v.upload_date && /^\d{8}$/.test(v.upload_date)
            ? v.upload_date.slice(0, 4) +
              "-" +
              v.upload_date.slice(4, 6) +
              "-" +
              v.upload_date.slice(6, 8)
            : Number.isFinite(v.timestamp)
              ? new Date(v.timestamp! * 1000).toISOString().slice(0, 10)
              : null,
        approximateDate: !direct,
        liveStatus: v.live_status ?? null,
      }));
  }
  list(): VideoJob[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM jobs WHERE type='youtube_download' ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END, created_at DESC LIMIT 100",
        )
        .all() as Row[]
    ).map((r) => {
      const p = JSON.parse(r.payload_json) as Payload;
      return {
        ...p,
        id: r.id,
        progress: r.progress,
        status: (r.status === "running" && p.stage === "review"
          ? "review"
          : r.status) as VideoJob["status"],
        message: p.message ?? "Queued",
        error: r.error_json ? JSON.parse(r.error_json).message : null,
        createdAt: r.created_at,
      };
    });
  }
  create(url: string, libraryRootId?: string): VideoJob {
    url = youtubeUrl(url);
    if (libraryRootId) this.library.getRoot(libraryRootId);
    const existing = this.list().find(
      (j) =>
        j.url === url && ["queued", "running", "review"].includes(j.status),
    );
    if (existing) return existing;
    const id = nanoid();
    const known = [...this.searchCache.values()]
      .flatMap((entry) => entry.results)
      .find((video) => video.url === url);
    this.db
      .prepare(
        "INSERT INTO jobs (id,type,status,progress,payload_json) VALUES (?,'youtube_download','queued',0,?)",
      )
      .run(
        id,
        JSON.stringify({
          url,
          libraryRootId,
          title: known?.title,
          message: "Queued for best available audio",
        }),
      );
    void this.download(id).catch((e) => this.fail(id, e));
    return this.list().find((j) => j.id === id)!;
  }
  cancel(id: string) {
    if (this.reviewing.has(id))
      throw new Error("Import is already being completed.");
    const j = this.get(id);
    if (["succeeded", "cancelled"].includes(j.status)) return;
    this.children.get(id)?.kill();
    if (j.itemId && this.imports.getItem(j.itemId).status === "needs_review")
      this.imports.rejectItem(j.itemId);
    this.db
      .prepare(
        "UPDATE jobs SET status='cancelled',completed_at=datetime('now') WHERE id=?",
      )
      .run(id);
  }
  retry(id: string) {
    const j = this.get(id);
    if (!["failed", "cancelled"].includes(j.status))
      throw new Error("Only stopped downloads can be retried.");
    return this.create(j.url);
  }
  async approve(input: YoutubeReviewRequest) {
    if (this.reviewing.has(input.jobId))
      throw new Error("This import is already being completed.");
    const j = this.get(input.jobId);
    if (j.status === "succeeded") return j;
    if (j.status !== "review" || !j.itemId)
      throw new Error("Download the audio before importing.");
    this.library.getRoot(input.libraryRootId);
    this.reviewing.add(j.id);
    try {
      const item = this.imports.getItem(j.itemId);
      if (item.status !== "imported") {
        this.imports.updateItemMetadata(item.id, input);
        await this.imports.approveItem(item.id, input.libraryRootId);
      }
      this.db
        .prepare(
          "UPDATE jobs SET status='succeeded',progress=1,payload_json=?,completed_at=datetime('now') WHERE id=?",
        )
        .run(
          JSON.stringify({
            ...j,
            ...input,
            message: "Imported into your library",
            stage: "done",
          }),
          j.id,
        );
      return this.get(j.id);
    } finally {
      this.reviewing.delete(j.id);
    }
  }
  private get(id: string): VideoJob {
    const j = this.list().find((j) => j.id === id);
    if (!j) throw new Error("YouTube download not found.");
    return j;
  }
  private async download(id: string) {
    const j = this.get(id);
    this.db
      .prepare(
        "UPDATE jobs SET status='running',started_at=datetime('now'),payload_json=? WHERE id=?",
      )
      .run(
        JSON.stringify({ ...j, message: "Downloading best available audio" }),
        id,
      );
    const folder = join(this.directory, id);
    await mkdir(folder, { recursive: true });
    if (this.get(id).status === "cancelled") return;
    const args = [
      "-f",
      "bestaudio",
      "-x",
      "--audio-format",
      "best",
      "--write-info-json",
      "--newline",
      "--progress",
      "--progress-template",
      "download:negi-progress:%(progress._percent_str)s",
      "--socket-timeout",
      "30",
      "--retries",
      "3",
      "-o",
      join(folder, "audio.%(ext)s"),
    ];
    if (this.config.ffmpegPath)
      args.push("--ffmpeg-location", this.config.ffmpegPath);
    let lastProgress = 0;
    await this.run([...args, "--", j.url], id, 20 * 60 * 1000, (progress) => {
      if (!this.db.open || (Date.now() - lastProgress < 500 && progress < 1))
        return;
      lastProgress = Date.now();
      this.db
        .prepare("UPDATE jobs SET progress=? WHERE id=? AND status='running'")
        .run(progress, id);
    });
    if (this.get(id).status === "cancelled") return;
    const info = JSON.parse(
      await readFile(join(folder, "audio.info.json"), "utf8"),
    ) as VideoInfo;
    const audio = (await readdir(folder)).find((f) =>
      /^audio\.(opus|m4a|mp3|ogg|flac|wav|aac|webm)$/.test(f),
    );
    if (!audio)
      throw new Error("yt-dlp did not produce a supported audio file.");
    const batch = await this.imports.createFromYoutubeDownload(
      join(folder, audio),
      { url: j.url, videoId: info.id },
    );
    const item = batch.items[0];
    if (this.get(id).status === "cancelled") {
      this.imports.rejectItem(item.id);
      return;
    }
    const metadata = guessVideoMetadata(info);
    this.imports.updateItemMetadata(item.id, metadata);
    this.db.prepare("UPDATE jobs SET payload_json=?,progress=1 WHERE id=?").run(
      JSON.stringify({
        ...j,
        ...metadata,
        stage: "review",
        message: "Audio ready. Check the metadata, then import.",
        importId: batch.id,
        itemId: item.id,
        codec: info.acodec ?? audio.split(".").pop(),
      }),
      id,
    );
  }
  private fail(id: string, error: unknown) {
    if (!this.db.open || this.get(id).status === "cancelled") return;
    this.db
      .prepare(
        "UPDATE jobs SET status='failed',error_json=?,completed_at=datetime('now') WHERE id=?",
      )
      .run(
        JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        }),
        id,
      );
  }
}
