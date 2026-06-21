import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { VisualizerStreamMode } from "@music-os/core";
import type { BackendConfig } from "../config.js";

const SAMPLE_RATE = 8000;
const ANALYSIS_WINDOW_MS = 64;
const DECODE_LOOKAHEAD_SECONDS = 90;
const RESTART_LOOKAHEAD_MS = 1500;
const MAX_WINDOW_SAMPLES = 512;
const MODE_BANDS: Record<VisualizerStreamMode, number> = {
  meter: 8,
  spectrum: 32,
  spectrogram: 64
};

export interface AnalyzerInput {
  fileId: string;
  path: string;
  positionMs: number;
  durationMs: number | null;
  mode: VisualizerStreamMode;
}

export interface AnalyzerFrame {
  fileId: string;
  analyzerPositionMs: number;
  rms: number;
  peak: number;
  bands: number[];
  fftBins?: number[];
}

export class LiveAnalyzerService {
  private process: ChildProcessWithoutNullStreams | null = null;
  private current: AnalyzerInput | null = null;
  private latestFrame: AnalyzerFrame | null = null;
  private decodedSamples: number[] = [];
  private startedAt = 0;

  constructor(private readonly config: BackendConfig) {}

  capabilities(): "available" | "missing_dependency" | "disabled" {
    return this.config.ffmpegPath ? "available" : "missing_dependency";
  }

  ensure(input: AnalyzerInput): void {
    if (!this.config.ffmpegPath) {
      this.stop();
      return;
    }
    if (this.current && this.current.fileId === input.fileId && this.current.path === input.path && this.current.mode === input.mode) {
      const positionIsClose = Math.abs(this.getEstimatedPositionMs() - input.positionMs) < 1200;
      if (positionIsClose && (this.process || this.hasLookahead())) {
        return;
      }
    }
    this.start(input);
  }

  pause(): void {
    this.stopProcess();
  }

  stop(): void {
    this.stopProcess();
    this.current = null;
    this.latestFrame = null;
    this.decodedSamples = [];
  }

  getFrame(): AnalyzerFrame | null {
    if (this.current) {
      this.latestFrame = this.createFrameAtPlaybackPosition();
    }
    return this.latestFrame;
  }

  private start(input: AnalyzerInput): void {
    this.stopProcess();
    this.current = input;
    this.latestFrame = null;
    this.decodedSamples = [];
    this.startedAt = Date.now() - input.positionMs;

    const args = [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      Math.max(0, input.positionMs / 1000).toFixed(3),
      "-i",
      translatePathForAnalyzer(input.path, this.config.ffmpegPath!),
      "-t",
      String(DECODE_LOOKAHEAD_SECONDS),
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "s16le",
      "pipe:1"
    ];
    const child = spawn(this.config.ffmpegPath!, args);
    this.process = child;
    child.stdout.on("data", (chunk: Buffer) => this.consumePcm(chunk, child));
    child.on("error", () => {
      if (this.process === child) {
        this.stop();
      }
    });
    child.on("close", () => {
      if (this.process === child) {
        this.process = null;
      }
    });
  }

  private stopProcess(): void {
    this.process?.kill();
    this.process = null;
  }

  private consumePcm(chunk: Buffer, child: ChildProcessWithoutNullStreams): void {
    if (!this.current || this.process !== child) {
      return;
    }
    for (let index = 0; index + 1 < chunk.length; index += 2) {
      this.decodedSamples.push(chunk.readInt16LE(index) / 32768);
    }
  }

  private getEstimatedPositionMs(): number {
    if (!this.current) {
      return 0;
    }
    const estimated = Math.max(0, Date.now() - this.startedAt);
    return this.current.durationMs == null ? estimated : Math.min(estimated, this.current.durationMs);
  }

  private hasLookahead(): boolean {
    if (!this.current) {
      return false;
    }
    const relativePositionMs = Math.max(0, this.getEstimatedPositionMs() - this.current.positionMs);
    const decodedUntilMs = (this.decodedSamples.length / SAMPLE_RATE) * 1000;
    return decodedUntilMs - relativePositionMs > RESTART_LOOKAHEAD_MS;
  }

  private createFrameAtPlaybackPosition(): AnalyzerFrame | null {
    const input = this.current;
    if (!input || this.decodedSamples.length === 0) {
      return this.latestFrame;
    }

    const playbackPositionMs = this.getEstimatedPositionMs();
    const relativePositionMs = Math.max(0, playbackPositionMs - input.positionMs);
    const centerSample = Math.floor((relativePositionMs / 1000) * SAMPLE_RATE);
    if (centerSample >= this.decodedSamples.length) {
      return this.latestFrame;
    }

    const windowSize = Math.min(
      MAX_WINDOW_SAMPLES,
      Math.max(64, Math.floor((ANALYSIS_WINDOW_MS / 1000) * SAMPLE_RATE))
    );
    const start = Math.max(0, centerSample - windowSize);
    const end = Math.min(this.decodedSamples.length, centerSample + Math.floor(windowSize / 2));
    const samples = this.decodedSamples.slice(start, end);
    if (samples.length === 0) {
      return this.latestFrame;
    }

    let peak = 0;
    let sumSquares = 0;
    for (const sample of samples) {
      const abs = Math.abs(sample);
      peak = Math.max(peak, abs);
      sumSquares += sample * sample;
    }
    const rms = Math.min(1, Math.sqrt(sumSquares / Math.max(1, samples.length)) * 1.15);
    const normalizedPeak = Math.min(1, peak * 1.05);
    const bands = input.mode === "meter"
      ? computeMeterBands(samples, MODE_BANDS[input.mode], rms, normalizedPeak)
      : computeBands(samples, MODE_BANDS[input.mode]);
    return {
      fileId: input.fileId,
      analyzerPositionMs: playbackPositionMs,
      rms,
      peak: normalizedPeak,
      bands,
      fftBins: input.mode === "spectrogram" ? computeBands(samples, 128) : undefined
    };
  }
}

function computeMeterBands(samples: number[], bandCount: number, rms: number, peak: number): number[] {
  const segmentSize = Math.max(1, Math.floor(samples.length / Math.max(1, bandCount)));
  return Array.from({ length: bandCount }, (_, band) => {
    let segmentPeak = 0;
    let segmentSquares = 0;
    for (let index = 0; index < segmentSize; index += 1) {
      const sample = samples[Math.min(samples.length - 1, band * segmentSize + index)] ?? 0;
      const abs = Math.abs(sample);
      segmentPeak = Math.max(segmentPeak, abs);
      segmentSquares += sample * sample;
    }
    const segmentRms = Math.sqrt(segmentSquares / segmentSize);
    const shaped = segmentPeak * 0.48 + segmentRms * 0.82 + rms * 0.12 + peak * 0.03;
    return Math.min(0.78, Math.pow(Math.max(0, shaped), 0.92));
  });
}

function computeBands(samples: number[], bandCount: number): number[] {
  if (samples.length === 0 || bandCount <= 0) {
    return new Array(Math.max(0, bandCount)).fill(0);
  }
  const step = Math.max(1, Math.floor(samples.length / MAX_WINDOW_SAMPLES));
  const compact = samples.filter((_, index) => index % step === 0).slice(-MAX_WINDOW_SAMPLES);
  const result: number[] = [];
  for (let band = 0; band < bandCount; band += 1) {
    const cycles = 1 + band * 0.65;
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < compact.length; index += 1) {
      const angle = (Math.PI * 2 * cycles * index) / compact.length;
      real += compact[index] * Math.cos(angle);
      imaginary -= compact[index] * Math.sin(angle);
    }
    result.push(Math.min(0.94, Math.pow(Math.sqrt(real * real + imaginary * imaginary) / Math.max(1, compact.length) * 8.5, 0.82)));
  }
  return result;
}

function translatePathForAnalyzer(path: string, analyzerPath: string): string {
  if (!analyzerPath.toLowerCase().endsWith(".exe")) {
    return path;
  }
  const match = path.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (!match) {
    return path;
  }
  return `${match[1].toUpperCase()}:\\${match[2].replaceAll("/", "\\")}`;
}
