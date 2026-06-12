CREATE TABLE library_roots (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_scan_at TEXT
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  library_root_id TEXT REFERENCES library_roots(id),
  path TEXT NOT NULL UNIQUE,
  normalized_path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  extension TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime TEXT NOT NULL,
  ctime TEXT,
  sha256 TEXT,
  quick_hash TEXT,
  duration_ms INTEGER,
  codec TEXT,
  container TEXT,
  bitrate INTEGER,
  sample_rate INTEGER,
  channels INTEGER,
  date_added TEXT NOT NULL DEFAULT (datetime('now')),
  date_updated TEXT NOT NULL DEFAULT (datetime('now')),
  scan_status TEXT NOT NULL DEFAULT 'new',
  missing INTEGER NOT NULL DEFAULT 0,
  staged INTEGER NOT NULL DEFAULT 0,
  import_item_id TEXT
);

CREATE TABLE artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_name TEXT,
  musicbrainz_artist_id TEXT,
  discogs_artist_id TEXT,
  country TEXT,
  type TEXT,
  disambiguation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sort_title TEXT,
  album_artist_id TEXT REFERENCES artists(id),
  release_year INTEGER,
  release_date TEXT,
  country TEXT,
  label TEXT,
  catalog_number TEXT,
  musicbrainz_release_id TEXT,
  musicbrainz_release_group_id TEXT,
  discogs_release_id TEXT,
  edition_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist_id TEXT REFERENCES artists(id),
  album_id TEXT REFERENCES albums(id),
  album_artist_id TEXT REFERENCES artists(id),
  track_number INTEGER,
  disc_number INTEGER,
  total_tracks INTEGER,
  total_discs INTEGER,
  recording_year INTEGER,
  release_year INTEGER,
  musicbrainz_recording_id TEXT,
  musicbrainz_track_id TEXT,
  duration_ms INTEGER,
  isrc TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE track_files (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  file_id TEXT NOT NULL REFERENCES files(id),
  quality_rank INTEGER,
  is_preferred INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(track_id, file_id)
);

CREATE TABLE embedded_tags (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id),
  tag_key TEXT NOT NULL,
  tag_value TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE track_user_tags (
  track_id TEXT NOT NULL REFERENCES tracks(id),
  user_tag_id TEXT NOT NULL REFERENCES user_tags(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,
  PRIMARY KEY (track_id, user_tag_id)
);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  agent_thread_id TEXT
);

CREATE TABLE playlist_items (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id),
  track_id TEXT NOT NULL REFERENCES tracks(id),
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  added_by TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE import_items (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES imports(id),
  file_id TEXT REFERENCES files(id),
  staging_path TEXT NOT NULL,
  status TEXT NOT NULL,
  detected_artist TEXT,
  detected_album TEXT,
  detected_title TEXT,
  detected_year INTEGER,
  metadata_candidates_json TEXT NOT NULL DEFAULT '[]',
  selected_candidate_json TEXT,
  duplicate_candidates_json TEXT NOT NULL DEFAULT '[]',
  quality_score REAL,
  confidence_score REAL,
  proposed_destination TEXT,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT
);

CREATE TABLE operation_batches (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  agent_thread_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  applied_at TEXT,
  reverted_at TEXT
);

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES operation_batches(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at TEXT,
  reverted_at TEXT
);
