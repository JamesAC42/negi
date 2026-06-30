import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import type {
  AudioFile,
  AlbumGroup,
  AlternateEditionGroup,
  AlbumMergeSuggestion,
  DuplicateCandidate,
  DuplicateGroup,
  EditableFileMetadata,
  IncompleteAlbum,
  LibraryFilesResponse,
  LibraryRoot,
  MetadataGap,
  QualityUpgradeCandidate,
  QualityUpgradeSuggestion
} from "@music-os/core";

export interface FileUpsertInput {
  libraryRootId: string | null;
  path: string;
  normalizedPath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  mtime: string;
  ctime: string | null;
  sha256: string | null;
  quickHash: string | null;
  durationMs: number | null;
  codec: string | null;
  container: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  scanStatus: string;
  staged?: boolean;
  importItemId?: string | null;
  tags: Array<{ key: string; value: string; source: string }>;
}

export interface FileUpsertResult {
  id: string;
  inserted: boolean;
}

const DISPLAY_TAG_KEYS = [
  "title",
  "artist",
  "album",
  "albumartist",
  "date",
  "year",
  "genre",
  "track",
  "tracknumber",
  "tracktotal",
  "totaltracks",
  "disc",
  "discnumber",
  "disctotal",
  "totaldiscs"
] as const;
const displayTagSqlList = DISPLAY_TAG_KEYS.map((key) => `'${key}'`).join(", ");

export class LibraryRepository {
  constructor(private readonly db: Database.Database) {}

  addRoot(path: string, name: string, watchEnabled = false): LibraryRoot {
    const existing = this.db
      .prepare("SELECT * FROM library_roots WHERE path = ?")
      .get(path) as LibraryRootRow | undefined;

    if (existing) {
      return watchEnabled && !existing.watch_enabled ? this.setRootWatchEnabled(existing.id, true) : mapRoot(existing);
    }

    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO library_roots (id, path, name, enabled, watch_enabled)
         VALUES (@id, @path, @name, 1, @watchEnabled)`
      )
      .run({ id, path, name, watchEnabled: watchEnabled ? 1 : 0 });

    return this.getRoot(id);
  }

  listRoots(): LibraryRoot[] {
    return this.db
      .prepare("SELECT * FROM library_roots ORDER BY created_at DESC")
      .all()
      .map((row) => mapRoot(row as LibraryRootRow));
  }

  listWatchedRoots(): LibraryRoot[] {
    return this.db
      .prepare("SELECT * FROM library_roots WHERE enabled = 1 AND watch_enabled = 1 ORDER BY created_at DESC")
      .all()
      .map((row) => mapRoot(row as LibraryRootRow));
  }

  getRoot(id: string): LibraryRoot {
    const row = this.db.prepare("SELECT * FROM library_roots WHERE id = ?").get(id) as
      | LibraryRootRow
      | undefined;
    if (!row) {
      throw new Error(`Library root not found: ${id}`);
    }
    return mapRoot(row);
  }

  removeRoot(id: string): void {
    const exists = this.db.prepare("SELECT id FROM library_roots WHERE id = ?").get(id);
    if (!exists) {
      throw new Error(`Library root not found: ${id}`);
    }

    const remove = this.db.transaction(() => {
      const fileRows = this.db.prepare("SELECT id FROM files WHERE library_root_id = ?").all(id) as Array<{
        id: string;
      }>;
      const fileIds = fileRows.map((row) => row.id);

      if (fileIds.length > 0) {
        const placeholders = fileIds.map(() => "?").join(",");
        this.db.prepare(`UPDATE import_items SET file_id = NULL WHERE file_id IN (${placeholders})`).run(...fileIds);
        this.db.prepare(`DELETE FROM file_metadata_overrides WHERE file_id IN (${placeholders})`).run(...fileIds);
        this.db.prepare(`DELETE FROM file_preferences WHERE file_id IN (${placeholders})`).run(...fileIds);
        this.db.prepare(`DELETE FROM embedded_tags WHERE file_id IN (${placeholders})`).run(...fileIds);
        this.db.prepare(`DELETE FROM audio_fingerprints WHERE file_id IN (${placeholders})`).run(...fileIds);
        this.db.prepare(`DELETE FROM track_files WHERE file_id IN (${placeholders})`).run(...fileIds);
        this.db.prepare(`DELETE FROM files WHERE id IN (${placeholders})`).run(...fileIds);
      }

      this.db.prepare("DELETE FROM library_roots WHERE id = ?").run(id);
    });

    remove();
  }

  setRootWatchEnabled(id: string, watchEnabled: boolean): LibraryRoot {
    const result = this.db
      .prepare("UPDATE library_roots SET watch_enabled = ?, updated_at = datetime('now') WHERE id = ?")
      .run(watchEnabled ? 1 : 0, id);
    if (result.changes === 0) {
      throw new Error(`Library root not found: ${id}`);
    }
    return this.getRoot(id);
  }

  upsertFile(input: FileUpsertInput): FileUpsertResult {
    const existing = this.db
      .prepare("SELECT id FROM files WHERE normalized_path = ?")
      .get(input.normalizedPath) as { id: string } | undefined;

    const id = existing?.id ?? nanoid();
    const inserted = !existing;

    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO files (
            id, library_root_id, path, normalized_path, filename, extension,
            size_bytes, mtime, ctime, sha256, quick_hash, duration_ms, codec, container, bitrate,
            sample_rate, channels, date_updated, scan_status, missing, staged, import_item_id
          )
          VALUES (
            @id, @libraryRootId, @path, @normalizedPath, @filename, @extension,
            @sizeBytes, @mtime, @ctime, @sha256, @quickHash, @durationMs, @codec, @container, @bitrate,
            @sampleRate, @channels, datetime('now'), @scanStatus, 0, @staged, @importItemId
          )
          ON CONFLICT(normalized_path) DO UPDATE SET
            library_root_id = excluded.library_root_id,
            path = excluded.path,
            filename = excluded.filename,
            extension = excluded.extension,
            size_bytes = excluded.size_bytes,
            mtime = excluded.mtime,
            ctime = excluded.ctime,
            sha256 = excluded.sha256,
            quick_hash = excluded.quick_hash,
            duration_ms = excluded.duration_ms,
            codec = excluded.codec,
            container = excluded.container,
            bitrate = excluded.bitrate,
            sample_rate = excluded.sample_rate,
            channels = excluded.channels,
            date_updated = datetime('now'),
            scan_status = excluded.scan_status,
            missing = 0,
            staged = excluded.staged,
            import_item_id = excluded.import_item_id`
        )
        .run({ id, ...input, staged: input.staged ? 1 : 0, importItemId: input.importItemId ?? null });

      this.db.prepare("DELETE FROM embedded_tags WHERE file_id = ?").run(id);
      const insertTag = this.db.prepare(
        `INSERT INTO embedded_tags (id, file_id, tag_key, tag_value, source)
         VALUES (@id, @fileId, @key, @value, @source)`
      );
      for (const tag of input.tags) {
        insertTag.run({ id: nanoid(), fileId: id, ...tag });
      }
    });

    write();
    return { id, inserted };
  }

  replaceFile(existingId: string, input: FileUpsertInput): void {
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE files
           SET library_root_id = @libraryRootId,
               path = @path,
               normalized_path = @normalizedPath,
               filename = @filename,
               extension = @extension,
               size_bytes = @sizeBytes,
               mtime = @mtime,
               ctime = @ctime,
               sha256 = @sha256,
               quick_hash = @quickHash,
               duration_ms = @durationMs,
               codec = @codec,
               container = @container,
               bitrate = @bitrate,
               sample_rate = @sampleRate,
               channels = @channels,
               date_updated = datetime('now'),
               scan_status = @scanStatus,
               missing = 0,
               staged = @staged,
               import_item_id = @importItemId
           WHERE id = @id`
        )
        .run({ id: existingId, ...input, staged: input.staged ? 1 : 0, importItemId: input.importItemId ?? null });

      this.db.prepare("DELETE FROM embedded_tags WHERE file_id = ?").run(existingId);
      const insertTag = this.db.prepare(
        `INSERT INTO embedded_tags (id, file_id, tag_key, tag_value, source)
         VALUES (@id, @fileId, @key, @value, @source)`
      );
      for (const tag of input.tags) {
        insertTag.run({ id: nanoid(), fileId: existingId, ...tag });
      }
    });

    write();
  }

  promoteStagedFile(fileId: string, libraryRootId: string, finalPath: string): void {
    const fileStat = statSync(finalPath);
    this.db
      .prepare(
        `UPDATE files
         SET library_root_id = ?,
             path = ?,
             normalized_path = ?,
             filename = ?,
             extension = ?,
             size_bytes = ?,
             mtime = ?,
             ctime = ?,
             date_updated = datetime('now'),
             scan_status = CASE WHEN scan_status = 'import_warning' THEN scan_status ELSE 'scanned' END,
             missing = 0,
             staged = 0,
             import_item_id = NULL
         WHERE id = ?`
      )
      .run(
        libraryRootId,
        finalPath,
        normalizeRepositoryPath(finalPath),
        basename(finalPath),
        extname(finalPath).toLowerCase().replace(/^\./, ""),
        fileStat.size,
        fileStat.mtime.toISOString(),
        fileStat.ctime.toISOString(),
        fileId
      );
  }

  markMissingFiles(rootId: string, seenNormalizedPaths: Set<string>): number {
    const rows = this.db
      .prepare("SELECT id, normalized_path FROM files WHERE library_root_id = ? AND missing = 0")
      .all(rootId) as Array<{ id: string; normalized_path: string }>;

    const markMissing = this.db.prepare(
      "UPDATE files SET missing = 1, scan_status = 'missing', date_updated = datetime('now') WHERE id = ?"
    );

    let count = 0;
    const update = this.db.transaction(() => {
      for (const row of rows) {
        if (!seenNormalizedPaths.has(row.normalized_path)) {
          markMissing.run(row.id);
          count += 1;
        }
      }
    });
    update();
    return count;
  }

  markRootScanned(rootId: string): void {
    this.db
      .prepare("UPDATE library_roots SET last_scan_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(rootId);
  }

  listFiles(query = "", limit = Number.POSITIVE_INFINITY, offset = 0): LibraryFilesResponse["files"] {
    const like = `%${query.trim().toLowerCase()}%`;
    const pagination = getPaginationClause(limit, offset);
    const rows = query.trim()
      ? this.db
          .prepare(
            `${filesWithPlaybackStatsSql}
             WHERE files.staged = 0
               AND (
                 lower(files.filename) LIKE @like OR
                 lower(files.path) LIKE @like OR
                 files.id IN (
                   SELECT file_id FROM embedded_tags
                   WHERE lower(tag_value) LIKE @like
                 ) OR
                 files.id IN (
                   SELECT file_id FROM file_metadata_overrides
                   WHERE lower(tag_value) LIKE @like
                 )
               )
             ORDER BY files.date_updated DESC
             ${pagination.sql}`
          )
          .all({ like, ...pagination.params })
      : this.db
          .prepare(
            `${filesWithPlaybackStatsSql}
             WHERE files.staged = 0
             ORDER BY files.date_updated DESC
             ${pagination.sql}`
          )
          .all(pagination.params);

    return this.mapRowsWithDisplayTags(rows as FileRow[]);
  }

  countPlayableFiles(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM files WHERE staged = 0 AND missing = 0")
      .get() as { total: number };
    return row.total;
  }

  listLikedFiles(limit = 100): LibraryFilesResponse["files"] {
    const pagination = getPaginationClause(limit, 0);
    const rows = this.db
      .prepare(
        `${filesWithPlaybackStatsSql}
         WHERE files.staged = 0
           AND files.missing = 0
           AND (file_preferences.liked = 1 OR file_preferences.rating >= 4)
         ORDER BY COALESCE(file_preferences.liked, 0) DESC,
                  COALESCE(file_preferences.rating, 0) DESC,
                  files.date_updated DESC
         ${pagination.sql}`
      )
      .all(pagination.params) as FileRow[];
    return this.mapRowsWithDisplayTags(rows);
  }

  listHighRotationFiles(limit = 100): LibraryFilesResponse["files"] {
    const pagination = getPaginationClause(limit, 0);
    const rows = this.db
      .prepare(
        `${filesWithPlaybackStatsSql}
         WHERE files.staged = 0
           AND files.missing = 0
           AND COALESCE(playback_stats.play_count, 0) > 0
         ORDER BY COALESCE(playback_stats.play_count, 0) DESC,
                  playback_stats.last_played_at DESC,
                  files.date_updated DESC
         ${pagination.sql}`
      )
      .all(pagination.params) as FileRow[];
    return this.mapRowsWithDisplayTags(rows);
  }

  listRecentlyPlayedFiles(limit = 100): LibraryFilesResponse["files"] {
    const pagination = getPaginationClause(limit, 0);
    const rows = this.db
      .prepare(
        `${filesWithPlaybackStatsSql}
         WHERE files.staged = 0
           AND files.missing = 0
           AND playback_stats.last_played_at IS NOT NULL
         ORDER BY playback_stats.last_played_at DESC,
                  files.date_updated DESC
         ${pagination.sql}`
      )
      .all(pagination.params) as FileRow[];
    return this.mapRowsWithDisplayTags(rows);
  }

  getFile(id: string): LibraryFilesResponse["files"][number] {
    const row = this.db.prepare(`${filesWithPlaybackStatsSql} WHERE files.id = ?`).get(id) as FileRow | undefined;
    if (!row) {
      throw new Error(`File not found: ${id}`);
    }

    const file = mapFile(row);
    return { ...file, displayTags: this.getDisplayTags(file.id) };
  }

  countFiles(query = ""): number {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      const row = this.db.prepare("SELECT COUNT(*) as total FROM files WHERE staged = 0").get() as { total: number };
      return row.total;
    }

    const like = `%${trimmed}%`;
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as total
         FROM files
         WHERE files.staged = 0
           AND (
             lower(files.filename) LIKE @like OR
             lower(files.path) LIKE @like OR
             files.id IN (
               SELECT file_id FROM embedded_tags
               WHERE lower(tag_value) LIKE @like
             ) OR
             files.id IN (
               SELECT file_id FROM file_metadata_overrides
               WHERE lower(tag_value) LIKE @like
             )
           )`
      )
      .get({ like }) as { total: number };
    return row.total;
  }

  listAlbumGroups(limit = Number.POSITIVE_INFINITY, offset = 0): AlbumGroup[] {
    const rows = this.db
      .prepare(
        `${filesWithPlaybackStatsSql}
         WHERE files.staged = 0
           AND files.missing = 0
         ORDER BY files.date_updated DESC`
      )
      .all() as FileRow[];

    const files = this.mapRowsWithDisplayTags(rows);
    const groups = new Map<string, AlbumGroup>();
    for (const fileWithTags of files) {
      const album = cleanAlbumLabel(fileWithTags.displayTags.album);
      if (!album) {
        continue;
      }

      const artist = cleanAlbumLabel(fileWithTags.displayTags.albumartist ?? fileWithTags.displayTags.artist) ?? "Unknown Artist";
      const year = cleanYear(fileWithTags.displayTags.year ?? fileWithTags.displayTags.date);
      const key = albumGroupKey(artist, album, year);
      const existing =
        groups.get(key) ??
        ({
          id: key,
          artist,
          album,
          year,
          fileCount: 0,
          durationMs: null,
          formats: [],
          files: []
        } satisfies AlbumGroup);

      existing.files.push(fileWithTags);
      existing.fileCount = existing.files.length;
      existing.durationMs =
        fileWithTags.durationMs == null ? existing.durationMs : (existing.durationMs ?? 0) + fileWithTags.durationMs;
      existing.formats = [...new Set([...existing.formats, fileWithTags.extension.toUpperCase()])].sort();
      groups.set(key, existing);
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        files: sortAlbumFiles(group.files)
      }))
      .sort(
        (left, right) =>
          left.artist.localeCompare(right.artist) ||
          (left.year ?? "").localeCompare(right.year ?? "") ||
          left.album.localeCompare(right.album)
      )
      .slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
  }

  getAlbumFiles(albumId: string): LibraryFilesResponse["files"] {
    const album = this.listAlbumGroups(Number.MAX_SAFE_INTEGER).find((group) => group.id === albumId);
    if (!album) {
      throw new Error(`Album not found: ${albumId}`);
    }
    return album.files;
  }

  getDisplayTags(fileId: string): Record<string, string> {
    return this.getDisplayTagsForFileIds([fileId]).get(fileId) ?? {};
  }

  private mapRowsWithDisplayTags(rows: FileRow[]): LibraryFilesResponse["files"] {
    const files = rows.map((row) => mapFile(row));
    const tagsByFileId = this.getDisplayTagsForFileIds(files.map((file) => file.id));
    return files.map((file) => ({ ...file, displayTags: tagsByFileId.get(file.id) ?? {} }));
  }

  private getDisplayTagsForFileIds(fileIds: string[]): Map<string, Record<string, string>> {
    const tagsByFileId = new Map<string, Record<string, string>>();
    const uniqueFileIds = [...new Set(fileIds)];
    if (uniqueFileIds.length === 0) {
      return tagsByFileId;
    }

    const readRows = (
      table: "embedded_tags" | "file_metadata_overrides",
      ids: string[]
    ): Array<{ file_id: string; tag_key: string; tag_value: string }> => {
      const rows: Array<{ file_id: string; tag_key: string; tag_value: string }> = [];
      for (const chunk of chunkArray(ids, 800)) {
        const placeholders = chunk.map(() => "?").join(",");
        rows.push(
          ...(this.db
            .prepare(
              `SELECT file_id, tag_key, tag_value FROM ${table}
               WHERE file_id IN (${placeholders})
                 AND tag_key IN (${displayTagSqlList})`
            )
            .all(...chunk) as Array<{ file_id: string; tag_key: string; tag_value: string }>)
        );
      }
      return rows;
    };

    for (const row of readRows("embedded_tags", uniqueFileIds)) {
      const tags = tagsByFileId.get(row.file_id) ?? {};
      tags[row.tag_key] = row.tag_value;
      tagsByFileId.set(row.file_id, tags);
    }

    for (const row of readRows("file_metadata_overrides", uniqueFileIds)) {
      const tags = tagsByFileId.get(row.file_id) ?? {};
      tags[row.tag_key] = row.tag_value;
      tagsByFileId.set(row.file_id, tags);
    }

    return tagsByFileId;
  }

  setFileMetadataOverrides(fileId: string, metadata: EditableFileMetadata): LibraryFilesResponse["files"][number] {
    this.getFile(fileId);
    const allowedKeys = ["title", "artist", "albumartist", "album", "year", "date", "genre", "tracknumber", "discnumber"] as const;
    const write = this.db.transaction(() => {
      const remove = this.db.prepare("DELETE FROM file_metadata_overrides WHERE file_id = ? AND tag_key = ?");
      const upsert = this.db.prepare(
        `INSERT INTO file_metadata_overrides (file_id, tag_key, tag_value, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(file_id, tag_key) DO UPDATE SET
           tag_value = excluded.tag_value,
           updated_at = datetime('now')`
      );

      for (const key of allowedKeys) {
        if (!(key in metadata)) {
          continue;
        }

        const raw = metadata[key];
        const value = typeof raw === "string" ? raw.trim() : "";
        if (value) {
          upsert.run(fileId, key, value);
        } else {
          remove.run(fileId, key);
        }
      }
      this.db.prepare("UPDATE files SET date_updated = datetime('now') WHERE id = ?").run(fileId);
    });

    write();
    return this.getFile(fileId);
  }

  setFileRating(fileId: string, rating: number | null): LibraryFilesResponse["files"][number] {
    this.getFile(fileId);
    this.db
      .prepare(
        `INSERT INTO file_preferences (file_id, rating, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(file_id) DO UPDATE SET
           rating = excluded.rating,
           updated_at = datetime('now')`
      )
      .run(fileId, rating);
    return this.getFile(fileId);
  }

  setFileFavoriteStatus(
    fileId: string,
    input: { liked?: boolean | null; disliked?: boolean | null }
  ): LibraryFilesResponse["files"][number] {
    const current = this.getFile(fileId);
    const liked = input.liked === undefined ? current.liked : input.liked;
    const disliked = input.disliked === undefined ? current.disliked : input.disliked;
    const normalized = normalizeFavoriteStatus(liked, disliked);
    this.db
      .prepare(
        `INSERT INTO file_preferences (file_id, liked, disliked, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(file_id) DO UPDATE SET
           liked = excluded.liked,
           disliked = excluded.disliked,
           updated_at = datetime('now')`
      )
      .run(fileId, nullableBooleanToInteger(normalized.liked), nullableBooleanToInteger(normalized.disliked));
    return this.getFile(fileId);
  }

  removeFileFromLibrary(fileId: string): { removedFromIndex: true; fileDeletedFromDisk: false; file: LibraryFilesResponse["files"][number] } {
    const before = this.getFile(fileId);
    const remove = this.db.transaction(() => {
      this.db.prepare("UPDATE import_items SET file_id = NULL WHERE file_id = ?").run(fileId);
      this.db.prepare("DELETE FROM file_metadata_overrides WHERE file_id = ?").run(fileId);
      this.db.prepare("DELETE FROM file_preferences WHERE file_id = ?").run(fileId);
      this.db.prepare("DELETE FROM embedded_tags WHERE file_id = ?").run(fileId);
      this.db.prepare("DELETE FROM audio_fingerprints WHERE file_id = ?").run(fileId);
      this.db.prepare("DELETE FROM track_files WHERE file_id = ?").run(fileId);
      this.db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
    });
    remove();
    return { removedFromIndex: true, fileDeletedFromDisk: false, file: before };
  }

  findDuplicateCandidates(sha256: string | null, excludeFileId?: string | null): DuplicateCandidate[] {
    if (!sha256) {
      return [];
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM files
         WHERE sha256 = @sha256
           AND staged = 0
           AND missing = 0
           AND (@excludeFileId IS NULL OR id != @excludeFileId)
         ORDER BY date_updated DESC
         LIMIT 25`
      )
      .all({ sha256, excludeFileId: excludeFileId ?? null }) as FileRow[];

    return rows.map((row) => {
      const tags = this.getDisplayTags(row.id);
      return {
        fileId: row.id,
        path: row.path,
        filename: row.filename,
        title: tags.title ?? null,
        artist: tags.artist ?? tags.albumartist ?? null,
        album: tags.album ?? null,
        reason: "Exact file hash match"
      };
    });
  }

  upsertAudioFingerprint(input: {
    fileId: string;
    algorithm: string;
    fingerprint: string;
    durationMs: number | null;
    acoustidId?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO audio_fingerprints (id, file_id, algorithm, fingerprint, duration_ms, acoustid_id)
         VALUES (@id, @fileId, @algorithm, @fingerprint, @durationMs, @acoustidId)
         ON CONFLICT(file_id, algorithm) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           duration_ms = excluded.duration_ms,
           acoustid_id = excluded.acoustid_id`
      )
      .run({
        id: nanoid(),
        fileId: input.fileId,
        algorithm: input.algorithm,
        fingerprint: input.fingerprint,
        durationMs: input.durationMs,
        acoustidId: input.acoustidId ?? null
      });
  }

  listDuplicateGroups(): DuplicateGroup[] {
    const hashRows = this.db
      .prepare(
        `SELECT sha256, COUNT(*) AS count
         FROM files
         WHERE sha256 IS NOT NULL
           AND staged = 0
           AND missing = 0
         GROUP BY sha256
         HAVING COUNT(*) > 1
         ORDER BY count DESC, sha256 ASC`
      )
      .all() as Array<{ sha256: string; count: number }>;

    return hashRows.map((hashRow) => {
      const rows = this.db
        .prepare(
          `SELECT * FROM files
           WHERE sha256 = ?
             AND staged = 0
             AND missing = 0
           ORDER BY path ASC`
        )
        .all(hashRow.sha256) as FileRow[];

      return {
        key: hashRow.sha256,
        type: "sha256",
        count: hashRow.count,
        files: rows.map((row) => {
          const file = mapFile(row);
          return { ...file, displayTags: this.getDisplayTags(file.id) };
        })
      };
    });
  }

  listMetadataGaps(limit = 200): MetadataGap[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM files
         WHERE staged = 0
           AND missing = 0
         ORDER BY date_updated DESC`
      )
      .all() as FileRow[];

    const gaps = rows
      .map((row) => {
        const file = mapFile(row);
        const fileWithTags = { ...file, displayTags: this.getDisplayTags(file.id) };
        const missingFields = getMissingMetadataFields(fileWithTags.displayTags);
        if (missingFields.length === 0) {
          return null;
        }

        return {
          file: fileWithTags,
          missingFields,
          suggestedMetadata: suggestMetadataFromFilename(fileWithTags.filename, missingFields),
          completenessScore: (4 - missingFields.length) / 4
        };
      })
      .filter((item): item is MetadataGap => item != null)
      .sort(
        (left, right) =>
          left.completenessScore - right.completenessScore ||
          right.missingFields.length - left.missingFields.length ||
          left.file.path.localeCompare(right.file.path)
      );

    return gaps.slice(0, limit);
  }

  listQualityUpgradeSuggestions(limit = 200): QualityUpgradeSuggestion[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM files
         WHERE staged = 0
           AND missing = 0
         ORDER BY date_updated DESC`
      )
      .all() as FileRow[];

    const groups = new Map<string, Array<LibraryFilesResponse["files"][number]>>();
    for (const row of rows) {
      const file = mapFile(row);
      const fileWithTags = { ...file, displayTags: this.getDisplayTags(file.id) };
      const artist = fileWithTags.displayTags.artist ?? fileWithTags.displayTags.albumartist;
      const title = fileWithTags.displayTags.title;
      if (!artist || !title) {
        continue;
      }

      const key = `${normalizeComparisonValue(artist)}::${normalizeComparisonValue(title)}`;
      const existing = groups.get(key) ?? [];
      existing.push(fileWithTags);
      groups.set(key, existing);
    }

    const suggestions: QualityUpgradeSuggestion[] = [];
    for (const [key, files] of groups) {
      if (files.length < 2) {
        continue;
      }

      const ranked = files.map(toQualityUpgradeCandidate).sort((left, right) => right.qualityScore - left.qualityScore);
      const preferred = ranked[0];
      const candidates = ranked.slice(1).filter((candidate) => preferred.qualityScore - candidate.qualityScore >= 20);
      if (candidates.length === 0) {
        continue;
      }

      suggestions.push({
        key,
        artist: preferred.file.displayTags.artist ?? preferred.file.displayTags.albumartist ?? "Unknown Artist",
        title: preferred.file.displayTags.title ?? preferred.file.filename,
        preferred,
        candidates
      });
    }

    return suggestions
      .sort(
        (left, right) =>
          right.candidates.length - left.candidates.length ||
          right.preferred.qualityScore - left.preferred.qualityScore ||
          left.artist.localeCompare(right.artist) ||
          left.title.localeCompare(right.title)
      )
      .slice(0, limit);
  }

  listIncompleteAlbums(limit = 200): IncompleteAlbum[] {
    return this.listAlbumGroups(Number.MAX_SAFE_INTEGER)
      .map((album) => {
        let expectedTracks = 0;
        const presentTrackNumbers = new Set<number>();
        for (const file of album.files) {
          const track = readTrackNumber(file.displayTags, file.filename);
          if (track !== Number.MAX_SAFE_INTEGER) {
            presentTrackNumbers.add(track);
          }
          const total = readTotalTrackCount(file.displayTags);
          if (total != null) {
            expectedTracks = Math.max(expectedTracks, total);
          }
        }

        if (expectedTracks <= 0 || presentTrackNumbers.size >= expectedTracks) {
          return null;
        }

        const missingTrackNumbers: number[] = [];
        for (let track = 1; track <= expectedTracks; track += 1) {
          if (!presentTrackNumbers.has(track)) {
            missingTrackNumbers.push(track);
          }
        }

        return {
          key: album.id,
          artist: album.artist,
          album: album.album,
          year: album.year,
          expectedTracks,
          presentTracks: presentTrackNumbers.size,
          missingTrackNumbers,
          files: album.files
        };
      })
      .filter((album): album is IncompleteAlbum => album != null)
      .sort(
        (left, right) =>
          right.missingTrackNumbers.length - left.missingTrackNumbers.length ||
          left.artist.localeCompare(right.artist) ||
          left.album.localeCompare(right.album)
      )
      .slice(0, limit);
  }

  listAlbumMergeSuggestions(limit = 200): AlbumMergeSuggestion[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM files
         WHERE staged = 0
           AND missing = 0
         ORDER BY date_updated DESC`
      )
      .all() as FileRow[];

    const groups = new Map<string, Map<string, Array<LibraryFilesResponse["files"][number]>>>();
    const artistLabels = new Map<string, string>();
    for (const row of rows) {
      const file = mapFile(row);
      const fileWithTags = { ...file, displayTags: this.getDisplayTags(file.id) };
      const artist = fileWithTags.displayTags.albumartist ?? fileWithTags.displayTags.artist;
      const album = fileWithTags.displayTags.album;
      if (!artist || !album) {
        continue;
      }

      const baseAlbum = normalizeAlbumMergeTitle(album);
      if (!baseAlbum) {
        continue;
      }

      const key = `${normalizeComparisonValue(artist)}::${baseAlbum}`;
      artistLabels.set(key, artist);
      const albumMap = groups.get(key) ?? new Map<string, Array<LibraryFilesResponse["files"][number]>>();
      const files = albumMap.get(album) ?? [];
      files.push(fileWithTags);
      albumMap.set(album, files);
      groups.set(key, albumMap);
    }

    const suggestions: AlbumMergeSuggestion[] = [];
    for (const [key, albumMap] of groups) {
      if (albumMap.size < 2) {
        continue;
      }

      const variants = [...albumMap.entries()]
        .map(([album, files]) => ({ album, fileCount: files.length, files }))
        .sort((left, right) => right.fileCount - left.fileCount || left.album.length - right.album.length || left.album.localeCompare(right.album));
      const canonicalAlbum = variants[0].album;
      suggestions.push({
        key,
        artist: artistLabels.get(key) ?? "Unknown Artist",
        canonicalAlbum,
        variants
      });
    }

    return suggestions
      .sort(
        (left, right) =>
          right.variants.reduce((total, variant) => total + variant.fileCount, 0) -
            left.variants.reduce((total, variant) => total + variant.fileCount, 0) ||
          left.artist.localeCompare(right.artist) ||
          left.canonicalAlbum.localeCompare(right.canonicalAlbum)
      )
      .slice(0, limit);
  }

  listAlternateEditionGroups(limit = 200): AlternateEditionGroup[] {
    return this.listAlbumMergeSuggestions(limit * 2)
      .map((suggestion) => ({
        key: suggestion.key,
        artist: suggestion.artist,
        baseAlbum: getAlbumBaseDisplay(suggestion.canonicalAlbum),
        editions: suggestion.variants
          .map((variant) => ({
            edition: detectEditionLabel(variant.album),
            album: variant.album,
            fileCount: variant.fileCount,
            files: variant.files
          }))
          .sort((left, right) => editionSortScore(left.edition) - editionSortScore(right.edition) || left.album.localeCompare(right.album))
      }))
      .filter((group) => group.editions.length >= 2)
      .slice(0, limit);
  }
}

interface LibraryRootRow {
  id: string;
  path: string;
  name: string;
  enabled: number;
  watch_enabled: number;
  created_at: string;
  updated_at: string;
  last_scan_at: string | null;
}

interface FileRow {
  id: string;
  library_root_id: string | null;
  path: string;
  normalized_path: string;
  filename: string;
  extension: string;
  size_bytes: number;
  mtime: string;
  ctime: string | null;
  sha256: string | null;
  quick_hash: string | null;
  duration_ms: number | null;
  codec: string | null;
  container: string | null;
  bitrate: number | null;
  sample_rate: number | null;
  channels: number | null;
  scan_status: string;
  staged: number;
  missing: number;
  play_count?: number;
  skip_count?: number;
  last_played_at?: string | null;
  last_skipped_at?: string | null;
  rating?: number | null;
  liked?: number | null;
  disliked?: number | null;
}

const filesWithPlaybackStatsSql = `
  SELECT files.*,
         COALESCE(playback_stats.play_count, 0) AS play_count,
         COALESCE(playback_stats.skip_count, 0) AS skip_count,
         playback_stats.last_played_at,
         playback_stats.last_skipped_at,
         file_preferences.rating,
         file_preferences.liked,
         file_preferences.disliked
  FROM files
  LEFT JOIN (
    SELECT file_id,
           SUM(CASE WHEN event_type = 'played' THEN 1 ELSE 0 END) AS play_count,
           SUM(CASE WHEN event_type = 'skipped' THEN 1 ELSE 0 END) AS skip_count,
           MAX(CASE WHEN event_type = 'played' THEN created_at ELSE NULL END) AS last_played_at,
           MAX(CASE WHEN event_type = 'skipped' THEN created_at ELSE NULL END) AS last_skipped_at
    FROM playback_events
    GROUP BY file_id
  ) playback_stats ON playback_stats.file_id = files.id
  LEFT JOIN file_preferences ON file_preferences.file_id = files.id
`;

function mapRoot(row: LibraryRootRow): LibraryRoot {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    enabled: Boolean(row.enabled),
    watchEnabled: Boolean(row.watch_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastScanAt: row.last_scan_at
  };
}

function mapFile(row: FileRow): AudioFile {
  return {
    id: row.id,
    libraryRootId: row.library_root_id,
    path: row.path,
    normalizedPath: row.normalized_path,
    filename: row.filename,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    mtime: row.mtime,
    ctime: row.ctime,
    sha256: row.sha256,
    quickHash: row.quick_hash,
    durationMs: row.duration_ms,
    codec: row.codec,
    bitrate: row.bitrate,
    sampleRate: row.sample_rate,
    channels: row.channels,
    scanStatus: row.scan_status,
    staged: Boolean(row.staged),
    missing: Boolean(row.missing),
    playCount: row.play_count ?? 0,
    skipCount: row.skip_count ?? 0,
    lastPlayedAt: row.last_played_at ?? null,
    lastSkippedAt: row.last_skipped_at ?? null,
    rating: row.rating ?? null,
    liked: row.liked == null ? null : Boolean(row.liked),
    disliked: row.disliked == null ? null : Boolean(row.disliked)
  };
}

function normalizeRepositoryPath(path: string): string {
  return resolve(path).toLowerCase();
}

function getMissingMetadataFields(displayTags: Record<string, string>): MetadataGap["missingFields"] {
  const fields: MetadataGap["missingFields"] = [];
  if (!hasTag(displayTags.title)) {
    fields.push("title");
  }
  if (!hasTag(displayTags.artist) && !hasTag(displayTags.albumartist)) {
    fields.push("artist");
  }
  if (!hasTag(displayTags.album)) {
    fields.push("album");
  }
  if (!hasTag(displayTags.year) && !hasTag(displayTags.date)) {
    fields.push("year");
  }
  return fields;
}

function albumGroupKey(artist: string, album: string, year: string | null): string {
  return [normalizeComparisonValue(artist), normalizeComparisonValue(album), year ?? ""].join("::");
}

function cleanAlbumLabel(value: string | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanYear(value: string | undefined): string | null {
  const match = value?.match(/\b(\d{4})\b/);
  return match?.[1] ?? null;
}

function sortAlbumFiles(files: LibraryFilesResponse["files"]): LibraryFilesResponse["files"] {
  return [...files].sort((left, right) => {
    const discCompare = readDiscNumber(left.displayTags) - readDiscNumber(right.displayTags);
    if (discCompare !== 0) {
      return discCompare;
    }

    const trackLeft = readTrackNumber(left.displayTags, left.filename);
    const trackRight = readTrackNumber(right.displayTags, right.filename);
    if (trackLeft !== trackRight) {
      return trackLeft - trackRight;
    }

    return left.filename.localeCompare(right.filename, undefined, { numeric: true, sensitivity: "base" });
  });
}

function readDiscNumber(tags: Record<string, string>): number {
  return readNumericTag(tags.discnumber ?? tags.disc) ?? 1;
}

function readTrackNumber(tags: Record<string, string>, filename: string): number {
  return readNumericTag(tags.tracknumber ?? tags.track) ?? readFilenameTrackNumber(filename) ?? Number.MAX_SAFE_INTEGER;
}

function readTotalTrackCount(tags: Record<string, string>): number | null {
  const explicit = readNumericTag(tags.tracktotal ?? tags.totaltracks);
  if (explicit != null) {
    return explicit;
  }

  const compound = tags.tracknumber ?? tags.track;
  const match = compound?.match(/\/\s*(\d+)/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readNumericTag(value: string | undefined): number | null {
  const match = value?.match(/\d+/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readFilenameTrackNumber(filename: string): number | null {
  const match = filename.match(/(?:^|[\s._-])(\d{1,2})(?:[\s._-])/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFavoriteStatus(
  liked: boolean | null,
  disliked: boolean | null
): { liked: boolean | null; disliked: boolean | null } {
  if (liked === true) {
    return { liked: true, disliked: false };
  }
  if (disliked === true) {
    return { liked: false, disliked: true };
  }
  return { liked, disliked };
}

function nullableBooleanToInteger(value: boolean | null): number | null {
  return value == null ? null : value ? 1 : 0;
}

function hasTag(value: string | undefined): boolean {
  return value != null && value.trim().length > 0;
}

function suggestMetadataFromFilename(filename: string, missingFields: MetadataGap["missingFields"]): EditableFileMetadata {
  const stem = filename.replace(/\.[^.]+$/, "").trim();
  const suggestion: EditableFileMetadata = {};
  const artistTitle = stem.match(/^(.+?)\s+-\s+(.+)$/);

  if (artistTitle) {
    if (missingFields.includes("artist")) {
      suggestion.artist = cleanFilenameMetadataValue(artistTitle[1]);
    }
    if (missingFields.includes("title")) {
      suggestion.title = cleanFilenameMetadataValue(artistTitle[2]);
    }
  } else if (missingFields.includes("title")) {
    suggestion.title = cleanFilenameMetadataValue(stem);
  }

  const yearMatch = stem.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch && missingFields.includes("year")) {
    suggestion.year = yearMatch[1];
  }

  return suggestion;
}

function cleanFilenameMetadataValue(value: string): string {
  return value.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeComparisonValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeAlbumMergeTitle(value: string): string {
  return normalizeComparisonValue(
    value
      .replace(/\((?:deluxe|expanded|remaster(?:ed)?|anniversary|bonus|special|limited|mono|stereo|disc \d+|cd \d+)[^)]*\)/gi, "")
      .replace(/\[(?:deluxe|expanded|remaster(?:ed)?|anniversary|bonus|special|limited|mono|stereo|disc \d+|cd \d+)[^\]]*\]/gi, "")
      .replace(/\b(?:deluxe|expanded|remaster(?:ed)?|anniversary|bonus|special|limited|edition)\b/gi, "")
  );
}

function getAlbumBaseDisplay(value: string): string {
  const cleaned = value
    .replace(/\s*\((?:deluxe|expanded|remaster(?:ed)?|anniversary|bonus|special|limited|mono|stereo|disc \d+|cd \d+)[^)]*\)/gi, "")
    .replace(/\s*\[(?:deluxe|expanded|remaster(?:ed)?|anniversary|bonus|special|limited|mono|stereo|disc \d+|cd \d+)[^\]]*\]/gi, "")
    .replace(/\b(?:deluxe|expanded|remaster(?:ed)?|anniversary|bonus|special|limited|edition)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || value;
}

function detectEditionLabel(album: string): string {
  const parenthetical = album.match(/[\[(]([^)\]]*(?:deluxe|expanded|remaster(?:ed)?|anniversary|bonus|special|limited|mono|stereo|disc \d+|cd \d+)[^)\]]*)[\])]/i);
  if (parenthetical?.[1]) {
    return titleCase(parenthetical[1]);
  }

  const inline = album.match(/\b(deluxe(?: edition)?|expanded(?: edition)?|remaster(?:ed)?|anniversary(?: edition)?|bonus(?: tracks?)?|special(?: edition)?|limited(?: edition)?|mono|stereo|disc \d+|cd \d+)\b/i);
  return inline?.[1] ? titleCase(inline[1]) : "Standard";
}

function editionSortScore(edition: string): number {
  return edition === "Standard" ? 0 : 1;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word.length <= 2 ? word.toUpperCase() : `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`))
    .join(" ");
}

function getPaginationClause(limit: number, offset: number): { sql: string; params: { limit?: number; offset?: number } } {
  if (!Number.isFinite(limit)) {
    return { sql: "", params: {} };
  }

  return {
    sql: "LIMIT @limit OFFSET @offset",
    params: {
      limit: Math.max(0, Math.floor(limit)),
      offset: Math.max(0, Math.floor(offset))
    }
  };
}

function toQualityUpgradeCandidate(file: LibraryFilesResponse["files"][number]): QualityUpgradeCandidate {
  const reasons: string[] = [];
  let score = 0;
  const extension = file.extension.toLowerCase();
  if (isLosslessExtension(extension)) {
    score += 100;
    reasons.push("lossless format");
  } else {
    score += 35;
    reasons.push("lossy format");
  }

  if (file.bitrate) {
    const kbps = Math.round(file.bitrate / 1000);
    score += Math.min(60, kbps / 8);
    reasons.push(`${kbps} kbps`);
  }

  if (file.sampleRate) {
    reasons.push(`${(file.sampleRate / 1000).toFixed(1)} kHz`);
  }

  if (file.sizeBytes > 0) {
    score += Math.min(10, file.sizeBytes / 50_000_000);
  }

  return {
    file,
    qualityScore: Math.round(score),
    qualityLabel: getQualityLabel(file),
    reasons
  };
}

function isLosslessExtension(extension: string): boolean {
  return ["flac", "alac", "wav", "aiff", "ape"].includes(extension);
}

function getQualityLabel(file: LibraryFilesResponse["files"][number]): string {
  const extension = file.extension.toUpperCase();
  const bitrate = file.bitrate ? ` / ${Math.round(file.bitrate / 1000)} kbps` : "";
  return `${extension}${bitrate}`;
}
