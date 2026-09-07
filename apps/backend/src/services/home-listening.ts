import type Database from "better-sqlite3";
import { homeListeningResponseSchema, type HomeListeningResponse } from "@music-os/core";

// The recorder stores position-based listened_ms, so this is recorded listening,
// not a wall-clock measure. Exclude starts to avoid double-counting each play.
export function getHomeListening(db: Database.Database, period: string, now = new Date()): HomeListeningResponse {
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : null;
  const until = now.toISOString();
  const since = days == null ? null : new Date(now.getTime() - days * 86400000).toISOString();
  const params = { since, until };
  const source = `FROM playback_events e JOIN files f ON f.id = e.file_id
    WHERE f.staged = 0 AND f.missing = 0 AND e.event_type IN ('played', 'skipped')
    AND (@since IS NULL OR julianday(e.created_at) >= julianday(@since))
    AND julianday(e.created_at) <= julianday(@until)`;
  return homeListeningResponseSchema.parse({
    since, until,
    files: db.prepare(`SELECT e.file_id AS fileId,
      SUM(e.event_type = 'played') AS plays, SUM(e.listened_ms) AS listenedMs,
      SUM(e.event_type = 'skipped') AS skips,
      (SELECT strftime('%Y-%m-%dT%H:%M:%SZ', MIN(h.created_at)) FROM playback_events h
       WHERE h.file_id = e.file_id AND h.event_type = 'played' AND julianday(h.created_at) <= julianday(@until)) AS firstPlayedAt
      ${source} GROUP BY e.file_id`).all(params),
    days: db.prepare(`SELECT date(e.created_at) AS day,
      SUM(e.event_type = 'played') AS plays, SUM(e.listened_ms) AS listenedMs
      ${source} GROUP BY day ORDER BY day`).all(params),
    hours: db.prepare(`SELECT CAST(strftime('%H', e.created_at) AS INTEGER) AS hour,
      SUM(e.event_type = 'played') AS plays ${source} GROUP BY hour ORDER BY hour`).all(params),
    recent: db.prepare(`SELECT e.id, e.file_id AS fileId,
      strftime('%Y-%m-%dT%H:%M:%SZ', e.created_at) AS playedAt
      ${source} AND e.event_type = 'played' ORDER BY julianday(e.created_at) DESC, e.id DESC LIMIT 8`).all(params)
  });
}