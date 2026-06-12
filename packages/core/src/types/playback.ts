export interface PlaybackState {
  status: "stopped" | "playing" | "paused" | "error";
  currentFileId: string | null;
  currentPath: string | null;
  currentDisplayName: string | null;
  positionMs: number;
  durationMs: number | null;
  queue: string[];
  queueIndex: number | null;
  volumePercent: number;
  error: string | null;
}
