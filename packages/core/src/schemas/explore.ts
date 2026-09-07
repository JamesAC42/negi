import { z } from "zod";
const label = z.string().trim().min(1).max(500);
export type CatalogueProvider = "apple" | "musicbrainz";
export const catalogueIdSchema = z.union([
  z.string().uuid(),
  z.string().regex(/^apple:[1-9]\d{0,15}$/),
]);
export const acquireAlbumRequestSchema = z.object({
  artist: label,
  album: label,
  albumId: z.string().optional(),
  artistId: catalogueIdSchema.optional(),
  releaseGroupId: catalogueIdSchema.optional(),
  libraryRootId: z.string().optional(),
});
export type AcquireAlbumRequest = z.infer<typeof acquireAlbumRequestSchema>;
export interface CatalogueArtist {
  /** Name-only recommendation; resolve a catalogue match before using catalogue endpoints. */
  requiresArtistMatch?: boolean;
  provider?: CatalogueProvider;
  artworkUrl?: string | null;
  sourceUrl?: string | null;
  id: string;
  libraryAlbumId?: string | null;
  name: string;
  description: string;
  country: string | null;
  type: string | null;
  begin: string | null;
  end: string | null;
  tags: string[];
}
/** Sourced artist details. Null fields mean the provider has no verified value. */
export interface CatalogueArtistProfile {
  pending?: boolean;
  artist: CatalogueArtist;
  biography: string | null;
  biographySourceUrl: string | null;
  imageUrl: string | null;
  imageSourceUrl: string | null;
  area: string | null;
  beginArea: string | null;
  ended: boolean | null;
  links: { label: string; url: string }[];
  metadataNote: string | null;
}
export interface CatalogueTrack {
  title: string;
  disc: number;
  number: number;
  durationMs: number | null;
  owned?: boolean;
}
export interface CatalogueAlbum {
  rating?: number | null;
  votes?: number;
  provider?: CatalogueProvider;
  artworkUrl?: string | null;
  sourceUrl?: string | null;
  id: string;
  title: string;
  date: string | null;
  type: string;
  secondaryTypes: string[];
  ownedTracks: number;
  libraryStatus: "missing" | "partial" | "complete" | "unverified";
  libraryAlbumId: string | null;
}
export const catalogueSectionSchema = z.enum(["albums", "eps-singles", "live-compilations", "other"]);
export type CatalogueSection = z.infer<typeof catalogueSectionSchema>;
export function catalogueAlbumSection(album: Pick<CatalogueAlbum, "type" | "secondaryTypes">): CatalogueSection {
  if (album.secondaryTypes.some((type) => /live|compilation/i.test(type))) return "live-compilations";
  if (album.type === "Album") return "albums";
  if (["EP", "Single"].includes(album.type)) return "eps-singles";
  return "other";
}
export type CatalogueSort = "newest" | "oldest" | "title";
export interface CataloguePage {
  provider?: CatalogueProvider;
  truncated?: boolean;
  artist: CatalogueArtist;
  albums: CatalogueAlbum[];
  total: number;
  nextOffset: number | null;
}
export interface CatalogueRelease {
  /** False when the provider returned only a partial or unverified track list. */
  trackListingComplete?: boolean;
  expectedTrackCount?: number | null;
  provider?: CatalogueProvider;
  artworkUrl?: string | null;
  sourceUrl?: string | null;
  id: string;
  title: string;
  artistIds: string[];
  date: string | null;
  releaseId: string;
  tracks: CatalogueTrack[];
  rating: number | null;
  votes: number;
  ownedTracks: number;
  libraryStatus: CatalogueAlbum["libraryStatus"];
}
export interface AcquisitionJob {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  artist: string;
  album: string;
  albumId?: string;
  releaseGroupId?: string;
  message: string;
  error: string | null;
  downloadJobId?: string;
  createdAt: string;
}
export interface VideoResult {
  id: string;
  url: string;
  title: string;
  channel: string;
  duration: number | null;
  thumbnail: string | null;
  viewCount?: number | null;
  uploadDate?: string | null;
  approximateDate?: boolean;
  liveStatus?: string | null;
}
export const youtubeDownloadRequestSchema = z.object({
  url: z.string().url().max(2048),
  libraryRootId: z.string().optional(),
});
export const youtubeReviewRequestSchema = z.object({
  jobId: label,
  artist: label,
  title: label,
  album: label,
  year: z
    .string()
    .trim()
    .max(4)
    .regex(/^(?:[12]\d{3})?$/),
  libraryRootId: label,
});
export type YoutubeReviewRequest = z.infer<typeof youtubeReviewRequestSchema>;
export interface VideoJob {
  progress?: number;
  id: string;
  status:
    | "queued"
    | "running"
    | "review"
    | "succeeded"
    | "failed"
    | "cancelled";
  message: string;
  error: string | null;
  url: string;
  importId?: string;
  itemId?: string;
  artist?: string;
  title?: string;
  album?: string;
  year?: string;
  codec?: string;
  createdAt: string;
}

export type SimilarArtistSource = "musicmap" | "listenbrainz" | "musicbrainz";
export interface SimilarArtist {
  artist: CatalogueArtist;
  reasons: string[];
  sources: SimilarArtistSource[];
  connection: "listeners" | "shared-tags" | "related";
  /** Relative ordering strength, not a probability or confidence percentage. */
  strength: number;
  sharedTags: string[];
  libraryAlbumCount: number;
  /** Local tags are matched by name; this does not verify catalogue identity. */
  libraryMatch: "name" | "none";
}
export interface SimilarArtistsResponse {
  pending?: boolean;
  artistId: string;
  /** Verified MusicBrainz seed, including cross-provider links; null when unresolved. */
  resolvedArtistId: string | null;
  artists: SimilarArtist[];
  sources: { id: SimilarArtistSource; label: string; url: string; status: "ok" | "empty" | "unavailable" }[];
  note: string | null;
}

export interface AlbumHighlightsResponse {
  artistId: string;
  resolvedArtistId: string | null;
  albums: (CatalogueAlbum & { rating: number; votes: number })[];
  sourceUrl: string | null;
  note: string | null;
  pending?: boolean;
}
