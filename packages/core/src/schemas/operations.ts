import { z } from "zod";

export const operationBatchStatusSchema = z.enum([
  "draft",
  "proposed",
  "approved",
  "applying",
  "applied",
  "partially_applied",
  "failed",
  "reverted",
  "rejected"
]);

export const riskLevelSchema = z.enum(["low", "medium", "high", "dangerous"]);

export const operationTypeSchema = z.enum([
  "create_playlist",
  "update_playlist",
  "add_tracks_to_playlist",
  "remove_tracks_from_playlist",
  "set_internal_tags",
  "set_file_metadata",
  "write_embedded_tags",
  "move_file",
  "rename_file",
  "remove_file_from_library",
  "import_file",
  "associate_file_with_track",
  "associate_track_with_album",
  "merge_duplicate_tracks",
  "mark_duplicate",
  "set_rating",
  "set_favorite_status",
  "queue_download",
  "reject_import_item"
]);

export const operationSchema = z.object({
  id: z.string().min(1),
  batchId: z.string().min(1),
  type: operationTypeSchema,
  status: operationBatchStatusSchema,
  payload: z.unknown(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  error: z.unknown().nullable()
});

export const operationBatchSchema = z.object({
  id: z.string().min(1),
  source: z.enum(["user", "agent", "import", "system"]),
  status: operationBatchStatusSchema,
  summary: z.string().min(1),
  riskLevel: riskLevelSchema,
  agentThreadId: z.string().min(1).nullable(),
  operations: z.array(operationSchema)
});

export type OperationBatchStatus = z.infer<typeof operationBatchStatusSchema>;
export type OperationType = z.infer<typeof operationTypeSchema>;
export type OperationBatch = z.infer<typeof operationBatchSchema>;
export type Operation = z.infer<typeof operationSchema>;
