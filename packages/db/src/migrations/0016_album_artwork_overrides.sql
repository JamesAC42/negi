CREATE TABLE album_artwork_overrides (
  id TEXT PRIMARY KEY,
  anchor_file_id TEXT NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  image_data BLOB NOT NULL,
  mime_type TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('local', 'remote')),
  source_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_album_artwork_overrides_anchor_file
  ON album_artwork_overrides(anchor_file_id);
