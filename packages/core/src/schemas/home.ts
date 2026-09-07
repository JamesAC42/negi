import { z } from "zod";

export const homeListeningResponseSchema = z.object({
  since: z.string().nullable(),
  until: z.string(),
  files: z.array(z.object({ fileId: z.string(), plays: z.number(), listenedMs: z.number(), skips: z.number(), firstPlayedAt: z.string().nullable() })),
  days: z.array(z.object({ day: z.string(), plays: z.number(), listenedMs: z.number() })),
  hours: z.array(z.object({ hour: z.number(), plays: z.number() })),
  recent: z.array(z.object({ id: z.string(), fileId: z.string(), playedAt: z.string() }))
});
export type HomeListeningResponse = z.infer<typeof homeListeningResponseSchema>;