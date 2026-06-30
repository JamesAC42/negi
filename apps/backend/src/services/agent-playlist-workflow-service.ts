import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { AgentMessageResponse, AgentPlaylistWorkflow, DiscoveryDownloadJob, Operation, OperationBatch } from "@music-os/core";
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

export class AgentPlaylistWorkflowService {
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
    return rows.map(mapWorkflow);
  }

  registerAgentResponse(runId: string, threadId: string | null, response: AgentMessageResponse): void {
    if (response.intent !== "research_playlist" || !response.operationBatch) {
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
    const name = stringValue(playlistPayload?.name) || stringValue(researchPlaylistPayload?.name) || playlistNameFromResponse(response);
    const description =
      nullableStringValue(playlistPayload?.description) ??
      nullableStringValue(researchPlaylistPayload?.description) ??
      `Agent researched playlist from: ${response.searchQuery}`;
    const ownedFileIds = [...new Set([...stringArrayValue(playlistPayload?.fileIds), ...stringArrayValue(researchPlaylistPayload?.ownedFileIds)])];

    this.db
      .prepare(
        `INSERT INTO agent_playlist_workflows (
          id, run_id, thread_id, operation_batch_id, status, playlist_name, playlist_description, owned_file_ids_json
        ) VALUES (?, ?, ?, ?, 'waiting_for_batch', ?, ?, ?)`
      )
      .run(nanoid(), runId, threadId, response.operationBatch.id, name, description, JSON.stringify(ownedFileIds));
  }

  async advanceAll(): Promise<void> {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_playlist_workflows
         WHERE status NOT IN ('completed', 'failed')
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
         WHERE download_job_id = ? AND status NOT IN ('completed', 'failed')
         ORDER BY created_at ASC`
      )
      .all(jobId) as WorkflowRow[];
    for (const row of rows) {
      await this.advance(row.id);
    }
  }

  async advance(workflowId: string): Promise<void> {
    const row = this.getRow(workflowId);
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
        await this.createOrUpdatePlaylist(row, playlistId, []);
        return;
      }

      const job = this.downloads.getJob(downloadJobId);
      if (job.status === "queued" || job.status === "running") {
        this.mark(row.id, "waiting_for_download");
        return;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        this.fail(row.id, job.error ?? `Discovery download job ended with ${job.status}`);
        return;
      }
      if (!job.imported) {
        this.mark(row.id, "waiting_for_import");
        return;
      }

      this.updateLinks(row.id, { downloadJobId, importId: job.imported.id, playlistId });
      const importedFileIds = await this.approveImportItems(row, job);
      await this.createOrUpdatePlaylist(this.getRow(row.id), playlistId, importedFileIds);
    } catch (error) {
      this.fail(row.id, error instanceof Error ? error.message : String(error));
    }
  }

  private async approveImportItems(row: WorkflowRow, job: DiscoveryDownloadJob): Promise<string[]> {
    if (!job.imported) {
      return [];
    }
    const imported = this.imports.getImport(job.imported.id);
    const existingFileIds = imported.items.map((item) => item.fileId).filter((fileId): fileId is string => Boolean(fileId));
    const reviewableIds = imported.items.filter((item) => item.status === "needs_review").map((item) => item.id);
    if (reviewableIds.length === 0) {
      return existingFileIds;
    }

    const root = this.library.listRoots()[0];
    if (!root) {
      throw new Error("Add a library root before the agent can import downloaded playlist tracks.");
    }

    this.mark(row.id, "waiting_for_import");
    const batch = this.operations.createImportApprovalBatchForItems(reviewableIds, root.id, "agent");
    this.operations.approveBatch(batch.id);
    const applied = await this.operations.applyBatch(batch.id);
    this.updateLinks(row.id, { importOperationBatchId: applied.id });

    return this.imports
      .getImport(job.imported.id)
      .items.map((item) => item.fileId)
      .filter((fileId): fileId is string => Boolean(fileId));
  }

  private async createOrUpdatePlaylist(row: WorkflowRow, playlistId: string | null, importedFileIds: string[]): Promise<void> {
    const ownedFileIds = parseStringArray(row.owned_file_ids_json);
    const fileIds = [...new Set([...ownedFileIds, ...importedFileIds])].filter((fileId) => {
      try {
        this.library.getFile(fileId);
        return true;
      } catch {
        return false;
      }
    });
    if (fileIds.length === 0) {
      throw new Error("No imported or owned files were available for the researched playlist.");
    }

    this.mark(row.id, "creating_playlist");
    const batch = playlistId
      ? this.operations.createAddTracksToPlaylistBatch(playlistId, fileIds, "agent")
      : this.operations.createPlaylistBatch(row.playlist_name, row.playlist_description ?? undefined, fileIds, "agent");
    this.operations.approveBatch(batch.id);
    const applied = await this.operations.applyBatch(batch.id);
    const finalPlaylistId = playlistId ?? readPlaylistId(applied) ?? row.playlist_id;
    if (!finalPlaylistId) {
      throw new Error("Playlist operation completed without returning a playlist id.");
    }
    this.playlists.getPlaylist(finalPlaylistId);
    this.db
      .prepare(
        `UPDATE agent_playlist_workflows
         SET status = 'completed',
             playlist_operation_batch_id = ?,
             playlist_id = ?,
             error = NULL,
             updated_at = datetime('now'),
             completed_at = datetime('now')
         WHERE id = ?`
      )
      .run(applied.id, finalPlaylistId, row.id);
    this.insertWorkflowMessage(
      row,
      `Here's your playlist: ${row.playlist_name}. ${fileIds.length} track${fileIds.length === 1 ? "" : "s"} ${
        playlistId ? "were added to it" : "are ready"
      }.`
    );
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

  private insertWorkflowMessage(row: WorkflowRow, text: string): void {
    if (!row.thread_id || this.hasWorkflowMessage(row.thread_id, text)) {
      return;
    }
    this.db
      .prepare(
        `INSERT INTO agent_messages (id, thread_id, role, text, response_json)
         VALUES (?, ?, 'agent', ?, NULL)`
      )
      .run(nanoid(), row.thread_id, text);
    this.db.prepare("UPDATE agent_threads SET updated_at = datetime('now') WHERE id = ?").run(row.thread_id);
  }

  private hasWorkflowMessage(threadId: string, text: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM agent_messages WHERE thread_id = ? AND role = 'agent' AND text = ? LIMIT 1")
      .get(threadId, text) as { 1: number } | undefined;
    return row != null;
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

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return stringArrayValue(parsed);
  } catch {
    return [];
  }
}
