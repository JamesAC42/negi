import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { AgentMessageResponse, AgentPlaylistWorkflow, DiscoveryDownloadJob, ImportItem, Operation, OperationBatch } from "@music-os/core";
import { LibraryRepository } from "./library-repository.js";
import { OperationService } from "./operation-service.js";
import { ImportService } from "./import-service.js";
import { PlaylistService } from "./playlist-service.js";
import { DiscoveryDownloadService } from "./discovery-download-service.js";

type WorkflowStatus =
  | "waiting_for_batch"
  | "waiting_for_download"
  | "waiting_for_import"
  | "creating_playlist"
  | "completed"
  | "partial"
  | "failed";

interface WorkflowRow {
  id: string;
  run_id: string | null;
  thread_id: string | null;
  operation_batch_id: string;
  status: WorkflowStatus;
  playlist_name: string;
  playlist_description: string | null;
  owned_file_ids_json: string;
  playlist_item_refs_json: string;
  download_job_id: string | null;
  import_id: string | null;
  import_operation_batch_id: string | null;
  playlist_operation_batch_id: string | null;
  playlist_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

type PlaylistItemRef =
  | {
      type: "owned";
      fileId: string;
    }
  | {
      type: "download";
      discoveryId: string;
    };

export class AgentPlaylistWorkflowService {
  private readonly advancing = new Map<string, Promise<void>>();
  constructor(
    private readonly db: Database.Database,
    private readonly library: LibraryRepository,
    private readonly operations: OperationService,
    private readonly imports: ImportService,
    private readonly playlists: PlaylistService,
    private readonly downloads: DiscoveryDownloadService
  ) {}

  listWorkflows(limit = 50): AgentPlaylistWorkflow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_playlist_workflows
         ORDER BY updated_at DESC, created_at DESC
         LIMIT ?`
      )
      .all(limit) as WorkflowRow[];
    return rows.map((row) => ({ ...mapWorkflow(row), delivery: this.delivery(row) }));
  }

  registerAgentResponse(runId: string, threadId: string | null, response: AgentMessageResponse): void {
    if (!response.operationBatch) {
      return;
    }
    const existing = this.db
      .prepare("SELECT id FROM agent_playlist_workflows WHERE run_id = ?")
      .get(runId) as { id: string } | undefined;
    if (existing) {
      return;
    }

    const playlistOperation = response.operationBatch.operations.find((operation) => operation.type === "create_playlist");
    const queueOperation = response.operationBatch.operations.find((operation) => operation.type === "queue_download");
    if (!playlistOperation && !queueOperation) {
      return;
    }

    const playlistPayload = asRecord(playlistOperation?.payload);
    const queuePayload = asRecord(queueOperation?.payload);
    const researchPlaylistPayload = asRecord(queuePayload?.researchPlaylist);
    // Plain song/album downloads do not implicitly request a playlist.
    if (!playlistOperation && !researchPlaylistPayload && response.intent !== "research_playlist") {
      return;
    }
    const name = stringValue(playlistPayload?.name) || stringValue(researchPlaylistPayload?.name) || playlistNameFromResponse(response);
    const description =
      nullableStringValue(playlistPayload?.description) ??
      nullableStringValue(researchPlaylistPayload?.description) ??
      `Agent researched playlist from: ${response.searchQuery}`;
    const ownedFileIds = [...new Set([...stringArrayValue(playlistPayload?.fileIds), ...stringArrayValue(researchPlaylistPayload?.ownedFileIds)])];
    const playlistItemRefs = playlistItemRefsValue(researchPlaylistPayload?.playlistItemRefs);

    this.db
      .prepare(
        `INSERT INTO agent_playlist_workflows (
          id, run_id, thread_id, operation_batch_id, status, playlist_name, playlist_description, owned_file_ids_json, playlist_item_refs_json
        ) VALUES (?, ?, ?, ?, 'waiting_for_batch', ?, ?, ?, ?)`
      )
      .run(nanoid(), runId, threadId, response.operationBatch.id, name, description, JSON.stringify(ownedFileIds), JSON.stringify(playlistItemRefs));
  }

  async advanceAll(): Promise<void> {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_playlist_workflows
         WHERE status NOT IN ('completed', 'partial', 'failed')
         ORDER BY created_at ASC`
      )
      .all() as WorkflowRow[];
    for (const row of rows) {
      await this.advance(row.id);
    }
  }

  async advanceForDownloadJob(jobId: string): Promise<void> {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_playlist_workflows
         WHERE download_job_id = ? AND status NOT IN ('completed', 'partial', 'failed')
         ORDER BY created_at ASC`
      )
      .all(jobId) as WorkflowRow[];
    for (const row of rows) {
      await this.advance(row.id);
    }
  }

  async advance(workflowId: string): Promise<void> {
    return this.serializeAdvance(workflowId, false);
  }

  /** Recover available tracks only: never queues downloads or reimports successful items. */
  async resume(workflowId: string): Promise<void> {
    return this.serializeAdvance(workflowId, true);
  }

  private async serializeAdvance(workflowId: string, resume: boolean): Promise<void> {
    const active = this.advancing.get(workflowId);
    if (active) return active;
    // Defer execution until the lock is installed, including synchronous service callbacks.
    const pending = Promise.resolve().then(() => this.advanceOnce(workflowId, resume));
    this.advancing.set(workflowId, pending);
    try {
      await pending;
    } finally {
      this.advancing.delete(workflowId);
    }
  }

  private async advanceOnce(workflowId: string, resume: boolean): Promise<void> {
    const row = this.getRow(workflowId);
    if (row.status === "completed" || (!resume && (row.status === "failed" || row.status === "partial"))) return;
    try {
      const batch = this.operations.getBatch(row.operation_batch_id);
      if (batch.status !== "applied" && batch.status !== "partially_applied") {
        this.mark(row.id, "waiting_for_batch");
        return;
      }

      const downloadJobId = row.download_job_id ?? readDownloadJobId(batch);
      const playlistId = row.playlist_id ?? readPlaylistId(batch);
      this.updateLinks(row.id, { downloadJobId, playlistId });
      if (!downloadJobId) {
        await this.createOrUpdatePlaylist(this.getRow(row.id), playlistId, []);
        return;
      }

      const job = this.downloads.getJob(downloadJobId);
      if (job.status === "queued" || job.status === "running") {
        this.mark(row.id, "waiting_for_download");
        return;
      }

      const warnings: string[] = [];
      if (job.status === "failed" || job.status === "cancelled") {
        warnings.push(job.error ?? `Downloads ended with ${job.status}.`);
      }
      const missingDownloads = Math.max(0, job.selectedCount - job.completedCount);
      if (missingDownloads > 0) {
        warnings.push(`${missingDownloads} requested download${missingDownloads === 1 ? "" : "s"} did not arrive.`);
      }

      const importId = job.imported?.id ?? row.import_id;
      if (importId) {
        this.updateLinks(row.id, { importId });
        try {
          const warning = await this.approveImportItems(this.getRow(row.id), importId);
          if (warning) warnings.push(warning);
        } catch (error) {
          // A failed item must never prevent delivery of the tracks that did import.
          warnings.push(error instanceof Error ? error.message : String(error));
        }
      } else {
        warnings.push("No downloaded tracks were available to import.");
      }
      const current = this.getRow(row.id);
      await this.createOrUpdatePlaylist(current, playlistId, this.importedFileIds(current.import_id), warnings);
    } catch (error) {
      this.fail(row.id, error instanceof Error ? error.message : String(error));
    }
  }

  private async approveImportItems(row: WorkflowRow, importId: string): Promise<string | null> {
    const imported = this.imports.getImport(importId);
    const reviewableIds = imported.items.filter((item) => item.status === "needs_review").map((item) => item.id);
    if (reviewableIds.length === 0) return null;
    const root = this.library.listRoots()[0];
    if (!root) throw new Error("Add a library root before the agent can import downloaded playlist tracks.");

    this.mark(row.id, "waiting_for_import");
    const batch = this.operations.createImportApprovalBatchForItems(reviewableIds, root.id, "agent");
    // Persist before the await so diagnostics and recovery retain this batch.
    this.updateLinks(row.id, { importOperationBatchId: batch.id });
    this.operations.approveBatch(batch.id);
    const applied = await this.operations.applyBatch(batch.id);
    const remaining = this.imports.getImport(importId).items.filter((item) => reviewableIds.includes(item.id) && item.status !== "imported");
    if (remaining.length === 0) return null;
    const firstError = applied.operations.filter((operation) => operation.status === "failed")
      .map((operation) => operationErrorMessage(operation.error)).find(Boolean);
    return `${remaining.length} downloaded track${remaining.length === 1 ? "" : "s"} could not be imported${firstError ? `: ${firstError}` : "."}`;
  }

  private importedFileIds(importId: string | null): string[] {
    if (!importId) return [];
    return this.imports.getImport(importId).items
      .filter((item) => item.status === "imported")
      .map((item) => item.fileId).filter((id): id is string => Boolean(id));
  }

  private async createOrUpdatePlaylist(row: WorkflowRow, playlistId: string | null, importedFileIds: string[], warnings: string[] = []): Promise<void> {
    const ownedFileIds = parseStringArray(row.owned_file_ids_json);
    const resolved = this.resolvePlaylistFileIds(row, ownedFileIds, importedFileIds);
    const available = this.availableFileIds(resolved);
    const fileIds = resolved.filter((id) => available.has(id));
    if (fileIds.length === 0) {
      throw new Error(["No imported or owned files were available for the researched playlist.", ...warnings].join(" "));
    }

    this.mark(row.id, "creating_playlist");
    const fileIdsToApply = playlistId ? this.filterMissingPlaylistFileIds(playlistId, fileIds) : fileIds;
    let playlistOperationBatchId: string | null = row.playlist_operation_batch_id ?? (playlistId ? row.operation_batch_id : null);
    let finalPlaylistId = playlistId ?? row.playlist_id;
    if (fileIdsToApply.length > 0) {
      const batch = playlistId
        ? this.operations.createAddTracksToPlaylistBatch(playlistId, fileIdsToApply, "agent")
        : this.operations.createPlaylistBatch(row.playlist_name, row.playlist_description ?? undefined, fileIdsToApply, "agent");
      this.operations.approveBatch(batch.id);
      const applied = await this.operations.applyBatch(batch.id);
      playlistOperationBatchId = applied.id;
      if (applied.status !== "applied") {
        const detail = applied.operations.map((operation) => operationErrorMessage(operation.error)).find(Boolean);
        throw new Error(detail ?? "Playlist operation did not finish.");
      }
      finalPlaylistId = playlistId ?? readPlaylistId(applied) ?? row.playlist_id;
    }
    if (!finalPlaylistId) {
      throw new Error("Playlist operation completed without returning a playlist id.");
    }
    if (playlistId && fileIdsToApply.length > 0) {
      this.positionRecoveredTracks(finalPlaylistId, fileIds, new Set(fileIdsToApply));
    }
    const playlist = this.playlists.getPlaylist(finalPlaylistId);
    const delivery = this.delivery({ ...row, playlist_id: finalPlaylistId });
    const partial = delivery.missingTrackCount > 0 || delivery.pendingImportCount > 0;
    const warning = partial
      ? [`${delivery.readyTrackCount} of ${delivery.requestedTrackCount} requested tracks are ready; ${delivery.missingTrackCount} still missing.`, ...warnings].join(" ")
      : null;
    this.db
      .prepare(
        `UPDATE agent_playlist_workflows
         SET status = ?,
             playlist_operation_batch_id = ?,
             playlist_id = ?,
             error = ?,
             updated_at = datetime('now'),
             completed_at = datetime('now')
         WHERE id = ?`
      )
      .run(partial ? "partial" : "completed", playlistOperationBatchId, finalPlaylistId, warning, row.id);
    const message = partial
      ? `Your playlist is ready: ${row.playlist_name}. ${delivery.readyTrackCount} of ${delivery.requestedTrackCount} tracks are ready; ${delivery.missingTrackCount} could not be added yet. Available tracks are saved in the playlist.`
      : `Here's your playlist: ${row.playlist_name}. ${playlist.items.length} track${playlist.items.length === 1 ? " is" : "s are"} ready.`;
    this.insertWorkflowMessage(row, message, {
      reply: message,
      intent: "research_playlist",
      searchQuery: row.playlist_name,
      playlistId: finalPlaylistId,
      results: [],
      discoveryResults: [],
      parsedListItems: [],
      importResults: [],
      operationBatch: null,
      playback: null
    });
  }

  private resolvePlaylistFileIds(row: WorkflowRow, ownedFileIds: string[], importedFileIds: string[]): string[] {
    const refs = parsePlaylistItemRefs(row.playlist_item_refs_json);
    if (refs.length === 0) {
      return [...new Set([...ownedFileIds, ...importedFileIds])];
    }

    const importedByDiscoveryId = this.importedFileIdsByDiscoveryId(row.import_id);
    const ordered = [...new Set(refs
      .map((ref) => {
        if (ref.type === "owned") {
          return ref.fileId;
        }
        return importedByDiscoveryId.get(ref.discoveryId) ?? null;
      })
      .filter((fileId): fileId is string => Boolean(fileId)))];
    const referenced = new Set(ordered);
    for (const fileId of [...ownedFileIds, ...importedFileIds]) {
      if (!referenced.has(fileId)) {
        ordered.push(fileId);
        referenced.add(fileId);
      }
    }
    return ordered;
  }

  private importedFileIdsByDiscoveryId(importId: string | null): Map<string, string> {
    return new Map([...this.importItemsByDiscoveryId(importId)]
      .filter((entry): entry is [string, ImportItem & { fileId: string }] => entry[1].status === "imported" && Boolean(entry[1].fileId))
      .map(([discoveryId, item]) => [discoveryId, item.fileId]));
  }

  private importItemsByDiscoveryId(importId: string | null): Map<string, ImportItem> {
    const byDiscoveryId = new Map<string, ImportItem>();
    if (!importId) return byDiscoveryId;
    let importBatch;
    try {
      importBatch = this.imports.getImport(importId);
    } catch {
      return byDiscoveryId;
    }
    const context = this.importSourceContext(importId);
    const selectedResults = Array.isArray(context?.selectedResults) ? context.selectedResults : [];
    const expandedPaths = Array.isArray(context?.expandedPaths) ? context.expandedPaths : [];
    const selectedPaths = selectedResults.flatMap((selected) => {
      const record = asRecord(selected);
      const discoveryId = stringValue(record?.id);
      const resultPath = stringValue(record?.path);
      return discoveryId && resultPath ? [{ discoveryId, segments: normalizedPathSegments(resultPath) }] : [];
    });
    const itemsById = new Map(importBatch.items.map((item) => [item.id, item]));
    // createFromSourcePaths inserts each item in expandedPaths order. created_at
    // has one-second precision, so explicitly retain insertion order for ties.
    const itemRows = this.db.prepare("SELECT id FROM import_items WHERE import_id = ? ORDER BY rowid ASC")
      .all(importId) as Array<{ id: string }>;
    for (let index = 0; index < itemRows.length; index += 1) {
      const item = itemsById.get(itemRows[index]!.id);
      if (!item) continue;
      const originalPath = typeof expandedPaths[index] === "string" ? expandedPaths[index] : null;
      const segments = normalizedPathSegments(originalPath ?? item.stagingPath);
      let bestScore = 0;
      let matches: string[] = [];
      for (const selected of selectedPaths) {
        const score = commonPathSuffixLength(segments, selected.segments);
        if (score > bestScore) {
          bestScore = score;
          matches = [selected.discoveryId];
        } else if (score > 0 && score === bestScore) {
          matches.push(selected.discoveryId);
        }
      }
      const uniqueMatches = [...new Set(matches)];
      // A basename alone is sufficient only when unique. Never silently map two
      // artists' "01 - Intro.flac" to the last selected result.
      if (bestScore > 0 && uniqueMatches.length === 1) byDiscoveryId.set(uniqueMatches[0]!, item);
    }
    return byDiscoveryId;
  }

  private importSourceContext(importId: string): Record<string, unknown> | null {
    const row = this.db.prepare("SELECT source_context_json FROM imports WHERE id = ?").get(importId) as
      | { source_context_json: string }
      | undefined;
    if (!row) {
      return null;
    }
    try {
      return asRecord(JSON.parse(row.source_context_json));
    } catch {
      return null;
    }
  }

  private delivery(row: WorkflowRow): NonNullable<AgentPlaylistWorkflow["delivery"]> {
    let job: DiscoveryDownloadJob | null = null;
    if (row.download_job_id) {
      try { job = this.downloads.getJob(row.download_job_id); } catch { /* Retain workflow diagnostics if the job was removed. */ }
    }
    const importId = row.import_id ?? job?.imported?.id ?? null;
    let items = job?.imported?.items ?? [];
    if (importId) {
      try { items = this.imports.getImport(importId).items; } catch { /* A missing import remains undelivered. */ }
    }
    const owned = parseStringArray(row.owned_file_ids_json);
    const available = this.availableFileIds([
      ...owned,
      ...items.filter((item) => item.status === "imported").flatMap((item) => item.fileId ? [item.fileId] : [])
    ]);
    const refs = parsePlaylistItemRefs(row.playlist_item_refs_json);
    const requestedTrackCount = refs.length > 0
      ? new Set(refs.map((ref) => ref.type === "owned" ? `owned:${ref.fileId}` : `download:${ref.discoveryId}`)).size
      : new Set(owned).size + (job?.selectedCount ?? items.length);
    const itemsByDiscoveryId = this.importItemsByDiscoveryId(importId);
    const tracks: NonNullable<NonNullable<AgentPlaylistWorkflow["delivery"]>["tracks"]> = refs.map((ref) => {
      if (ref.type === "owned") {
        return { discoveryId: null, fileId: ref.fileId, state: available.has(ref.fileId) ? "owned" : "missing" };
      }
      const item = itemsByDiscoveryId.get(ref.discoveryId);
      const fileId = item?.fileId ?? null;
      const state = item?.status === "imported" && fileId && available.has(fileId)
        ? "imported"
        : item?.status === "needs_review" || item?.status === "scanning" ? "pending" : "missing";
      return { discoveryId: ref.discoveryId, fileId, state };
    });
    return {
      readyTrackCount: available.size,
      requestedTrackCount: Math.max(requestedTrackCount, available.size),
      missingTrackCount: Math.max(0, requestedTrackCount - available.size),
      pendingImportCount: items.filter((item) => item.status === "needs_review").length,
      tracks
    };
  }

  private availableFileIds(fileIds: string[]): Set<string> {
    if (fileIds.length === 0) return new Set();
    // Polling delivery counts should not hydrate tags/artwork for every track.
    const rows = this.db.prepare(
      `SELECT id FROM files WHERE staged = 0 AND missing = 0 AND id IN (${fileIds.map(() => "?").join(",")})`
    ).all(...fileIds) as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  }

  private positionRecoveredTracks(playlistId: string, intendedFileIds: string[], addedFileIds: Set<string>): void {
    // Insert only recovered items among the surviving sequence. Existing/user-added
    // tracks retain their relative order, so resuming never replaces playlist edits.
    const items = this.playlists.getPlaylist(playlistId).items;
    const ordered = items.filter((item) => !addedFileIds.has(item.file.id));
    for (let index = 0; index < intendedFileIds.length; index += 1) {
      const fileId = intendedFileIds[index]!;
      if (!addedFileIds.has(fileId)) continue;
      const item = items.find((entry) => entry.file.id === fileId);
      if (!item) continue;
      const successorIds = new Set(intendedFileIds.slice(index + 1));
      const next = ordered.findIndex((entry) => successorIds.has(entry.file.id));
      if (next >= 0) ordered.splice(next, 0, item);
      else ordered.push(item);
    }
    this.db.transaction(() => {
      const update = this.db.prepare("UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?");
      ordered.forEach((item, index) => update.run(index, item.id, playlistId));
    })();
  }

  private filterMissingPlaylistFileIds(playlistId: string, fileIds: string[]): string[] {
    const existingFileIds = new Set(this.playlists.getPlaylist(playlistId).items.map((item) => item.file.id));
    return fileIds.filter((fileId) => !existingFileIds.has(fileId));
  }

  private getRow(workflowId: string): WorkflowRow {
    const row = this.db.prepare("SELECT * FROM agent_playlist_workflows WHERE id = ?").get(workflowId) as
      | WorkflowRow
      | undefined;
    if (!row) {
      throw new Error(`Agent playlist workflow not found: ${workflowId}`);
    }
    return row;
  }

  private mark(workflowId: string, status: WorkflowStatus): void {
    this.db
      .prepare("UPDATE agent_playlist_workflows SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, workflowId);
  }

  private fail(workflowId: string, message: string): void {
    const row = this.getRow(workflowId);
    this.db
      .prepare(
        `UPDATE agent_playlist_workflows
         SET status = 'failed', error = ?, updated_at = datetime('now'), completed_at = datetime('now')
         WHERE id = ?`
      )
      .run(message, workflowId);
    this.insertWorkflowMessage(row, `I could not finish ${row.playlist_name}: ${message}`);
  }

  private updateLinks(
    workflowId: string,
    links: {
      downloadJobId?: string | null;
      importId?: string | null;
      importOperationBatchId?: string | null;
      playlistId?: string | null;
    }
  ): void {
    this.db
      .prepare(
        `UPDATE agent_playlist_workflows
         SET download_job_id = COALESCE(?, download_job_id),
             import_id = COALESCE(?, import_id),
             import_operation_batch_id = COALESCE(?, import_operation_batch_id),
             playlist_id = COALESCE(?, playlist_id),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        links.downloadJobId ?? null,
        links.importId ?? null,
        links.importOperationBatchId ?? null,
        links.playlistId ?? null,
        workflowId
      );
  }

  private insertWorkflowMessage(row: WorkflowRow, text: string, response: AgentMessageResponse | null = null): void {
    if (!row.thread_id) {
      return;
    }
    const existing = this.getWorkflowMessage(row.thread_id, text);
    if (existing) {
      if (response != null && existing.response_json == null) {
        this.db
          .prepare("UPDATE agent_messages SET response_json = ? WHERE id = ?")
          .run(JSON.stringify(response), existing.id);
        this.db.prepare("UPDATE agent_threads SET updated_at = datetime('now') WHERE id = ?").run(row.thread_id);
      }
      return;
    }
    this.db
      .prepare(
        `INSERT INTO agent_messages (id, thread_id, role, text, response_json)
         VALUES (?, ?, 'agent', ?, ?)`
      )
      .run(nanoid(), row.thread_id, text, response == null ? null : JSON.stringify(response));
    this.db.prepare("UPDATE agent_threads SET updated_at = datetime('now') WHERE id = ?").run(row.thread_id);
  }

  private getWorkflowMessage(threadId: string, text: string): { id: string; response_json: string | null } | null {
    const row = this.db
      .prepare("SELECT id, response_json FROM agent_messages WHERE thread_id = ? AND role = 'agent' AND text = ? LIMIT 1")
      .get(threadId, text) as { id: string; response_json: string | null } | undefined;
    return row ?? null;
  }
}

function mapWorkflow(row: WorkflowRow): AgentPlaylistWorkflow {
  return {
    id: row.id,
    runId: row.run_id,
    threadId: row.thread_id,
    operationBatchId: row.operation_batch_id,
    status: row.status,
    playlistName: row.playlist_name,
    playlistDescription: row.playlist_description,
    ownedFileIds: parseStringArray(row.owned_file_ids_json),
    downloadJobId: row.download_job_id,
    importId: row.import_id,
    importOperationBatchId: row.import_operation_batch_id,
    playlistOperationBatchId: row.playlist_operation_batch_id,
    playlistId: row.playlist_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

function readDownloadJobId(batch: OperationBatch): string | null {
  const operation = batch.operations.find((item) => item.type === "queue_download" && item.status === "applied");
  const after = asRecord(operation?.after);
  return stringValue(after?.id);
}

function readPlaylistId(batch: OperationBatch): string | null {
  const operation = batch.operations.find(
    (item) => (item.type === "create_playlist" || item.type === "add_tracks_to_playlist") && item.status === "applied"
  );
  const after = asRecord(operation?.after);
  return stringValue(after?.id) ?? stringValue(after?.playlistId);
}

function playlistNameFromResponse(response: AgentMessageResponse): string {
  const query = response.searchQuery.trim();
  if (!query) {
    return `Agent Playlist ${new Date().toISOString().slice(0, 10)}`;
  }
  return `Agent: ${query.replace(/\b\p{L}/gu, (match) => match.toUpperCase())}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableStringValue(value: unknown): string | null {
  return value == null ? null : stringValue(value);
}

function operationErrorMessage(error: unknown): string | null {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (typeof error !== "object" || error == null || !("message" in error)) {
    return null;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function playlistItemRefsValue(value: unknown): PlaylistItemRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const refs: PlaylistItemRef[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const type = record?.type;
    if (type === "owned") {
      const fileId = stringValue(record.fileId);
      if (fileId) {
        refs.push({ type, fileId });
      }
      continue;
    }
    if (type === "download") {
      const discoveryId = stringValue(record.discoveryId);
      if (discoveryId) {
        refs.push({ type, discoveryId });
      }
    }
  }
  return refs;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return stringArrayValue(parsed);
  } catch {
    return [];
  }
}

function parsePlaylistItemRefs(value: string): PlaylistItemRef[] {
  try {
    return playlistItemRefsValue(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

function normalizedPathSegments(value: string): string[] {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).map((segment) => segment.toLowerCase());
}

function commonPathSuffixLength(left: string[], right: string[]): number {
  let length = 0;
  while (length < left.length && length < right.length && left[left.length - 1 - length] === right[right.length - 1 - length]) {
    length += 1;
  }
  return length;
}
