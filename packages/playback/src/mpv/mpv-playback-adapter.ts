import type { PlaybackState } from "@music-os/core";
import type { PlaybackAdapter } from "../types/adapter.js";

export class MpvPlaybackAdapter implements PlaybackAdapter {
  private state: PlaybackState = {
    status: "stopped",
    currentFileId: null,
    currentPath: null,
    currentDisplayName: null,
    positionMs: 0,
    durationMs: null,
    queue: [],
    queueIndex: null,
    volumePercent: 100,
    error: null
  };

  async start(): Promise<void> {
    this.state = { ...this.state, status: "stopped" };
  }

  async stop(): Promise<void> {
    this.state = {
      status: "stopped",
      currentFileId: null,
      currentPath: null,
      currentDisplayName: null,
      positionMs: 0,
      durationMs: null,
      queue: [],
      queueIndex: null,
      volumePercent: this.state.volumePercent,
      error: null
    };
  }

  async playFile(path: string): Promise<void> {
    this.state = {
      ...this.state,
      status: "playing",
      currentFileId: null,
      currentPath: path,
      currentDisplayName: path,
      queue: [path],
      queueIndex: 0,
      error: null
    };
  }

  async pause(): Promise<void> {
    if (this.state.status === "playing") {
      this.state = { ...this.state, status: "paused" };
    }
  }

  async resume(): Promise<void> {
    if (this.state.status === "paused") {
      this.state = { ...this.state, status: "playing" };
    }
  }

  async seek(positionMs: number): Promise<void> {
    this.state = { ...this.state, positionMs };
  }

  async setQueue(paths: string[], startIndex = 0): Promise<void> {
    this.state = {
      ...this.state,
      queue: paths,
      queueIndex: paths.length > 0 ? startIndex : null,
      currentPath: paths[startIndex] ?? null
    };
  }

  async getState(): Promise<PlaybackState> {
    return this.state;
  }
}
