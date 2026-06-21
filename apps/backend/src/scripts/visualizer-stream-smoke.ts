import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { OutgoingHttpHeader } from "node:http";
import type { PlaybackState } from "@music-os/core";
import { VisualizerService } from "../services/visualizer-service.js";

class FakeSseResponse extends EventEmitter {
  statusCode = 0;
  headers: Record<string, OutgoingHttpHeader> = {};
  body: string[] = [];
  ended = false;

  writeHead(statusCode: number, headers: Record<string, OutgoingHttpHeader>): void {
    this.statusCode = statusCode;
    this.headers = headers;
  }

  write(chunk: string): void {
    this.body.push(chunk);
  }

  end(): void {
    this.ended = true;
  }
}

const playbackState: PlaybackState = {
  status: "stopped",
  currentFileId: null,
  currentPath: null,
  currentDisplayName: null,
  positionMs: 0,
  durationMs: null,
  queue: [],
  queueIndex: null,
  repeatMode: "none",
  volumePercent: 100,
  error: null
};

let analyzerStopCount = 0;
const playback = {
  getSnapshot: () => playbackState,
  getCurrentFile: () => null
};
const waveforms = {
  capabilities: () => "available"
};
const analyzer = {
  capabilities: () => "available",
  ensure: () => undefined,
  pause: () => undefined,
  stop: () => {
    analyzerStopCount += 1;
  },
  getFrame: () => null
};

const service = new VisualizerService(playback as any, waveforms as any, analyzer as any);
const response = new FakeSseResponse();
service.subscribe(response as any, "meter");

await delay(180);
assert.equal(response.statusCode, 200);
assert.equal(response.headers["content-type"], "text/event-stream");
assert(response.body.some((chunk) => chunk.includes("event: frame")), "stream should emit at least one frame event");

response.emit("close");
await delay(30);
assert(analyzerStopCount > 0, "analyzer should stop when the final stream subscriber disconnects");
assert.deepEqual(service.debugSnapshot(), { subscriberCount: 0, activeMode: null });
service.close();

const playingState: PlaybackState = {
  ...playbackState,
  status: "playing",
  currentFileId: "file-1",
  currentPath: "/tmp/file.wav",
  currentDisplayName: "file.wav",
  durationMs: 1000
};
const payloadPlayback = {
  getSnapshot: () => playingState,
  getCurrentFile: () => ({ id: "file-1", path: "/tmp/file.wav" })
};
const payloadAnalyzer = {
  capabilities: () => "available",
  ensure: () => undefined,
  pause: () => undefined,
  stop: () => undefined,
  getFrame: () => ({
    fileId: "file-1",
    analyzerPositionMs: 0,
    rms: 0.2,
    peak: 0.5,
    bands: [0.1, 0.2],
    fftBins: [0.3, 0.4]
  })
};
const payloadService = new VisualizerService(payloadPlayback as any, waveforms as any, payloadAnalyzer as any);
const meterResponse = new FakeSseResponse();
const spectrogramResponse = new FakeSseResponse();
payloadService.subscribe(meterResponse as any, "meter");
payloadService.subscribe(spectrogramResponse as any, "spectrogram");
await delay(180);
const meterFrame = parseLastFrame(meterResponse);
const spectrogramFrame = parseLastFrame(spectrogramResponse);
assert(meterFrame && !("fftBins" in meterFrame), "meter subscriber should not receive fft bins");
assert(spectrogramFrame?.fftBins?.length === 2, "spectrogram subscriber should receive fft bins");
payloadService.close();

console.log("visualizer stream lifecycle ok");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLastFrame(response: FakeSseResponse): any {
  const event = [...response.body].reverse().find((chunk) => chunk.includes("event: frame"));
  if (!event) {
    return null;
  }
  const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  return data ? JSON.parse(data) : null;
}
