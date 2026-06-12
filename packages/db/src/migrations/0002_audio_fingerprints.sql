CREATE TABLE audio_fingerprints (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id),
  algorithm TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  duration_ms INTEGER,
  acoustid_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(file_id, algorithm)
);
