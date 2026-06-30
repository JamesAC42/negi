ALTER TABLE agent_playlist_workflows
  ADD COLUMN playlist_item_refs_json TEXT NOT NULL DEFAULT '[]';
