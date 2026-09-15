import { z } from "zod";

export const lyricsLineSchema = z.object({ timeMs: z.number().int().nonnegative(), text: z.string() });
export const lyricsResponseSchema = z.object({
  fileId: z.string(),
  status: z.enum(["synced", "plain", "instrumental", "not_found", "error"]),
  plainLyrics: z.string().nullable(),
  lines: z.array(lyricsLineSchema),
  provider: z.literal("lrclib"),
  cached: z.boolean(),
  fetchedAt: z.string().datetime().nullable(),
  retryAfterMs: z.number().int().nonnegative().optional()
});
export type LyricsLine = z.infer<typeof lyricsLineSchema>;
export type LyricsResponse = z.infer<typeof lyricsResponseSchema>;
