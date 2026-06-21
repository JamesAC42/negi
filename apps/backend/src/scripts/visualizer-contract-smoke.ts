import assert from "node:assert/strict";
import {
  visualizerCapabilitiesSchema,
  visualizerFrameSchema,
  visualizerStreamModeSchema,
  waveformResponseSchema
} from "@music-os/core";

const frame = visualizerFrameSchema.parse({
  version: 1,
  frameId: 1,
  emittedAt: new Date().toISOString(),
  fileId: "file-1",
  status: "playing",
  positionMs: 1200,
  durationMs: 3000,
  rms: 0.2,
  peak: 0.6,
  bands: [0.1, 0.5, 0.2],
  fftBins: [0.1, 0.2],
  source: "sidecar"
});

assert.equal(frame.source, "sidecar");
assert.equal(visualizerStreamModeSchema.parse("spectrogram"), "spectrogram");
assert.equal(
  visualizerCapabilitiesSchema.parse({
    waveformCache: "available",
    liveAnalyzer: "available",
    spectrogram: "available"
  }).liveAnalyzer,
  "available"
);
assert.equal(waveformResponseSchema.parse({ status: "pending", message: "queued" }).status, "pending");
assert.equal(visualizerFrameSchema.safeParse({ ...frame, rms: 2 }).success, false);

console.log("visualizer contracts ok");
