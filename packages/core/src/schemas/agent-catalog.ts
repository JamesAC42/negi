import { z } from "zod";

export const agentCatalogActionRequestSchema = z.object({ runId: z.string().min(1), choiceId: z.string().min(1) });
export const agentCatalogChoiceSchema = z.object({
  id: z.string(), label: z.string(), description: z.string(),
  action: z.object({
    kind: z.enum(["artists", "releases", "scope", "similar", "review", "queue", "track", "cancel"]),
    capability: z.string(), query: z.string().optional(), artistId: z.string().optional(),
    artist: z.string().optional(), album: z.string().optional(),
    section: z.enum(["albums", "eps-singles", "live-compilations", "other"]).optional(),
    itemId: z.string().optional(), provider: z.enum(["apple", "musicbrainz"]).optional(),
  }),
});
export const agentCatalogItemSchema = z.object({
  id: z.string(), kind: z.enum(["album", "track"]), artist: z.string(), title: z.string(),
  artistId: z.string().optional(), provider: z.enum(["apple", "musicbrainz"]).optional(),
  artworkUrl: z.string().nullable().optional(), date: z.string().nullable().optional(),
  ownedTracks: z.number().optional(), libraryStatus: z.string().optional(),
  libraryAlbumId: z.string().nullable().optional(), discoveryId: z.string().optional(),
  detail: z.string().optional(),
});
export const agentCatalogPlanSchema = z.object({
  capability: z.string(), title: z.string(), summary: z.string(),
  status: z.enum(["clarification", "review", "queued", "complete"]),
  choices: z.array(agentCatalogChoiceSchema), items: z.array(agentCatalogItemSchema),
  notes: z.array(z.string()), jobIds: z.array(z.string()),
});
export type AgentCatalogPlan = z.infer<typeof agentCatalogPlanSchema>;
export type AgentCatalogChoice = z.infer<typeof agentCatalogChoiceSchema>;
export type AgentCatalogItem = z.infer<typeof agentCatalogItemSchema>;
export type AgentCatalogActionRequest = z.infer<typeof agentCatalogActionRequestSchema>;
