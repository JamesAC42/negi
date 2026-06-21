export interface PlaybackState {
  status: "stopped" | "playing" | "paused" | "error";
  currentFileId: string | null;
  currentPath: string | null;
  currentDisplayName: string | null;
  positionMs: number;
  durationMs: number | null;
  queue: string[];
  queueIndex: number | null;
  repeatMode: "none" | "song" | "queue";
  volumePercent: number;
  error: string | null;
}

export type VisualizerSource = "none" | "cached" | "sidecar" | "mpv";
export type VisualizerStreamMode = "meter" | "spectrum" | "spectrogram";

export interface VisualizerFrame {
  version: 1;
  frameId: number;
  emittedAt: string;
  fileId: string | null;
  status: PlaybackState["status"];
  positionMs: number;
  durationMs: number | null;
  rms: number;
  peak: number;
  bands: number[];
  fftBins?: number[];
  waveform?: number[];
  source: VisualizerSource;
}

export interface WaveformSummary {
  version: 1;
  fileId: string;
  filePath: string;
  fileSize: number;
  fileMtimeMs: number;
  durationMs: number | null;
  channels: number;
  sampleCount: number;
  samplesPerPoint: number;
  peaks: number[];
  rms?: number[];
  createdAt: string;
}
