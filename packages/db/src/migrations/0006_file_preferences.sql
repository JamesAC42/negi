CREATE TABLE file_preferences (
  file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  liked INTEGER,
  disliked INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
