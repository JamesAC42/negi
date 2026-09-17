-- An outer UPSERT's DO UPDATE uses ABORT for constraint failures, overriding
-- INSERT OR REPLACE inside its triggers. Use an explicit UPSERT for dirty rows
-- so repeated preference and metadata saves cannot fail on an existing marker.
-- Preserve revision invalidation for both newly dirty and already-dirty files.
CREATE TRIGGER taste_learning_dirty_update_revision AFTER UPDATE ON taste_learning_dirty
BEGIN UPDATE taste_learning_state SET revision = revision + 1 WHERE id = 1; END;

DROP TRIGGER taste_learning_playback_events_insert;
DROP TRIGGER taste_learning_playback_events_update;
DROP TRIGGER taste_learning_playback_events_delete;
DROP TRIGGER taste_learning_file_preferences_insert;
DROP TRIGGER taste_learning_file_preferences_update;
DROP TRIGGER taste_learning_file_preferences_delete;
DROP TRIGGER taste_learning_embedded_tags_insert;
DROP TRIGGER taste_learning_embedded_tags_update;
DROP TRIGGER taste_learning_embedded_tags_delete;
DROP TRIGGER taste_learning_file_metadata_overrides_insert;
DROP TRIGGER taste_learning_file_metadata_overrides_update;
DROP TRIGGER taste_learning_file_metadata_overrides_delete;

CREATE TRIGGER taste_learning_playback_events_insert AFTER INSERT ON playback_events
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;

CREATE TRIGGER taste_learning_playback_events_update AFTER UPDATE ON playback_events
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;

CREATE TRIGGER taste_learning_playback_events_delete AFTER DELETE ON playback_events
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = OLD.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = OLD.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = OLD.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = OLD.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;

CREATE TRIGGER taste_learning_file_preferences_insert AFTER INSERT ON file_preferences
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;

CREATE TRIGGER taste_learning_file_preferences_update AFTER UPDATE ON file_preferences
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;

CREATE TRIGGER taste_learning_file_preferences_delete AFTER DELETE ON file_preferences
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = OLD.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = OLD.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = OLD.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = OLD.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;

CREATE TRIGGER taste_learning_embedded_tags_insert AFTER INSERT ON embedded_tags
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;

CREATE TRIGGER taste_learning_embedded_tags_update AFTER UPDATE ON embedded_tags
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;

CREATE TRIGGER taste_learning_embedded_tags_delete AFTER DELETE ON embedded_tags
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = OLD.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = OLD.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = OLD.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = OLD.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;

CREATE TRIGGER taste_learning_file_metadata_overrides_insert AFTER INSERT ON file_metadata_overrides
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;

CREATE TRIGGER taste_learning_file_metadata_overrides_update AFTER UPDATE ON file_metadata_overrides
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = NEW.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = NEW.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = NEW.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = NEW.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;

CREATE TRIGGER taste_learning_file_metadata_overrides_delete AFTER DELETE ON file_metadata_overrides
WHEN EXISTS (SELECT 1 FROM playback_events WHERE file_id = OLD.file_id AND event_type = 'played')
  OR EXISTS (SELECT 1 FROM file_preferences WHERE file_id = OLD.file_id)
  OR EXISTS (SELECT 1 FROM taste_learning_files WHERE file_id = OLD.file_id)
BEGIN INSERT INTO taste_learning_dirty (file_id) SELECT id FROM files WHERE id = OLD.file_id
  ON CONFLICT(file_id) DO UPDATE SET file_id = excluded.file_id;
END;
