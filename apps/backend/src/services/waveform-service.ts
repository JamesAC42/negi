import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LibraryFilesResponse, WaveformResponse, WaveformSummary } from "@music-os/core";
import { waveformResponseSchema, waveformSummarySchema } from "@music-os/core";
import type { BackendConfig } from "../config.js";

type LibraryFile = LibraryFilesResponse["files"][number];

const WAVEFORM_VERSION = 1;
const TARGET_PEAKS = 1024;
const MAX_CONCURRENT_GENERATORS = 2;
const GENERATION_TIMEOUT_MS = 60_000;
const FAILURE_COOLDOWN_MS = 60_000;

export class WaveformService {
  private activeGenerators = 0;
  private readonly pending = new Map<string, Promise<WaveformResponse>>();
  private readonly failures = new Map<string, { message: string; retryAfter: number }>();
  private readonly queue: Array<() => void> = [];
  private readonly children = new Set<ReturnType<typeof spawn>>();
  private closed = false;

  constructor(private readonly config: BackendConfig) {}

  capabilities(): "available" | "missing_dependency" | "disabled" {
    return this.config.ffmpegPath ? "available" : "missing_dependency";
  }

  debugSnapshot(): { activeGenerators: number; pendingCount: number; queuedCount: number; childCount: number; closed: boolean } {
    return {
      activeGenerators: this.activeGenerators,
      pendingCount: this.pending.size,
      queuedCount: this.queue.length,
      childCount: this.children.size,
      closed: this.closed
    };
  }

  async getWaveform(file: LibraryFile): Promise<WaveformResponse> {
    if (this.closed) {
      return { status: "error", message: "Waveform service is closed." };
    }
    const fingerprint = await this.fingerprintFile(file);
    const cachePath = this.cachePath(file.id, fingerprint);
    const cached = await this.readCached(cachePath, file, fingerprint);
    if (cached) {
      return waveformResponseSchema.parse({ status: "ready", waveform: cached });
    }

    if (!this.config.ffmpegPath) {
      return { status: "unavailable", message: "ffmpeg was not found; waveform generation is unavailable." };
    }

    const key = `${file.id}:${fingerprint.fileSize}:${fingerprint.fileMtimeMs}`;
    const failure = this.failures.get(key);
    if (failure && Date.now() < failure.retryAfter) {
      return { status: "error", message: failure.message };
    }
    if (failure) {
      this.failures.delete(key);
    }

    if (!this.pending.has(key)) {
      const task = this.scheduleGeneration(file, fingerprint, cachePath, key).finally(() => {
        this.pending.delete(key);
      });
      this.pending.set(key, task);
    }

    return { status: "pending", message: "Waveform generation has been queued." };
  }

  private async scheduleGeneration(file: LibraryFile, fingerprint: FileFingerprint, cachePath: string, key: string): Promise<WaveformResponse> {
    await this.enterGeneratorSlot();
    try {
      const waveform = await this.generateWaveform(file, fingerprint);
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify(waveform), "utf8");
      this.failures.delete(key);
      return waveformResponseSchema.parse({ status: "ready", waveform });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failures.set(key, { message, retryAfter: Date.now() + FAILURE_COOLDOWN_MS });
      return { status: "error", message };
    } finally {
      this.leaveGeneratorSlot();
    }
  }

  private async enterGeneratorSlot(): Promise<void> {
    if (this.closed) {
      throw new Error("Waveform service is closed.");
    }
    if (this.activeGenerators < MAX_CONCURRENT_GENERATORS) {
      this.activeGenerators += 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    if (this.closed) {
      throw new Error("Waveform service is closed.");
    }
    this.activeGenerators += 1;
  }

  private leaveGeneratorSlot(): void {
    this.activeGenerators = Math.max(0, this.activeGenerators - 1);
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  close(): void {
    this.closed = true;
    for (const child of this.children) {
      child.kill();
    }
    this.children.clear();
    while (this.queue.length > 0) {
      this.queue.shift()?.();
    }
    this.pending.clear();
  }

  private async fingerprintFile(file: LibraryFile): Promise<FileFingerprint> {
    const stats = await stat(file.path);
    return {
      fileSize: stats.size,
      fileMtimeMs: stats.mtimeMs
    };
  }

  private cachePath(fileId: string, fingerprint: FileFingerprint): string {
    const safeFileId = fileId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const key = createHash("sha1")
      .update(`${fileId}:${fingerprint.fileSize}:${fingerprint.fileMtimeMs}:${WAVEFORM_VERSION}`)
      .digest("hex")
      .slice(0, 16);
    return join(process.cwd(), ".music-os", "cache", "waveforms", `${safeFileId}-${key}.json`);
  }

  private async readCached(cachePath: string, file: LibraryFile, fingerprint: FileFingerprint): Promise<WaveformSummary | null> {
    try {
      const parsed = waveformSummarySchema.parse(JSON.parse(await readFile(cachePath, "utf8")));
      if (
        parsed.version === WAVEFORM_VERSION &&
        parsed.fileId === file.id &&
        parsed.fileSize === fingerprint.fileSize &&
        parsed.fileMtimeMs === fingerprint.fileMtimeMs
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async generateWaveform(file: LibraryFile, fingerprint: FileFingerprint): Promise<WaveformSummary> {
    if (!this.config.ffmpegPath) {
      throw new Error("ffmpeg was not found; waveform generation is unavailable.");
    }

    const peaks = new Array<number>(TARGET_PEAKS).fill(0);
    const rms = new Array<number>(TARGET_PEAKS).fill(0);
    const counts = new Array<number>(TARGET_PEAKS).fill(0);
    let sampleIndex = 0;
    const estimatedSamples = Math.max(1, Math.floor(((file.durationMs ?? 0) / 1000) * 8000) || Math.floor(fingerprint.fileSize / 16));

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.config.ffmpegPath!, [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        translatePathForAnalyzer(file.path, this.config.ffmpegPath!),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "pipe:1"
      ]);
      this.children.add(child);
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
      }, GENERATION_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => {
        for (let index = 0; index + 1 < chunk.length; index += 2) {
          const bucket = Math.min(TARGET_PEAKS - 1, Math.floor((sampleIndex / estimatedSamples) * TARGET_PEAKS));
          const value = chunk.readInt16LE(index) / 32768;
          const abs = Math.abs(value);
          peaks[bucket] = Math.max(peaks[bucket], abs);
          rms[bucket] += value * value;
          counts[bucket] += 1;
          sampleIndex += 1;
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-4000);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        this.children.delete(child);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        this.children.delete(child);
        if (code === 0 && sampleIndex > 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `ffmpeg waveform generation failed with code ${code ?? "unknown"} or timed out`));
      });
    });

    return {
      version: WAVEFORM_VERSION,
      fileId: file.id,
      filePath: file.path,
      fileSize: fingerprint.fileSize,
      fileMtimeMs: fingerprint.fileMtimeMs,
      durationMs: file.durationMs,
      channels: 1,
      sampleCount: sampleIndex,
      samplesPerPoint: Math.max(1, sampleIndex / TARGET_PEAKS),
      peaks: smoothNormalize(peaks),
      rms: rms.map((value, index) => (counts[index] > 0 ? Math.min(1, Math.sqrt(value / counts[index])) : 0)),
      createdAt: new Date().toISOString()
    };
  }
}

interface FileFingerprint {
  fileSize: number;
  fileMtimeMs: number;
}

function smoothNormalize(values: number[]): number[] {
  const max = Math.max(0.01, ...values);
  return values.map((value, index) => {
    const previous = values[Math.max(0, index - 1)] ?? value;
    const next = values[Math.min(values.length - 1, index + 1)] ?? value;
    return Math.min(1, ((previous + value * 2 + next) / 4) / max);
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
