import type Database from "better-sqlite3";
import type { Playlist } from "@music-os/core";
import { LibraryRepository } from "./library-repository.js";

export class PlaylistService {
  constructor(
    private readonly db: Database.Database,
    private readonly library: LibraryRepository
  ) {}

  listPlaylists(): Playlist[] {
    const rows = this.db
      .prepare("SELECT * FROM playlists ORDER BY updated_at DESC, created_at DESC")
      .all() as PlaylistRow[];
    return rows.map((row) => this.mapPlaylist(row));
  }

  getPlaylist(id: string): Playlist {
    const row = this.db.prepare("SELECT * FROM playlists WHERE id = ?").get(id) as PlaylistRow | undefined;
    if (!row) {
      throw new Error(`Playlist not found: ${id}`);
    }
    return this.mapPlaylist(row);
  }

  getPlaylistFiles(id: string): Playlist["items"][number]["file"][] {
    return this.getPlaylist(id).items.map((item) => item.file);
  }

  private mapPlaylist(row: PlaylistRow): Playlist {
    const itemRows = this.db
      .prepare(
        `SELECT playlist_items.id AS item_id, playlist_items.position, tracks.id AS track_id, tracks.title AS track_title, track_files.file_id
         FROM playlist_items
         JOIN tracks ON tracks.id = playlist_items.track_id
         JOIN track_files ON track_files.track_id = tracks.id
         WHERE playlist_items.playlist_id = ?
         ORDER BY playlist_items.position ASC`
      )
      .all(row.id) as PlaylistItemRow[];

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      type: row.type,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: itemRows.map((item) => ({
        id: item.item_id,
        position: item.position,
        track: {
          id: item.track_id,
          title: item.track_title
        },
        file: this.library.getFile(item.file_id)
      }))
    };
  }
}

interface PlaylistRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface PlaylistItemRow {
  item_id: string;
  position: number;
  track_id: string;
  track_title: string;
  file_id: string;
}
