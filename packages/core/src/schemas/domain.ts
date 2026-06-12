import { z } from "zod";

export const entityIdSchema = z.string().min(1);

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
]);

export const importItemStatusSchema = z.enum([
  "new",
  "scanning",
  "fingerprinting",
  "metadata_lookup",
  "match_proposed",
  "duplicate_detected",
  "needs_review",
  "ready_to_import",
  "rejected",
  "imported",
  "failed"
]);

export const libraryRootSchema = z.object({
  id: entityIdSchema,
  path: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  watchEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastScanAt: z.string().nullable()
});

export const audioFileSchema = z.object({
  id: entityIdSchema,
  libraryRootId: entityIdSchema.nullable(),
  path: z.string().min(1),
  normalizedPath: z.string().min(1),
  filename: z.string().min(1),
  extension: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  mtime: z.string(),
  ctime: z.string().nullable(),
  sha256: z.string().nullable(),
  quickHash: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  codec: z.string().nullable(),
  bitrate: z.number().int().nonnegative().nullable(),
  sampleRate: z.number().int().nonnegative().nullable(),
  channels: z.number().int().nonnegative().nullable(),
  scanStatus: z.string(),
  staged: z.boolean(),
  missing: z.boolean(),
  playCount: z.number().int().nonnegative().default(0),
  skipCount: z.number().int().nonnegative().default(0),
  lastPlayedAt: z.string().nullable().default(null),
  lastSkippedAt: z.string().nullable().default(null),
  rating: z.number().int().min(0).max(5).nullable().default(null),
  liked: z.boolean().nullable().default(null),
  disliked: z.boolean().nullable().default(null)
});

export type LibraryRoot = z.infer<typeof libraryRootSchema>;
export type AudioFile = z.infer<typeof audioFileSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type ImportItemStatus = z.infer<typeof importItemStatusSchema>;
