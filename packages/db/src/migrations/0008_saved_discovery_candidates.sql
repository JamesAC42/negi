CREATE TABLE IF NOT EXISTS saved_discovery_candidates (
  id TEXT PRIMARY KEY,
  candidate_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  query TEXT NOT NULL,
  release_artist TEXT,
  release_title TEXT NOT NULL,
  username TEXT,
  folder TEXT,
  result_count INTEGER NOT NULL,
  available_count INTEGER NOT NULL,
  total_size_bytes INTEGER,
  primary_format TEXT,
  quality_label TEXT NOT NULL,
  match_label TEXT NOT NULL,
  results_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_saved_discovery_candidates_updated
  ON saved_discovery_candidates(updated_at DESC);
