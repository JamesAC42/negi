import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LiveAnalyzerService } from "../services/live-analyzer-service.js";
import type { BackendConfig } from "../config.js";

const ffmpegPath = process.env.MUSIC_OS_FFMPEG_PATH ?? (existsSync("/usr/bin/ffmpeg") ? "/usr/bin/ffmpeg" : null);
if (!ffmpegPath) {
  const unavailable = new LiveAnalyzerService(baseConfig(null));
  assert.equal(unavailable.capabilities(), "missing_dependency");
  unavailable.ensure({
    fileId: "missing",
    path: "/tmp/missing.wav",
    positionMs: 0,
    durationMs: null,
    mode: "meter"
  });
  assert.equal(unavailable.getFrame(), null);
  console.log("visualizer analyzer smoke skipped: ffmpeg unavailable");
  process.exit(0);
}

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-analyzer-"));
const wavPath = join(fixtureDir, "tone.wav");
await writeFile(wavPath, createSineWav());

const analyzer = new LiveAnalyzerService(baseConfig(ffmpegPath));
analyzer.ensure({
  fileId: "analyzer-fixture",
  path: wavPath,
  positionMs: 0,
  durationMs: 600,
  mode: "spectrogram"
});

let frame = analyzer.getFrame();
for (let attempt = 0; attempt < 20 && frame == null; attempt += 1) {
  await delay(150);
  frame = analyzer.getFrame();
}

assert(frame, "analyzer should emit a frame for a readable wav fixture");
assert.equal(frame.fileId, "analyzer-fixture");
assert(frame.bands.length > 0, "analyzer should emit bands");
assert(frame.fftBins && frame.fftBins.length > 0, "spectrogram mode should emit fft bins");

analyzer.pause();
analyzer.stop();
assert.equal(analyzer.getFrame(), null);

console.log("visualizer analyzer lifecycle ok");

function baseConfig(ffmpegPathValue: string | null): BackendConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    databasePath: ":memory:",
    mpvPath: "mpv",
    ffmpegPath: ffmpegPathValue,
    musicBrainzEnabled: false
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSineWav(): Buffer {
  const sampleRate = 8000;
  const seconds = 0.6;
  const samples = Math.floor(sampleRate * seconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 330) * 14000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}
