import type { LyricsResponse, PlaybackStateResponse, VisualizerFrameResponse } from "@music-os/core";

/** Timestamp lookup is right-continuous, including seeks back into an intro. */
export function activeLyricIndex(lines: LyricsResponse["lines"], positionMs: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].timeMs <= positionMs) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

export function lyricsPositionMs(
  playback: PlaybackStateResponse,
  elapsedMs: number,
  frame: VisualizerFrameResponse | null,
  frameAgeMs: number,
): number {
  // The app already ticks its playback state. Interpolate only since that
  // snapshot; cap extrapolation if the parent stops reporting progress.
  const advancing = playback.status === "playing" && !playback.albumTransition;
  let position = playback.positionMs + (advancing ? Math.min(500, Math.max(0, elapsedMs)) : 0);
  if (advancing && frame?.fileId === playback.currentFileId && frame.status === "playing" &&
      frameAgeMs >= 0 && frameAgeMs <= 500 && Math.abs(frame.positionMs - position) < 1500) {
    position = frame.positionMs + frameAgeMs;
  }
  return Math.max(0, Math.min(playback.durationMs ?? Infinity, position));
}

/** Untimed lyrics travel the full scroll range uniformly over the song. */
export function plainLyricsScrollTop(positionMs: number, durationMs: number | null, scrollHeight: number, clientHeight: number): number {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(positionMs)) return 0;
  return Math.max(0, scrollHeight - clientHeight) * Math.max(0, Math.min(1, positionMs / durationMs));
}
