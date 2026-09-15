-- Metadata-keyed results survive replay, duplicate files, and app restarts.
-- Transient provider errors are deliberately excluded from the durable cache.
CREATE TABLE lyrics_cache (
  cache_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('synced', 'plain', 'instrumental', 'not_found')),
  plain_lyrics TEXT,
  lines_json TEXT NOT NULL DEFAULT '[]',
  fetched_at TEXT
);
