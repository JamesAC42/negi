import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { mkdir, rename } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type {
  DiscoveryDownloadJob,
  DiscoveryResult,
  EditableFileMetadata,
  ImportItem,
  Operation,
  OperationBatch,
  OperationBatchStatus,
  OperationType
} from "@music-os/core";
import type { ImportService } from "./import-service.js";
import { LibraryRepository } from "./library-repository.js";
import { scanAudioFile } from "./library-scanner.js";

type OperationSource = "user" | "agent" | "import" | "system";
type RiskLevel = "low" | "medium" | "high" | "dangerous";

interface QueueDownloadService {
  createJob(results: DiscoveryResult[], libraryRootId?: string): DiscoveryDownloadJob;
}

export interface CreateOperationInput {
  type: OperationType;
  payload: unknown;
}

export interface CreateBatchInput {
  source: OperationSource;
  summary: string;
  riskLevel: RiskLevel;
  operations: CreateOperationInput[];
}

export class OperationService {
  constructor(
    private readonly db: Database.Database,
    private readonly imports: ImportService,
    private readonly library: LibraryRepository,
    private readonly downloads?: QueueDownloadService
  ) {}

  createBatch(input: CreateBatchInput): OperationBatch {
    if (input.operations.length === 0) {
      throw new Error("Operation batch requires at least one operation");
    }

    const batchId = nanoid();
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO operation_batches (id, source, status, summary, risk_level)
           VALUES (@id, @source, 'proposed', @summary, @riskLevel)`
        )
        .run({
          id: batchId,
          source: input.source,
          summary: input.summary,
          riskLevel: input.riskLevel
        });

      const insertOperation = this.db.prepare(
        `INSERT INTO operations (id, batch_id, type, status, payload_json)
         VALUES (@id, @batchId, @type, 'proposed', @payloadJson)`
      );
      for (const operation of input.operations) {
        insertOperation.run({
          id: nanoid(),
          batchId,
          type: operation.type,
          payloadJson: JSON.stringify(operation.payload)
        });
      }
    });
    write();
    return this.getBatch(batchId);
  }

  createImportApprovalBatch(importItemId: string, libraryRootId: string, source: OperationSource = "import"): OperationBatch {
    return this.createImportApprovalBatchForItems([importItemId], libraryRootId, source);
  }

  createImportApprovalBatchForItems(
    importItemIds: string[],
    libraryRootId: string,
    source: OperationSource = "import"
  ): OperationBatch {
    const uniqueItemIds = [...new Set(importItemIds)];
    if (uniqueItemIds.length === 0) {
      throw new Error("Import approval batch requires at least one item");
    }
    this.library.getRoot(libraryRootId);
    const items = uniqueItemIds.map((importItemId) => this.imports.getItem(importItemId));
    for (const item of items) {
      if (item.status !== "needs_review") {
        throw new Error(`Import item is not reviewable: ${item.status}`);
      }
    }

    const duplicateCount = items.reduce((total, item) => total + item.duplicateCandidates.length, 0);
    const label =
      items.length === 1
        ? `${items[0].detectedArtist ?? "Unknown Artist"} - ${items[0].detectedTitle ?? items[0].stagingPath}`
        : importItemsBatchLabel(items);
    return this.createBatch({
      source,
      summary: `Import ${label}`,
      riskLevel: duplicateCount > 0 ? "medium" : "low",
      operations: items.map((item) => ({
        type: "import_file",
        payload: {
          importItemId: item.id,
          libraryRootId,
          stagingPath: item.stagingPath,
          proposedDestination: item.proposedDestination
        }
      }))
    });
  }

  createPlaylistBatch(name: string, description?: string, fileIds: string[] = [], source: OperationSource = "user"): OperationBatch {
    const uniqueFileIds = [...new Set(fileIds)];
    for (const fileId of uniqueFileIds) {
      this.library.getFile(fileId);
    }

    return this.createBatch({
      source,
      summary: `Create playlist ${name}`,
      riskLevel: "low",
      operations: [
        {
          type: "create_playlist",
          payload: {
            name,
            description: description ?? null,
            type: "manual",
            createdBy: source,
            fileIds: uniqueFileIds
          }
        }
      ]
    });
  }

  createUpdatePlaylistBatch(
    playlistId: string,
    updates: { name: string; description?: string | null },
    source: OperationSource = "user"
  ): OperationBatch {
    const playlist = this.getPlaylistRecord(playlistId);
    const name = updates.name.trim();
    if (!name) {
      throw new Error("Playlist update requires a name");
    }
    const description = updates.description?.trim() || null;

    return this.createBatch({
      source,
      summary: `Update playlist ${playlist.name}`,
      riskLevel: "low",
      operations: [
        {
          type: "update_playlist",
          payload: { playlistId, name, description }
        }
      ]
    });
  }

  createAddTracksToPlaylistBatch(playlistId: string, fileIds: string[], source: OperationSource = "user"): OperationBatch {
    const playlist = this.getPlaylistRecord(playlistId);
    const uniqueFileIds = [...new Set(fileIds)];
    if (uniqueFileIds.length === 0) {
      throw new Error("Add to playlist proposal requires at least one file");
    }
    const files = uniqueFileIds.map((fileId) => this.library.getFile(fileId));

    return this.createBatch({
      source,
      summary: `Add ${files.length} track${files.length === 1 ? "" : "s"} to ${playlist.name}`,
      riskLevel: "low",
      operations: [
        {
          type: "add_tracks_to_playlist",
          payload: { playlistId, fileIds: uniqueFileIds, addedBy: source }
        }
      ]
    });
  }

  createRemoveTracksFromPlaylistBatch(playlistId: string, itemIds: string[], source: OperationSource = "user"): OperationBatch {
    const playlist = this.getPlaylistRecord(playlistId);
    const uniqueItemIds = [...new Set(itemIds)];
    if (uniqueItemIds.length === 0) {
      throw new Error("Remove from playlist proposal requires at least one playlist item");
    }
    const items = this.getPlaylistItemSnapshots(playlistId, uniqueItemIds);
    if (items.length !== uniqueItemIds.length) {
      throw new Error("Remove from playlist proposal contains items that are not in the playlist");
    }

    return this.createBatch({
      source,
      summary: `Remove ${items.length} track${items.length === 1 ? "" : "s"} from ${playlist.name}`,
      riskLevel: "low",
      operations: [
        {
          type: "remove_tracks_from_playlist",
          payload: { playlistId, itemIds: uniqueItemIds }
        }
      ]
    });
  }

  createAssociateFileWithTrackBatch(fileId: string, trackId: string, source: OperationSource = "user"): OperationBatch {
    const file = this.library.getFile(fileId);
    const track = this.getTrackRecord(trackId);
    return this.createBatch({
      source,
      summary: `Associate ${file.displayTags.title ?? file.filename} with track ${track.title}`,
      riskLevel: "low",
      operations: [
        {
          type: "associate_file_with_track",
          payload: { fileId, trackId }
        }
      ]
    });
  }

  createAssociateTrackWithAlbumBatch(trackId: string, albumId: string, source: OperationSource = "user"): OperationBatch {
    const track = this.getTrackRecord(trackId);
    const album = this.getAlbumRecord(albumId);
    return this.createBatch({
      source,
      summary: `Associate track ${track.title} with album ${album.title}`,
      riskLevel: "low",
      operations: [
        {
          type: "associate_track_with_album",
          payload: { trackId, albumId }
        }
      ]
    });
  }

  createMergeDuplicateTracksBatch(
    canonicalTrackId: string,
    duplicateTrackId: string,
    source: OperationSource = "user"
  ): OperationBatch {
    if (canonicalTrackId === duplicateTrackId) {
      throw new Error("A track cannot be merged into itself");
    }
    const canonicalTrack = this.getTrackRecord(canonicalTrackId);
    const duplicateTrack = this.getTrackRecord(duplicateTrackId);
    return this.createBatch({
      source,
      summary: `Merge duplicate track ${duplicateTrack.title} into ${canonicalTrack.title}`,
      riskLevel: "low",
      operations: [
        {
          type: "merge_duplicate_tracks",
          payload: { canonicalTrackId, duplicateTrackId }
        }
      ]
    });
  }

  createMoveFileBatch(fileId: string, destinationPath: string): OperationBatch {
    const file = this.library.getFile(fileId);
    return this.createBatch({
      source: "user",
      summary: `Move ${file.filename}`,
      riskLevel: "medium",
      operations: [
        {
          type: "move_file",
          payload: { fileId, destinationPath }
        }
      ]
    });
  }

  createRenameFileBatch(fileId: string, filename: string): OperationBatch {
    const file = this.library.getFile(fileId);
    return this.createBatch({
      source: "user",
      summary: `Rename ${file.filename} to ${filename}`,
      riskLevel: "medium",
      operations: [
        {
          type: "rename_file",
          payload: { fileId, filename }
        }
      ]
    });
  }

  createBulkRenameFilesBatch(fileIds: string[], pattern: string): OperationBatch {
    const uniqueFileIds = [...new Set(fileIds)];
    const trimmedPattern = pattern.trim();
    if (uniqueFileIds.length === 0) {
      throw new Error("Bulk rename proposal requires at least one file");
    }
    if (!trimmedPattern) {
      throw new Error("Bulk rename proposal requires a filename pattern");
    }

    const files = uniqueFileIds.map((fileId) => this.library.getFile(fileId));
    const targetKeys = new Set<string>();
    const operations = files.map((file) => {
      const filename = buildFilenameFromPattern(file, trimmedPattern);
      const targetKey = join(dirname(file.path), filename).toLowerCase();
      if (targetKeys.has(targetKey)) {
        throw new Error(`Bulk rename pattern creates duplicate target filename: ${filename}`);
      }
      targetKeys.add(targetKey);
      return {
        type: "rename_file" as const,
        payload: { fileId: file.id, filename, currentFilename: file.filename, pattern: trimmedPattern }
      };
    });

    return this.createBatch({
      source: "user",
      summary: `Rename ${operations.length} file${operations.length === 1 ? "" : "s"} with ${trimmedPattern}`,
      riskLevel: "medium",
      operations
    });
  }

  createSetInternalTagsBatch(trackId: string, tags: string[]): OperationBatch {
    return this.createBatch({
      source: "user",
      summary: `Set ${tags.length} internal tag${tags.length === 1 ? "" : "s"}`,
      riskLevel: "low",
      operations: [
        {
          type: "set_internal_tags",
          payload: { trackId, tags }
        }
      ]
    });
  }

  createBulkSetInternalTagsBatch(fileIds: string[], tags: string[]): OperationBatch {
    const uniqueFileIds = [...new Set(fileIds)];
    const uniqueTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    if (uniqueFileIds.length === 0) {
      throw new Error("Bulk tag proposal requires at least one file");
    }
    if (uniqueTags.length === 0) {
      throw new Error("Bulk tag proposal requires at least one tag");
    }

    const files = uniqueFileIds.map((fileId) => this.library.getFile(fileId));
    const trackIds = uniqueFileIds.map((fileId) => this.ensureTrackForFile(fileId));
    return this.createBatch({
      source: "user",
      summary: `Set ${uniqueTags.length} internal tag${uniqueTags.length === 1 ? "" : "s"} on ${
        files.length
      } file${files.length === 1 ? "" : "s"}`,
      riskLevel: "low",
      operations: trackIds.map((trackId, index) => ({
        type: "set_internal_tags",
        payload: {
          trackId,
          fileId: uniqueFileIds[index],
          filename: files[index].filename,
          tags: uniqueTags
        }
      }))
    });
  }

  createSetFileMetadataBatch(fileId: string, metadata: EditableFileMetadata): OperationBatch {
    const file = this.library.getFile(fileId);
    const title = metadata.title?.trim() || file.displayTags.title || file.filename;
    return this.createBatch({
      source: "user",
      summary: `Update metadata for ${title}`,
      riskLevel: "low",
      operations: [
        {
          type: "set_file_metadata",
          payload: { fileId, metadata }
        }
      ]
    });
  }

  createSetRatingBatch(fileId: string, rating: number | null): OperationBatch {
    const file = this.library.getFile(fileId);
    return this.createBatch({
      source: "user",
      summary: `${rating == null ? "Clear rating" : `Rate ${rating}/5`} for ${file.displayTags.title ?? file.filename}`,
      riskLevel: "low",
      operations: [
        {
          type: "set_rating",
          payload: { fileId, rating }
        }
      ]
    });
  }

  createSetFavoriteStatusBatch(fileId: string, input: { liked?: boolean | null; disliked?: boolean | null }): OperationBatch {
    const file = this.library.getFile(fileId);
    const status =
      input.liked === true ? "liked" : input.disliked === true ? "disliked" : input.liked === null && input.disliked === null ? "neutral" : "favorite status";
    return this.createBatch({
      source: "user",
      summary: `Set ${status} for ${file.displayTags.title ?? file.filename}`,
      riskLevel: "low",
      operations: [
        {
          type: "set_favorite_status",
          payload: { fileId, liked: input.liked ?? null, disliked: input.disliked ?? null }
        }
      ]
    });
  }

  createAlbumMergeBatch(canonicalAlbum: string, fileIds: string[]): OperationBatch {
    const album = canonicalAlbum.trim();
    const uniqueFileIds = [...new Set(fileIds)];
    if (!album) {
      throw new Error("Album merge requires a canonical album name");
    }
    if (uniqueFileIds.length === 0) {
      throw new Error("Album merge requires at least one file");
    }

    const files = uniqueFileIds.map((fileId) => this.library.getFile(fileId));
    return this.createBatch({
      source: "user",
      summary: `Merge ${files.length} file${files.length === 1 ? "" : "s"} into album ${album}`,
      riskLevel: "low",
      operations: files.map((file) => ({
        type: "set_file_metadata",
        payload: {
          fileId: file.id,
          metadata: { album },
          currentAlbum: file.displayTags.album ?? null,
          reason: "album_merge"
        }
      }))
    });
  }

  createRemoveFileBatch(fileId: string): OperationBatch {
    const file = this.library.getFile(fileId);
    return this.createBatch({
      source: "user",
      summary: `Remove ${file.displayTags.title ?? file.filename} from library index`,
      riskLevel: "medium",
      operations: [
        {
          type: "remove_file_from_library",
          payload: { fileId, path: file.path }
        }
      ]
    });
  }

  createDuplicateCleanupBatch(keepFileId: string, removeFileIds: string[]): OperationBatch {
    const keepFile = this.library.getFile(keepFileId);
    const uniqueRemoveFileIds = [...new Set(removeFileIds)].filter((fileId) => fileId !== keepFileId);
    if (uniqueRemoveFileIds.length === 0) {
      throw new Error("Duplicate cleanup requires at least one file to remove");
    }

    if (!keepFile.sha256) {
      throw new Error("Duplicate cleanup requires a hashed file to keep");
    }

    const removeFiles = uniqueRemoveFileIds.map((fileId) => this.library.getFile(fileId));
    for (const file of removeFiles) {
      if (file.sha256 !== keepFile.sha256) {
        throw new Error(`File is not an exact duplicate of the kept file: ${file.path}`);
      }
      if (file.missing) {
        throw new Error(`Cannot clean up a missing duplicate file: ${file.path}`);
      }
    }

    const keepLabel = keepFile.displayTags.title ?? keepFile.filename;
    return this.createBatch({
      source: "user",
      summary: `Keep ${keepLabel}; remove ${removeFiles.length} exact duplicate index entr${
        removeFiles.length === 1 ? "y" : "ies"
      }`,
      riskLevel: "medium",
      operations: removeFiles.map((file) => ({
        type: "remove_file_from_library",
        payload: {
          fileId: file.id,
          path: file.path,
          keptFileId: keepFile.id,
          keptPath: keepFile.path,
          reason: "exact_duplicate_cleanup"
        }
      }))
    });
  }

  createMarkDuplicateBatch(
    canonicalFileId: string,
    duplicateFileId: string,
    reason?: string | null,
    source: OperationSource = "user"
  ): OperationBatch {
    if (canonicalFileId === duplicateFileId) {
      throw new Error("A file cannot be marked as a duplicate of itself");
    }
    const canonicalFile = this.library.getFile(canonicalFileId);
    const duplicateFile = this.library.getFile(duplicateFileId);
    const canonicalLabel = canonicalFile.displayTags.title ?? canonicalFile.filename;
    const duplicateLabel = duplicateFile.displayTags.title ?? duplicateFile.filename;

    return this.createBatch({
      source,
      summary: `Mark ${duplicateLabel} as duplicate of ${canonicalLabel}`,
      riskLevel: "low",
      operations: [
        {
          type: "mark_duplicate",
          payload: {
            canonicalFileId,
            duplicateFileId,
            reason: reason?.trim() || null
          }
        }
      ]
    });
  }

  createQueueDownloadBatch(
    results: DiscoveryResult[],
    query: string,
    source: OperationSource = "agent",
    libraryRootId?: string
  ): OperationBatch {
    const unlocked = results.filter((result) => !result.isLocked);
    if (unlocked.length === 0) {
      throw new Error("Download proposal requires at least one unlocked Discovery result");
    }

    return this.createBatch({
      source,
      summary: `Queue ${unlocked.length} Discovery download${unlocked.length === 1 ? "" : "s"} for ${query}`,
      riskLevel: "medium",
      operations: [
        {
          type: "queue_download",
          payload: {
            query,
            results: unlocked,
            libraryRootId,
            note: "Creates a monitored Discovery download job after this operation batch is approved and applied."
          }
        }
      ]
    });
  }

  listBatches(): OperationBatch[] {
    const rows = this.db
      .prepare("SELECT * FROM operation_batches ORDER BY created_at DESC LIMIT 100")
      .all() as OperationBatchRow[];
    return rows.map((row) => mapBatch(row, this.listOperations(row.id)));
  }

  getBatch(batchId: string): OperationBatch {
    const row = this.db.prepare("SELECT * FROM operation_batches WHERE id = ?").get(batchId) as
      | OperationBatchRow
      | undefined;
    if (!row) {
      throw new Error(`Operation batch not found: ${batchId}`);
    }
    return mapBatch(row, this.listOperations(batchId));
  }

  approveBatch(batchId: string): OperationBatch {
    const batch = this.getBatch(batchId);
    if (batch.status !== "proposed" && batch.status !== "draft") {
      throw new Error(`Operation batch cannot be approved from status ${batch.status}`);
    }

    this.db
      .prepare("UPDATE operation_batches SET status = 'approved', approved_at = datetime('now') WHERE id = ?")
      .run(batchId);
    this.db.prepare("UPDATE operations SET status = 'approved' WHERE batch_id = ? AND status = 'proposed'").run(batchId);
    return this.getBatch(batchId);
  }

  rejectBatch(batchId: string): OperationBatch {
    const batch = this.getBatch(batchId);
    if (batch.status === "applied" || batch.status === "applying") {
      throw new Error(`Operation batch cannot be rejected from status ${batch.status}`);
    }

    this.db.prepare("UPDATE operation_batches SET status = 'rejected' WHERE id = ?").run(batchId);
    this.db.prepare("UPDATE operations SET status = 'rejected' WHERE batch_id = ? AND status NOT IN ('applied')").run(batchId);
    return this.getBatch(batchId);
  }

  async applyBatch(batchId: string): Promise<OperationBatch> {
    const batch = this.getBatch(batchId);
    if (batch.status !== "approved") {
      throw new Error(`Operation batch must be approved before applying; current status is ${batch.status}`);
    }

    this.db.prepare("UPDATE operation_batches SET status = 'applying' WHERE id = ?").run(batchId);
    let failed = false;

    for (const operation of batch.operations) {
      try {
        const before = await this.captureBefore(operation);
        this.updateOperation(operation.id, "applying", before, null, null);
        const after = await this.applyOperation(operation);
        this.updateOperation(operation.id, "applied", before, after, null);
      } catch (error) {
        failed = true;
        this.updateOperation(operation.id, "failed", null, null, serializeError(error));
      }
    }

    const finalStatus = failed ? this.getFinalFailureStatus(batchId) : "applied";
    this.db
      .prepare("UPDATE operation_batches SET status = ?, applied_at = datetime('now') WHERE id = ?")
      .run(finalStatus, batchId);

    return this.getBatch(batchId);
  }

  async revertBatch(batchId: string): Promise<OperationBatch> {
    const batch = this.getBatch(batchId);
    if (batch.status !== "applied" && batch.status !== "partially_applied") {
      throw new Error(`Operation batch cannot be reverted from status ${batch.status}`);
    }

    const appliedOperations = batch.operations.filter((operation) => operation.status === "applied");
    for (const operation of appliedOperations) {
      if (!this.canRevertOperation(operation)) {
        throw new Error(`Operation type cannot be safely reverted yet: ${operation.type}`);
      }
      if (operation.before == null) {
        throw new Error(`Operation is missing before-state and cannot be reverted: ${operation.id}`);
      }
    }

    for (const operation of appliedOperations.reverse()) {
      await this.revertOperation(operation);
      this.markOperationReverted(operation.id);
    }

    this.db
      .prepare("UPDATE operation_batches SET status = 'reverted', reverted_at = datetime('now') WHERE id = ?")
      .run(batchId);
    return this.getBatch(batchId);
  }

  private listOperations(batchId: string): Operation[] {
    const rows = this.db
      .prepare("SELECT * FROM operations WHERE batch_id = ? ORDER BY created_at ASC")
      .all(batchId) as OperationRow[];
    return rows.map(mapOperation);
  }

  private async captureBefore(operation: Operation): Promise<unknown> {
    if (operation.type === "import_file" || operation.type === "reject_import_item") {
      const payload = importItemOperationPayload(operation.payload);
      return this.imports.getItem(payload.importItemId);
    }

    if (operation.type === "create_playlist") {
      const payload = createPlaylistPayload(operation.payload);
      return { existingPlaylistNames: this.getExistingPlaylistNames(payload.name) };
    }

    if (operation.type === "update_playlist") {
      const payload = updatePlaylistPayload(operation.payload);
      return this.getPlaylistRecord(payload.playlistId);
    }

    if (operation.type === "add_tracks_to_playlist") {
      const payload = playlistFileIdsPayload(operation.payload, "Add to playlist operation requires fileIds");
      return this.getPlaylistSnapshot(payload.playlistId);
    }

    if (operation.type === "remove_tracks_from_playlist") {
      const payload = playlistItemIdsPayload(operation.payload);
      return {
        playlist: this.getPlaylistRecord(payload.playlistId),
        items: this.getPlaylistItemSnapshots(payload.playlistId, payload.itemIds)
      };
    }

    if (operation.type === "associate_file_with_track") {
      const payload = associateFileWithTrackPayload(operation.payload);
      return {
        file: this.library.getFile(payload.fileId),
        targetTrack: this.getTrackRecord(payload.trackId),
        existingLinks: this.getTrackFileLinksForFile(payload.fileId)
      };
    }

    if (operation.type === "associate_track_with_album") {
      const payload = associateTrackWithAlbumPayload(operation.payload);
      return {
        track: this.getTrackRecord(payload.trackId),
        targetAlbum: this.getAlbumRecord(payload.albumId)
      };
    }

    if (operation.type === "merge_duplicate_tracks") {
      const payload = mergeDuplicateTracksPayload(operation.payload);
      return this.getTrackMergeSnapshot(payload.canonicalTrackId, payload.duplicateTrackId);
    }

    if (operation.type === "mark_duplicate") {
      const payload = markDuplicatePayload(operation.payload);
      return {
        canonicalFile: this.library.getFile(payload.canonicalFileId),
        duplicateFile: this.library.getFile(payload.duplicateFileId),
        existingMark: this.getDuplicateMark(payload.canonicalFileId, payload.duplicateFileId)
      };
    }

    if (operation.type === "move_file") {
      const payload = moveFilePayload(operation.payload);
      return this.library.getFile(payload.fileId);
    }

    if (operation.type === "rename_file") {
      const payload = renameFilePayload(operation.payload);
      return this.library.getFile(payload.fileId);
    }

    if (operation.type === "set_internal_tags") {
      const payload = setInternalTagsPayload(operation.payload);
      return {
        trackId: payload.trackId,
        tags: this.getTrackTagNames(payload.trackId)
      };
    }

    if (operation.type === "set_file_metadata") {
      const payload = setFileMetadataPayload(operation.payload);
      return this.library.getFile(payload.fileId);
    }

    if (operation.type === "set_rating") {
      const payload = setRatingPayload(operation.payload);
      return this.library.getFile(payload.fileId);
    }

    if (operation.type === "set_favorite_status") {
      const payload = setFavoriteStatusPayload(operation.payload);
      return this.library.getFile(payload.fileId);
    }

    if (operation.type === "remove_file_from_library") {
      const payload = fileIdPayload(operation.payload, "Remove file operation requires fileId");
      return this.library.getFile(payload.fileId);
    }

    if (operation.type === "queue_download") {
      const payload = queueDownloadPayload(operation.payload);
      return {
        existingJobs: this.countDiscoveryDownloadJobs(),
        selectedCount: payload.results.length,
        query: payload.query
      };
    }

    return null;
  }

  private async applyOperation(operation: Operation): Promise<unknown> {
    if (operation.type === "import_file") {
      const payload = importFileOperationPayload(operation.payload);
      return this.imports.approveItem(payload.importItemId, payload.libraryRootId);
    }

    if (operation.type === "reject_import_item") {
      const payload = importItemOperationPayload(operation.payload);
      return this.imports.rejectItem(payload.importItemId);
    }

    if (operation.type === "create_playlist") {
      const payload = createPlaylistPayload(operation.payload);
      return this.createPlaylist(payload);
    }

    if (operation.type === "update_playlist") {
      const payload = updatePlaylistPayload(operation.payload);
      return this.updatePlaylist(payload);
    }

    if (operation.type === "add_tracks_to_playlist") {
      const payload = playlistFileIdsPayload(operation.payload, "Add to playlist operation requires fileIds");
      return this.addTracksToPlaylist(payload);
    }

    if (operation.type === "remove_tracks_from_playlist") {
      const payload = playlistItemIdsPayload(operation.payload);
      return this.removeTracksFromPlaylist(payload);
    }

    if (operation.type === "associate_file_with_track") {
      const payload = associateFileWithTrackPayload(operation.payload);
      return this.associateFileWithTrack(payload);
    }

    if (operation.type === "associate_track_with_album") {
      const payload = associateTrackWithAlbumPayload(operation.payload);
      return this.associateTrackWithAlbum(payload);
    }

    if (operation.type === "merge_duplicate_tracks") {
      const payload = mergeDuplicateTracksPayload(operation.payload);
      return this.mergeDuplicateTracks(payload);
    }

    if (operation.type === "mark_duplicate") {
      const payload = markDuplicatePayload(operation.payload);
      return this.markDuplicate(payload);
    }

    if (operation.type === "move_file") {
      const payload = moveFilePayload(operation.payload);
      return this.moveFile(payload.fileId, payload.destinationPath);
    }

    if (operation.type === "rename_file") {
      const payload = renameFilePayload(operation.payload);
      const file = this.library.getFile(payload.fileId);
      return this.moveFile(payload.fileId, join(dirname(file.path), payload.filename));
    }

    if (operation.type === "set_internal_tags") {
      const payload = setInternalTagsPayload(operation.payload);
      return this.setInternalTags(payload);
    }

    if (operation.type === "set_file_metadata") {
      const payload = setFileMetadataPayload(operation.payload);
      return this.library.setFileMetadataOverrides(payload.fileId, payload.metadata);
    }

    if (operation.type === "set_rating") {
      const payload = setRatingPayload(operation.payload);
      return this.library.setFileRating(payload.fileId, payload.rating);
    }

    if (operation.type === "set_favorite_status") {
      const payload = setFavoriteStatusPayload(operation.payload);
      return this.library.setFileFavoriteStatus(payload.fileId, { liked: payload.liked, disliked: payload.disliked });
    }

    if (operation.type === "remove_file_from_library") {
      const payload = fileIdPayload(operation.payload, "Remove file operation requires fileId");
      return this.library.removeFileFromLibrary(payload.fileId);
    }

    if (operation.type === "queue_download") {
      if (!this.downloads) {
        throw new Error("Discovery downloads are not configured");
      }
      const payload = queueDownloadPayload(operation.payload);
      return this.downloads.createJob(payload.results, payload.libraryRootId);
    }

    throw new Error(`Unsupported operation type: ${operation.type}`);
  }

  private canRevertOperation(operation: Operation): boolean {
    return (
      operation.type === "create_playlist" ||
      operation.type === "update_playlist" ||
      operation.type === "add_tracks_to_playlist" ||
      operation.type === "remove_tracks_from_playlist" ||
      operation.type === "associate_file_with_track" ||
      operation.type === "associate_track_with_album" ||
      operation.type === "merge_duplicate_tracks" ||
      operation.type === "mark_duplicate" ||
      operation.type === "set_file_metadata" ||
      operation.type === "set_rating" ||
      operation.type === "set_favorite_status" ||
      operation.type === "set_internal_tags"
    );
  }

  private async revertOperation(operation: Operation): Promise<unknown> {
    if (operation.type === "create_playlist") {
      return this.revertCreatePlaylist(createPlaylistAfter(operation.after));
    }

    if (operation.type === "update_playlist") {
      return this.restorePlaylist(playlistRecordBefore(operation.before));
    }

    if (operation.type === "add_tracks_to_playlist") {
      return this.revertAddTracksToPlaylist(playlistEditAfter(operation.after));
    }

    if (operation.type === "remove_tracks_from_playlist") {
      const before = playlistRemoveBefore(operation.before);
      return this.restorePlaylistItems(before.playlist.id, before.items);
    }

    if (operation.type === "associate_file_with_track") {
      return this.revertAssociateFileWithTrack(associateFileWithTrackAfter(operation.after));
    }

    if (operation.type === "associate_track_with_album") {
      return this.revertAssociateTrackWithAlbum(associateTrackWithAlbumAfter(operation.after));
    }

    if (operation.type === "merge_duplicate_tracks") {
      return this.revertMergeDuplicateTracks(trackMergeSnapshotBefore(operation.before), mergeDuplicateTracksAfter(operation.after));
    }

    if (operation.type === "mark_duplicate") {
      return this.revertMarkDuplicate(markDuplicateAfter(operation.after));
    }

    if (operation.type === "set_file_metadata") {
      const payload = setFileMetadataPayload(operation.payload);
      return this.library.setFileMetadataOverrides(payload.fileId, editableMetadataFromBefore(operation.before));
    }

    if (operation.type === "set_rating") {
      const payload = setRatingPayload(operation.payload);
      const before = filePreferenceBefore(operation.before);
      return this.library.setFileRating(payload.fileId, before.rating);
    }

    if (operation.type === "set_favorite_status") {
      const payload = setFavoriteStatusPayload(operation.payload);
      const before = filePreferenceBefore(operation.before);
      return this.library.setFileFavoriteStatus(payload.fileId, { liked: before.liked, disliked: before.disliked });
    }

    if (operation.type === "set_internal_tags") {
      const payload = setInternalTagsPayload(operation.payload);
      const before = internalTagsBefore(operation.before);
      return this.setInternalTags({ trackId: payload.trackId, tags: before.tags });
    }

    throw new Error(`Operation type cannot be reverted: ${operation.type}`);
  }

  private updateOperation(
    operationId: string,
    status: OperationBatchStatus,
    before: unknown,
    after: unknown,
    error: unknown
  ): void {
    this.db
      .prepare(
        `UPDATE operations
         SET status = ?,
             before_json = COALESCE(?, before_json),
             after_json = COALESCE(?, after_json),
             error_json = ?,
             applied_at = CASE WHEN ? = 'applied' THEN datetime('now') ELSE applied_at END
         WHERE id = ?`
      )
      .run(
        status,
        before == null ? null : JSON.stringify(before),
        after == null ? null : JSON.stringify(after),
        error == null ? null : JSON.stringify(error),
        status,
        operationId
      );
  }

  private markOperationReverted(operationId: string): void {
    this.db
      .prepare(
        `UPDATE operations
         SET status = 'reverted',
             error_json = NULL,
             reverted_at = datetime('now')
         WHERE id = ?`
      )
      .run(operationId);
  }

  private getFinalFailureStatus(batchId: string): OperationBatchStatus {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM operations WHERE batch_id = ? AND status = 'applied'")
      .get(batchId) as { total: number };
    return row.total > 0 ? "partially_applied" : "failed";
  }

  private countDiscoveryDownloadJobs(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM jobs WHERE type = 'discovery_download'")
      .get() as { total: number };
    return row.total;
  }

  private getExistingPlaylistNames(name: string): string[] {
    const rows = this.db
      .prepare("SELECT name FROM playlists WHERE lower(name) = lower(?)")
      .all(name) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  private createPlaylist(payload: CreatePlaylistPayload): { id: string; name: string; itemCount: number } {
    const existing = this.getExistingPlaylistNames(payload.name);
    if (existing.length > 0) {
      throw new Error(`Playlist already exists: ${payload.name}`);
    }

    const id = nanoid();
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO playlists (id, name, description, type, created_by)
           VALUES (@id, @name, @description, @type, @createdBy)`
        )
        .run({
          id,
          name: payload.name,
          description: payload.description,
          type: payload.type,
          createdBy: payload.createdBy
        });

      const insertItem = this.db.prepare(
        `INSERT INTO playlist_items (id, playlist_id, track_id, position, added_by, reason)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      payload.fileIds.forEach((fileId, index) => {
        const trackId = this.ensureTrackForFile(fileId);
        insertItem.run(nanoid(), id, trackId, index, payload.createdBy, "Selected from library file");
      });
    });
    write();
    return { id, name: payload.name, itemCount: payload.fileIds.length };
  }

  private revertCreatePlaylist(after: CreatePlaylistAfter): { id: string; removedItems: number } {
    const row = this.db.prepare("SELECT id, name FROM playlists WHERE id = ?").get(after.id) as
      | { id: string; name: string }
      | undefined;
    if (!row) {
      throw new Error(`Playlist is missing and cannot be reverted: ${after.id}`);
    }
    if (row.name !== after.name) {
      throw new Error(`Playlist was renamed and cannot be safely reverted: ${row.name}`);
    }

    const itemCount = this.db.prepare("SELECT COUNT(*) AS total FROM playlist_items WHERE playlist_id = ?").get(after.id) as {
      total: number;
    };
    if (itemCount.total !== after.itemCount) {
      throw new Error(
        `Playlist item count changed and cannot be safely reverted: expected ${after.itemCount}, got ${itemCount.total}`
      );
    }

    const remove = this.db.transaction(() => {
      const deletedItems = this.db.prepare("DELETE FROM playlist_items WHERE playlist_id = ?").run(after.id);
      this.db.prepare("DELETE FROM playlists WHERE id = ?").run(after.id);
      return deletedItems.changes;
    });
    return { id: after.id, removedItems: remove() };
  }

  private getPlaylistRecord(playlistId: string): PlaylistRecord {
    const row = this.db
      .prepare("SELECT id, name, description, type FROM playlists WHERE id = ?")
      .get(playlistId) as PlaylistRecord | undefined;
    if (!row) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }
    return row;
  }

  private getPlaylistSnapshot(playlistId: string): { id: string; name: string; itemCount: number; trackIds: string[] } {
    const playlist = this.getPlaylistRecord(playlistId);
    const rows = this.db
      .prepare("SELECT track_id FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC")
      .all(playlistId) as Array<{ track_id: string }>;
    return {
      id: playlist.id,
      name: playlist.name,
      itemCount: rows.length,
      trackIds: rows.map((row) => row.track_id)
    };
  }

  private updatePlaylist(payload: UpdatePlaylistPayload): PlaylistRecord {
    const playlist = this.getPlaylistRecord(payload.playlistId);
    const existing = this.db
      .prepare("SELECT id, name FROM playlists WHERE lower(name) = lower(?) AND id != ?")
      .get(payload.name, payload.playlistId) as { id: string; name: string } | undefined;
    if (existing) {
      throw new Error(`Playlist already exists: ${existing.name}`);
    }

    this.db
      .prepare(
        `UPDATE playlists
         SET name = ?, description = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(payload.name, payload.description, payload.playlistId);
    return this.getPlaylistRecord(playlist.id);
  }

  private restorePlaylist(before: PlaylistRecord): PlaylistRecord {
    this.getPlaylistRecord(before.id);
    const existing = this.db
      .prepare("SELECT id, name FROM playlists WHERE lower(name) = lower(?) AND id != ?")
      .get(before.name, before.id) as { id: string; name: string } | undefined;
    if (existing) {
      throw new Error(`Playlist name is now in use and cannot be restored: ${existing.name}`);
    }

    this.db
      .prepare(
        `UPDATE playlists
         SET name = ?, description = ?, type = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(before.name, before.description, before.type, before.id);
    return this.getPlaylistRecord(before.id);
  }

  private getPlaylistItemSnapshots(playlistId: string, itemIds: string[]): PlaylistItemSnapshot[] {
    if (itemIds.length === 0) {
      return [];
    }
    const placeholders = itemIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT id, playlist_id, track_id, position, added_at, added_by, reason
         FROM playlist_items
         WHERE playlist_id = ? AND id IN (${placeholders})
         ORDER BY position ASC`
      )
      .all(playlistId, ...itemIds) as PlaylistItemSnapshot[];
  }

  private addTracksToPlaylist(payload: PlaylistFileIdsPayload): PlaylistEditAfter {
    const playlist = this.getPlaylistRecord(payload.playlistId);
    const existingTrackRows = this.db
      .prepare("SELECT track_id FROM playlist_items WHERE playlist_id = ?")
      .all(payload.playlistId) as Array<{ track_id: string }>;
    const existingTrackIds = new Set(existingTrackRows.map((row) => row.track_id));
    const maxRow = this.db
      .prepare("SELECT COALESCE(MAX(position), -1) AS position FROM playlist_items WHERE playlist_id = ?")
      .get(payload.playlistId) as { position: number };

    const addedItemIds: string[] = [];
    const skippedTrackIds: string[] = [];
    const add = this.db.transaction(() => {
      const insertItem = this.db.prepare(
        `INSERT INTO playlist_items (id, playlist_id, track_id, position, added_by, reason)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      let nextPosition = maxRow.position + 1;
      for (const fileId of payload.fileIds) {
        const trackId = this.ensureTrackForFile(fileId);
        if (existingTrackIds.has(trackId)) {
          skippedTrackIds.push(trackId);
          continue;
        }
        existingTrackIds.add(trackId);
        const itemId = nanoid();
        insertItem.run(itemId, payload.playlistId, trackId, nextPosition, payload.addedBy, "Selected from library file");
        addedItemIds.push(itemId);
        nextPosition += 1;
      }
      this.db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(payload.playlistId);
    });
    add();
    return {
      playlistId: payload.playlistId,
      playlistName: playlist.name,
      addedItemIds,
      addedCount: addedItemIds.length,
      skippedCount: skippedTrackIds.length
    };
  }

  private removeTracksFromPlaylist(payload: PlaylistItemIdsPayload): { playlistId: string; removedItems: PlaylistItemSnapshot[] } {
    this.getPlaylistRecord(payload.playlistId);
    const items = this.getPlaylistItemSnapshots(payload.playlistId, payload.itemIds);
    if (items.length !== payload.itemIds.length) {
      throw new Error("Cannot remove playlist items that no longer exist");
    }

    const remove = this.db.transaction(() => {
      const deleteItem = this.db.prepare("DELETE FROM playlist_items WHERE playlist_id = ? AND id = ?");
      for (const item of items) {
        deleteItem.run(payload.playlistId, item.id);
      }
      this.db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(payload.playlistId);
    });
    remove();
    return { playlistId: payload.playlistId, removedItems: items };
  }

  private revertAddTracksToPlaylist(after: PlaylistEditAfter): { playlistId: string; removedItems: number } {
    this.getPlaylistRecord(after.playlistId);
    if (after.addedItemIds.length === 0) {
      return { playlistId: after.playlistId, removedItems: 0 };
    }
    const existing = this.getPlaylistItemSnapshots(after.playlistId, after.addedItemIds);
    if (existing.length !== after.addedItemIds.length) {
      throw new Error("Added playlist items changed and cannot be safely reverted");
    }
    const remove = this.db.transaction(() => {
      const deleteItem = this.db.prepare("DELETE FROM playlist_items WHERE playlist_id = ? AND id = ?");
      for (const itemId of after.addedItemIds) {
        deleteItem.run(after.playlistId, itemId);
      }
      this.db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(after.playlistId);
      return after.addedItemIds.length;
    });
    return { playlistId: after.playlistId, removedItems: remove() };
  }

  private restorePlaylistItems(playlistId: string, items: PlaylistItemSnapshot[]): { playlistId: string; restoredItems: number } {
    this.getPlaylistRecord(playlistId);
    const restore = this.db.transaction(() => {
      const existing = this.db.prepare("SELECT id FROM playlist_items WHERE id = ?");
      const insertItem = this.db.prepare(
        `INSERT INTO playlist_items (id, playlist_id, track_id, position, added_at, added_by, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of items) {
        if (existing.get(item.id)) {
          throw new Error(`Playlist item already exists and cannot be restored safely: ${item.id}`);
        }
        insertItem.run(item.id, item.playlist_id, item.track_id, item.position, item.added_at, item.added_by, item.reason);
      }
      this.db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
    });
    restore();
    return { playlistId, restoredItems: items.length };
  }

  private getTrackRecord(trackId: string): TrackRecord {
    const row = this.db
      .prepare("SELECT id, title, album_id, merged_into_track_id, merged_at FROM tracks WHERE id = ?")
      .get(trackId) as TrackRecord | undefined;
    if (!row) {
      throw new Error(`Track not found: ${trackId}`);
    }
    return row;
  }

  private getAlbumRecord(albumId: string): AlbumRecord {
    const row = this.db.prepare("SELECT id, title FROM albums WHERE id = ?").get(albumId) as AlbumRecord | undefined;
    if (!row) {
      throw new Error(`Album not found: ${albumId}`);
    }
    return row;
  }

  private getTrackFileLinksForFile(fileId: string): TrackFileLink[] {
    return this.db
      .prepare("SELECT id, track_id, file_id, quality_rank, is_preferred, source, created_at FROM track_files WHERE file_id = ? ORDER BY created_at ASC")
      .all(fileId) as TrackFileLink[];
  }

  private associateFileWithTrack(payload: AssociateFileWithTrackPayload): AssociateFileWithTrackAfter {
    this.library.getFile(payload.fileId);
    this.getTrackRecord(payload.trackId);
    const existing = this.db
      .prepare("SELECT id FROM track_files WHERE track_id = ? AND file_id = ?")
      .get(payload.trackId, payload.fileId) as { id: string } | undefined;
    if (existing) {
      return {
        fileId: payload.fileId,
        trackId: payload.trackId,
        linkId: existing.id,
        created: false
      };
    }

    const linkId = nanoid();
    this.db
      .prepare(
        `INSERT INTO track_files (id, track_id, file_id, quality_rank, is_preferred, source)
         VALUES (?, ?, ?, 0, 0, 'operation')`
      )
      .run(linkId, payload.trackId, payload.fileId);
    return {
      fileId: payload.fileId,
      trackId: payload.trackId,
      linkId,
      created: true
    };
  }

  private revertAssociateFileWithTrack(after: AssociateFileWithTrackAfter): { fileId: string; trackId: string; removed: boolean } {
    if (!after.created) {
      return { fileId: after.fileId, trackId: after.trackId, removed: false };
    }
    const deleted = this.db
      .prepare("DELETE FROM track_files WHERE id = ? AND track_id = ? AND file_id = ? AND source = 'operation'")
      .run(after.linkId, after.trackId, after.fileId);
    if (deleted.changes !== 1) {
      throw new Error("Track-file association changed and cannot be safely reverted");
    }
    return { fileId: after.fileId, trackId: after.trackId, removed: true };
  }

  private associateTrackWithAlbum(payload: AssociateTrackWithAlbumPayload): AssociateTrackWithAlbumAfter {
    const track = this.getTrackRecord(payload.trackId);
    this.getAlbumRecord(payload.albumId);
    this.db
      .prepare("UPDATE tracks SET album_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(payload.albumId, payload.trackId);
    return {
      trackId: payload.trackId,
      albumId: payload.albumId,
      previousAlbumId: track.album_id
    };
  }

  private revertAssociateTrackWithAlbum(after: AssociateTrackWithAlbumAfter): { trackId: string; albumId: string | null } {
    this.getTrackRecord(after.trackId);
    this.db
      .prepare("UPDATE tracks SET album_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(after.previousAlbumId, after.trackId);
    return { trackId: after.trackId, albumId: after.previousAlbumId };
  }

  private getTrackMergeSnapshot(canonicalTrackId: string, duplicateTrackId: string): TrackMergeSnapshot {
    if (canonicalTrackId === duplicateTrackId) {
      throw new Error("A track cannot be merged into itself");
    }
    return {
      canonicalTrack: this.getTrackRecord(canonicalTrackId),
      duplicateTrack: this.getTrackRecord(duplicateTrackId),
      canonicalTrackFiles: this.getTrackFileLinksForTrack(canonicalTrackId),
      duplicateTrackFiles: this.getTrackFileLinksForTrack(duplicateTrackId),
      canonicalTagLinks: this.getTrackUserTagLinks(canonicalTrackId),
      duplicateTagLinks: this.getTrackUserTagLinks(duplicateTrackId),
      duplicatePlaylistItems: this.getPlaylistItemsForTrack(duplicateTrackId)
    };
  }

  private mergeDuplicateTracks(payload: MergeDuplicateTracksPayload): MergeDuplicateTracksAfter {
    const before = this.getTrackMergeSnapshot(payload.canonicalTrackId, payload.duplicateTrackId);
    const canonicalFileIds = new Set(before.canonicalTrackFiles.map((link) => link.file_id));
    const movedFileLinkIds: string[] = [];
    const removedDuplicateFileLinks: TrackFileLink[] = [];
    const movedPlaylistItemIds = before.duplicatePlaylistItems.map((item) => item.id);
    const canonicalTagIds = new Set(before.canonicalTagLinks.map((link) => link.user_tag_id));
    const copiedTagIds = before.duplicateTagLinks
      .map((link) => link.user_tag_id)
      .filter((tagId) => !canonicalTagIds.has(tagId));

    const merge = this.db.transaction(() => {
      for (const link of before.duplicateTrackFiles) {
        if (canonicalFileIds.has(link.file_id)) {
          this.db.prepare("DELETE FROM track_files WHERE id = ? AND track_id = ?").run(link.id, payload.duplicateTrackId);
          removedDuplicateFileLinks.push(link);
          continue;
        }
        this.db.prepare("UPDATE track_files SET track_id = ? WHERE id = ? AND track_id = ?").run(
          payload.canonicalTrackId,
          link.id,
          payload.duplicateTrackId
        );
        movedFileLinkIds.push(link.id);
      }

      this.db.prepare("UPDATE playlist_items SET track_id = ? WHERE track_id = ?").run(
        payload.canonicalTrackId,
        payload.duplicateTrackId
      );

      const insertTag = this.db.prepare(
        "INSERT OR IGNORE INTO track_user_tags (track_id, user_tag_id, created_at, source) VALUES (?, ?, ?, ?)"
      );
      for (const link of before.duplicateTagLinks) {
        insertTag.run(payload.canonicalTrackId, link.user_tag_id, link.created_at, link.source);
      }
      this.db.prepare("DELETE FROM track_user_tags WHERE track_id = ?").run(payload.duplicateTrackId);

      this.db
        .prepare("UPDATE tracks SET merged_into_track_id = ?, merged_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
        .run(payload.canonicalTrackId, payload.duplicateTrackId);
    });
    merge();

    return {
      canonicalTrackId: payload.canonicalTrackId,
      duplicateTrackId: payload.duplicateTrackId,
      movedFileLinkIds,
      removedDuplicateFileLinkIds: removedDuplicateFileLinks.map((link) => link.id),
      movedPlaylistItemIds,
      copiedTagIds
    };
  }

  private revertMergeDuplicateTracks(
    before: TrackMergeSnapshot,
    after: MergeDuplicateTracksAfter
  ): { canonicalTrackId: string; duplicateTrackId: string; restoredFileLinks: number; restoredPlaylistItems: number } {
    const canonicalTrack = this.getTrackRecord(after.canonicalTrackId);
    const duplicateTrack = this.getTrackRecord(after.duplicateTrackId);
    if (canonicalTrack.id !== before.canonicalTrack.id || duplicateTrack.id !== before.duplicateTrack.id) {
      throw new Error("Track merge targets changed and cannot be safely reverted");
    }

    const restore = this.db.transaction(() => {
      for (const linkId of after.movedFileLinkIds) {
        const updated = this.db
          .prepare("UPDATE track_files SET track_id = ? WHERE id = ? AND track_id = ?")
          .run(after.duplicateTrackId, linkId, after.canonicalTrackId);
        if (updated.changes !== 1) {
          throw new Error(`Moved track-file link changed and cannot be restored: ${linkId}`);
        }
      }

      const existingTrackFile = this.db.prepare("SELECT id FROM track_files WHERE id = ?");
      const insertTrackFile = this.db.prepare(
        `INSERT INTO track_files (id, track_id, file_id, quality_rank, is_preferred, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const link of before.duplicateTrackFiles.filter((link) => after.removedDuplicateFileLinkIds.includes(link.id))) {
        if (existingTrackFile.get(link.id)) {
          throw new Error(`Removed duplicate track-file link already exists and cannot be restored: ${link.id}`);
        }
        insertTrackFile.run(link.id, link.track_id, link.file_id, link.quality_rank, link.is_preferred, link.source, link.created_at);
      }

      for (const item of before.duplicatePlaylistItems) {
        this.db.prepare("UPDATE playlist_items SET track_id = ? WHERE id = ? AND track_id = ?").run(
          after.duplicateTrackId,
          item.id,
          after.canonicalTrackId
        );
      }

      const insertTag = this.db.prepare(
        "INSERT OR IGNORE INTO track_user_tags (track_id, user_tag_id, created_at, source) VALUES (?, ?, ?, ?)"
      );
      for (const tagId of after.copiedTagIds) {
        this.db.prepare("DELETE FROM track_user_tags WHERE track_id = ? AND user_tag_id = ?").run(after.canonicalTrackId, tagId);
      }
      for (const link of before.duplicateTagLinks) {
        insertTag.run(after.duplicateTrackId, link.user_tag_id, link.created_at, link.source);
      }

      this.db
        .prepare("UPDATE tracks SET merged_into_track_id = ?, merged_at = ?, updated_at = datetime('now') WHERE id = ?")
        .run(before.duplicateTrack.merged_into_track_id, before.duplicateTrack.merged_at, after.duplicateTrackId);
    });
    restore();

    return {
      canonicalTrackId: after.canonicalTrackId,
      duplicateTrackId: after.duplicateTrackId,
      restoredFileLinks: before.duplicateTrackFiles.length,
      restoredPlaylistItems: before.duplicatePlaylistItems.length
    };
  }

  private getDuplicateMark(canonicalFileId: string, duplicateFileId: string): DuplicateMarkRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, canonical_file_id, duplicate_file_id, status, reason, source
         FROM duplicate_marks
         WHERE canonical_file_id = ? AND duplicate_file_id = ?`
      )
      .get(canonicalFileId, duplicateFileId) as DuplicateMarkRow | undefined;
    return row ? mapDuplicateMark(row) : null;
  }

  private markDuplicate(payload: MarkDuplicatePayload): MarkDuplicateAfter {
    if (payload.canonicalFileId === payload.duplicateFileId) {
      throw new Error("A file cannot be marked as a duplicate of itself");
    }
    this.library.getFile(payload.canonicalFileId);
    this.library.getFile(payload.duplicateFileId);
    const existing = this.getDuplicateMark(payload.canonicalFileId, payload.duplicateFileId);
    if (existing) {
      return {
        id: existing.id,
        canonicalFileId: payload.canonicalFileId,
        duplicateFileId: payload.duplicateFileId,
        created: false
      };
    }

    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO duplicate_marks (id, canonical_file_id, duplicate_file_id, status, reason, source)
         VALUES (?, ?, ?, 'active', ?, 'operation')`
      )
      .run(id, payload.canonicalFileId, payload.duplicateFileId, payload.reason);
    return {
      id,
      canonicalFileId: payload.canonicalFileId,
      duplicateFileId: payload.duplicateFileId,
      created: true
    };
  }

  private revertMarkDuplicate(after: MarkDuplicateAfter): { id: string; removed: boolean } {
    if (!after.created) {
      return { id: after.id, removed: false };
    }
    const deleted = this.db
      .prepare(
        `DELETE FROM duplicate_marks
         WHERE id = ?
           AND canonical_file_id = ?
           AND duplicate_file_id = ?
           AND source = 'operation'`
      )
      .run(after.id, after.canonicalFileId, after.duplicateFileId);
    if (deleted.changes !== 1) {
      throw new Error("Duplicate mark changed and cannot be safely reverted");
    }
    return { id: after.id, removed: true };
  }

  private ensureTrackForFile(fileId: string): string {
    const existing = this.db.prepare("SELECT track_id FROM track_files WHERE file_id = ?").get(fileId) as
      | { track_id: string }
      | undefined;
    if (existing) {
      return existing.track_id;
    }

    const file = this.library.getFile(fileId);
    const title = file.displayTags.title ?? file.filename;
    const trackId = nanoid();
    this.db
      .prepare("INSERT INTO tracks (id, title, duration_ms) VALUES (?, ?, ?)")
      .run(trackId, title, file.durationMs);
    this.db
      .prepare(
        `INSERT INTO track_files (id, track_id, file_id, quality_rank, is_preferred, source)
         VALUES (?, ?, ?, 0, 1, 'library_file')`
      )
      .run(nanoid(), trackId, fileId);
    return trackId;
  }

  private async moveFile(fileId: string, destinationPath: string): Promise<unknown> {
    const file = this.library.getFile(fileId);
    await mkdir(dirname(destinationPath), { recursive: true });
    await rename(file.path, destinationPath);
    const scanned = await scanAudioFile(file.libraryRootId, destinationPath);
    this.library.replaceFile(fileId, { ...scanned, staged: false, importItemId: null });
    return this.library.getFile(fileId);
  }

  private setInternalTags(payload: SetInternalTagsPayload): { trackId: string; tags: string[] } {
    const track = this.db.prepare("SELECT id FROM tracks WHERE id = ?").get(payload.trackId);
    if (!track) {
      throw new Error(`Track not found: ${payload.trackId}`);
    }

    const clear = this.db.prepare("DELETE FROM track_user_tags WHERE track_id = ?");
    const getTag = this.db.prepare("SELECT id FROM user_tags WHERE name = ?");
    const insertTag = this.db.prepare("INSERT INTO user_tags (id, name, category) VALUES (?, ?, 'internal')");
    const linkTag = this.db.prepare(
      "INSERT OR IGNORE INTO track_user_tags (track_id, user_tag_id, source) VALUES (?, ?, 'operation')"
    );

    const write = this.db.transaction(() => {
      clear.run(payload.trackId);
      for (const tag of payload.tags) {
        const existing = getTag.get(tag) as { id: string } | undefined;
        const tagId = existing?.id ?? nanoid();
        if (!existing) {
          insertTag.run(tagId, tag);
        }
        linkTag.run(payload.trackId, tagId);
      }
    });
    write();
    return { trackId: payload.trackId, tags: this.getTrackTagNames(payload.trackId) };
  }

  private getTrackTagNames(trackId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT user_tags.name FROM user_tags
         JOIN track_user_tags ON track_user_tags.user_tag_id = user_tags.id
         WHERE track_user_tags.track_id = ?
         ORDER BY user_tags.name ASC`
      )
      .all(trackId) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  private getTrackFileLinksForTrack(trackId: string): TrackFileLink[] {
    return this.db
      .prepare("SELECT id, track_id, file_id, quality_rank, is_preferred, source, created_at FROM track_files WHERE track_id = ? ORDER BY created_at ASC")
      .all(trackId) as TrackFileLink[];
  }

  private getTrackUserTagLinks(trackId: string): TrackUserTagLink[] {
    return this.db
      .prepare("SELECT track_id, user_tag_id, created_at, source FROM track_user_tags WHERE track_id = ? ORDER BY created_at ASC")
      .all(trackId) as TrackUserTagLink[];
  }

  private getPlaylistItemsForTrack(trackId: string): PlaylistItemSnapshot[] {
    return this.db
      .prepare(
        `SELECT id, playlist_id, track_id, position, added_at, added_by, reason
         FROM playlist_items
         WHERE track_id = ?
         ORDER BY playlist_id ASC, position ASC`
      )
      .all(trackId) as PlaylistItemSnapshot[];
  }
}

interface OperationBatchRow {
  id: string;
  source: OperationSource;
  status: OperationBatchStatus;
  summary: string;
  risk_level: RiskLevel;
  agent_thread_id: string | null;
}

interface OperationRow {
  id: string;
  batch_id: string;
  type: OperationType;
  status: OperationBatchStatus;
  payload_json: string;
  before_json: string | null;
  after_json: string | null;
  error_json: string | null;
}

interface ImportItemOperationPayload {
  importItemId: string;
}

interface ImportFileOperationPayload extends ImportItemOperationPayload {
  libraryRootId: string;
}

interface CreatePlaylistPayload {
  name: string;
  description: string | null;
  type: string;
  createdBy: string;
  fileIds: string[];
}

interface CreatePlaylistAfter {
  id: string;
  name: string;
  itemCount: number;
}

interface PlaylistRecord {
  id: string;
  name: string;
  description: string | null;
  type: string;
}

interface UpdatePlaylistPayload {
  playlistId: string;
  name: string;
  description: string | null;
}

interface PlaylistFileIdsPayload {
  playlistId: string;
  fileIds: string[];
  addedBy: string;
}

interface PlaylistItemIdsPayload {
  playlistId: string;
  itemIds: string[];
}

interface PlaylistItemSnapshot {
  id: string;
  playlist_id: string;
  track_id: string;
  position: number;
  added_at: string;
  added_by: string;
  reason: string | null;
}

interface PlaylistEditAfter {
  playlistId: string;
  playlistName: string;
  addedItemIds: string[];
  addedCount: number;
  skippedCount: number;
}

interface TrackRecord {
  id: string;
  title: string;
  album_id: string | null;
  merged_into_track_id: string | null;
  merged_at: string | null;
}

interface AlbumRecord {
  id: string;
  title: string;
}

interface TrackFileLink {
  id: string;
  track_id: string;
  file_id: string;
  quality_rank: number | null;
  is_preferred: number;
  source: string | null;
  created_at: string;
}

interface TrackUserTagLink {
  track_id: string;
  user_tag_id: string;
  created_at: string;
  source: string;
}

interface TrackMergeSnapshot {
  canonicalTrack: TrackRecord;
  duplicateTrack: TrackRecord;
  canonicalTrackFiles: TrackFileLink[];
  duplicateTrackFiles: TrackFileLink[];
  canonicalTagLinks: TrackUserTagLink[];
  duplicateTagLinks: TrackUserTagLink[];
  duplicatePlaylistItems: PlaylistItemSnapshot[];
}

interface MergeDuplicateTracksPayload {
  canonicalTrackId: string;
  duplicateTrackId: string;
}

interface MergeDuplicateTracksAfter {
  canonicalTrackId: string;
  duplicateTrackId: string;
  movedFileLinkIds: string[];
  removedDuplicateFileLinkIds: string[];
  movedPlaylistItemIds: string[];
  copiedTagIds: string[];
}

interface AssociateFileWithTrackPayload {
  fileId: string;
  trackId: string;
}

interface AssociateFileWithTrackAfter {
  fileId: string;
  trackId: string;
  linkId: string;
  created: boolean;
}

interface AssociateTrackWithAlbumPayload {
  trackId: string;
  albumId: string;
}

interface AssociateTrackWithAlbumAfter {
  trackId: string;
  albumId: string;
  previousAlbumId: string | null;
}

interface DuplicateMarkRow {
  id: string;
  canonical_file_id: string;
  duplicate_file_id: string;
  status: string;
  reason: string | null;
  source: string;
}

interface DuplicateMarkRecord {
  id: string;
  canonicalFileId: string;
  duplicateFileId: string;
  status: string;
  reason: string | null;
  source: string;
}

interface MarkDuplicatePayload {
  canonicalFileId: string;
  duplicateFileId: string;
  reason: string | null;
}

interface MarkDuplicateAfter {
  id: string;
  canonicalFileId: string;
  duplicateFileId: string;
  created: boolean;
}

interface MoveFilePayload {
  fileId: string;
  destinationPath: string;
}

interface RenameFilePayload {
  fileId: string;
  filename: string;
}

interface SetInternalTagsPayload {
  trackId: string;
  tags: string[];
}

interface SetFileMetadataPayload {
  fileId: string;
  metadata: EditableFileMetadata;
}

interface SetRatingPayload {
  fileId: string;
  rating: number | null;
}

interface SetFavoriteStatusPayload {
  fileId: string;
  liked: boolean | null;
  disliked: boolean | null;
}

interface QueueDownloadPayload {
  query: string;
  results: DiscoveryResult[];
  libraryRootId?: string;
}

function mapBatch(row: OperationBatchRow, operations: Operation[]): OperationBatch {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    summary: row.summary,
    riskLevel: row.risk_level,
    agentThreadId: row.agent_thread_id,
    operations
  };
}

function mapOperation(row: OperationRow): Operation {
  return {
    id: row.id,
    batchId: row.batch_id,
    type: row.type,
    status: row.status,
    payload: parseJson(row.payload_json),
    before: row.before_json ? parseJson(row.before_json) : null,
    after: row.after_json ? parseJson(row.after_json) : null,
    error: row.error_json ? parseJson(row.error_json) : null
  };
}

function mapDuplicateMark(row: DuplicateMarkRow): DuplicateMarkRecord {
  return {
    id: row.id,
    canonicalFileId: row.canonical_file_id,
    duplicateFileId: row.duplicate_file_id,
    status: row.status,
    reason: row.reason,
    source: row.source
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function importItemOperationPayload(value: unknown): ImportItemOperationPayload {
  if (typeof value !== "object" || value == null || typeof (value as { importItemId?: unknown }).importItemId !== "string") {
    throw new Error("Operation payload requires importItemId");
  }
  return { importItemId: (value as { importItemId: string }).importItemId };
}

function importItemsBatchLabel(items: ImportItem[]): string {
  const first = items[0];
  const commonArtist = first?.detectedArtist?.trim() || "Unknown Artist";
  const commonAlbum = first?.detectedAlbum?.trim();
  if (
    commonAlbum &&
    items.every(
      (item) =>
        (item.detectedAlbum?.trim() || "") === commonAlbum &&
        (item.detectedArtist?.trim() || "Unknown Artist") === commonArtist
    )
  ) {
    return `${commonArtist} - ${commonAlbum} (${items.length} tracks)`;
  }

  return `${items.length} import items`;
}

function importFileOperationPayload(value: unknown): ImportFileOperationPayload {
  const payload = importItemOperationPayload(value);
  if (typeof (value as { libraryRootId?: unknown }).libraryRootId !== "string") {
    throw new Error("Import operation payload requires libraryRootId");
  }
  return { ...payload, libraryRootId: (value as { libraryRootId: string }).libraryRootId };
}

function createPlaylistPayload(value: unknown): CreatePlaylistPayload {
  if (typeof value !== "object" || value == null) {
    throw new Error("Playlist operation payload must be an object");
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
    throw new Error("Playlist operation requires a name");
  }
  return {
    name: payload.name.trim(),
    description: typeof payload.description === "string" ? payload.description : null,
    type: typeof payload.type === "string" ? payload.type : "manual",
    createdBy: typeof payload.createdBy === "string" ? payload.createdBy : "user",
    fileIds: Array.isArray(payload.fileIds)
      ? [...new Set(payload.fileIds.filter((fileId): fileId is string => typeof fileId === "string" && fileId.length > 0))]
      : []
  };
}

function playlistFileIdsPayload(value: unknown, message: string): PlaylistFileIdsPayload {
  const record = asRecord(value);
  if (!record) {
    throw new Error(message);
  }
  const playlistId = typeof record.playlistId === "string" && record.playlistId.trim() ? record.playlistId.trim() : "";
  const fileIds = Array.isArray(record.fileIds)
    ? [...new Set(record.fileIds.filter((fileId): fileId is string => typeof fileId === "string" && fileId.trim().length > 0))]
    : [];
  if (!playlistId || fileIds.length === 0) {
    throw new Error(message);
  }
  return {
    playlistId,
    fileIds,
    addedBy: typeof record.addedBy === "string" && record.addedBy.trim() ? record.addedBy.trim() : "user"
  };
}

function updatePlaylistPayload(value: unknown): UpdatePlaylistPayload {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Update playlist operation payload must be an object");
  }
  const playlistId = typeof record.playlistId === "string" && record.playlistId.trim() ? record.playlistId.trim() : "";
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "";
  const description =
    typeof record.description === "string" && record.description.trim() ? record.description.trim() : null;
  if (!playlistId || !name) {
    throw new Error("Update playlist operation requires playlistId and name");
  }
  return { playlistId, name, description };
}

function associateFileWithTrackPayload(value: unknown): AssociateFileWithTrackPayload {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Associate file operation payload must be an object");
  }
  const fileId = typeof record.fileId === "string" && record.fileId.trim() ? record.fileId.trim() : "";
  const trackId = typeof record.trackId === "string" && record.trackId.trim() ? record.trackId.trim() : "";
  if (!fileId || !trackId) {
    throw new Error("Associate file operation requires fileId and trackId");
  }
  return { fileId, trackId };
}

function associateTrackWithAlbumPayload(value: unknown): AssociateTrackWithAlbumPayload {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Associate track operation payload must be an object");
  }
  const trackId = typeof record.trackId === "string" && record.trackId.trim() ? record.trackId.trim() : "";
  const albumId = typeof record.albumId === "string" && record.albumId.trim() ? record.albumId.trim() : "";
  if (!trackId || !albumId) {
    throw new Error("Associate track operation requires trackId and albumId");
  }
  return { trackId, albumId };
}

function mergeDuplicateTracksPayload(value: unknown): MergeDuplicateTracksPayload {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Merge duplicate tracks operation payload must be an object");
  }
  const canonicalTrackId =
    typeof record.canonicalTrackId === "string" && record.canonicalTrackId.trim() ? record.canonicalTrackId.trim() : "";
  const duplicateTrackId =
    typeof record.duplicateTrackId === "string" && record.duplicateTrackId.trim() ? record.duplicateTrackId.trim() : "";
  if (!canonicalTrackId || !duplicateTrackId) {
    throw new Error("Merge duplicate tracks operation requires canonicalTrackId and duplicateTrackId");
  }
  if (canonicalTrackId === duplicateTrackId) {
    throw new Error("A track cannot be merged into itself");
  }
  return { canonicalTrackId, duplicateTrackId };
}

function markDuplicatePayload(value: unknown): MarkDuplicatePayload {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Mark duplicate operation payload must be an object");
  }
  const canonicalFileId =
    typeof record.canonicalFileId === "string" && record.canonicalFileId.trim() ? record.canonicalFileId.trim() : "";
  const duplicateFileId =
    typeof record.duplicateFileId === "string" && record.duplicateFileId.trim() ? record.duplicateFileId.trim() : "";
  const reason = typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : null;
  if (!canonicalFileId || !duplicateFileId) {
    throw new Error("Mark duplicate operation requires canonicalFileId and duplicateFileId");
  }
  if (canonicalFileId === duplicateFileId) {
    throw new Error("A file cannot be marked as a duplicate of itself");
  }
  return { canonicalFileId, duplicateFileId, reason };
}

function playlistItemIdsPayload(value: unknown): PlaylistItemIdsPayload {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Remove from playlist operation payload must be an object");
  }
  const playlistId = typeof record.playlistId === "string" && record.playlistId.trim() ? record.playlistId.trim() : "";
  const itemIds = Array.isArray(record.itemIds)
    ? [...new Set(record.itemIds.filter((itemId): itemId is string => typeof itemId === "string" && itemId.trim().length > 0))]
    : [];
  if (!playlistId || itemIds.length === 0) {
    throw new Error("Remove from playlist operation requires playlistId and itemIds");
  }
  return { playlistId, itemIds };
}

function moveFilePayload(value: unknown): MoveFilePayload {
  if (typeof value !== "object" || value == null) {
    throw new Error("Move operation payload must be an object");
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.fileId !== "string" || payload.fileId.length === 0) {
    throw new Error("Move operation requires fileId");
  }
  if (typeof payload.destinationPath !== "string" || payload.destinationPath.length === 0) {
    throw new Error("Move operation requires destinationPath");
  }
  return { fileId: payload.fileId, destinationPath: payload.destinationPath };
}

function renameFilePayload(value: unknown): RenameFilePayload {
  if (typeof value !== "object" || value == null) {
    throw new Error("Rename operation payload must be an object");
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.fileId !== "string" || payload.fileId.length === 0) {
    throw new Error("Rename operation requires fileId");
  }
  if (typeof payload.filename !== "string" || payload.filename.trim().length === 0 || /[\\/]/.test(payload.filename)) {
    throw new Error("Rename operation requires a filename without path separators");
  }
  return { fileId: payload.fileId, filename: payload.filename.trim() };
}

function buildFilenameFromPattern(file: ReturnType<LibraryRepository["getFile"]>, pattern: string): string {
  const extension = file.extension || extname(file.filename).replace(/^\./, "") || "audio";
  const currentStem = file.filename.replace(/\.[^.]+$/, "");
  const tags = file.displayTags;
  const replacements: Record<string, string> = {
    artist: tags.artist ?? tags.albumartist ?? "Unknown Artist",
    albumartist: tags.albumartist ?? tags.artist ?? "Unknown Artist",
    album: tags.album ?? "Unknown Album",
    year: tags.year ?? tags.date ?? "Unknown Year",
    title: tags.title ?? currentStem,
    filename: currentStem,
    ext: extension
  };

  const expanded = pattern.replace(/\{([a-z]+)\}/gi, (token, rawKey: string) => replacements[rawKey.toLowerCase()] ?? token);
  const withExtension = /\.[^./\\]+$/.test(expanded) ? expanded : `${expanded}.${extension}`;
  const filename = sanitizeFilename(withExtension);
  if (!filename || filename === "." || filename === `.${extension}`) {
    throw new Error(`Bulk rename pattern produced an empty filename for ${file.path}`);
  }
  if (/[\\/]/.test(filename)) {
    throw new Error(`Bulk rename pattern produced an invalid filename for ${file.path}`);
  }
  return filename;
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim()
    .replace(/[. ]+$/g, "");
}

function setInternalTagsPayload(value: unknown): SetInternalTagsPayload {
  if (typeof value !== "object" || value == null) {
    throw new Error("Set internal tags operation payload must be an object");
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.trackId !== "string" || payload.trackId.length === 0) {
    throw new Error("Set internal tags operation requires trackId");
  }
  if (!Array.isArray(payload.tags)) {
    throw new Error("Set internal tags operation requires tags");
  }
  const tags = payload.tags.map(String).map((tag) => tag.trim()).filter(Boolean);
  return { trackId: payload.trackId, tags: [...new Set(tags)] };
}

function setFileMetadataPayload(value: unknown): SetFileMetadataPayload {
  const payload = fileIdPayload(value, "Set file metadata operation requires fileId");
  const rawMetadata = (value as Record<string, unknown>).metadata;
  if (typeof rawMetadata !== "object" || rawMetadata == null || Array.isArray(rawMetadata)) {
    throw new Error("Set file metadata operation requires metadata");
  }

  const metadata: EditableFileMetadata = {};
  for (const key of ["title", "artist", "albumartist", "album", "year", "date", "genre", "tracknumber", "discnumber"] as const) {
    if (key in rawMetadata) {
      const rawValue = (rawMetadata as Record<string, unknown>)[key];
      metadata[key] = typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : null;
    }
  }

  return { fileId: payload.fileId, metadata };
}

function editableMetadataFromBefore(value: unknown): EditableFileMetadata {
  const record = asRecord(value);
  const displayTags = asRecord(record?.displayTags);
  if (!displayTags) {
    throw new Error("Metadata operation before-state is missing display tags");
  }

  const metadata: EditableFileMetadata = {};
  for (const key of ["title", "artist", "albumartist", "album", "year", "date", "genre", "tracknumber", "discnumber"] as const) {
    const value = displayTags[key];
    metadata[key] = typeof value === "string" && value.trim() ? value.trim() : null;
  }
  return metadata;
}

function filePreferenceBefore(value: unknown): { rating: number | null; liked: boolean | null; disliked: boolean | null } {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Preference operation before-state must be an object");
  }

  const rating = record.rating;
  const liked = record.liked;
  const disliked = record.disliked;
  return {
    rating: typeof rating === "number" && Number.isInteger(rating) && rating >= 0 && rating <= 5 ? rating : null,
    liked: typeof liked === "boolean" ? liked : null,
    disliked: typeof disliked === "boolean" ? disliked : null
  };
}

function internalTagsBefore(value: unknown): { tags: string[] } {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.tags)) {
    throw new Error("Internal tags operation before-state is missing tags");
  }
  return { tags: record.tags.map(String).map((tag) => tag.trim()).filter(Boolean) };
}

function createPlaylistAfter(value: unknown): CreatePlaylistAfter {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Create playlist operation after-state must be an object");
  }
  const id = record.id;
  const name = record.name;
  const itemCount = record.itemCount;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Create playlist operation after-state is missing playlist id");
  }
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Create playlist operation after-state is missing playlist name");
  }
  if (typeof itemCount !== "number" || !Number.isInteger(itemCount) || itemCount < 0) {
    throw new Error("Create playlist operation after-state is missing item count");
  }
  return { id, name, itemCount };
}

function playlistRecordBefore(value: unknown): PlaylistRecord {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.type !== "string"
  ) {
    throw new Error("Playlist before-state is incomplete");
  }
  return {
    id: record.id,
    name: record.name,
    description: typeof record.description === "string" ? record.description : null,
    type: record.type
  };
}

function playlistEditAfter(value: unknown): PlaylistEditAfter {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Playlist edit after-state must be an object");
  }
  const playlistId = record.playlistId;
  const playlistName = record.playlistName;
  const addedItemIds = record.addedItemIds;
  const addedCount = record.addedCount;
  const skippedCount = record.skippedCount;
  if (typeof playlistId !== "string" || !playlistId.trim()) {
    throw new Error("Playlist edit after-state is missing playlistId");
  }
  if (typeof playlistName !== "string" || !playlistName.trim()) {
    throw new Error("Playlist edit after-state is missing playlistName");
  }
  if (!Array.isArray(addedItemIds) || !addedItemIds.every((itemId) => typeof itemId === "string" && itemId.length > 0)) {
    throw new Error("Playlist edit after-state is missing added item ids");
  }
  if (typeof addedCount !== "number" || !Number.isInteger(addedCount) || addedCount < 0) {
    throw new Error("Playlist edit after-state is missing added count");
  }
  if (typeof skippedCount !== "number" || !Number.isInteger(skippedCount) || skippedCount < 0) {
    throw new Error("Playlist edit after-state is missing skipped count");
  }
  return { playlistId, playlistName, addedItemIds, addedCount, skippedCount };
}

function playlistRemoveBefore(value: unknown): { playlist: PlaylistRecord; items: PlaylistItemSnapshot[] } {
  const record = asRecord(value);
  const playlist = asRecord(record?.playlist);
  const items = record?.items;
  if (
    !playlist ||
    typeof playlist.id !== "string" ||
    typeof playlist.name !== "string" ||
    typeof playlist.type !== "string" ||
    !Array.isArray(items)
  ) {
    throw new Error("Playlist remove before-state is incomplete");
  }
  return {
    playlist: {
      id: playlist.id,
      name: playlist.name,
      description: typeof playlist.description === "string" ? playlist.description : null,
      type: playlist.type
    },
    items: items.map(playlistItemSnapshot)
  };
}

function playlistItemSnapshot(value: unknown): PlaylistItemSnapshot {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.playlist_id !== "string" ||
    typeof record.track_id !== "string" ||
    typeof record.position !== "number" ||
    !Number.isInteger(record.position) ||
    typeof record.added_at !== "string" ||
    typeof record.added_by !== "string"
  ) {
    throw new Error("Playlist item snapshot is incomplete");
  }
  return {
    id: record.id,
    playlist_id: record.playlist_id,
    track_id: record.track_id,
    position: record.position,
    added_at: record.added_at,
    added_by: record.added_by,
    reason: typeof record.reason === "string" ? record.reason : null
  };
}

function associateFileWithTrackAfter(value: unknown): AssociateFileWithTrackAfter {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.fileId !== "string" ||
    typeof record.trackId !== "string" ||
    typeof record.linkId !== "string" ||
    typeof record.created !== "boolean"
  ) {
    throw new Error("Associate file operation after-state is incomplete");
  }
  return {
    fileId: record.fileId,
    trackId: record.trackId,
    linkId: record.linkId,
    created: record.created
  };
}

function associateTrackWithAlbumAfter(value: unknown): AssociateTrackWithAlbumAfter {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.trackId !== "string" ||
    typeof record.albumId !== "string" ||
    !(typeof record.previousAlbumId === "string" || record.previousAlbumId == null)
  ) {
    throw new Error("Associate track operation after-state is incomplete");
  }
  return {
    trackId: record.trackId,
    albumId: record.albumId,
    previousAlbumId: typeof record.previousAlbumId === "string" ? record.previousAlbumId : null
  };
}

function mergeDuplicateTracksAfter(value: unknown): MergeDuplicateTracksAfter {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.canonicalTrackId !== "string" ||
    typeof record.duplicateTrackId !== "string" ||
    !Array.isArray(record.movedFileLinkIds) ||
    !Array.isArray(record.removedDuplicateFileLinkIds) ||
    !Array.isArray(record.movedPlaylistItemIds) ||
    !Array.isArray(record.copiedTagIds)
  ) {
    throw new Error("Merge duplicate tracks operation after-state is incomplete");
  }
  return {
    canonicalTrackId: record.canonicalTrackId,
    duplicateTrackId: record.duplicateTrackId,
    movedFileLinkIds: stringArray(record.movedFileLinkIds, "movedFileLinkIds"),
    removedDuplicateFileLinkIds: stringArray(record.removedDuplicateFileLinkIds, "removedDuplicateFileLinkIds"),
    movedPlaylistItemIds: stringArray(record.movedPlaylistItemIds, "movedPlaylistItemIds"),
    copiedTagIds: stringArray(record.copiedTagIds, "copiedTagIds")
  };
}

function trackMergeSnapshotBefore(value: unknown): TrackMergeSnapshot {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Track merge before-state must be an object");
  }
  if (
    !Array.isArray(record.canonicalTrackFiles) ||
    !Array.isArray(record.duplicateTrackFiles) ||
    !Array.isArray(record.canonicalTagLinks) ||
    !Array.isArray(record.duplicateTagLinks) ||
    !Array.isArray(record.duplicatePlaylistItems)
  ) {
    throw new Error("Track merge before-state row arrays are incomplete");
  }
  return {
    canonicalTrack: trackRecordSnapshot(record.canonicalTrack),
    duplicateTrack: trackRecordSnapshot(record.duplicateTrack),
    canonicalTrackFiles: record.canonicalTrackFiles.map(trackFileLinkSnapshot),
    duplicateTrackFiles: record.duplicateTrackFiles.map(trackFileLinkSnapshot),
    canonicalTagLinks: record.canonicalTagLinks.map(trackUserTagLinkSnapshot),
    duplicateTagLinks: record.duplicateTagLinks.map(trackUserTagLinkSnapshot),
    duplicatePlaylistItems: record.duplicatePlaylistItems.map(playlistItemSnapshot)
  };
}

function trackRecordSnapshot(value: unknown): TrackRecord {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || typeof record.title !== "string") {
    throw new Error("Track snapshot is incomplete");
  }
  return {
    id: record.id,
    title: record.title,
    album_id: typeof record.album_id === "string" ? record.album_id : null,
    merged_into_track_id: typeof record.merged_into_track_id === "string" ? record.merged_into_track_id : null,
    merged_at: typeof record.merged_at === "string" ? record.merged_at : null
  };
}

function trackFileLinkSnapshot(value: unknown): TrackFileLink {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.track_id !== "string" ||
    typeof record.file_id !== "string" ||
    typeof record.is_preferred !== "number" ||
    typeof record.created_at !== "string"
  ) {
    throw new Error("Track-file link snapshot is incomplete");
  }
  return {
    id: record.id,
    track_id: record.track_id,
    file_id: record.file_id,
    quality_rank: typeof record.quality_rank === "number" ? record.quality_rank : null,
    is_preferred: record.is_preferred,
    source: typeof record.source === "string" ? record.source : null,
    created_at: record.created_at
  };
}

function trackUserTagLinkSnapshot(value: unknown): TrackUserTagLink {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.track_id !== "string" ||
    typeof record.user_tag_id !== "string" ||
    typeof record.created_at !== "string" ||
    typeof record.source !== "string"
  ) {
    throw new Error("Track tag link snapshot is incomplete");
  }
  return {
    track_id: record.track_id,
    user_tag_id: record.user_tag_id,
    created_at: record.created_at,
    source: record.source
  };
}

function markDuplicateAfter(value: unknown): MarkDuplicateAfter {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.canonicalFileId !== "string" ||
    typeof record.duplicateFileId !== "string" ||
    typeof record.created !== "boolean"
  ) {
    throw new Error("Mark duplicate operation after-state is incomplete");
  }
  return {
    id: record.id,
    canonicalFileId: record.canonicalFileId,
    duplicateFileId: record.duplicateFileId,
    created: record.created
  };
}

function setRatingPayload(value: unknown): SetRatingPayload {
  const payload = fileIdPayload(value, "Set rating operation requires fileId");
  const rating = (value as Record<string, unknown>).rating;
  if (rating == null) {
    return { fileId: payload.fileId, rating: null };
  }
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw new Error("Set rating operation requires rating between 0 and 5");
  }
  return { fileId: payload.fileId, rating };
}

function setFavoriteStatusPayload(value: unknown): SetFavoriteStatusPayload {
  const payload = fileIdPayload(value, "Set favorite status operation requires fileId");
  const record = value as Record<string, unknown>;
  const liked = booleanOrNull(record.liked, "liked");
  const disliked = booleanOrNull(record.disliked, "disliked");
  if (liked === true && disliked === true) {
    throw new Error("A file cannot be both liked and disliked");
  }
  return { fileId: payload.fileId, liked, disliked };
}

function booleanOrNull(value: unknown, key: string): boolean | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Set favorite status operation requires ${key} to be boolean or null`);
  }
  return value;
}

function queueDownloadPayload(value: unknown): QueueDownloadPayload {
  const record = asRecord(value);
  const query = typeof record?.query === "string" ? record.query : "";
  const results = Array.isArray(record?.results) ? record.results.map(discoveryResultPayload) : [];
  const libraryRootId = typeof record?.libraryRootId === "string" && record.libraryRootId.trim() ? record.libraryRootId : undefined;
  if (results.length === 0) {
    throw new Error("Queue download operation requires at least one Discovery result");
  }
  return {
    query,
    results,
    libraryRootId
  };
}

function discoveryResultPayload(value: unknown): DiscoveryResult {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Queue download result must be an object");
  }
  const id = stringField(record, "id");
  const filename = stringField(record, "filename");
  const path = stringField(record, "path");
  return {
    id,
    source: "slskd",
    username: nullableString(record.username),
    filename,
    path,
    folder: nullableString(record.folder),
    sizeBytes: nullableNumber(record.sizeBytes),
    extension: nullableString(record.extension),
    bitrate: nullableNumber(record.bitrate),
    sampleRate: nullableNumber(record.sampleRate),
    lengthSeconds: nullableNumber(record.lengthSeconds),
    isLocked: Boolean(record.isLocked),
    raw: asRecord(record.raw) ?? {}
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringArray(value: unknown[], key: string): string[] {
  if (!value.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error(`Operation after-state requires string array ${key}`);
  }
  return value.map((item) => item as string);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Queue download result requires ${key}`);
  }
  return value.trim();
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function fileIdPayload(value: unknown, message: string): { fileId: string } {
  if (typeof value !== "object" || value == null) {
    throw new Error(message);
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.fileId !== "string" || payload.fileId.length === 0) {
    throw new Error(message);
  }
  return { fileId: payload.fileId };
}

function serializeError(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : String(error) };
}
