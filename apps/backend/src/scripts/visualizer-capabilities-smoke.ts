import assert from "node:assert/strict";
import { LiveAnalyzerService } from "../services/live-analyzer-service.js";
import { VisualizerService } from "../services/visualizer-service.js";
import { WaveformService } from "../services/waveform-service.js";
import type { BackendConfig } from "../config.js";
import type { PlaybackState } from "@music-os/core";

const stopped: PlaybackState = {
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

const playback = {
  getSnapshot: () => stopped,
  getCurrentFile: () => null
};

const missing = createVisualizer(null);
assert.deepEqual(missing.capabilities(), {
  waveformCache: "missing_dependency",
  liveAnalyzer: "missing_dependency",
  spectrogram: "disabled"
});
missing.close();

const available = createVisualizer("/usr/bin/ffmpeg");
assert.deepEqual(available.capabilities(), {
  waveformCache: "available",
  liveAnalyzer: "available",
  spectrogram: "available"
});
available.close();

console.log("visualizer capabilities ok");

function createVisualizer(ffmpegPath: string | null): VisualizerService {
  const config: BackendConfig = {
    host: "127.0.0.1",
    port: 0,
    databasePath: ":memory:",
    mpvPath: "mpv",
    ffmpegPath,
    musicBrainzEnabled: false
  };
  const waveforms = new WaveformService(config);
  const analyzer = new LiveAnalyzerService(config);
  return new VisualizerService(playback as any, waveforms, analyzer);
}
