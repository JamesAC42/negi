import assert from "node:assert/strict";
import type { LibraryFilesResponse } from "@music-os/core";
import type { MpvIpcEvent } from "../services/mpv-ipc.js";
import type { PlaybackHistoryRecorder } from "../services/playback-history-service.js";
import { PlaybackService } from "../services/playback-service.js";
type Ended = Parameters<PlaybackHistoryRecorder["recordEnded"]>[0];

// Only the player boundary is replaced; never starts mpv or touches the live library.
function fixture(durationMs: number | null = 180_000) {
  const ended: Ended[] = [];
  let loads = 0;
  const playback = new PlaybackService(
    { host: "127.0.0.1", port: 0, databasePath: ":memory:", mpvPath: "fake-mpv" },
    { recordStarted() {}, recordEnded(input) { ended.push(input); } }
  );
  const driver = playback as unknown as {
    ensureProcess(): Promise<void>;
    sendMpvCommand(command: unknown[]): Promise<unknown>;
    handleMpvEvent(event: MpvIpcEvent, generation: number): void;
    processGeneration: number;
    operationChain: Promise<void>;
    positionUpdatedAt: number | null;
  };
  driver.ensureProcess = async () => {};
  driver.sendMpvCommand = async (command) => { if (command[0] === "loadfile") loads++; return null; };
  return {
    playback, ended, driver, loads: () => loads,
    start: () => playback.playQueue([file("a", durationMs), file("b", durationMs), file("c", durationMs)], 0),
    event(event: MpvIpcEvent) { driver.handleMpvEvent(event, driver.processGeneration); },
    flush: () => driver.operationChain
  };
}
for (const reason of ["error", 4]) {
  const f = fixture();
  try {
    await f.start();
    f.event({ event: "end-file", reason, error: "loading failed" });
    f.event({ event: "idle" });
    await f.flush();
    const state = f.playback.getSnapshot();
    assert.equal(state.status, "error");
    assert.equal(state.currentFileId, "a");
    assert.equal(state.queueIndex, 0);
    assert.deepEqual(state.queue, ["a", "b", "c"]);
    assert.ok(state.error);
    assert.equal(f.loads(), 1, "failure must not cascade through the album");
    assert.deepEqual(f.ended, [], "failure must not count as played or skipped");
    await f.playback.stop();
    assert.deepEqual(f.ended, [], "stop after failure must not record the discarded listen");
  } finally { f.playback.close(); }
}
{
  const f = fixture();
  try {
    f.driver.sendMpvCommand = async (command) => {
      if (command[0] === "loadfile") f.event({ event: "end-file", reason: "error", error: "loading failed" });
      return null;
    };
    assert.equal((await f.start()).status, "error", "load response must preserve immediate failure");
    f.event({ event: "idle" });
    await f.flush();
    await f.playback.stop();
    assert.deepEqual(f.ended, []);
  } finally { f.playback.close(); }
}
for (const reason of ["eof", 0]) {
  const f = fixture();
  try {
    await f.start();
    f.event({ event: "end-file", reason });
    await f.flush();
    assert.equal(f.playback.getSnapshot().currentFileId, "b");
    assert.deepEqual(f.ended.map(({ fileId, reason }) => ({ fileId, reason })), [{ fileId: "a", reason: "completed" }]);
    f.event({ event: "idle" });
    await f.flush();
    assert.equal(f.playback.getSnapshot().currentFileId, "b", "late idle must not skip next track");
    assert.equal(f.ended.length, 1, "EOF and idle must complete only once");
  } finally { f.playback.close(); }
}
for (const reason of ["stop", "quit", "redirect", 2, 3, 5]) {
  const f = fixture();
  try {
    await f.start();
    f.event({ event: "end-file", reason });
    f.event({ event: "idle" });
    await f.flush();
    assert.equal(f.playback.getSnapshot().currentFileId, "a");
    assert.equal(f.loads(), 1);
    assert.deepEqual(f.ended, [], String(reason) + " followed by idle is not completion");
  } finally { f.playback.close(); }
}
for (const sample of [
  { durationMs: 180_000, position: 179.5, completed: true },
  { durationMs: 180_000, position: 170, completed: false },
  { durationMs: 2_000, position: 1.85, completed: true },
  { durationMs: 2_000, position: 1.5, completed: false },
  { durationMs: 180_000, position: null, completed: false },
  { durationMs: null, position: 179.5, completed: false }
]) {
  const f = fixture(sample.durationMs);
  try {
    await f.start();
    if (sample.position != null) f.event({ event: "property-change", name: "time-pos", data: sample.position });
    // Wall-clock progress cannot prove that mpv decoded audio.
    else f.driver.positionUpdatedAt = Date.now() - 180_000;
    f.event({ event: "end-file" });
    f.event({ event: "idle" });
    await f.flush();
    if (sample.completed) {
      assert.equal(f.playback.getSnapshot().currentFileId, "b");
      assert.equal(f.ended.length, 1);
      assert.equal(f.ended[0]?.reason, "completed");
      f.event({ event: "idle" });
      await f.flush();
      assert.equal(f.playback.getSnapshot().currentFileId, "b");
    } else {
      assert.equal(f.playback.getSnapshot().status, "error");
      assert.equal(f.loads(), 1);
      assert.deepEqual(f.ended, []);
      await f.playback.stop();
      assert.deepEqual(f.ended, []);
    }
  } finally { f.playback.close(); }
}
console.log(JSON.stringify({ ok: true, explicitErrors: 2, immediateLoadFailure: true, eofVariants: 2, ignoredReasons: 6, legacyCases: 6 }, null, 2));
function file(id: string, durationMs: number | null): LibraryFilesResponse["files"][number] {
  const path = "/isolated-playback-fixture/" + id + ".wav";
  return {
    id, libraryRootId: null, path, normalizedPath: path, filename: id + ".wav",
    extension: "wav", sizeBytes: 0, mtime: new Date(0).toISOString(), ctime: null,
    sha256: null, quickHash: null, durationMs, codec: "pcm_s16le", bitrate: null,
    sampleRate: 8000, channels: 1, scanStatus: "scanned", staged: false, missing: false,
    playCount: 0, skipCount: 0, lastPlayedAt: null, lastSkippedAt: null,
    rating: null, liked: null, disliked: null, displayTags: { title: id, artist: "Failure Smoke" }
  };
}
