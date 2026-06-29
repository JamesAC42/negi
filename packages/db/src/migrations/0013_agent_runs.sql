CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  thread_id TEXT REFERENCES agent_threads(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  objective TEXT NOT NULL,
  response_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  type TEXT NOT NULL,
  tool_name TEXT,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_created
  ON agent_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_created
  ON agent_runs(thread_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_steps_run_index
  ON agent_steps(run_id, step_index);
