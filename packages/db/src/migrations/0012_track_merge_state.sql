ALTER TABLE tracks ADD COLUMN merged_into_track_id TEXT REFERENCES tracks(id);
ALTER TABLE tracks ADD COLUMN merged_at TEXT;

CREATE INDEX idx_tracks_merged_into_track_id ON tracks(merged_into_track_id);
