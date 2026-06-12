CREATE TABLE IF NOT EXISTS saved_discovery_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  original_text TEXT NOT NULL,
  items_json TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  missing_count INTEGER NOT NULL,
  owned_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_saved_discovery_lists_updated
  ON saved_discovery_lists(updated_at DESC);
