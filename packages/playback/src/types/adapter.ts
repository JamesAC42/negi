import type { PlaybackState } from "@music-os/core";

export interface PlaybackAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  playFile(path: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setQueue(paths: string[], startIndex?: number): Promise<void>;
  getState(): Promise<PlaybackState>;
}
