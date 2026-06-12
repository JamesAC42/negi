CREATE TABLE duplicate_marks (
  id TEXT PRIMARY KEY,
  canonical_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  duplicate_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'operation',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (canonical_file_id != duplicate_file_id),
  UNIQUE(canonical_file_id, duplicate_file_id)
);

CREATE INDEX idx_duplicate_marks_canonical_file_id ON duplicate_marks(canonical_file_id);
CREATE INDEX idx_duplicate_marks_duplicate_file_id ON duplicate_marks(duplicate_file_id);
CREATE INDEX idx_duplicate_marks_status ON duplicate_marks(status);
