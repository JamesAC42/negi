import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WaveformService } from "../services/waveform-service.js";
import type { BackendConfig } from "../config.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-waveform-"));
const wavPath = join(fixtureDir, "tone.wav");
await writeFile(wavPath, createSineWav());

const config: BackendConfig = {
  host: "127.0.0.1",
  port: 0,
  databasePath: join(fixtureDir, "music-os.sqlite"),
  mpvPath: "mpv",
  ffmpegPath: process.env.MUSIC_OS_FFMPEG_PATH ?? (existsSync("/usr/bin/ffmpeg") ? "/usr/bin/ffmpeg" : null),
  musicBrainzEnabled: false
};

const service = new WaveformService(config);
const file = {
  id: "waveform-fixture",
  path: wavPath,
  filename: "tone.wav",
  durationMs: 300,
  displayTags: {}
} as any;

const first = await service.getWaveform(file);
if (first.status === "unavailable") {
  console.log("waveform cache smoke skipped: ffmpeg unavailable");
  process.exit(0);
}
assert.equal(first.status, "pending");
if (first.status === "pending") {
  assert.match(first.message, /queued/i);
}

let ready = await service.getWaveform(file);
for (let attempt = 0; attempt < 20 && ready.status === "pending"; attempt += 1) {
  await delay(250);
  ready = await service.getWaveform(file);
}
assert.equal(ready.status, "ready");
if (ready.status === "ready") {
  assert.equal(ready.waveform.fileId, file.id);
  assert.equal(ready.waveform.peaks.length, 1024);
}
assert.deepEqual(service.debugSnapshot(), {
  activeGenerators: 0,
  pendingCount: 0,
  queuedCount: 0,
  childCount: 0,
  closed: false
});
service.close();
assert.equal(service.debugSnapshot().closed, true);

console.log("waveform cache ok");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSineWav(): Buffer {
  const sampleRate = 8000;
  const seconds = 0.3;
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
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 12000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}
