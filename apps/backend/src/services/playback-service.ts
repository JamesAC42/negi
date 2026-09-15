import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { basename } from "node:path";
import { nanoid } from "nanoid";
import { recordAlbumKey, RECORD_PLAYBACK_START_MS, type AlbumTransition, type LibraryFilesResponse, type PlaybackState } from "@music-os/core";
import type { BackendConfig } from "../config.js";
import { preparePlaybackPath, type PreparedPlaybackPath } from "./playback-path.js";
export { translatePathForPlayer } from "./playback-path.js";
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
  private pendingEndFileLoadToken: number | null = null;
  private acceptObservedState = false;
  private observedPositionMs: number | null = null;
  private preparedPath: PreparedPlaybackPath | null = null;

  private recordPlayerClients = new Map<string, { expiresAt: number; reducedMotion: boolean }>();
  private albumTransitionTimer: ReturnType<typeof setTimeout> | null = null;

  /** Visibility lease: an absent or crashed renderer must never stall the queue. */
  async setRecordPlayerPresence(clientId: string, active: boolean, reducedMotion: boolean): Promise<PlaybackState> {
    return this.runPlaybackOperation(() => {
      if (active) this.recordPlayerClients.set(clientId, { expiresAt: Date.now() + 12_000, reducedMotion });
      else this.recordPlayerClients.delete(clientId);
      if (!this.activeRecordPlayerClients().length && this.state.albumTransition && !this.state.albumTransition.paused) {
        return this.finishAlbumTransition(this.state.albumTransition.id);
      }
      return this.state;
    });
  }

  async recordPlayerAction(id: string, action: "begin" | "complete" | "skip"): Promise<PlaybackState> {
    return this.runPlaybackOperation(() => {
      const transition = this.state.albumTransition;
      if (!transition || transition.id !== id) return this.state;
      if (action === "begin") {
        if (transition.startedAt == null && !transition.paused) {
          this.state = { ...this.state, albumTransition: { ...transition, startedAt: Date.now() } };
          this.scheduleAlbumTransitionFallback(id, transition.reducedMotion ? 2_500 : 12_000);
        }
        return this.state;
      }
      // Duplicate/early animation callbacks cannot bypass the needle drop and brief lead-in.
      if (action === "complete" && (transition.paused || transition.startedAt == null ||
        Date.now() - transition.startedAt < (transition.reducedMotion ? 250 : RECORD_PLAYBACK_START_MS))) return this.state;
      return this.finishAlbumTransition(id);
    });
  }

  private activeRecordPlayerClients() {
    for (const [id, client] of this.recordPlayerClients) {
      if (client.expiresAt <= Date.now()) this.recordPlayerClients.delete(id);
    }
    return [...this.recordPlayerClients.values()];
  }

  private clearAlbumTransition(): void {
    if (this.albumTransitionTimer) clearTimeout(this.albumTransitionTimer);
    this.albumTransitionTimer = null;
    if (this.state.albumTransition) this.state = { ...this.state, albumTransition: null };
  }

  private scheduleAlbumTransitionFallback(id: string, delayMs: number): void {
    if (this.albumTransitionTimer) clearTimeout(this.albumTransitionTimer);
    this.albumTransitionTimer = setTimeout(() => {
      void this.runPlaybackOperation(() => {
        if (this.state.albumTransition?.id !== id || this.state.albumTransition.paused) return this.state;
        return this.finishAlbumTransition(id);
      }).catch(() => undefined);
    }, delayMs);
    this.albumTransitionTimer.unref();
  }

  private async finishAlbumTransition(id: string): Promise<PlaybackState> {
    if (this.state.albumTransition?.id !== id || this.queueIndex == null) return this.state;
    this.clearAlbumTransition();
    const nextIndex = this.queueIndex + 1 < this.queue.length ? this.queueIndex + 1 : this.repeatMode === "queue" ? 0 : -1;
    if (nextIndex < 0) return this.stopUnlocked();
    this.queueIndex = nextIndex;
    return this.playQueuedFile(this.queue[nextIndex]);
  }

  private reconcileAlbumTransition(): PlaybackState | Promise<PlaybackState> {
    const transition = this.state.albumTransition;
    if (!transition || this.queueIndex == null) return this.state;
    const next = this.queue[this.queueIndex + 1] ?? (this.repeatMode === "queue" ? this.queue[0] : null);
    if (next?.id === transition.to.fileId) return this.state;
    const paused = transition.paused;
    this.clearAlbumTransition();
    if (!next) return this.stopUnlocked();
    // Invalidate the old sleeve/acknowledgement before presenting the new target.
    this.beginAlbumTransition(this.queue[this.queueIndex], next, paused);
    return this.state;
  }

  private beginAlbumTransition(from: LibraryFile, to: LibraryFile, paused = false): void {
    const describe = (file: LibraryFile) => ({ fileId: file.id, album: file.displayTags.album || "Untitled record",
      artist: file.displayTags.albumartist || file.displayTags.artist || "Unknown artist" });
    const transition: AlbumTransition = { id: nanoid(), from: describe(from), to: describe(to), startedAt: null,
      paused, reducedMotion: this.activeRecordPlayerClients().some((client) => client.reducedMotion) };
    this.loadGeneration += 1;
    this.pendingEndFileLoadToken = null;
    this.acceptObservedState = false;
    this.positionUpdatedAt = null;
    this.state = { ...this.state, status: "paused", albumTransition: transition };
    if (!paused) this.scheduleAlbumTransitionFallback(transition.id, 4_000);
  }

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
      return this.reconcileAlbumTransition();
    });
  }

  async replaceUpNext(files: LibraryFile[]): Promise<PlaybackState> {
    return this.runPlaybackOperation(() => {
      if (this.queueIndex == null || this.state.status === "stopped" || this.queue.length === 0) {
        return this.state;
      }

      this.queue = [...this.queue.slice(0, this.queueIndex + 1), ...files];
      this.state = {
        ...this.state,
        queue: this.queue.map((item) => item.id),
        queueIndex: this.queueIndex
      };
      return this.reconcileAlbumTransition();
    });
  }

  async setRepeatMode(repeatMode: PlaybackRepeatMode): Promise<PlaybackState> {
    return this.runPlaybackOperation(async () => {
      this.repeatMode = repeatMode;
      this.state = { ...this.state, repeatMode };
      return this.reconcileAlbumTransition();
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
    this.clearAlbumTransition();
    this.recordCurrentListen("replaced");
    const loadToken = ++this.loadGeneration;
    this.observedPositionMs = null;
    let preparedPath: PreparedPlaybackPath | null = null;
    this.acceptObservedState = false;
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
      preparedPath = await preparePlaybackPath(file.path, this.config.mpvPath, this.config.windowsNodePath);
      if (!this.isActiveLoad(loadToken)) return this.state;
      await this.sendMpvCommand(["set_property", "volume", this.volumePercent]).catch(() => undefined);
      if (!this.isActiveLoad(loadToken)) {
        return this.state;
      }
      await this.sendMpvCommand(["loadfile", preparedPath.path, "replace"]);
      if (!this.isActiveLoad(loadToken)) {
        return this.state;
      }
      this.releasePreparedPath();
      this.preparedPath = preparedPath;
      preparedPath = null;
      await this.sendMpvCommand(["set_property", "pause", false]).catch(() => undefined);
      if (!this.isActiveLoad(loadToken)) {
        return this.state;
      }
      this.state = { ...this.state, status: "playing", positionMs: 0, error: null };
      this.acceptObservedState = true;
      this.recordListenStarted(file.id);
      this.positionUpdatedAt = Date.now();
      return this.state;
    } catch (error) {
      if (this.isActiveLoad(loadToken)) {
        this.acceptObservedState = false;
        this.positionUpdatedAt = null;
        this.state = { ...this.state, status: "error", error: error instanceof Error ? error.message : String(error) };
      }
      throw error;
    } finally {
      await preparedPath?.cleanup().catch(() => undefined);
    }
  }

  async pause(): Promise<PlaybackState> {
    return this.runInterruptOperation(async () => {
      if (this.state.albumTransition) {
        if (this.albumTransitionTimer) clearTimeout(this.albumTransitionTimer);
        this.albumTransitionTimer = null;
        this.state = { ...this.state, albumTransition: { ...this.state.albumTransition, paused: true } };
        return this.state;
      }
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
      if (this.state.albumTransition) return this.finishAlbumTransition(this.state.albumTransition.id);
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
      if (this.state.albumTransition) return this.state;
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
    this.clearAlbumTransition();
    this.loadGeneration += 1;
    this.recordCurrentListen("stop");
    this.killProcessFallback();
    this.queue = [];
    this.queueIndex = null;
    this.positionUpdatedAt = null;
    this.acceptObservedState = false;
    this.state = createStoppedState(this.volumePercent, this.repeatMode);
    return this.state;
  }

  async getState(): Promise<PlaybackState> {
    if (!this.process || !this.ipc || !this.acceptObservedState || this.state.status === "stopped" || this.state.status === "error") {
      return this.state;
    }

    const loadToken = this.loadGeneration;
    try {
      const [positionSample, durationSeconds, paused, volume] = await Promise.all([
        this.getMpvProperty("time-pos")
          .then((value) => ({ value, receivedAt: Date.now() }))
          .catch(() => ({ value: null, receivedAt: Date.now() })),
        this.getMpvProperty("duration").catch(() => null),
        this.getMpvProperty("pause").catch(() => null),
        this.getMpvProperty("volume").catch(() => null)
      ]);
      if (loadToken !== this.loadGeneration || !this.acceptObservedState) {
        return this.state;
      }
      const volumePercent = normalizeVolumePercent(volume) ?? this.volumePercent;
      this.volumePercent = volumePercent;

      const nextStatus = paused == null ? this.state.status : paused === true ? "paused" : "playing";
      const durationMs = numberToMilliseconds(durationSeconds) ?? this.state.durationMs;
      const sampledPositionMs = numberToMilliseconds(positionSample.value);
      if (sampledPositionMs != null) this.observedPositionMs = sampledPositionMs;
      const positionMs = sampledPositionMs == null
        ? this.getEstimatedPositionMs()
        : sampledPositionMs + (nextStatus === "playing" ? Math.max(0, Date.now() - positionSample.receivedAt) : 0);
      this.state = {
        ...this.state,
        status: nextStatus,
        positionMs: durationMs == null ? positionMs : Math.min(positionMs, durationMs),
        durationMs,
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
    this.clearAlbumTransition();
    this.recordPlayerClients.clear();
    this.interruptGeneration += 1;
    this.loadGeneration += 1;
    this.recordCurrentListen("close");
    this.killProcessFallback();
    this.queue = [];
    this.queueIndex = null;
    this.positionUpdatedAt = null;
    this.acceptObservedState = false;
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
        this.acceptObservedState = false;
        this.state = createStoppedState(this.volumePercent, this.repeatMode);
        this.releasePreparedPath();
      }
    });

    const onEvent = (event: MpvIpcEvent) => this.handleMpvEvent(event, generation);
    this.ipcReady = windowsMpv
      ? MpvIpcClient.connectWindowsPipe(ipcId, onEvent, this.config.windowsNodePath ?? "node.exe")
      : MpvIpcClient.connectUnixSocket(ipcServerPath, onEvent);
    this.ipc = await this.ipcReady;
    await Promise.all([
      this.sendMpvCommand(["observe_property", 1, "time-pos"]).catch(() => undefined),
      this.sendMpvCommand(["observe_property", 2, "duration"]).catch(() => undefined),
      this.sendMpvCommand(["observe_property", 3, "pause"]).catch(() => undefined),
      this.sendMpvCommand(["observe_property", 4, "volume"]).catch(() => undefined)
    ]);
  }

  private handleMpvEvent(event: MpvIpcEvent, generation: number): void {
    if (generation !== this.processGeneration) {
      return;
    }

    if (event.event === "property-change") {
      this.applyObservedProperty(event.name, event.data);
      return;
    }

    // Only EOF means completion. In particular, error followed by idle must
    // not award a full listen or run through the remaining queue.
    if (event.event === "end-file") {
      const loadToken = this.loadGeneration;
      this.pendingEndFileLoadToken = null;
      if (isEofReason(event.reason)) {
        this.queueTrackEndAdvance(loadToken);
      } else if (event.reason === "error" || event.reason === 4 || event.error != null) {
        this.failCurrentPlayback(event.error);
      } else if (event.reason == null) {
        // Older mpv omits reason. Require actual player progress near the end,
        // rather than our wall-clock estimate, before accepting its idle event.
        this.pendingEndFileLoadToken = loadToken;
      }
      return;
    }

    if (event.event === "idle" && this.pendingEndFileLoadToken != null) {
      const loadToken = this.pendingEndFileLoadToken;
      this.pendingEndFileLoadToken = null;
      if (loadToken !== this.loadGeneration) return;
      const durationMs = this.state.durationMs;
      if (durationMs != null && durationMs > 0 && this.observedPositionMs != null
        && this.observedPositionMs >= durationMs - Math.min(1_000, durationMs * 0.1)) {
        this.queueTrackEndAdvance(loadToken);
      } else {
        this.failCurrentPlayback("The player stopped before the track finished");
      }
    }
  }

  private failCurrentPlayback(detail: unknown): void {
    this.clearAlbumTransition();
    this.releasePreparedPath();
    this.loadGeneration += 1;
    this.pendingEndFileLoadToken = null;
    this.acceptObservedState = false;
    this.positionUpdatedAt = null;
    // A player failure is neither a completed listen nor a user skip.
    this.trackedFileId = null;
    const message = typeof detail === "string" && detail ? detail : "The file could not be opened or decoded";
    this.state = {
      ...this.state,
      status: "error",
      error: `Unable to play ${this.state.currentDisplayName ?? "this track"}: ${message}`
    };
  }

  private applyObservedProperty(name: unknown, value: unknown): void {
    if (!this.acceptObservedState) {
      return;
    }
    if (name === "time-pos") {
      const positionMs = numberToMilliseconds(value);
      if (positionMs != null && this.state.status !== "stopped") {
        this.observedPositionMs = positionMs;
        this.state = {
          ...this.state,
          positionMs: this.state.durationMs == null ? positionMs : Math.min(positionMs, this.state.durationMs)
        };
        this.positionUpdatedAt = this.state.status === "playing" ? Date.now() : null;
      }
      return;
    }
    if (name === "duration") {
      const durationMs = numberToMilliseconds(value);
      if (durationMs != null && this.state.status !== "stopped") {
        this.state = { ...this.state, durationMs };
      }
      return;
    }
    if (name === "pause" && typeof value === "boolean" && this.state.status !== "stopped" && this.state.status !== "error") {
      this.state = { ...this.state, status: value ? "paused" : "playing" };
      this.positionUpdatedAt = value ? null : Date.now();
      return;
    }
    if (name === "volume") {
      const volumePercent = normalizeVolumePercent(value);
      if (volumePercent != null) {
        this.volumePercent = volumePercent;
        this.state = { ...this.state, volumePercent };
      }
    }
  }

  private queueTrackEndAdvance(loadToken: number): void {
    void this.runPlaybackOperation(async () => {
      if (loadToken !== this.loadGeneration) {
        return this.state;
      }
      return this.advanceAfterTrackEnd();
    }).catch(() => undefined);
  }

  private async advanceAfterTrackEnd(): Promise<PlaybackState> {
    if (this.state.albumTransition || this.queueIndex == null || this.queue.length === 0 || this.state.status === "stopped" || this.state.status === "error") {
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
    const nextFile = this.queue[nextIndex] ?? (this.repeatMode === "queue" ? this.queue[0] : null);
    const currentFile = this.queue[this.queueIndex];
    if (nextFile && recordAlbumKey(currentFile) && recordAlbumKey(nextFile) &&
      recordAlbumKey(currentFile) !== recordAlbumKey(nextFile) && this.activeRecordPlayerClients().length) {
      this.beginAlbumTransition(currentFile, nextFile);
      return this.state;
    }
    if (nextIndex >= this.queue.length) {
      if (this.repeatMode === "queue") {
        this.queueIndex = 0;
        return this.playQueuedFile(this.queue[0]);
      }
      this.queue = [];
      this.queueIndex = null;
      this.positionUpdatedAt = null;
      this.acceptObservedState = false;
      this.state = createStoppedState(this.volumePercent, this.repeatMode);
      this.releasePreparedPath();
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
    this.pendingEndFileLoadToken = null;
    this.ipc?.close();
    this.ipc = null;
    this.ipcReady = null;
    this.acceptObservedState = false;
    this.process?.kill();
    this.killWindowsMpv();
    this.releasePreparedPath();
  }

  private releasePreparedPath(): void {
    const prepared = this.preparedPath;
    this.preparedPath = null;
    void prepared?.cleanup().catch(() => undefined);
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
