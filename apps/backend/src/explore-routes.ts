import { handleYoutubePlayback } from './youtube-playback-routes.js';
import { youtubePreferences, youtubeHome } from './services/youtube-personalization.js';
import { z } from "zod";
import {
  acquireAlbumRequestSchema,
  catalogueIdSchema,
  catalogueSectionSchema,
  youtubeDownloadRequestSchema,
  youtubeBrowseRequestSchema,
  youtubeReviewRequestSchema,
} from "@music-os/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BackendApp } from "./app.js";
const label = z.string().trim().min(1).max(500);
const id = z.string().uuid();
export async function handleExplore(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  app: BackendApp,
  read: (r: IncomingMessage) => Promise<unknown>,
  write: (r: ServerResponse, status: number, body: unknown) => void,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/explore/")) return false;
  if (await handleYoutubePlayback(request, response, url, app.youtube.playback, read, write)) return true;
  if (request.method === 'GET' && path === '/explore/youtube/preferences') { write(response, 200, youtubePreferences(app.tasteProfile.getEffectiveProfile())); return true; }
  if (request.method === 'GET' && path === '/explore/youtube/home') { write(response, 200, await youtubeHome(app.tasteProfile.getEffectiveProfile(), request => app.youtube.browse(request), z.coerce.number().int().min(1).max(20).parse(url.searchParams.get('page') ?? 1))); return true; }
  if (request.method === "GET" && path === "/explore/cover") {
    const groupId = id.parse(url.searchParams.get("id"));
    const artwork = await app.artwork.catalogue
      .get(groupId)
      .catch(() => undefined);
    response.writeHead(artwork ? 200 : artwork === null ? 404 : 502, {
      "content-type": artwork?.mimeType ?? "text/plain",
      "cache-control": artwork
        ? "public, max-age=604800"
        : artwork === null
          ? "public, max-age=900"
          : "no-store",
    });
    response.end(artwork?.data ?? "Cover unavailable");
    return true;
  }
  if (request.method === "GET" && path === "/explore/youtube/artwork") {
    const jobId = label.parse(url.searchParams.get("id"));
    const job = app.youtube.list().find((j) => j.id === jobId);
    const videoId = job ? new URL(job.url).searchParams.get("v") : null;
    const artwork = videoId ? await app.artwork.youtube.get(videoId) : null;
    response.writeHead(artwork ? 200 : 404, {
      "content-type": artwork?.mimeType ?? "text/plain",
      "cache-control": artwork ? "private, max-age=86400" : "no-store",
    });
    response.end(artwork?.data ?? "No thumbnail");
    return true;
  }
  const catalogueFor = (value: string) => value.startsWith("apple:") ? app.appleCatalogue : app.catalogue;
  let result: unknown;
  if (request.method === "GET" && path === "/explore/artists")
    result = {
      artists: await (z.enum(["apple", "musicbrainz"]).parse(url.searchParams.get("provider") ?? "apple") === "apple"
        ? app.appleCatalogue : app.catalogue).searchArtists(
        label.parse(url.searchParams.get("q")),
      ),
    };
  else if (request.method === "GET" && path === "/explore/album-highlights")
    result = await app.albumHighlights.get(
      catalogueIdSchema.parse(url.searchParams.get("artistId")),
      label.parse(url.searchParams.get("artist")),
    );
  else if (request.method === "GET" && path === "/explore/similar-artists")
    result = await app.similarArtists.get(
      catalogueIdSchema.parse(url.searchParams.get("artistId")),
      label.parse(url.searchParams.get("artist")),
    );
  else if (request.method === "GET" && path === "/explore/artist-profile")
    result = await app.artistProfiles.get(
      catalogueIdSchema.parse(url.searchParams.get("artistId")),
      label.parse(url.searchParams.get("artist")),
    );
  else if (request.method === "GET" && path === "/explore/catalogue")
    result = await catalogueFor(catalogueIdSchema.parse(url.searchParams.get("artistId"))).browse(
      catalogueIdSchema.parse(url.searchParams.get("artistId")),
      label.parse(url.searchParams.get("artist")),
      z.coerce
        .number()
        .int()
        .min(0)
        .max(100000)
        .parse(url.searchParams.get("offset") ?? 0),
      z.enum(["newest", "oldest", "title"]).parse(url.searchParams.get("sort") ?? "newest"),
      catalogueSectionSchema.optional().parse(url.searchParams.get("section") ?? undefined),
    );
  else if (request.method === "GET" && path === "/explore/release")
    result = await catalogueFor(catalogueIdSchema.parse(url.searchParams.get("id"))).release(
      catalogueIdSchema.parse(url.searchParams.get("id")),
      label.parse(url.searchParams.get("artist")),
      url.searchParams.get("albumId") ?? undefined,
    );
  else if (request.method === "GET" && path === "/explore/albums/completeness")
    result = {
      album:
        app.library
          .listIncompleteAlbums(Number.MAX_SAFE_INTEGER)
          .find(
            (a) => a.key === label.parse(url.searchParams.get("albumId")),
          ) ?? null,
    };
  else if (request.method === "GET" && path === "/explore/albums/jobs")
    result = { jobs: app.albumAcquisitions.list() };
  else if (request.method === "POST" && path === "/explore/albums/acquire")
    result = {
      job: app.albumAcquisitions.create(
        acquireAlbumRequestSchema.parse(await read(request)),
      ),
    };
  else if (
    request.method === "POST" &&
    ["/explore/albums/cancel", "/explore/albums/retry"].includes(path)
  ) {
    const body = z.object({ id: label }).parse(await read(request));
    if (path.endsWith("cancel")) app.albumAcquisitions.cancel(body.id);
    else app.albumAcquisitions.retry(body.id);
    result = { jobs: app.albumAcquisitions.list() };
  } else if (request.method === "GET" && path === "/explore/youtube/health")
    result = await app.youtube.health();
  else if (request.method === "GET" && path === "/explore/youtube/browse")
    result = await app.youtube.browse(youtubeBrowseRequestSchema.parse({
      kind: url.searchParams.get("kind") ?? undefined,
      q: url.searchParams.get("q"),
      page: url.searchParams.get("page") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    }));
  else if (request.method === "GET" && path === "/explore/youtube/search")
    result = {
      results: await app.youtube.search(label.parse(url.searchParams.get("q"))),
    };
  else if (request.method === "GET" && path === "/explore/youtube/jobs")
    result = { jobs: app.youtube.list() };
  else if (request.method === "POST" && path === "/explore/youtube/download") {
    const body = youtubeDownloadRequestSchema.parse(await read(request));
    result = { job: app.youtube.create(body.url, body.libraryRootId) };
  } else if (request.method === "POST" && path === "/explore/youtube/import")
    result = {
      job: await app.youtube.approve(
        youtubeReviewRequestSchema.parse(await read(request)),
      ),
    };
  else if (
    request.method === "POST" &&
    ["/explore/youtube/cancel", "/explore/youtube/retry"].includes(path)
  ) {
    const body = z.object({ id: label }).parse(await read(request));
    if (path.endsWith("cancel")) app.youtube.cancel(body.id);
    else app.youtube.retry(body.id);
    result = { jobs: app.youtube.list() };
  } else {
    write(response, 404, { error: "Unknown discovery endpoint" });
    return true;
  }
  write(response, 200, result);
  return true;
}
