import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { VideoResult } from "@music-os/core";
import { youtubeVideoResult } from "./youtube-browse.js";
import { youtubeUrl } from "./youtube-service.js";
type Info = { channel_id?: string; channel_url?: string; description?: string; id: string; url?: string; acodec?: string; vcodec?: string; title?: string; channel?: string; uploader?: string; duration?: number; view_count?: number; upload_date?: string; live_status?: string; http_headers?: Record<string, string> };
type Stream = { url: string; expires: number; headers: Record<string, string> };
export function youtubeMediaUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.port || url.username || url.password || !/^[a-z0-9.-]+\.googlevideo\.com$/.test(url.hostname)) throw new Error("Unsupported YouTube media address.");
  return url;
}
export function validateYoutubeCookies(cookies: string): string {
  if (Buffer.byteLength(cookies) > 1024 * 1024 || cookies.includes("\0")) throw new Error("Cookie file must be smaller than 1 MB.");
  const lines = cookies.replace(/\r\n/g, "\n").trim().split("\n");
  if (!/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)$/.test(lines[0] ?? "")) throw new Error("Use a Netscape-format cookies.txt file.");
  let count = 0;
  for (const raw of lines.slice(1)) {
    if (!raw.trim() || (raw.startsWith("#") && !raw.startsWith("#HttpOnly_"))) continue;
    const fields = raw.replace(/^#HttpOnly_/, "").split("\t");
    const domain = fields[0]?.replace(/^\./, "").toLowerCase();
    if (fields.length !== 7 || !domain || !/^(?:[a-z0-9-]+\.)*(?:youtube\.com|google\.com)$/.test(domain) || !/^(TRUE|FALSE)$/.test(fields[1]) || !fields[2].startsWith("/") || !/^(TRUE|FALSE)$/.test(fields[3]) || !/^\d+$/.test(fields[4]) || !fields[5]) throw new Error("Upload only valid YouTube or Google cookies in Netscape format.");
    count++;
  }
  if (!count) throw new Error("The cookie file contains no YouTube or Google cookies.");
  return lines.join("\n") + "\n";
}
export class YoutubePlaybackService {
  private streams = new Map<string, Stream>();
  private controllers = new Set<AbortController>();
  private cookiePath: string;
  private pending = 0;
  private sessionRevision = 0;
  constructor(private directory: string, private extract: (args: string[]) => Promise<string>, private fetchMedia: typeof fetch = fetch) { this.cookiePath = join(directory, "session.cookies.txt"); }
  async session() { return { configured: await access(this.cookiePath).then(() => true, () => false) }; }
  async saveSession(cookies: string) {
    const content = validateYoutubeCookies(cookies);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = this.cookiePath + "." + randomBytes(12).toString("hex");
    try { await writeFile(temporary, content, { mode: 0o600, flag: "wx" }); await chmod(temporary, 0o600); await rename(temporary, this.cookiePath); }
    finally { await unlink(temporary).catch(() => {}); }
    this.sessionRevision++; this.close();
    return { configured: true };
  }
  async removeSession() { this.sessionRevision++; this.close(); await unlink(this.cookiePath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); this.streams.clear(); return { configured: false }; }
  close() { for (const controller of this.controllers) controller.abort(); this.streams.clear(); }
  async resolve(input: string, mode: "audio" | "video" = "audio"): Promise<{ src: string; video: VideoResult; audioOnly: boolean; expiresAt: number }> {
    const canonical = youtubeUrl(input);
    if (this.pending >= 4) throw new Error("Several videos are loading. Try again in a moment.");
    this.pending++;
    let info: Info;
    const revision = this.sessionRevision;
    let cookieSnapshot: string | undefined;
    try {
      const contents = await readFile(this.cookiePath, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
      if (contents !== null) {
        // yt-dlp rewrites its cookie jar on exit. A private snapshot prevents an
        // in-flight extraction from recreating a disconnected account session.
        cookieSnapshot = join(this.directory, ".playback-" + randomBytes(12).toString("hex") + ".cookies.txt");
        await writeFile(cookieSnapshot, contents, { mode: 0o600, flag: "wx" });
      }
      const cookies = cookieSnapshot ? ["--cookies", cookieSnapshot] : [];
      const format = mode === "video" ? "best[ext=mp4][protocol=https][vcodec!=none][acodec!=none]/best[protocol=https][vcodec!=none][acodec!=none]" : "bestaudio[ext=m4a][protocol=https]/bestaudio[protocol=https]/best[ext=mp4][protocol=https]/best[protocol=https]";
      info = JSON.parse(await this.extract(["--dump-single-json", "--skip-download", "--no-playlist", "--no-warnings", "--socket-timeout", "15", "--retries", "1", "-f", format, ...cookies, "--", canonical]));
    } catch { throw new Error(mode === "video" ? "Video is unavailable for this item. Switch to Audio to keep listening, or choose another video." : "YouTube could not provide playback. Try connecting a YouTube cookie file or open this video on YouTube."); }
    finally { this.pending--; if (cookieSnapshot) await unlink(cookieSnapshot).catch(() => {}); }
    if (revision !== this.sessionRevision) throw new Error('YouTube session changed. Open the video again.');
    if (info.id !== new URL(canonical).searchParams.get("v") || !info.url || info.acodec === "none") throw new Error("YouTube did not provide a playable media stream.");
    if (mode === "video" && (!info.vcodec || info.vcodec === "none")) throw new Error("Video is unavailable for this item. Switch to Audio to keep listening, or choose another video.");
    const media = youtubeMediaUrl(info.url);
    const now = Date.now();
    const remoteExpiry = Number(media.searchParams.get("expire")) * 1000;
    const expiresAt = Math.min(now + 5 * 60 * 60_000, remoteExpiry > now ? remoteExpiry - 30_000 : now + 60 * 60_000);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(info.http_headers ?? {})) if (["user-agent", "referer", "origin"].includes(key.toLowerCase()) && typeof value === "string" && !/[\r\n]/.test(value)) headers[key.toLowerCase()] = value;
    for (const [key, stream] of this.streams) if (stream.expires <= now) this.streams.delete(key);
    while (this.streams.size >= 64) this.streams.delete(this.streams.keys().next().value!);
    const token = randomBytes(24).toString("base64url");
    this.streams.set(token, { url: media.href, expires: expiresAt, headers });
    return { src: "/explore/youtube/stream?token=" + token, audioOnly: info.vcodec === "none", expiresAt, video: youtubeVideoResult(info, false)! };
  }
  async stream(token: string, request: IncomingMessage, response: ServerResponse) {
    const source = this.streams.get(token);
    if (!source || source.expires <= Date.now()) { response.writeHead(410); response.end("Reload this video to continue playback."); return; }
    const range = request.headers.range;
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) { response.writeHead(416); response.end(); return; }
    const controller = new AbortController(); this.controllers.add(controller);
    const abort = () => controller.abort(); response.once("close", abort);
    const timeout = setTimeout(abort, 30_000);
    try {
      let address = source.url; let upstream: Response | undefined;
      for (let redirects = 0; redirects <= 3; redirects++) {
        upstream = await this.fetchMedia(youtubeMediaUrl(address), { method: request.method === "HEAD" ? "HEAD" : "GET", headers: { ...source.headers, ...(range ? { Range: range } : {}) }, signal: controller.signal, redirect: "manual" });
        if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
        const location = upstream.headers.get("location"); await upstream.body?.cancel();
        if (!location || redirects === 3) throw new Error("Media redirect failed");
        address = youtubeMediaUrl(new URL(location, address).href).href;
      }
      clearTimeout(timeout);
      if (!upstream || ![200, 206, 416].includes(upstream.status)) throw new Error("Media unavailable");
      const headers: Record<string, string> = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) { const value = upstream.headers.get(name); if (value) headers[name] = value; }
      response.writeHead(upstream.status, headers);
      if (request.method === "HEAD" || !upstream.body) response.end();
      else await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream<Uint8Array>), response);
    } catch { if (!response.destroyed) { if (!response.headersSent) { response.writeHead(502); response.end("YouTube playback expired or is unavailable. Reload the video."); } else response.destroy(); } }
    finally { clearTimeout(timeout); response.off("close", abort); this.controllers.delete(controller); controller.abort(); }
  }
}