import type Database from "better-sqlite3";
import type { JobEvent, JobSummary } from "@music-os/core";

export class JobService {
  constructor(private readonly db: Database.Database) {}

  listJobs(limit = 100): JobSummary[] {
    return (this.db
      .prepare(
        `SELECT * FROM jobs
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as JobRow[]).map(mapJob);
  }

  getJob(jobId: string): { job: JobSummary; events: JobEvent[] } {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
    if (!row) {
      throw new Error(`Job not found: ${jobId}`);
    }
    const events = (this.db
      .prepare(
        `SELECT * FROM job_events
         WHERE job_id = ?
         ORDER BY timestamp ASC, id ASC`
      )
      .all(jobId) as JobEventRow[]).map(mapEvent);
    return { job: mapJob(row), events };
  }
}

interface JobRow {
  id: string;
  type: string;
  status: string;
  progress: number;
  payload_json: string;
  result_json: string | null;
  error_json: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancel_requested: number;
}

interface JobEventRow {
  id: string;
  job_id: string;
  timestamp: string;
  level: string;
  message: string;
  data_json: string | null;
}

function mapJob(row: JobRow): JobSummary {
  return {
    id: row.id,
    type: row.type,
    status: row.status as JobSummary["status"],
    progress: Math.max(0, Math.min(1, row.progress)),
    payload: parseJson(row.payload_json, {}),
    result: row.result_json ? parseJson(row.result_json, null) : null,
    error: row.error_json ? parseJson(row.error_json, null) : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelRequested: row.cancel_requested === 1
  };
}

function mapEvent(row: JobEventRow): JobEvent {
  return {
    id: row.id,
    jobId: row.job_id,
    timestamp: row.timestamp,
    level: row.level,
    message: row.message,
    data: row.data_json ? parseJson(row.data_json, null) : null
  };
}

function parseJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}
