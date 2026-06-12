CREATE TABLE file_metadata_overrides (
  file_id TEXT NOT NULL REFERENCES files(id),
  tag_key TEXT NOT NULL,
  tag_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (file_id, tag_key)
);
