import type { PlaybackStateResponse } from "@music-os/core";

export function shouldRefreshPlaybackHistory(
  current: PlaybackStateResponse | null,
  next: PlaybackStateResponse
): boolean {
  if (!current?.currentFileId) {
    return false;
  }
  return current.currentFileId !== next.currentFileId ||
    (current.status !== "stopped" && next.status === "stopped") ||
    (current.status === "playing" && next.status === "playing" &&
      mergePlaybackState(current, next).positionMs < current.positionMs);
}

export function mergePlaybackState(
  current: PlaybackStateResponse,
  next: PlaybackStateResponse
): PlaybackStateResponse {
  const samePlayingFile =
    current.status === "playing" &&
    next.status === "playing" &&
    current.currentFileId != null &&
    current.currentFileId === next.currentFileId;

  if (!samePlayingFile) {
    return next;
  }

  const loopedToStart =
    current.durationMs != null &&
    current.durationMs > 0 &&
    current.positionMs >= current.durationMs - 3000 &&
    next.positionMs <= 2500 &&
    next.positionMs < current.positionMs;

  if (loopedToStart) {
    return next;
  }

  return {
    ...next,
    positionMs: Math.max(current.positionMs, next.positionMs)
  };
}
