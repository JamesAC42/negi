import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { basename } from "node:path";
import { nanoid } from "nanoid";
import type { LibraryFilesResponse, PlaybackState } from "@music-os/core";
import type { BackendConfig } from "../config.js";
import { MpvIpcClient, type MpvIpcEvent } from "./mpv-ipc.js";
import type { PlaybackEndReason, PlaybackHistoryRecorder } from "./playback-history-service.js";

type LibraryFile = LibraryFilesResponse["files"][number];
type PlaybackRepeatMode = PlaybackState["repeatMode"];

export class PlaybackService {
  private process: ChildProcessWithoutNullStreams | null = null;
  private ipc: MpvIpcClient | null = null;
  private ipcReady: Promise<MpvIpcClient> | null = null;
  private processGeneration = 0;
  private loadGeneration = 0;
  private queue: LibraryFile[] = [];
  private queueIndex: number | null = null;
  private state: PlaybackState = createStoppedState();
  private operationChain = Promise.resolve();
  private positionUpdatedAt: number | null = null;
  private trackedFileId: string | null = null;
  private volumePercent = 100;
  private repeatMode: PlaybackRepeatMode = "none";
  private interruptGeneration = 0;

  constructor(
    private readonly config: BackendConfig,
    private readonly history: PlaybackHistoryRecorder | null = null
  ) {}

  async playFile(file: LibraryFile): Promise<PlaybackState> {
    return this.playQueue([file], 0);
  }

  async playQueue(files: LibraryFile[], startIndex: number): Promise<PlaybackState> {
    return this.runPlaybackOperation(async () => {
      if (files.length === 0) {
        throw new Error("Cannot play an empty queue");
      }

      const safeIndex = Math.min(Math.max(0, startIndex), files.length - 1);
      this.queue = files;
      this.queueIndex = safeIndex;
      return this.playQueuedFile(files[safeIndex]);
    });
  }

  async enqueue(files: LibraryFile[], position: "up_next" | "end"): Promise<PlaybackState> {
    return this.runPlaybackOperation(async () => {
      if (files.length === 0) {
        throw new Error("Cannot enqueue an empty file list");
      }
      if (this.state.status === "stopped" || this.queueIndex == null || this.queue.length === 0) {
        this.queue = files;
        this.queueIndex = 0;
        return this.playQueuedFile(files[0]);
      }

      const insertAt = position === "up_next" ? this.queueIndex + 1 : this.queue.length;
      this.queue.splice(insertAt, 0, ...files);
      this.state = {
        ...this.state,
        queue: this.queue.map((item) => item.id),
        queueIndex: this.queueIndex
      };
      return this.state;
    });
  }

  async setRepeatMode(repeatMode: PlaybackRepeatMode): Promise<PlaybackState> {
    return this.runPlaybackOperation(async () => {
      this.repeatMode = repeatMode;
      this.state = { ...this.state, repeatMode };
      return this.state;
    });
  }

  async next(): Promise<PlaybackState> {
    return this.runPlaybackOperation(async () => {
      if (this.queueIndex == null || this.queue.length === 0) {
        return this.state;
      }
      this.recordCurrentListen("next");

      const nextIndex = this.queueIndex + 1;
      if (nextIndex >= this.queue.length) {
        if (this.repeatMode === "queue") {
          this.queueIndex = 0;
          return this.playQueuedFile(this.queue[0]);
        }
        return this.stopUnlocked();
      }

      this.queueIndex = nextIndex;
      return this.playQueuedFile(this.queue[nextIndex]);
    });
  }

  async previous(): Promise<PlaybackState> {
    return this.runPlaybackOperation(async () => {
      if (this.queueIndex == null || this.queue.length === 0) {
        return this.state;
      }
      this.recordCurrentListen("previous");

      const previousIndex = Math.max(0, this.queueIndex - 1);
      this.queueIndex = previousIndex;
      return this.playQueuedFile(this.queue[previousIndex]);
    });
  }

  private async playQueuedFile(file: LibraryFile): Promise<PlaybackState> {
    this.recordCurrentListen("replaced");
    const loadToken = ++this.loadGeneration;
    const translatedPath = translatePathForPlayer(file.path, this.config.mpvPath);
    this.state = {
      status: "playing",
      currentFileId: file.id,
      currentPath: file.path,
      currentDisplayName: getDisplayName(file),
      positionMs: 0,
      durationMs: file.durationMs,
      queue: this.queue.map((item) => item.id),
      queueIndex: this.queueIndex,
      repeatMode: this.repeatMode,
      volumePercent: this.volumePercent,
      error: null
    };
    this.positionUpdatedAt = Date.now();

    try {
      await this.ensureProcess();
      if (!this.isActiveLoad(loadToken)) {
        return this.state;
      }
      await this.sendMpvCommand(["set_property", "volume", this.volumePercent]).catch(() => undefined);
      if (!this.isActiveLoad(loadToken)) {
        return this.state;
      }
      await this.sendMpvCommand(["loadfile", translatedPath, "replace"]);
      if (!this.isActiveLoad(loadToken)) {
        return this.state;
      }
      await this.sendMpvCommand(["set_property", "pause", false]).catch(() => undefined);
      if (!this.isActiveLoad(loadToken)) {
        return this.state;
      }
      this.recordListenStarted(file.id);
      this.positionUpdatedAt = Date.now();
      return this.state;
    } catch (error) {
      if (this.isActiveLoad(loadToken)) {
        this.positionUpdatedAt = null;
        this.state = { ...this.state, status: "error", error: error instanceof Error ? error.message : String(error) };
      }
      throw error;
    }
  }

  async pause(): Promise<PlaybackState> {
    return this.runInterruptOperation(async () => {
      const currentFile = this.getCurrentFile();
      const shouldPause = this.process != null || this.state.status === "playing";
      if (!shouldPause) {
        return this.state;
      }

      this.applyProgressFallback();
      try {
        if (!this.ipc && this.ipcReady) {
          this.ipc = await withTimeout(this.ipcReady, 750, "Timed out waiting for mpv IPC to pause playback");
        }
        await this.sendMpvCommand(["set_property", "pause", true]);
      } catch (error) {
        this.recordCurrentListen("stop");
        this.killProcessFallback();
        this.queue = [];
        this.queueIndex = null;
        this.positionUpdatedAt = null;
        this.state = createStoppedState(this.volumePercent, this.repeatMode);
        return { ...this.state, error: error instanceof Error ? error.message : String(error) };
      }

      if (currentFile && (this.state.status === "stopped" || this.state.currentFileId !== currentFile.id)) {
        this.state = {
          status: "paused",
          currentFileId: currentFile.id,
          currentPath: currentFile.path,
          currentDisplayName: getDisplayName(currentFile),
          positionMs: 0,
          durationMs: currentFile.durationMs,
          queue: this.queue.map((item) => item.id),
          queueIndex: this.queueIndex,
          repeatMode: this.repeatMode,
          volumePercent: this.volumePercent,
          error: null
        };
      } else if (this.state.status !== "stopped" && this.state.status !== "error") {
        this.state = { ...this.state, status: "paused", error: null };
      }
      this.positionUpdatedAt = null;
      return this.state;
    });
  }

  async resume(): Promise<PlaybackState> {
    return this.runPlaybackOperation(async () => {
      if (this.process && this.state.status === "paused") {
        await this.sendMpvCommand(["set_property", "pause", false]);
        this.state = { ...this.state, status: "playing" };
        this.positionUpdatedAt = Date.now();
      }
      return this.state;
    });
  }

  async seek(positionMs: number): Promise<PlaybackState> {
    return this.runPlaybackOperation(async () => {
      if (this.process && this.state.status !== "stopped") {
        await this.sendMpvCommand(["seek", Math.max(0, positionMs / 1000), "absolute"]);
        this.state = { ...this.state, positionMs: Math.max(0, positionMs) };
        this.positionUpdatedAt = this.state.status === "playing" ? Date.now() : null;
      }
      return this.state;
    });
  }

  async setVolume(volumePercent: number): Promise<PlaybackState> {
    return this.runPlaybackOperation(async () => {
      this.volumePercent = Math.max(0, Math.min(100, Math.round(volumePercent)));
      if (this.process && this.state.status !== "error") {
        await this.sendMpvCommand(["set_property", "volume", this.volumePercent]);
      }
      this.state = { ...this.state, volumePercent: this.volumePercent };
      return this.state;
    });
  }

  async stop(): Promise<PlaybackState> {
    return this.runInterruptOperation(() => this.stopUnlocked());
  }

  private stopUnlocked(): PlaybackState {
    this.loadGeneration += 1;
    this.recordCurrentListen("stop");
    this.killProcessFallback();
    this.queue = [];
    this.queueIndex = null;
    this.positionUpdatedAt = null;
    this.state = createStoppedState(this.volumePercent, this.repeatMode);
    return this.state;
  }

  async getState(): Promise<PlaybackState> {
    if (!this.process || !this.ipc || this.state.status === "stopped" || this.state.status === "error") {
      return this.state;
    }

    try {
      const positionSeconds = await this.getMpvProperty("time-pos").catch(() => null);
      const durationSeconds = await this.getMpvProperty("duration").catch(() => null);
      const paused = await this.getMpvProperty("pause").catch(() => null);
      const volume = await this.getMpvProperty("volume").catch(() => null);
      const volumePercent = normalizeVolumePercent(volume) ?? this.volumePercent;
      this.volumePercent = volumePercent;

      const nextStatus = paused == null ? this.state.status : paused === true ? "paused" : "playing";
      this.state = {
        ...this.state,
        status: nextStatus,
        positionMs: numberToMilliseconds(positionSeconds) ?? this.getEstimatedPositionMs(),
        durationMs: numberToMilliseconds(durationSeconds) ?? this.state.durationMs,
        volumePercent,
        error: null
      };
      this.positionUpdatedAt = nextStatus === "playing" ? Date.now() : null;
    } catch (error) {
      this.applyProgressFallback();
      this.state = { ...this.state, error: error instanceof Error ? error.message : String(error) };
    }

    return this.state;
  }

  getCurrentFile(): LibraryFile | null {
    if (this.queueIndex == null) {
      return null;
    }
    return this.queue[this.queueIndex] ?? null;
  }

  getSnapshot(): PlaybackState {
    if (this.state.status !== "playing") {
      return this.state;
    }
    return {
      ...this.state,
      positionMs: this.getEstimatedPositionMs()
    };
  }

  close(): void {
    this.interruptGeneration += 1;
    this.loadGeneration += 1;
    this.recordCurrentListen("close");
    this.killProcessFallback();
    this.queue = [];
    this.queueIndex = null;
    this.positionUpdatedAt = null;
    this.state = createStoppedState(this.volumePercent, this.repeatMode);
  }

  private async ensureProcess(): Promise<void> {
    if (this.process && this.process.exitCode === null && this.ipcReady) {
      this.ipc = await this.ipcReady;
      return;
    }

    this.killProcessFallback();
    this.process = null;
    const generation = ++this.processGeneration;
    const windowsMpv = isWindowsPlayer(this.config.mpvPath);
    const ipcId = `music-os-mpv-${nanoid()}`;
    const ipcServerPath = windowsMpv ? `\\\\.\\pipe\\${ipcId}` : `/tmp/${ipcId}.sock`;

    this.process = spawn(
      this.config.mpvPath,
      ["--idle=yes", "--force-window=no", "--really-quiet", "--no-video", `--input-ipc-server=${ipcServerPath}`],
      {
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    this.process.on("error", (error) => {
      if (generation !== this.processGeneration) {
        return;
      }
      this.state = { ...this.state, status: "error", error: error.message };
    });

    this.process.stderr.on("data", (chunk: Buffer) => {
      if (generation !== this.processGeneration) {
        return;
      }
      const message = chunk.toString("utf8").trim();
      if (message) {
        this.state = { ...this.state, error: message };
      }
    });

    this.process.on("exit", () => {
      if (generation !== this.processGeneration) {
        return;
      }
      this.ipc?.close();
      this.ipc = null;
      this.ipcReady = null;
      this.process = null;
      if (this.state.status !== "stopped") {
        this.recordCurrentListen("close");
        this.queue = [];
        this.queueIndex = null;
        this.positionUpdatedAt = null;
        this.state = createStoppedState(this.volumePercent, this.repeatMode);
      }
    });

    const onEvent = (event: MpvIpcEvent) => this.handleMpvEvent(event, generation);
    this.ipcReady = windowsMpv ? MpvIpcClient.connectWindowsPipe(ipcId, onEvent) : MpvIpcClient.connectUnixSocket(ipcServerPath, onEvent);
    this.ipc = await this.ipcReady;
  }

  private handleMpvEvent(event: MpvIpcEvent, generation: number): void {
    if (generation !== this.processGeneration) {
      return;
    }

    // Newer mpv builds tag end-file with reason "eof". mpv 0.29 omits the
    // reason, but emits "idle" only when playback genuinely ran out, so both
    // signals route to the same guarded advance. The load token ignores
    // signals that raced with an explicit track change.
    const trackEnded = (event.event === "end-file" && isEofReason(event.reason)) || event.event === "idle";
    if (trackEnded) {
      const loadToken = this.loadGeneration;
      void this.runPlaybackOperation(async () => {
        if (loadToken !== this.loadGeneration) {
          return this.state;
        }
        return this.advanceAfterTrackEnd();
      }).catch(() => undefined);
    }
  }

  private async advanceAfterTrackEnd(): Promise<PlaybackState> {
    if (this.queueIndex == null || this.queue.length === 0 || this.state.status === "stopped") {
      return this.state;
    }

    if (this.state.durationMs != null) {
      this.state = { ...this.state, positionMs: this.state.durationMs };
    }
    this.recordCurrentListen("completed");

    if (this.repeatMode === "song") {
      return this.playQueuedFile(this.queue[this.queueIndex]);
    }

    const nextIndex = this.queueIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeatMode === "queue") {
        this.queueIndex = 0;
        return this.playQueuedFile(this.queue[0]);
      }
      this.queue = [];
      this.queueIndex = null;
      this.positionUpdatedAt = null;
      this.state = createStoppedState(this.volumePercent, this.repeatMode);
      return this.state;
    }

    this.queueIndex = nextIndex;
    return this.playQueuedFile(this.queue[nextIndex]);
  }

  private recordListenStarted(fileId: string): void {
    if (this.trackedFileId === fileId) {
      return;
    }

    this.trackedFileId = fileId;
    try {
      this.history?.recordStarted(fileId);
    } catch (error) {
      this.state = { ...this.state, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private recordCurrentListen(reason: PlaybackEndReason): void {
    if (!this.trackedFileId || !this.state.currentFileId || this.trackedFileId !== this.state.currentFileId) {
      this.trackedFileId = null;
      return;
    }

    this.applyProgressFallback();
    const fileId = this.trackedFileId;
    this.trackedFileId = null;
    try {
      this.history?.recordEnded({
        fileId,
        reason,
        positionMs: this.state.positionMs,
        durationMs: this.state.durationMs
      });
    } catch (error) {
      this.state = { ...this.state, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async sendMpvCommand(command: unknown[]): Promise<unknown> {
    if (!this.ipc) {
      throw new Error("mpv process is not running");
    }

    const response = await this.ipc.command(command);
    if (response.error && response.error !== "success") {
      throw new Error(`mpv command ${String(command[0])} failed: ${response.error}`);
    }
    return response.data;
  }

  private async getMpvProperty(name: string): Promise<unknown> {
    return this.sendMpvCommand(["get_property", name]);
  }

  private killProcessFallback(): void {
    this.processGeneration += 1;
    this.ipc?.close();
    this.ipc = null;
    this.ipcReady = null;
    this.process?.kill();
    this.killWindowsMpv();
  }

  private getEstimatedPositionMs(): number {
    if (this.state.status !== "playing" || this.positionUpdatedAt == null) {
      return this.state.positionMs;
    }

    const elapsed = Math.max(0, Date.now() - this.positionUpdatedAt);
    const estimated = this.state.positionMs + elapsed;
    return this.state.durationMs == null ? estimated : Math.min(estimated, this.state.durationMs);
  }

  private applyProgressFallback(): void {
    if (this.state.status !== "playing") {
      return;
    }

    this.state = { ...this.state, positionMs: this.getEstimatedPositionMs() };
    this.positionUpdatedAt = Date.now();
  }

  private killWindowsMpv(): void {
    if (isWindowsPlayer(this.config.mpvPath)) {
      spawnSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Stop-Process -Name mpv -Force -ErrorAction SilentlyContinue"
      ]);
    }
  }

  private runPlaybackOperation(operation: () => Promise<PlaybackState> | PlaybackState): Promise<PlaybackState> {
    const interruptToken = this.interruptGeneration;
    const runIfCurrent = () => {
      if (interruptToken !== this.interruptGeneration) {
        return this.state;
      }
      return operation();
    };
    const next = this.operationChain.then(runIfCurrent, runIfCurrent);
    this.operationChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private runInterruptOperation(operation: () => Promise<PlaybackState> | PlaybackState): Promise<PlaybackState> {
    this.interruptGeneration += 1;
    this.loadGeneration += 1;
    const next = Promise.resolve().then(operation);
    this.operationChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private isActiveLoad(loadToken: number): boolean {
    return loadToken === this.loadGeneration;
  }
}

function isWindowsPlayer(playerPath: string): boolean {
  return playerPath.toLowerCase().endsWith(".exe");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isEofReason(reason: unknown): boolean {
  return reason === "eof" || reason === 0;
}

function numberToMilliseconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.round(value * 1000));
}

export function translatePathForPlayer(path: string, playerPath: string): string {
  if (!isWindowsPlayer(playerPath)) {
    return path;
  }

  const match = path.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (!match) {
    return path;
  }

  const drive = match[1].toUpperCase();
  const rest = match[2].replaceAll("/", "\\");
  return `${drive}:\\${rest}`;
}

function getDisplayName(file: LibraryFile): string {
  const title = file.displayTags.title;
  const artist = file.displayTags.artist ?? file.displayTags.albumartist;
  if (title && artist) {
    return `${artist} - ${title}`;
  }
  return title ?? basename(file.path);
}

function createStoppedState(volumePercent = 100, repeatMode: PlaybackRepeatMode = "none"): PlaybackState {
  return {
    status: "stopped",
    currentFileId: null,
    currentPath: null,
    currentDisplayName: null,
    positionMs: 0,
    durationMs: null,
    queue: [],
    queueIndex: null,
    repeatMode,
    volumePercent,
    error: null
  };
}

function normalizeVolumePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}
