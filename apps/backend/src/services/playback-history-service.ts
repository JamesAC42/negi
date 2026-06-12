import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

export type PlaybackEndReason = "replaced" | "next" | "previous" | "stop" | "close" | "completed";

export interface PlaybackHistoryRecorder {
  recordStarted(fileId: string): void;
  recordEnded(input: {
    fileId: string;
    reason: PlaybackEndReason;
    positionMs: number;
    durationMs: number | null;
  }): void;
}

export class PlaybackHistoryService implements PlaybackHistoryRecorder {
  constructor(private readonly db: Database.Database) {}

  recordStarted(fileId: string): void {
    this.db
      .prepare(
        `INSERT INTO playback_events (id, file_id, event_type, reason, position_ms, duration_ms, listened_ms)
         VALUES (?, ?, 'started', 'start', 0, NULL, 0)`
      )
      .run(nanoid(), fileId);
  }

  recordEnded(input: {
    fileId: string;
    reason: PlaybackEndReason;
    positionMs: number;
    durationMs: number | null;
  }): void {
    const positionMs = Math.max(0, Math.round(input.positionMs));
    const durationMs = input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs));
    const eventType = isPlayed(positionMs, durationMs, input.reason) ? "played" : "skipped";

    this.db
      .prepare(
        `INSERT INTO playback_events (id, file_id, event_type, reason, position_ms, duration_ms, listened_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(nanoid(), input.fileId, eventType, input.reason, positionMs, durationMs, positionMs);
  }
}

function isPlayed(positionMs: number, durationMs: number | null, reason: PlaybackEndReason): boolean {
  if (reason === "completed") {
    return true;
  }

  if (durationMs != null && durationMs > 0 && durationMs - positionMs <= 5_000) {
    return true;
  }

  const threshold = durationMs != null && durationMs > 0 ? Math.min(30_000, durationMs * 0.5) : 30_000;
  return positionMs >= threshold;
}
