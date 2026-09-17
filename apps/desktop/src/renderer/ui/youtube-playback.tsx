import { useSyncExternalStore } from "react";
import type { VideoResult } from "@music-os/core";
import { exploreApi, errorMessage } from "./explore-api";

export type YoutubePlaybackMode = "audio" | "video";
export type YoutubePlaybackSnapshot = {
  video: VideoResult | null; sourceActive: boolean; takingOver: boolean; playing: boolean;
  loading: boolean; positionMs: number; durationMs: number; volumePercent: number;
  modalOpen: boolean; confirmClose: boolean; queue: VideoResult[]; queueIndex: number;
  error: string; audioOnly: boolean; mode: YoutubePlaybackMode; videoUnavailable: boolean; reopened: boolean;
};
let state: YoutubePlaybackSnapshot = { video: null, sourceActive: false, takingOver: false, playing: false, loading: false, positionMs: 0, durationMs: 0, volumePercent: 75, modalOpen: false, confirmClose: false, queue: [], queueIndex: -1, error: "", audioOnly: false, mode: "audio", videoUnavailable: false, reopened: false };
const listeners = new Set<() => void>();
let media: HTMLVideoElement | null = null;
let generation = 0;
let authorized = false;
let playPermit = -1;
let playRequest = 0;
let pendingPlay: Promise<void> | null = null;
// Keep obsolete requests too: a queued server-side pause must finish before local playback starts.
const pendingPauses = new Set<Promise<unknown>>();
let request: AbortController | null = null;
let resumeAfterModeFailure = false;
let resolvingModeWithSource = false;
let pendingSeek: { generation: number; positionMs: number } | null = null;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => state;
function update(patch: Partial<YoutubePlaybackSnapshot>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
export function useYoutubePlayback() { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }
export function useYoutubeSourceActive() { return useSyncExternalStore(subscribe, () => state.sourceActive, () => false); }

export function readYoutubeList(kind: "saved" | "recent"): VideoResult[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(`music-os:youtube:${kind}:v1`) || "[]"); return Array.isArray(value) ? value.filter((v): v is VideoResult => !!v && typeof v === "object" && /^[\w-]{11}$/.test(v.id) && typeof v.title === "string" && v.url === "https://www.youtube.com/watch?v=" + v.id).slice(0, 100) : []; } catch { return []; }
}
export function writeYoutubeList(kind: "saved" | "recent", videos: VideoResult[]) {
  try { localStorage.setItem(`music-os:youtube:${kind}:v1`, JSON.stringify(videos.slice(0, 100))); window.dispatchEvent(new Event("youtube-lists-changed")); return true; } catch { return false; }
}
async function play() {
  if (!media?.getAttribute("src") || state.loading || state.videoUnavailable) return;
  if (pendingPlay) return pendingPlay;
  const token = generation;
  const element = media;
  const playToken = ++playRequest;
  pendingPlay = (async () => {
    try {
      update({ takingOver: true, error: "" });
      // Pause first, even when a local track was resumed outside this renderer.
      const pauseRequest = exploreApi<unknown>("/playback/pause", {});
      pendingPauses.add(pauseRequest);
      let backendState: unknown;
      try { backendState = await pauseRequest; }
      finally { pendingPauses.delete(pauseRequest); }
      if (generation !== token || playRequest !== playToken || media !== element) return;
      window.dispatchEvent(new CustomEvent("youtube-playback-takeover", { detail: backendState }));
      authorized = true;
      playPermit = token;
      update({ sourceActive: true });
      await element.play();
    } catch (error) {
      if (generation === token && playRequest === playToken) { playPermit = -1; element.pause(); update({ playing: false, error: errorMessage(error) }); }
    } finally {
      if (generation === token && playRequest === playToken) update({ takingOver: false });
      if (playRequest === playToken) pendingPlay = null;
    }
  })();
  return pendingPlay;
}
async function load(video: VideoResult, queue: VideoResult[], queueIndex: number, modalOpen: boolean, options: { mode?: YoutubePlaybackMode; positionMs?: number; autoplay?: boolean; reopened?: boolean; keepCurrentSource?: boolean } = {}) {
  const mode = options.mode ?? state.mode;
  const positionMs = options.positionMs ?? 0;
  const autoplay = options.autoplay ?? true;
  resumeAfterModeFailure = autoplay;
  const keepCurrentSource = !!options.keepCurrentSource && !!media?.getAttribute("src") && !media.error;
  const wasPlaying = keepCurrentSource && state.playing;
  resolvingModeWithSource = keepCurrentSource;
  const token = ++generation;
  request?.abort(); const abort = new AbortController(); request = abort; pendingPlay = null; authorized = false; playPermit = -1; ++playRequest;
  pendingSeek = !keepCurrentSource && positionMs > 0 ? { generation: token, positionMs } : null;
  if (!keepCurrentSource) { media?.pause(); media?.removeAttribute("src"); media?.load(); }
  update({ video, queue, queueIndex, modalOpen, confirmClose: false, loading: true, playing: wasPlaying, takingOver: false, positionMs, durationMs: (video.duration || 0) * 1000, error: "", audioOnly: mode === "audio", mode, videoUnavailable: false, reopened: options.reopened ?? false });
  writeYoutubeList("recent", [video, ...readYoutubeList("recent").filter(v => v.id !== video.id)]);
  try {
    const result = await exploreApi<{ src: string; video: VideoResult; audioOnly?: boolean }>("/explore/youtube/playback", { url: video.url, mode }, abort.signal);
    if (generation !== token || !media) return;
    // Never assign a remote extractor URL to the renderer; playback uses the local stream proxy.
    if (!result.src.startsWith("/explore/youtube/stream?")) throw new Error("The video source could not be opened.");
    if (mode === "video" && result.audioOnly) throw new Error("Video is unavailable for this item. Switch to Audio to keep listening, or choose another video.");
    const resumePositionMs = keepCurrentSource ? media.currentTime * 1000 : positionMs;
    pendingSeek = resumePositionMs > 0 ? { generation: token, positionMs: resumePositionMs } : null;
    resolvingModeWithSource = false;
    media.pause();
    media.addEventListener("loadedmetadata", restorePosition, { once: true, signal: abort.signal });
    media.src = "http://127.0.0.1:47831" + result.src;
    media.volume = state.volumePercent / 100;
    update({ video: { ...video, ...result.video }, loading: false, positionMs: resumePositionMs, audioOnly: !!result.audioOnly });
    if (autoplay && resumeAfterModeFailure) await play();
  } catch (error) { if (generation === token && !abort.signal.aborted) { const stoppedAt = keepCurrentSource && media ? media.currentTime * 1000 : positionMs; resolvingModeWithSource = false; media?.pause(); update({ positionMs: stoppedAt, loading: false, playing: false, videoUnavailable: mode === "video", error: errorMessage(error) }); } }
}
function restorePosition() {
  if (!media || !pendingSeek || pendingSeek.generation !== generation || media.readyState < 1) return;
  const position = pendingSeek.positionMs;
  pendingSeek = null;
  const durationMs = Number.isFinite(media.duration) ? media.duration * 1000 : position;
  media.currentTime = Math.min(position, durationMs) / 1000;
  update({ positionMs: Math.min(position, durationMs) });
}
export const youtubePlayback = {
  subscribe, getSnapshot,
  attach(element: HTMLVideoElement | null) { media = element; if (element) element.volume = state.volumePercent / 100; },
  open(video: VideoResult) {
    if (state.video?.id === video.id && media?.getAttribute("src")) { update({ modalOpen: true, confirmClose: false, reopened: true }); return; }
    void load(video, [video], 0, true);
  },
  reopen() { if (state.video) update({ modalOpen: true, confirmClose: false, reopened: true }); },
  setMode(mode: YoutubePlaybackMode) {
    if (mode === state.mode || !state.video) return;
    const autoplay = state.playing || state.takingOver || ((state.videoUnavailable || state.loading) && resumeAfterModeFailure);
    const positionMs = pendingSeek?.positionMs ?? state.positionMs;
    void load(state.video, state.queue, state.queueIndex, state.modalOpen, { mode, positionMs, autoplay, reopened: state.reopened, keepCurrentSource: true });
  },
  requestClose() { if (state.reopened) { update({ modalOpen: false, confirmClose: false }); return; } if (!state.playing && (state.loading || state.takingOver)) { this.release(); return; } update(state.playing ? { confirmClose: true } : { modalOpen: false, confirmClose: false }); },
  keepListening() { update({ modalOpen: false, confirmClose: false }); },
  cancelClose() { update({ confirmClose: false }); },
  pause() { resumeAfterModeFailure = false; ++playRequest; pendingPlay = null; playPermit = -1; media?.pause(); update({ playing: false, takingOver: false }); },
  play,
  toggle() { if (state.playing) this.pause(); else void play(); },
  seek(ms: number) { if (media && Number.isFinite(ms)) { const target = Math.max(0, Math.min(ms, state.durationMs || ms)); media.currentTime = target / 1000; update({ positionMs: target }); } },
  setVolume(percent: number) { if (!Number.isFinite(percent)) return; const volumePercent = Math.max(0, Math.min(100, percent)); if (media) { media.volume = volumePercent / 100; media.muted = false; } update({ volumePercent }); },
  next() { const index = state.queueIndex + 1; const video = state.queue[index]; if (video) void load(video, state.queue, index, state.modalOpen); },
  previous() { if (state.positionMs > 3000 || state.queueIndex <= 0) this.seek(0); else this.playIndex(state.queueIndex - 1); },
  playIndex(index: number) { const video = state.queue[index]; if (video) void load(video, state.queue, index, state.modalOpen); },
  enqueue(video: VideoResult, position: "up_next" | "end") { if (!state.sourceActive) return; const queue = [...state.queue]; queue.splice(position === "up_next" ? state.queueIndex + 1 : queue.length, 0, video); update({ queue }); },
  moveQueue(from: number, to: number) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || to < 0 || from >= state.queue.length || to >= state.queue.length) return;
    const queue = [...state.queue];
    const [moved] = queue.splice(from, 1);
    queue.splice(to, 0, moved);
    // Identify the current occurrence by its index: duplicate videos are valid queue entries.
    let queueIndex = state.queueIndex;
    if (queueIndex === from) queueIndex = to;
    else if (from < queueIndex && to >= queueIndex) --queueIndex;
    else if (from > queueIndex && to <= queueIndex) ++queueIndex;
    update({ queue, queueIndex });
  },
  removeQueue(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) return;
    const queue = state.queue.filter((_, i) => i !== index);
    if (index !== state.queueIndex) {
      update({ queue, queueIndex: index < state.queueIndex ? state.queueIndex - 1 : state.queueIndex });
      return;
    }
    const next = queue[index];
    if (next) {
      const autoplay = state.playing || state.takingOver || (state.loading && resumeAfterModeFailure);
      void load(next, queue, index, state.modalOpen, { autoplay });
    } else {
      this.release();
      update({ video: null, queue: [], queueIndex: -1, positionMs: 0, durationMs: 0, error: "", videoUnavailable: false, reopened: false });
    }
  },
  retry() { if (state.video) void load(state.video, state.queue, state.queueIndex, state.modalOpen, { positionMs: state.positionMs, autoplay: state.playing || resumeAfterModeFailure, reopened: state.reopened }); },
  release() { resolvingModeWithSource = false; pendingSeek = null; resumeAfterModeFailure = false; ++generation; request?.abort(); authorized = false; playPermit = -1; ++playRequest; pendingPlay = null; media?.pause(); media?.removeAttribute("src"); media?.load(); update({ sourceActive: false, takingOver: false, playing: false, loading: false, modalOpen: false, confirmClose: false }); },
  async releaseAndWait() {
    const settling = [...pendingPauses, ...(pendingPlay ? [pendingPlay] : [])];
    this.release();
    await Promise.allSettled(settling);
  },
  onPlay() {
    if (!media || media.paused || state.loading) return;
    if (state.videoUnavailable) { media.pause(); return; }
    if (playPermit === generation) { playPermit = -1; return; }
    media.pause(); void play();
  },
  onPlaying() { if (!media || media.paused || state.loading) return; if (!authorized) { media?.pause(); return; } update({ playing: true, sourceActive: true, error: "" }); },
  onPause() { if (media?.paused) { if (resolvingModeWithSource && state.playing) resumeAfterModeFailure = false; update({ playing: false }); } },
  onTime() { if (media?.getAttribute("src") && !pendingSeek && (!state.loading || resolvingModeWithSource) && !state.videoUnavailable) update({ positionMs: media.currentTime * 1000 }); },
  onDuration() { restorePosition(); if (media && Number.isFinite(media.duration)) update({ durationMs: media.duration * 1000 }); },
  onVolume() { if (media) update({ volumePercent: media.muted ? 0 : Math.round(media.volume * 100) }); },
  onEnded() { if (!media?.ended || state.loading) return; update({ playing: false }); this.next(); },
  onError() { if (media?.error && media.getAttribute("src")) { media.pause(); update({ playing: false, loading: false, videoUnavailable: state.mode === "video", error: state.mode === "video" ? "Video is unavailable for this item. Switch to Audio to keep listening, or choose another video." : "This audio could not be played. Retry to refresh its stream, or open it on YouTube." }); } },
};
