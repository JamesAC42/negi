export interface RecordAlbum {
  fileId: string;
  album: string;
  artist: string;
}

export interface AlbumTransition {
  id: string;
  from: RecordAlbum;
  to: RecordAlbum;
  /** Null until a visible renderer is ready to perform the change. */
  startedAt: number | null;
  paused: boolean;
  reducedMotion: boolean;
}

export interface PlaybackState {
  albumTransition?: AlbumTransition | null;
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
