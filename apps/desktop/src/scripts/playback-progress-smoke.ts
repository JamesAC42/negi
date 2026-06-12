import { mergePlaybackState } from "../renderer/ui/App.js";
import type { PlaybackStateResponse } from "@music-os/core";

const current: PlaybackStateResponse = {
  status: "playing",
  currentFileId: "file-1",
  currentPath: "/music/file-1.flac",
  currentDisplayName: "Artist - Track",
  positionMs: 12_000,
  durationMs: 180_000,
  queue: ["file-1"],
  queueIndex: 0,
  volumePercent: 100,
  error: null
};

const staleBackendPoll: PlaybackStateResponse = {
  ...current,
  positionMs: 0
};

const merged = mergePlaybackState(current, staleBackendPoll);
assert(merged.positionMs === 12_000, `expected stale poll not to reset position, got ${merged.positionMs}`);

const freshBackendPoll: PlaybackStateResponse = {
  ...current,
  positionMs: 14_000
};
assert(
  mergePlaybackState(current, freshBackendPoll).positionMs === 14_000,
  "expected newer backend position to win"
);

const nextTrack: PlaybackStateResponse = {
  ...current,
  currentFileId: "file-2",
  currentPath: "/music/file-2.flac",
  positionMs: 0
};
assert(mergePlaybackState(current, nextTrack).positionMs === 0, "expected track changes to reset position");

console.log(JSON.stringify({ ok: true }, null, 2));

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
