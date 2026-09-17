import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { YoutubePlaybackService } from "./services/youtube-playback-service.js";
export async function handleYoutubePlayback(request: IncomingMessage, response: ServerResponse, url: URL, service: YoutubePlaybackService, read: (r: IncomingMessage) => Promise<unknown>, write: (r: ServerResponse, status: number, body: unknown) => void): Promise<boolean> {
  const path = url.pathname;
  if ((request.method === "GET" || request.method === "HEAD") && path === "/explore/youtube/stream") { await service.stream(url.searchParams.get("token") ?? "", request, response); return true; }
  if (request.method === "POST" && path === "/explore/youtube/playback") {
    const body = z.object({ url: z.string().min(1).max(2048), mode: z.enum(["audio", "video"]).default("audio") }).parse(await read(request));
    write(response, 200, await service.resolve(body.url, body.mode)); return true;
  }
  if (path === "/explore/youtube/session") {
    response.setHeader("cache-control", "no-store");
    if (request.method === "GET") write(response, 200, await service.session());
    else if (request.method === "POST") { const body = z.object({ cookies: z.string().min(1).max(1024 * 1024) }).parse(await read(request)); write(response, 200, await service.saveSession(body.cookies)); }
    else if (request.method === "DELETE") write(response, 200, await service.removeSession());
    else return false;
    return true;
  }
  return false;
}