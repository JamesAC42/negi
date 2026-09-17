import { youtubeBrowseRequestSchema, type YoutubeBrowseRequest, type YoutubeBrowsePage, type VideoResult, type YoutubeChannelResult } from "@music-os/core";

export const YOUTUBE_PAGE_SIZE = 24;
export const YOUTUBE_MAX_PAGE = 20;
const channelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

function sourceUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Enter a valid YouTube link."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port ||
      !["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(url.hostname)) {
    throw new Error("Only YouTube links are supported.");
  }
  return url;
}

export function youtubeChannelUrl(input: string): string {
  input = input.trim();
  if (channelIdPattern.test(input)) return `https://www.youtube.com/channel/${input}/videos`;
  if (/^@[\p{L}\p{N}_.\-·]{1,100}$/u.test(input)) return `https://www.youtube.com/${encodeURIComponent(input).replace(/^%40/, "@")}/videos`;
  const url = sourceUrl(input);
  if (url.hostname === "youtu.be") throw new Error("Enter a YouTube channel link or handle.");
  let path: string;
  try { path = decodeURIComponent(url.pathname).replace(/\/$/, ""); } catch { throw new Error("Invalid channel link."); }
  const match = /^(\/@[\p{L}\p{N}_.\-·]{1,100}|\/channel\/UC[A-Za-z0-9_-]{22}|\/(?:c|user)\/[\p{L}\p{N}_.-]{1,100})(?:\/(?:videos|featured|shorts|streams))?$/u.exec(path);
  if (!match) throw new Error("Enter a YouTube channel link or handle.");
  return "https://www.youtube.com" + encodeURI(match[1]) + "/videos";
}

export function youtubePlaylistUrl(input: string): string {
  const url = sourceUrl(input);
  const id = url.searchParams.get("list");
  if (url.hostname === "youtu.be" || !["/playlist", "/watch"].includes(url.pathname) || !id || !/^[A-Za-z0-9_-]{10,100}$/.test(id)) {
    throw new Error("Enter a YouTube playlist link.");
  }
  return "https://www.youtube.com/playlist?list=" + id;
}

export function youtubeBrowsePlan(raw: YoutubeBrowseRequest) {
  const request = youtubeBrowseRequestSchema.parse(raw);
  const start = (request.page - 1) * YOUTUBE_PAGE_SIZE + 1;
  const end = request.page * YOUTUBE_PAGE_SIZE + 1;
  let input: string;
  let source: string;
  let direct = false;
  if (request.kind === "channel") source = input = youtubeChannelUrl(request.q);
  else if (request.kind === "playlist") source = input = youtubePlaylistUrl(request.q);
  else if (/^https?:\/\//i.test(request.q)) {
    const url = sourceUrl(request.q);
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(?:shorts|embed|live)\/([^/]+)$/.exec(url.pathname)?.[1];
    if (!id || !videoIdPattern.test(id)) throw new Error("Choose channel or playlist browsing for this link.");
    source = input = "https://www.youtube.com/watch?v=" + id;
    direct = true;
    if (request.page !== 1) throw new Error("Single videos have only one page.");
  } else {
    input = `ytsearch${end}:${request.q}`;
    source = "https://www.youtube.com/results?search_query=" + encodeURIComponent(request.q);
  }
  return {
    request, direct, sourceUrl: source,
    key: JSON.stringify([request.kind, source, request.page, request.kind === "search" ? request.sort : "source"]),
    args: ["--dump-single-json", "--skip-download", "--flat-playlist", "--socket-timeout", "10", "--extractor-retries", "1", "--retries", "1",
      ...(direct ? [] : ["--yes-playlist", "--playlist-items", `${start}:${end}`, "--extractor-args", "youtubetab:approximate_date"]), "--", input],
  };
}

export interface YoutubeVideoInfo {
  id?: string; title?: string; channel?: string; uploader?: string; channel_id?: string; channel_url?: string;
  description?: string; duration?: number; thumbnail?: string; thumbnails?: {url: string; width?: number}[];
  view_count?: number; upload_date?: string; timestamp?: number; live_status?: string; entries?: (YoutubeVideoInfo | null)[];
}

export function youtubeVideoResult(v: YoutubeVideoInfo, approximateDate: boolean): VideoResult | null {
  if (!v.id || !videoIdPattern.test(v.id)) return null;
  const channelId = v.channel_id && channelIdPattern.test(v.channel_id) ? v.channel_id : undefined;
  let channelUrl = channelId ? `https://www.youtube.com/channel/${channelId}/videos` : undefined;
  if (!channelUrl && v.channel_url) { try { channelUrl = youtubeChannelUrl(v.channel_url); } catch { /* Untrusted provider URL. */ } }
  const timestamp = typeof v.timestamp === "number" ? new Date(v.timestamp * 1000) : null;
  const thumbnail = [v.thumbnail, ...(v.thumbnails ?? []).filter(t => (t.width ?? 0) >= 320).map(t => t.url)].find(value => value && /^https:\/\//.test(value));
  return {
    id: v.id, url: "https://www.youtube.com/watch?v=" + v.id, title: v.title || v.id, channel: v.channel || v.uploader || "",
    channelId, channelUrl, description: v.description?.slice(0, 2000),
    duration: Number.isFinite(v.duration) && v.duration! >= 0 ? v.duration! : null,
    thumbnail: thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    viewCount: Number.isFinite(v.view_count) && v.view_count! >= 0 ? v.view_count! : null,
    uploadDate: v.upload_date && /^\d{8}$/.test(v.upload_date) ? `${v.upload_date.slice(0,4)}-${v.upload_date.slice(4,6)}-${v.upload_date.slice(6,8)}` : timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toISOString().slice(0,10) : null,
    approximateDate, liveStatus: v.live_status ?? null,
  };
}

/** Only surface strong channel-name matches with provider-sourced channel identities. */
export function youtubeMatchingChannels(query: string, results: VideoResult[]): YoutubeChannelResult[] {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/(?:\s*[-–]\s*topic|\s+official(?:\s+channel)?)$/i, "").replace(/[^\p{L}\p{N}]/gu, "");
  const term = normalize(query);
  if (!term || /^https?:/i.test(query)) return [];
  const matches = new Map<string, YoutubeChannelResult>();
  for (const video of results) {
    if (!video.channelId || !video.channelUrl || normalize(video.channel) !== term) continue;
    const match = matches.get(video.channelId);
    if (match) match.matchedVideos++;
    else matches.set(video.channelId, { id: video.channelId, name: video.channel, url: video.channelUrl, matchedVideos: 1 });
  }
  return [...matches.values()].sort((a, b) => b.matchedVideos - a.matchedVideos).slice(0, 4);
}

/** Bounded, read-only metadata browsing; execution is injected for isolated tests. */
export class YoutubeBrowser {
  private cache = new Map<string, {until: number; page: YoutubeBrowsePage}>();
  private pending = new Map<string, Promise<YoutubeBrowsePage>>();
  constructor(private run: (args: string[]) => Promise<string>, private now = Date.now) {}
  find(url: string): VideoResult | undefined {
    for (const entry of this.cache.values()) { const video = entry.page.results.find(v => v.url === url); if (video) return video; }
    return undefined;
  }
  async browse(request: YoutubeBrowseRequest): Promise<YoutubeBrowsePage> {
    const plan = youtubeBrowsePlan(request);
    const cached = this.cache.get(plan.key);
    if (cached && cached.until > this.now()) return cached.page;
    const pending = this.pending.get(plan.key);
    if (pending) return pending;
    if (this.pending.size >= 6) throw new Error("YouTube is busy. Try again in a moment.");
    const work = this.fetch(plan).then(page => {
      if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(plan.key, {until: this.now() + 5 * 60_000, page});
      return page;
    }).finally(() => this.pending.delete(plan.key));
    this.pending.set(plan.key, work);
    return work;
  }
  private async fetch(plan: ReturnType<typeof youtubeBrowsePlan>): Promise<YoutubeBrowsePage> {
    const info = JSON.parse(await this.run(plan.args)) as YoutubeVideoInfo;
    const entries = info.entries ?? [info];
    const seen = new Set<string>();
    const results = entries.slice(0, YOUTUBE_PAGE_SIZE).flatMap(entry => {
      const video = entry && youtubeVideoResult(entry, !plan.direct);
      if (!video || seen.has(video.id)) return [];
      seen.add(video.id);
      return [video];
    });
    // YouTube removed upload-date search ordering. This orders only the current result page.
    if (plan.request.kind === "search" && plan.request.sort === "date") results.sort((a, b) => (b.uploadDate ?? "").localeCompare(a.uploadDate ?? ""));
    return {results, channels: plan.request.kind === "search" ? youtubeMatchingChannels(plan.request.q, results) : [], title: plan.request.kind === "search" ? plan.request.q : info.title || plan.request.q,
      nextPage: !plan.direct && entries.length > YOUTUBE_PAGE_SIZE && plan.request.page < YOUTUBE_MAX_PAGE ? plan.request.page + 1 : null,
      sourceUrl: plan.sourceUrl};
  }
}
