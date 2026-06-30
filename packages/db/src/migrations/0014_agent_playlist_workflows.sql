CREATE TABLE IF NOT EXISTS agent_playlist_workflows (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  thread_id TEXT REFERENCES agent_threads(id) ON DELETE SET NULL,
  operation_batch_id TEXT NOT NULL REFERENCES operation_batches(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  playlist_name TEXT NOT NULL,
  playlist_description TEXT,
  owned_file_ids_json TEXT NOT NULL DEFAULT '[]',
  download_job_id TEXT,
  import_id TEXT,
  import_operation_batch_id TEXT,
  playlist_operation_batch_id TEXT,
  playlist_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_playlist_workflows_status
  ON agent_playlist_workflows(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_playlist_workflows_job
  ON agent_playlist_workflows(download_job_id);
