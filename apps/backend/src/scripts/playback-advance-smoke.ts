import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { LibraryFilesResponse } from "@music-os/core";
import { getBackendConfig } from "../config.js";
import { PlaybackService } from "../services/playback-service.js";

type LibraryFile = LibraryFilesResponse["files"][number];

// Fixtures must live on a Windows-visible drive so Windows mpv launched from
// WSL can read them; the OS temp dir is WSL-only.
const fixtureDir = resolve(process.cwd(), ".music-os", "playback-advance-smoke");
const trackDurationSeconds = 2;

const config = getBackendConfig();
const playback = new PlaybackService(config, null);

try {
  await rm(fixtureDir, { recursive: true, force: true });
  await mkdir(fixtureDir, { recursive: true });

  const pathA = join(fixtureDir, "track-a.wav");
  const pathB = join(fixtureDir, "track-b.wav");
  await writeFile(pathA, createSilentWav(trackDurationSeconds));
  await writeFile(pathB, createSilentWav(trackDurationSeconds));

  const fileA = createLibraryFile("smoke-track-a", pathA, "Track A");
  const fileB = createLibraryFile("smoke-track-b", pathB, "Track B");

  const started = await playback.playQueue([fileA, fileB], 0);
  assert(started.status === "playing", `expected playing state, got ${started.status}`);
  assert(started.currentFileId === fileA.id, `expected first track, got ${started.currentFileId}`);

  const advanced = await waitFor(
    async () => {
      const state = await playback.getState();
      return state.currentFileId === fileB.id && state.status === "playing" ? state : null;
    },
    (trackDurationSeconds + 20) * 1000,
    "auto-advance to the second queued track"
  );
  assert(advanced.queueIndex === 1, `expected queue index 1 after advance, got ${advanced.queueIndex}`);

  const stoppedAtEnd = await waitFor(
    async () => {
      const state = await playback.getState();
      return state.status === "stopped" ? state : null;
    },
    (trackDurationSeconds + 20) * 1000,
    "stop state after the queue finishes"
  );
  assert(stoppedAtEnd.currentFileId === null, "expected cleared current file after queue end");
  assert(stoppedAtEnd.queue.length === 0, "expected cleared queue after queue end");

  console.log(
    JSON.stringify(
      {
        ok: true,
        advancedTo: advanced.currentDisplayName,
        finalStatus: stoppedAtEnd.status
      },
      null,
      2
    )
  );
} finally {
  await playback.stop().catch(() => undefined);
  playback.close();
  await rm(fixtureDir, { recursive: true, force: true });
}

async function waitFor<T>(check: () => Promise<T | null>, timeoutMs: number, label: string): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await check();
    if (result != null) {
      return result;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function createLibraryFile(id: string, path: string, title: string): LibraryFile {
  const now = new Date().toISOString();
  return {
    id,
    libraryRootId: null,
    path,
    normalizedPath: path.toLowerCase(),
    filename: path.split(/[\\/]/).at(-1) ?? path,
    extension: "wav",
    sizeBytes: 0,
    mtime: now,
    ctime: null,
    sha256: null,
    quickHash: null,
    durationMs: trackDurationSeconds * 1000,
    codec: "pcm_s16le",
    bitrate: null,
    sampleRate: 8000,
    channels: 1,
    scanStatus: "scanned",
    staged: false,
    missing: false,
    playCount: 0,
    skipCount: 0,
    lastPlayedAt: null,
    lastSkippedAt: null,
    rating: null,
    liked: null,
    disliked: null,
    displayTags: { title, artist: "Playback Smoke" }
  };
}

function createSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 8000;
  const sampleCount = sampleRate * durationSeconds;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
