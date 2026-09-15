import assert from "node:assert/strict";
import type { PlaybackStateResponse, VisualizerFrameResponse } from "@music-os/core";
import { activeLyricIndex, lyricsPositionMs, plainLyricsScrollTop } from "../renderer/lyrics-state.js";
import { fetchLyrics } from "../renderer/lyrics-resource.js";

const lines = [{ timeMs: 1000, text: "Opening line" }, { timeMs: 6000, text: "Next line" }, { timeMs: 12000, text: "" }];
assert.equal(activeLyricIndex(lines, 0), -1);
assert.equal(activeLyricIndex(lines, 1000), 0);
assert.equal(activeLyricIndex(lines, 5999), 0);
assert.equal(activeLyricIndex(lines, 6000), 1);
assert.equal(activeLyricIndex(lines, 13000), 2);
assert.equal(activeLyricIndex(lines, 500), -1, "backward seek returns to the intro");
assert.equal(activeLyricIndex([], 99999), -1);
const playback = {
  status: "playing", currentFileId: "song", currentPath: null, currentDisplayName: "Song",
  positionMs: 5000, durationMs: 180000, queue: ["song"], queueIndex: 0,
  repeatMode: "none", volumePercent: 50, error: null,
} satisfies PlaybackStateResponse;
const frame = { fileId: "song", status: "playing", positionMs: 5100 } as VisualizerFrameResponse;
assert.equal(lyricsPositionMs(playback, 100, null, Infinity), 5100);
assert.equal(lyricsPositionMs(playback, 10000, null, Infinity), 5500, "stale state must not extrapolate forever");
assert.equal(lyricsPositionMs(playback, 100, frame, 100), 5200, "fresh audio sample wins");
assert.equal(lyricsPositionMs(playback, 100, frame, -100), 5100, "ignore cross-clock timestamps");
assert.equal(lyricsPositionMs(playback, 100, frame, 1000), 5100, "ignore stale audio samples");
assert.equal(lyricsPositionMs(playback, 100, { ...frame, fileId: "other" }, 100), 5100);
assert.equal(lyricsPositionMs({ ...playback, positionMs: 30000 }, 100, frame, 100), 30100, "old frame cannot undo a seek");
assert.equal(lyricsPositionMs({ ...playback, status: "paused" }, 100, frame, 100), 5000, "paused state owns position");
assert.equal(lyricsPositionMs({ ...playback, status: "error" }, 100, frame, 100), 5000);
assert.equal(lyricsPositionMs({ ...playback, positionMs: 179950 }, 100, null, Infinity), 180000);
// Proportional travel reaches the bottom at the end, and follows backward seeks.
assert.equal(plainLyricsScrollTop(0, 200000, 1500, 300), 0);
assert.equal(plainLyricsScrollTop(50000, 200000, 1500, 300), 300);
assert.equal(plainLyricsScrollTop(100000, 200000, 1500, 300), 600);
assert.equal(plainLyricsScrollTop(200000, 200000, 1500, 300), 1200);
assert.equal(plainLyricsScrollTop(50000, 200000, 1500, 300), 300);
assert.equal(plainLyricsScrollTop(300000, 200000, 1500, 300), 1200);
assert.equal(plainLyricsScrollTop(-100, 200000, 1500, 300), 0);
assert.equal(plainLyricsScrollTop(100000, null, 1500, 300), 0);
assert.equal(plainLyricsScrollTop(100000, 0, 1500, 300), 0);
assert.equal(plainLyricsScrollTop(100000, 200000, 200, 300), 0);
assert.equal(plainLyricsScrollTop(100000, 200000, 1800, 300), 750, "rewrapping adjusts the travel distance");
assert.equal(plainLyricsScrollTop(100000, Infinity, 1500, 300), 0);
assert.equal(plainLyricsScrollTop(NaN, 200000, 1500, 300), 0);

// Route activation failures must not be presented as a user's connection issue.
const originalFetch = globalThis.fetch;
const signal = new AbortController().signal;
try {
  globalThis.fetch = async () => Response.json({ error: "not_found" }, { status: 404 });
  await assert.rejects(fetchLyrics("song", signal), { message: "backend_outdated" });
  globalThis.fetch = async () => Response.json({ error: "File not found" }, { status: 404 });
  await assert.rejects(fetchLyrics("song", signal), { message: "file_missing" });
  globalThis.fetch = async () => Response.json({ error: "Unavailable" }, { status: 503 });
  await assert.rejects(fetchLyrics("song", signal), { message: "connection" });
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(fetchLyrics("song", signal), { message: "Failed to fetch" });
  const response = {
    fileId: "song/one", status: "synced", plainLyrics: null, lines,
    provider: "lrclib", cached: true, fetchedAt: new Date().toISOString(),
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:47831/library/files/song%2Fone/lyrics");
    assert.equal(options?.signal, signal);
    return Response.json(response);
  };
  assert.deepEqual(await fetchLyrics("song/one", signal), response);
  globalThis.fetch = async () => Response.json({ ...response, fileId: "different" });
  await assert.rejects(fetchLyrics("song", signal), { message: "Lyrics belong to another track" });
  globalThis.fetch = async () => Response.json({ ...response, status: "invalid" });
  await assert.rejects(fetchLyrics("song/one", signal));
} finally {
  globalThis.fetch = originalFetch;
}
console.log(JSON.stringify({ ok: true }));
