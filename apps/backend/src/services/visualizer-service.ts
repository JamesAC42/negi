import type { ServerResponse } from "node:http";
import type {
  PlaybackState,
  VisualizerCapabilitiesResponse,
  VisualizerFrame,
  VisualizerStreamMode,
  WaveformResponse
} from "@music-os/core";
import { visualizerFrameSchema, visualizerStreamModeSchema } from "@music-os/core";
import { LiveAnalyzerService } from "./live-analyzer-service.js";
import type { PlaybackService } from "./playback-service.js";
import type { WaveformService } from "./waveform-service.js";

const MODE_INTERVAL_MS: Record<VisualizerStreamMode, number> = {
  meter: 33,
  spectrum: 33,
  spectrogram: 50
};

const MODE_BANDS: Record<VisualizerStreamMode, number> = {
  meter: 8,
  spectrum: 32,
  spectrogram: 64
};

export class VisualizerService {
  private frameId = 0;
  private readonly subscribers = new Map<number, Subscriber>();
  private nextSubscriberId = 0;
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastFrame: VisualizerFrame | null = null;
  private cachedWaveform: { fileId: string; peaks: number[] } | null = null;
  private nextWaveformLookupAt = 0;
  private activeMode: VisualizerStreamMode | null = null;

  constructor(
    private readonly playback: PlaybackService,
    private readonly waveforms: WaveformService,
    private readonly analyzer: LiveAnalyzerService
  ) {}

  capabilities(): VisualizerCapabilitiesResponse {
    const waveformCache = this.waveforms.capabilities();
    const liveAnalyzer = this.analyzer.capabilities();
    return {
      waveformCache,
      liveAnalyzer,
      spectrogram: liveAnalyzer === "available" ? "available" : "disabled"
    };
  }

  debugSnapshot(): { subscriberCount: number; activeMode: VisualizerStreamMode | null } {
    return {
      subscriberCount: this.subscribers.size,
      activeMode: this.activeMode
    };
  }

  subscribe(response: ServerResponse, modeValue: string | null): void {
    const parsedMode = visualizerStreamModeSchema.safeParse(modeValue ?? "meter");
    const mode = parsedMode.success ? parsedMode.data : "meter";
    const id = ++this.nextSubscriberId;
    this.subscribers.set(id, { id, mode, response });

    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });
    response.write(": connected\n\n");
    if (this.lastFrame) {
      this.writeFrame({ id, mode, response }, this.lastFrame);
    }

    response.on("close", () => {
      this.subscribers.delete(id);
      this.resetTimers();
    });

    this.resetTimers();
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    for (const subscriber of this.subscribers.values()) {
      subscriber.response.end();
    }
    this.subscribers.clear();
    this.analyzer.stop();
  }

  private resetTimers(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.subscribers.size === 0) {
      this.activeMode = null;
      this.analyzer.stop();
      return;
    }

    const mode = this.highestMode();
    if (this.activeMode !== mode) {
      this.activeMode = mode;
      this.analyzer.stop();
    }
    this.timer = setInterval(() => {
      void this.emitFrame(mode);
    }, MODE_INTERVAL_MS[mode]);
    this.heartbeat = setInterval(() => {
      for (const subscriber of this.subscribers.values()) {
        this.writeSubscriber(subscriber, ": heartbeat\n\n");
      }
    }, 20_000);
    void this.emitFrame(mode);
  }

  private highestMode(): VisualizerStreamMode {
    if ([...this.subscribers.values()].some((subscriber) => subscriber.mode === "spectrogram")) {
      return "spectrogram";
    }
    if ([...this.subscribers.values()].some((subscriber) => subscriber.mode === "spectrum")) {
      return "spectrum";
    }
    return "meter";
  }

  private async emitFrame(mode: VisualizerStreamMode): Promise<void> {
    if (this.subscribers.size === 0) {
      return;
    }
    const state = this.playback.getSnapshot();
    const frame = visualizerFrameSchema.parse(await this.createFrame(state, mode));
    this.lastFrame = frame;
    for (const subscriber of this.subscribers.values()) {
      this.writeFrame(subscriber, frameForSubscriber(frame, subscriber.mode));
    }
  }

  private async createFrame(state: PlaybackState | null, mode: VisualizerStreamMode): Promise<VisualizerFrame> {
    if (!state || state.status === "stopped" || !state.currentFileId) {
      this.analyzer.stop();
      return this.emptyFrame(state);
    }

    const file = this.playback.getCurrentFile();
    if (state.status === "paused" || !file || file.id !== state.currentFileId) {
      this.analyzer.pause();
    } else {
      this.analyzer.ensure({
        fileId: file.id,
        path: file.path,
        positionMs: state.positionMs,
        durationMs: state.durationMs,
        mode
      });
    }
    const analyzerFrame = this.analyzer.getFrame();
    if (analyzerFrame?.fileId === state.currentFileId) {
      return {
        version: 1,
        frameId: ++this.frameId,
        emittedAt: new Date().toISOString(),
        fileId: state.currentFileId,
        status: state.status,
        positionMs: state.positionMs,
        durationMs: state.durationMs,
        rms: analyzerFrame.rms,
        peak: analyzerFrame.peak,
        bands: analyzerFrame.bands,
        fftBins: mode === "spectrogram" ? analyzerFrame.fftBins : undefined,
        source: "sidecar"
      };
    }

    const waveform = await this.loadCurrentWaveform(state).catch(() => null);
    const bands = deriveBands(waveform, state, MODE_BANDS[mode]);
    const peak = Math.max(0, ...bands);
    const rms = bands.length === 0 ? 0 : Math.min(1, Math.sqrt(bands.reduce((sum, band) => sum + band * band, 0) / bands.length));
    const frame: VisualizerFrame = {
      version: 1,
      frameId: ++this.frameId,
      emittedAt: new Date().toISOString(),
      fileId: state.currentFileId,
      status: state.status,
      positionMs: state.positionMs,
      durationMs: state.durationMs,
      rms,
      peak,
      bands,
      source: waveform ? "cached" : "none"
    };
    if (mode === "spectrogram") {
      frame.fftBins = deriveBands(waveform, state, 128);
    }
    return frame;
  }

  private emptyFrame(state: PlaybackState | null): VisualizerFrame {
    return {
      version: 1,
      frameId: ++this.frameId,
      emittedAt: new Date().toISOString(),
      fileId: state?.currentFileId ?? null,
      status: state?.status ?? "stopped",
      positionMs: state?.positionMs ?? 0,
      durationMs: state?.durationMs ?? null,
      rms: 0,
      peak: 0,
      bands: [],
      source: "none"
    };
  }

  private async loadCurrentWaveform(state: PlaybackState): Promise<number[] | null> {
    const file = this.playback.getCurrentFile();
    if (!file || file.id !== state.currentFileId) {
      this.cachedWaveform = null;
      return null;
    }
    if (this.cachedWaveform?.fileId === file.id) {
      return this.cachedWaveform.peaks;
    }
    if (Date.now() < this.nextWaveformLookupAt) {
      return null;
    }
    this.nextWaveformLookupAt = Date.now() + 2500;
    const response: WaveformResponse = await this.waveforms.getWaveform(file);
    if (response.status !== "ready") {
      return null;
    }
    this.cachedWaveform = { fileId: file.id, peaks: response.waveform.peaks };
    return this.cachedWaveform.peaks;
  }

  private writeFrame(subscriber: Subscriber, frame: VisualizerFrame): void {
    this.writeSubscriber(subscriber, `event: frame\ndata: ${JSON.stringify(frame)}\n\n`);
  }

  private writeSubscriber(subscriber: Subscriber, chunk: string): void {
    try {
      subscriber.response.write(chunk);
    } catch {
      this.subscribers.delete(subscriber.id);
      this.resetTimers();
    }
  }
}

interface Subscriber {
  id: number;
  mode: VisualizerStreamMode;
  response: ServerResponse;
}

function deriveBands(waveform: number[] | null, state: PlaybackState, count: number): number[] {
  if (!waveform || waveform.length === 0 || count <= 0) {
    return new Array(count).fill(0);
  }
  const duration = state.durationMs && state.durationMs > 0 ? state.durationMs : Math.max(1, waveform.length);
  const center = Math.max(0, Math.min(waveform.length - 1, Math.floor((state.positionMs / duration) * waveform.length)));
  const windowSize = Math.max(count, Math.floor(waveform.length / 96));
  const start = Math.max(0, center - Math.floor(windowSize / 2));
  const result: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const sampleIndex = Math.min(waveform.length - 1, start + Math.floor((index / Math.max(1, count - 1)) * windowSize));
    const value = waveform[sampleIndex] ?? 0;
    const shaped = Math.pow(Math.max(0, Math.min(1, value)), 0.7);
    result.push(Number.isFinite(shaped) ? shaped : 0);
  }
  return result;
}

function frameForSubscriber(frame: VisualizerFrame, mode: VisualizerStreamMode): VisualizerFrame {
  if (mode === "spectrogram") {
    return frame;
  }
  const { fftBins: _fftBins, ...rest } = frame;
  return rest;
}
