-- Durable, lazily refreshed per-file listening evidence. Reads only revisit dirty files.
CREATE TABLE taste_learning_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO taste_learning_state (id) VALUES (1);

CREATE TABLE taste_learning_dirty (
  file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE
);
CREATE TABLE taste_learning_files (
  file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  evidence_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER taste_learning_dirty_revision AFTER INSERT ON taste_learning_dirty
BEGIN UPDATE taste_learning_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER taste_learning_file_delete AFTER DELETE ON files
BEGIN UPDATE taste_learning_state SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER taste_learning_playback_events_insert AFTER INSERT ON playback_events
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id; END;

CREATE TRIGGER taste_learning_playback_events_update AFTER UPDATE ON playback_events
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id; END;

CREATE TRIGGER taste_learning_playback_events_delete AFTER DELETE ON playback_events
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = OLD.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = OLD.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = OLD.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = OLD.file_id; END;

CREATE TRIGGER taste_learning_file_preferences_insert AFTER INSERT ON file_preferences
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id; END;

CREATE TRIGGER taste_learning_file_preferences_update AFTER UPDATE ON file_preferences
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id; END;

CREATE TRIGGER taste_learning_file_preferences_delete AFTER DELETE ON file_preferences
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = OLD.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = OLD.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = OLD.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = OLD.file_id; END;

CREATE TRIGGER taste_learning_embedded_tags_insert AFTER INSERT ON embedded_tags
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id; END;

CREATE TRIGGER taste_learning_embedded_tags_update AFTER UPDATE ON embedded_tags
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id; END;

CREATE TRIGGER taste_learning_embedded_tags_delete AFTER DELETE ON embedded_tags
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = OLD.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = OLD.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = OLD.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = OLD.file_id; END;

CREATE TRIGGER taste_learning_file_metadata_overrides_insert AFTER INSERT ON file_metadata_overrides
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id; END;

CREATE TRIGGER taste_learning_file_metadata_overrides_update AFTER UPDATE ON file_metadata_overrides
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id; END;

CREATE TRIGGER taste_learning_file_metadata_overrides_delete AFTER DELETE ON file_metadata_overrides
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = OLD.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = OLD.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = OLD.file_id)
BEGIN INSERT OR REPLACE INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = OLD.file_id; END;

INSERT OR IGNORE INTO taste_learning_dirty (file_id)
SELECT file_id FROM playback_events WHERE event_type = 'played'
UNION SELECT file_id FROM file_preferences;