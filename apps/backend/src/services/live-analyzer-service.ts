import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { VisualizerStreamMode } from "@music-os/core";
import type { BackendConfig } from "../config.js";

const SAMPLE_RATE = 16000;
const ANALYSIS_WINDOW_MS = 42;
const ANALYZER_READ_RATE = 4;
const INITIAL_ANALYSIS_BURST_SECONDS = 2;
const DECODE_LOOKAHEAD_SECONDS = 90;
const RESTART_LOOKAHEAD_MS = 900;
const DECODER_CATCHUP_GRACE_MS = 1200;
const MAX_WINDOW_SAMPLES = 1024;
const MAX_BAND_KERNELS = 8;
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
      this.current.durationMs = input.durationMs;
      const decodedUntilMs = this.current.positionMs + (this.decodedSamples.length / SAMPLE_RATE) * 1000;
      const positionIsDecoded = input.positionMs >= this.current.positionMs && input.positionMs <= decodedUntilMs;
      const decoderCanCatchUp = Boolean(
        this.process
        && input.positionMs >= this.current.positionMs
        && input.positionMs <= decodedUntilMs + DECODER_CATCHUP_GRACE_MS
      );

      if ((positionIsDecoded || decoderCanCatchUp) && (this.process || this.hasLookahead(input.positionMs))) {
        return;
      }
      this.start(input, true);
      return;
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

  getFrame(positionMs: number): AnalyzerFrame | null {
    if (this.current) {
      this.latestFrame = this.createFrameAtPlaybackPosition(positionMs);
    }
    return this.latestFrame;
  }

  private start(input: AnalyzerInput, preserveLatestFrame = false): void {
    this.stopProcess();
    this.current = input;
    if (!preserveLatestFrame) {
      this.latestFrame = null;
    }
    this.decodedSamples = [];

    const args = [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      // Pace decoding ahead of playback without flooding the backend event loop.
      "-readrate",
      String(ANALYZER_READ_RATE),
      "-readrate_initial_burst",
      String(INITIAL_ANALYSIS_BURST_SECONDS),
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
      "-flush_packets",
      "1",
      "-blocksize",
      "4096",
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

  private hasLookahead(positionMs: number): boolean {
    if (!this.current) {
      return false;
    }
    const relativePositionMs = Math.max(0, positionMs - this.current.positionMs);
    const decodedUntilMs = (this.decodedSamples.length / SAMPLE_RATE) * 1000;
    return decodedUntilMs - relativePositionMs > RESTART_LOOKAHEAD_MS;
  }

  private createFrameAtPlaybackPosition(requestedPositionMs: number): AnalyzerFrame | null {
    const input = this.current;
    if (!input || this.decodedSamples.length === 0) {
      return this.latestFrame;
    }

    const playbackPositionMs = input.durationMs == null
      ? Math.max(0, requestedPositionMs)
      : Math.max(0, Math.min(requestedPositionMs, input.durationMs));
    const relativePositionMs = Math.max(0, playbackPositionMs - input.positionMs);
    const centerSample = Math.floor((relativePositionMs / 1000) * SAMPLE_RATE);
    if (centerSample >= this.decodedSamples.length) {
      return this.latestFrame;
    }

    const windowSize = Math.min(
      MAX_WINDOW_SAMPLES,
      Math.max(64, Math.floor((ANALYSIS_WINDOW_MS / 1000) * SAMPLE_RATE))
    );
    const start = Math.max(0, centerSample - Math.floor(windowSize / 2));
    const end = Math.min(this.decodedSamples.length, centerSample + Math.ceil(windowSize / 2));
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
    const fftBins = input.mode === "spectrogram" ? computeBands(samples, 128) : undefined;
    const bands = input.mode === "meter"
      ? computeMeterBands(samples, MODE_BANDS[input.mode], rms, normalizedPeak)
      : fftBins
        ? downsampleBands(fftBins, MODE_BANDS[input.mode])
        : computeBands(samples, MODE_BANDS[input.mode]);
    return {
      fileId: input.fileId,
      analyzerPositionMs: playbackPositionMs,
      rms,
      peak: normalizedPeak,
      bands,
      fftBins
    };
  }
}

type BandKernel = {
  cosines: Float32Array[];
  sines: Float32Array[];
  window: Float32Array;
  windowSum: number;
};

const bandKernels = new Map<string, BandKernel>();

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
  const compact = samples.slice(-MAX_WINDOW_SAMPLES);
  const kernel = getBandKernel(compact.length, bandCount);
  const result: number[] = [];
  for (let band = 0; band < bandCount; band += 1) {
    let real = 0;
    let imaginary = 0;
    const cosines = kernel.cosines[band];
    const sines = kernel.sines[band];
    for (let index = 0; index < compact.length; index += 1) {
      const sample = compact[index] * kernel.window[index];
      real += sample * cosines[index];
      imaginary -= sample * sines[index];
    }
    const magnitude = (Math.sqrt(real * real + imaginary * imaginary) * 2) / kernel.windowSum;
    result.push(Math.min(0.96, Math.pow(Math.max(0, magnitude * 2.35), 0.78)));
  }
  return result;
}

function getBandKernel(sampleCount: number, bandCount: number): BandKernel {
  const key = `${sampleCount}:${bandCount}`;
  const cached = bandKernels.get(key);
  if (cached) {
    return cached;
  }

  const window = Float32Array.from({ length: sampleCount }, (_, index) =>
    sampleCount <= 1 ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * 2 * index) / (sampleCount - 1))
  );
  const windowSum = Math.max(1, window.reduce((sum, value) => sum + value, 0));
  const minimumFrequency = 45;
  const maximumFrequency = SAMPLE_RATE * 0.48;
  const cosines: Float32Array[] = [];
  const sines: Float32Array[] = [];
  for (let band = 0; band < bandCount; band += 1) {
    const position = bandCount <= 1 ? 0 : band / (bandCount - 1);
    const frequency = minimumFrequency * Math.pow(maximumFrequency / minimumFrequency, position);
    const radiansPerSample = (Math.PI * 2 * frequency) / SAMPLE_RATE;
    cosines.push(Float32Array.from({ length: sampleCount }, (_, index) => Math.cos(radiansPerSample * index)));
    sines.push(Float32Array.from({ length: sampleCount }, (_, index) => Math.sin(radiansPerSample * index)));
  }
  const kernel = { cosines, sines, window, windowSum };
  if (bandKernels.size >= MAX_BAND_KERNELS) {
    const oldestKey = bandKernels.keys().next().value;
    if (oldestKey) {
      bandKernels.delete(oldestKey);
    }
  }
  bandKernels.set(key, kernel);
  return kernel;
}

function downsampleBands(bands: number[], count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index / count) * bands.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / count) * bands.length));
    let total = 0;
    for (let sourceIndex = start; sourceIndex < Math.min(end, bands.length); sourceIndex += 1) {
      total += bands[sourceIndex] ?? 0;
    }
    return total / Math.max(1, Math.min(end, bands.length) - start);
  });
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
