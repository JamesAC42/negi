import { z } from "zod";
import { audioFileSchema, jobStatusSchema, libraryRootSchema } from "./domain.js";
import { operationBatchSchema } from "./operations.js";

export const healthResponseSchema = z.object({
  status: z.enum(["ok"]),
  app: z.literal("music-os-backend"),
  database: z.object({
    connected: z.boolean(),
    path: z.string()
  }),
  playback: z.object({
    mpvPath: z.string()
  }),
  checkedAt: z.string()
});

export const addLibraryRootRequestSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).optional(),
  watchEnabled: z.boolean().default(false)
});

export const libraryRootResponseSchema = z.object({
  root: libraryRootSchema
});

export const libraryRootsResponseSchema = z.object({
  roots: z.array(libraryRootSchema)
});

export const searchLibraryRequestSchema = z.object({
  query: z.string().default(""),
  filters: z.record(z.unknown()).default({})
});

export const scanLibraryRootRequestSchema = z.object({
  rootId: z.string().min(1)
});

export const updateLibraryRootWatchRequestSchema = z.object({
  rootId: z.string().min(1),
  watchEnabled: z.boolean()
});

export const libraryScanResultSchema = z.object({
  rootId: z.string().min(1),
  scanned: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  missingMarked: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.object({ path: z.string(), message: z.string() }))
});

export const watchedLibraryScanResultSchema = z.object({
  rootsScanned: z.number().int().nonnegative(),
  results: z.array(libraryScanResultSchema),
  totals: z.object({
    scanned: z.number().int().nonnegative(),
    inserted: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    missingMarked: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative()
  })
});

export const libraryFilesResponseSchema = z.object({
  files: z.array(audioFileSchema.extend({ displayTags: z.record(z.string()) })),
  total: z.number().int().nonnegative()
});

export const duplicateCandidateSchema = z.object({
  fileId: z.string().min(1),
  path: z.string().min(1),
  filename: z.string().min(1),
  title: z.string().nullable(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  reason: z.string().min(1)
});

export const duplicateGroupSchema = z.object({
  key: z.string().min(1),
  type: z.literal("sha256"),
  count: z.number().int().min(2),
  files: z.array(audioFileSchema.extend({ displayTags: z.record(z.string()) })).min(2)
});

export const duplicateGroupsResponseSchema = z.object({
  groups: z.array(duplicateGroupSchema),
  totalGroups: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative()
});

export const metadataCandidateSchema = z.object({
  source: z.enum(["embedded", "filename", "musicbrainz", "manual"]),
  externalId: z.string().nullable(),
  title: z.string().nullable(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  year: z.number().int().nullable(),
  score: z.number().min(0).max(1),
  reason: z.string().min(1),
  externalUrl: z.string().nullable()
});

export const metadataDiagnosticsTagSchema = z.object({
  key: z.string().min(1),
  value: z.string()
});

export const metadataDiagnosticsNativeTagSchema = metadataDiagnosticsTagSchema.extend({
  source: z.string().min(1)
});

export const metadataDiagnosticsResponseSchema = z.object({
  source: z.enum(["library_file", "import_item"]),
  fileId: z.string().nullable(),
  importItemId: z.string().nullable(),
  path: z.string().min(1),
  parserStatus: z.enum(["ok", "error"]),
  error: z.string().nullable(),
  format: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  common: z.array(metadataDiagnosticsTagSchema),
  native: z.array(metadataDiagnosticsNativeTagSchema),
  indexedDisplayTags: z.record(z.string()),
  importContext: z
    .object({
      detectedArtist: z.string().nullable(),
      detectedAlbum: z.string().nullable(),
      detectedTitle: z.string().nullable(),
      detectedYear: z.number().int().nullable(),
      selectedCandidate: metadataCandidateSchema.nullable(),
      metadataCandidates: z.array(metadataCandidateSchema),
      warnings: z.array(z.string())
    })
    .nullable()
});

export const playbackStateSchema = z.object({
  status: z.enum(["stopped", "playing", "paused", "error"]),
  currentFileId: z.string().nullable(),
  currentPath: z.string().nullable(),
  currentDisplayName: z.string().nullable(),
  positionMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative().nullable(),
  queue: z.array(z.string()),
  queueIndex: z.number().int().nonnegative().nullable(),
  volumePercent: z.number().min(0).max(100).default(100),
  error: z.string().nullable()
});

export const playFileRequestSchema = z.object({
  fileId: z.string().min(1)
});

export const playQueueRequestSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1),
  startIndex: z.number().int().nonnegative().default(0)
});

export const importItemSchema = z.object({
  id: z.string().min(1),
  importId: z.string().min(1),
  fileId: z.string().nullable(),
  stagingPath: z.string().min(1),
  status: z.string().min(1),
  detectedArtist: z.string().nullable(),
  detectedAlbum: z.string().nullable(),
  detectedTitle: z.string().nullable(),
  detectedYear: z.number().int().nullable(),
  proposedDestination: z.string().nullable(),
  confidenceScore: z.number().nullable(),
  qualityScore: z.number().nullable(),
  warnings: z.array(z.string()),
  metadataCandidates: z.array(metadataCandidateSchema),
  selectedCandidate: metadataCandidateSchema.nullable(),
  duplicateCandidates: z.array(duplicateCandidateSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const importBatchSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  status: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  items: z.array(importItemSchema)
});

export const createImportFromPathsRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  libraryRootId: z.string().min(1).optional()
});

export const approveImportItemRequestSchema = z.object({
  importItemId: z.string().min(1),
  libraryRootId: z.string().min(1)
});

export const rejectImportItemRequestSchema = z.object({
  importItemId: z.string().min(1)
});

export const updateImportItemMetadataRequestSchema = z.object({
  importItemId: z.string().min(1),
  metadata: z.object({
    artist: z.string().nullable().optional(),
    album: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    year: z.union([z.number().int(), z.string(), z.null()]).optional()
  })
});

export const importsInboxResponseSchema = z.object({
  imports: z.array(importBatchSchema)
});

export const jobEventSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  timestamp: z.string(),
  level: z.string().min(1),
  message: z.string().min(1),
  data: z.unknown().nullable()
});

export const jobSummarySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: jobStatusSchema,
  progress: z.number().min(0).max(1),
  payload: z.unknown(),
  result: z.unknown().nullable(),
  error: z.unknown().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelRequested: z.boolean()
});

export const jobsResponseSchema = z.object({
  jobs: z.array(jobSummarySchema)
});

export const jobResponseSchema = z.object({
  job: jobSummarySchema,
  events: z.array(jobEventSchema)
});

export const importBatchResponseSchema = z.object({
  import: importBatchSchema
});

export const importItemResponseSchema = z.object({
  item: importItemSchema
});

export const operationBatchesResponseSchema = z.object({
  batches: z.array(operationBatchSchema)
});

export const operationBatchResponseSchema = z.object({
  batch: operationBatchSchema
});

export const createImportApprovalBatchRequestSchema = z.object({
  importItemId: z.string().min(1),
  libraryRootId: z.string().min(1)
});

export const createPlaylistBatchRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  fileIds: z.array(z.string().min(1)).optional()
});

export const createUpdatePlaylistBatchRequestSchema = z.object({
  playlistId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional()
});

export const createAddTracksToPlaylistBatchRequestSchema = z.object({
  playlistId: z.string().min(1),
  fileIds: z.array(z.string().min(1)).min(1)
});

export const createRemoveTracksFromPlaylistBatchRequestSchema = z.object({
  playlistId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).min(1)
});

export const createAssociateFileWithTrackBatchRequestSchema = z.object({
  fileId: z.string().min(1),
  trackId: z.string().min(1)
});

export const createAssociateTrackWithAlbumBatchRequestSchema = z.object({
  trackId: z.string().min(1),
  albumId: z.string().min(1)
});

export const createMergeDuplicateTracksBatchRequestSchema = z.object({
  canonicalTrackId: z.string().min(1),
  duplicateTrackId: z.string().min(1)
});

export const playlistTrackSchema = z.object({
  id: z.string().min(1),
  position: z.number().int().nonnegative(),
  file: audioFileSchema.extend({ displayTags: z.record(z.string()) }),
  track: z.object({
    id: z.string().min(1),
    title: z.string().min(1)
  })
});

export const playlistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  type: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(playlistTrackSchema)
});

export const playlistsResponseSchema = z.object({
  playlists: z.array(playlistSchema)
});

export const playlistResponseSchema = z.object({
  playlist: playlistSchema
});

export const playPlaylistRequestSchema = z.object({
  playlistId: z.string().min(1)
});

export const albumGroupSchema = z.object({
  id: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().min(1),
  year: z.string().nullable(),
  fileCount: z.number().int().positive(),
  durationMs: z.number().int().nonnegative().nullable(),
  formats: z.array(z.string().min(1)),
  files: z.array(audioFileSchema.extend({ displayTags: z.record(z.string()) })).min(1)
});

export const albumGroupsResponseSchema = z.object({
  albums: z.array(albumGroupSchema),
  total: z.number().int().nonnegative()
});

export const playAlbumRequestSchema = z.object({
  albumId: z.string().min(1)
});

export const discoveryHealthResponseSchema = z.object({
  configured: z.boolean(),
  reachable: z.boolean(),
  downloadsConfigured: z.boolean(),
  url: z.string().nullable(),
  message: z.string().nullable()
});

export const discoverySourceSchema = z.enum(["slskd"]);

export const discoverySearchRequestSchema = z.object({
  query: z.string().min(1),
  source: discoverySourceSchema.default("slskd"),
  responseLimit: z.number().int().min(1).max(500).optional()
});

export const discoveryResultSchema = z.object({
  id: z.string().min(1),
  source: discoverySourceSchema,
  username: z.string().nullable(),
  filename: z.string().min(1),
  path: z.string().min(1),
  folder: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  extension: z.string().nullable(),
  bitrate: z.number().int().nonnegative().nullable(),
  sampleRate: z.number().int().nonnegative().nullable(),
  lengthSeconds: z.number().nonnegative().nullable(),
  isLocked: z.boolean(),
  hasFreeUploadSlot: z.boolean().nullable().optional(),
  uploadSpeedBytesPerSecond: z.number().nonnegative().nullable().optional(),
  queueLength: z.number().int().nonnegative().nullable().optional(),
  raw: z.record(z.unknown())
});

export const discoverySearchResponseSchema = z.object({
  query: z.string().min(1),
  results: z.array(discoveryResultSchema),
  total: z.number().int().nonnegative()
});

export const savedDiscoveryCandidateSchema = z.object({
  id: z.string().min(1),
  candidateKey: z.string().min(1),
  source: discoverySourceSchema,
  query: z.string(),
  releaseArtist: z.string().nullable(),
  releaseTitle: z.string().min(1),
  username: z.string().nullable(),
  folder: z.string().nullable(),
  resultCount: z.number().int().nonnegative(),
  availableCount: z.number().int().nonnegative(),
  totalSizeBytes: z.number().int().nonnegative().nullable(),
  primaryFormat: z.string().nullable(),
  qualityLabel: z.string().min(1),
  matchLabel: z.string().min(1),
  results: z.array(discoveryResultSchema).min(1),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const saveDiscoveryCandidateRequestSchema = savedDiscoveryCandidateSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    query: z.string().default("")
  });

export const savedDiscoveryCandidatesResponseSchema = z.object({
  candidates: z.array(savedDiscoveryCandidateSchema)
});

export const savedDiscoveryCandidateResponseSchema = z.object({
  candidate: savedDiscoveryCandidateSchema
});

export const discoveryDownloadRequestSchema = z.object({
  results: z.array(discoveryResultSchema).min(1),
  libraryRootId: z.string().min(1).optional()
});

export const createQueueDownloadBatchRequestSchema = discoveryDownloadRequestSchema.extend({
  query: z.string().min(1)
});

export const discoveryDownloadResponseSchema = z.object({
  job: z.lazy(() => discoveryDownloadJobSchema),
  message: z.string()
});

export const discoveryDownloadJobSchema = z.object({
  id: z.string().min(1),
  status: jobStatusSchema,
  progress: z.number().min(0).max(1),
  selectedCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  imported: importBatchSchema.nullable(),
  message: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable()
});

export const discoveryDownloadJobsResponseSchema = z.object({
  jobs: z.array(discoveryDownloadJobSchema)
});

export const discoveryDownloadJobResponseSchema = z.object({
  job: discoveryDownloadJobSchema
});

export const discoveryDownloadJobIdRequestSchema = z.object({
  jobId: z.string().min(1)
});

export const agentMessageRequestSchema = z.object({
  message: z.string().min(1),
  threadId: z.string().min(1).optional()
});

export const agentSearchResultSchema = z.object({
  fileId: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  year: z.string().nullable()
});

export const agentDiscoveryResultSchema = z.object({
  discoveryId: z.string().min(1),
  username: z.string().nullable(),
  filename: z.string().min(1),
  folder: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  extension: z.string().nullable(),
  isLocked: z.boolean(),
  ownedMatchCount: z.number().int().nonnegative()
});

export const agentDiscoveryGroupSchema = z.object({
  releaseArtist: z.string().nullable(),
  releaseTitle: z.string().min(1),
  sourceCount: z.number().int().positive(),
  fileCount: z.number().int().positive(),
  unlockedCount: z.number().int().nonnegative(),
  bestFormat: z.string().nullable(),
  ownedMatchCount: z.number().int().nonnegative(),
  results: z.array(agentDiscoveryResultSchema)
});

export const agentParsedListItemSchema = z.object({
  rank: z.number().int().positive().nullable(),
  artist: z.string().nullable(),
  title: z.string().min(1),
  year: z.string().nullable(),
  query: z.string().min(1),
  ownedMatchCount: z.number().int().nonnegative()
});

export const savedDiscoveryListSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.literal("pasted_list"),
  originalText: z.string(),
  items: z.array(agentParsedListItemSchema),
  itemCount: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
  ownedCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const saveDiscoveryListRequestSchema = savedDiscoveryListSchema
  .pick({
    name: true,
    originalText: true,
    items: true
  })
  .extend({
    name: z.string().min(1).max(160)
  });

export const savedDiscoveryListsResponseSchema = z.object({
  lists: z.array(savedDiscoveryListSchema)
});

export const savedDiscoveryListResponseSchema = z.object({
  list: savedDiscoveryListSchema
});

export const agentImportResultSchema = z.object({
  importItemId: z.string().min(1),
  importId: z.string().min(1),
  title: z.string().nullable(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  year: z.number().int().nullable(),
  status: z.string().min(1),
  duplicateCount: z.number().int().nonnegative(),
  confidenceScore: z.number().nullable()
});

export const agentMessageResponseSchema = z.object({
  threadId: z.string().min(1).optional(),
  reply: z.string().min(1),
  intent: z.enum([
    "search_library",
    "search_discovery",
    "parse_pasted_list",
    "propose_import",
    "propose_playlist",
    "propose_duplicate_cleanup",
    "playback",
    "unknown"
  ]),
  searchQuery: z.string(),
  results: z.array(agentSearchResultSchema),
  discoveryResults: z.array(agentDiscoveryResultSchema),
  discoveryGroups: z.array(agentDiscoveryGroupSchema).optional(),
  parsedListItems: z.array(agentParsedListItemSchema),
  importResults: z.array(agentImportResultSchema),
  operationBatch: operationBatchSchema.nullable(),
  playback: playbackStateSchema.nullable()
});

export const agentThreadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const agentThreadMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  role: z.enum(["user", "agent"]),
  text: z.string(),
  response: agentMessageResponseSchema.nullable(),
  createdAt: z.string()
});

export const agentThreadResponseSchema = z.object({
  thread: agentThreadSchema,
  messages: z.array(agentThreadMessageSchema)
});

export const agentThreadsResponseSchema = z.object({
  threads: z.array(agentThreadSchema)
});

export const createAgentThreadRequestSchema = z.object({
  title: z.string().min(1).optional()
});

export const createMoveFileBatchRequestSchema = z.object({
  fileId: z.string().min(1),
  destinationPath: z.string().min(1)
});

export const createRenameFileBatchRequestSchema = z.object({
  fileId: z.string().min(1),
  filename: z.string().min(1)
});

export const createBulkRenameFilesBatchRequestSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1),
  pattern: z.string().min(1)
});

export const createSetRatingBatchRequestSchema = z.object({
  fileId: z.string().min(1),
  rating: z.number().int().min(0).max(5).nullable()
});

export const createSetFavoriteStatusBatchRequestSchema = z.object({
  fileId: z.string().min(1),
  liked: z.boolean().nullable().optional(),
  disliked: z.boolean().nullable().optional()
});

export const editableFileMetadataSchema = z.object({
  title: z.string().nullable().optional(),
  artist: z.string().nullable().optional(),
  albumartist: z.string().nullable().optional(),
  album: z.string().nullable().optional(),
  year: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  genre: z.string().nullable().optional(),
  tracknumber: z.string().nullable().optional(),
  discnumber: z.string().nullable().optional()
});

export const metadataGapFieldSchema = z.enum(["title", "artist", "album", "year"]);

export const metadataGapSchema = z.object({
  file: audioFileSchema.extend({ displayTags: z.record(z.string()) }),
  missingFields: z.array(metadataGapFieldSchema).min(1),
  suggestedMetadata: editableFileMetadataSchema,
  completenessScore: z.number().min(0).max(1)
});

export const metadataGapsResponseSchema = z.object({
  items: z.array(metadataGapSchema),
  total: z.number().int().nonnegative()
});

export const qualityUpgradeCandidateSchema = z.object({
  file: audioFileSchema.extend({ displayTags: z.record(z.string()) }),
  qualityScore: z.number().min(0),
  qualityLabel: z.string().min(1),
  reasons: z.array(z.string().min(1))
});

export const qualityUpgradeSuggestionSchema = z.object({
  key: z.string().min(1),
  artist: z.string().min(1),
  title: z.string().min(1),
  preferred: qualityUpgradeCandidateSchema,
  candidates: z.array(qualityUpgradeCandidateSchema).min(1)
});

export const qualityUpgradeSuggestionsResponseSchema = z.object({
  suggestions: z.array(qualityUpgradeSuggestionSchema),
  total: z.number().int().nonnegative()
});

export const incompleteAlbumSchema = z.object({
  key: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().min(1),
  year: z.string().nullable(),
  expectedTracks: z.number().int().positive(),
  presentTracks: z.number().int().nonnegative(),
  missingTrackNumbers: z.array(z.number().int().positive()),
  files: z.array(audioFileSchema.extend({ displayTags: z.record(z.string()) })).min(1)
});

export const incompleteAlbumsResponseSchema = z.object({
  albums: z.array(incompleteAlbumSchema),
  total: z.number().int().nonnegative()
});

export const albumMergeVariantSchema = z.object({
  album: z.string().min(1),
  fileCount: z.number().int().positive(),
  files: z.array(audioFileSchema.extend({ displayTags: z.record(z.string()) })).min(1)
});

export const albumMergeSuggestionSchema = z.object({
  key: z.string().min(1),
  artist: z.string().min(1),
  canonicalAlbum: z.string().min(1),
  variants: z.array(albumMergeVariantSchema).min(2)
});

export const albumMergeSuggestionsResponseSchema = z.object({
  suggestions: z.array(albumMergeSuggestionSchema),
  total: z.number().int().nonnegative()
});

export const alternateEditionSchema = z.object({
  edition: z.string().min(1),
  album: z.string().min(1),
  fileCount: z.number().int().positive(),
  files: z.array(audioFileSchema.extend({ displayTags: z.record(z.string()) })).min(1)
});

export const alternateEditionGroupSchema = z.object({
  key: z.string().min(1),
  artist: z.string().min(1),
  baseAlbum: z.string().min(1),
  editions: z.array(alternateEditionSchema).min(2)
});

export const alternateEditionGroupsResponseSchema = z.object({
  groups: z.array(alternateEditionGroupSchema),
  total: z.number().int().nonnegative()
});

export const tasteProfileSchema = z.object({
  favoriteArtists: z.array(z.string()).default([]),
  favoriteAlbums: z.array(z.string()).default([]),
  favoriteTracks: z.array(z.string()).default([]),
  preferredGenres: z.array(z.string()).default([]),
  preferredEras: z.array(z.string()).default([]),
  preferredCountries: z.array(z.string()).default([]),
  preferredLabels: z.array(z.string()).default([]),
  blockedArtists: z.array(z.string()).default([]),
  blockedGenres: z.array(z.string()).default([]),
  overplayedTracks: z.array(z.string()).default([]),
  preferredFormats: z.array(z.string()).default([]),
  qualityPreferences: z.object({
    preferLossless: z.boolean().default(true),
    allowMp3IfRare: z.boolean().default(true),
    minimumBitrateKbps: z.number().int().min(0).max(2000).nullable().default(null)
  }).default({}),
  taggingPreferences: z.string().default(""),
  folderOrganizationPreferences: z.string().default(""),
  playlistStylePreferences: z.string().default(""),
  notes: z.string().default("")
});

export const tasteProfileEntrySchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  source: z.string().min(1),
  confidence: z.number().min(0).max(1),
  updatedAt: z.string()
});

export const tasteProfileResponseSchema = z.object({
  profile: tasteProfileSchema,
  entries: z.array(tasteProfileEntrySchema),
  updatedAt: z.string().nullable()
});

export const updateTasteProfileRequestSchema = z.object({
  profile: tasteProfileSchema,
  source: z.string().min(1).optional()
});

export const createAlbumMergeBatchRequestSchema = z.object({
  canonicalAlbum: z.string().min(1),
  fileIds: z.array(z.string().min(1)).min(1)
});

export const createSetFileMetadataBatchRequestSchema = z.object({
  fileId: z.string().min(1),
  metadata: editableFileMetadataSchema
});

export const createRemoveFileBatchRequestSchema = z.object({
  fileId: z.string().min(1)
});

export const createDuplicateCleanupBatchRequestSchema = z.object({
  keepFileId: z.string().min(1),
  removeFileIds: z.array(z.string().min(1)).min(1)
});

export const createMarkDuplicateBatchRequestSchema = z.object({
  canonicalFileId: z.string().min(1),
  duplicateFileId: z.string().min(1),
  reason: z.string().nullable().optional()
});

export const createSetInternalTagsBatchRequestSchema = z.object({
  trackId: z.string().min(1),
  tags: z.array(z.string().min(1))
});

export const createBulkSetInternalTagsBatchRequestSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)).min(1)
});

export const operationBatchIdRequestSchema = z.object({
  batchId: z.string().min(1)
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type AddLibraryRootRequest = z.infer<typeof addLibraryRootRequestSchema>;
export type LibraryRootResponse = z.infer<typeof libraryRootResponseSchema>;
export type LibraryRootsResponse = z.infer<typeof libraryRootsResponseSchema>;
export type SearchLibraryRequest = z.infer<typeof searchLibraryRequestSchema>;
export type ScanLibraryRootRequest = z.infer<typeof scanLibraryRootRequestSchema>;
export type LibraryScanResult = z.infer<typeof libraryScanResultSchema>;
export type WatchedLibraryScanResult = z.infer<typeof watchedLibraryScanResultSchema>;
export type LibraryFilesResponse = z.infer<typeof libraryFilesResponseSchema>;
export type UpdateLibraryRootWatchRequest = z.infer<typeof updateLibraryRootWatchRequestSchema>;
export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;
export type DuplicateGroup = z.infer<typeof duplicateGroupSchema>;
export type DuplicateGroupsResponse = z.infer<typeof duplicateGroupsResponseSchema>;
export type MetadataCandidate = z.infer<typeof metadataCandidateSchema>;
export type MetadataDiagnosticsResponse = z.infer<typeof metadataDiagnosticsResponseSchema>;
export type PlaybackStateResponse = z.infer<typeof playbackStateSchema>;
export type PlayFileRequest = z.infer<typeof playFileRequestSchema>;
export type PlayQueueRequest = z.infer<typeof playQueueRequestSchema>;
export type ImportItem = z.infer<typeof importItemSchema>;
export type ImportBatch = z.infer<typeof importBatchSchema>;
export type CreateImportFromPathsRequest = z.infer<typeof createImportFromPathsRequestSchema>;
export type ApproveImportItemRequest = z.infer<typeof approveImportItemRequestSchema>;
export type RejectImportItemRequest = z.infer<typeof rejectImportItemRequestSchema>;
export type UpdateImportItemMetadataRequest = z.infer<typeof updateImportItemMetadataRequestSchema>;
export type ImportsInboxResponse = z.infer<typeof importsInboxResponseSchema>;
export type JobEvent = z.infer<typeof jobEventSchema>;
export type JobSummary = z.infer<typeof jobSummarySchema>;
export type JobsResponse = z.infer<typeof jobsResponseSchema>;
export type JobResponse = z.infer<typeof jobResponseSchema>;
export type ImportBatchResponse = z.infer<typeof importBatchResponseSchema>;
export type ImportItemResponse = z.infer<typeof importItemResponseSchema>;
export type OperationBatchesResponse = z.infer<typeof operationBatchesResponseSchema>;
export type OperationBatchResponse = z.infer<typeof operationBatchResponseSchema>;
export type CreateImportApprovalBatchRequest = z.infer<typeof createImportApprovalBatchRequestSchema>;
export type CreatePlaylistBatchRequest = z.infer<typeof createPlaylistBatchRequestSchema>;
export type CreateUpdatePlaylistBatchRequest = z.infer<typeof createUpdatePlaylistBatchRequestSchema>;
export type CreateAddTracksToPlaylistBatchRequest = z.infer<typeof createAddTracksToPlaylistBatchRequestSchema>;
export type CreateRemoveTracksFromPlaylistBatchRequest = z.infer<typeof createRemoveTracksFromPlaylistBatchRequestSchema>;
export type CreateAssociateFileWithTrackBatchRequest = z.infer<typeof createAssociateFileWithTrackBatchRequestSchema>;
export type CreateAssociateTrackWithAlbumBatchRequest = z.infer<typeof createAssociateTrackWithAlbumBatchRequestSchema>;
export type CreateMergeDuplicateTracksBatchRequest = z.infer<typeof createMergeDuplicateTracksBatchRequestSchema>;
export type Playlist = z.infer<typeof playlistSchema>;
export type PlaylistsResponse = z.infer<typeof playlistsResponseSchema>;
export type PlaylistResponse = z.infer<typeof playlistResponseSchema>;
export type AlbumGroup = z.infer<typeof albumGroupSchema>;
export type AlbumGroupsResponse = z.infer<typeof albumGroupsResponseSchema>;
export type PlayPlaylistRequest = z.infer<typeof playPlaylistRequestSchema>;
export type DiscoveryHealthResponse = z.infer<typeof discoveryHealthResponseSchema>;
export type DiscoverySource = z.infer<typeof discoverySourceSchema>;
export type DiscoverySearchRequest = z.infer<typeof discoverySearchRequestSchema>;
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>;
export type DiscoverySearchResponse = z.infer<typeof discoverySearchResponseSchema>;
export type SavedDiscoveryCandidate = z.infer<typeof savedDiscoveryCandidateSchema>;
export type SaveDiscoveryCandidateRequest = z.infer<typeof saveDiscoveryCandidateRequestSchema>;
export type SavedDiscoveryCandidatesResponse = z.infer<typeof savedDiscoveryCandidatesResponseSchema>;
export type SavedDiscoveryCandidateResponse = z.infer<typeof savedDiscoveryCandidateResponseSchema>;
export type SavedDiscoveryList = z.infer<typeof savedDiscoveryListSchema>;
export type SaveDiscoveryListRequest = z.infer<typeof saveDiscoveryListRequestSchema>;
export type SavedDiscoveryListsResponse = z.infer<typeof savedDiscoveryListsResponseSchema>;
export type SavedDiscoveryListResponse = z.infer<typeof savedDiscoveryListResponseSchema>;
export type DiscoveryDownloadRequest = z.infer<typeof discoveryDownloadRequestSchema>;
export type CreateQueueDownloadBatchRequest = z.infer<typeof createQueueDownloadBatchRequestSchema>;
export type DiscoveryDownloadResponse = z.infer<typeof discoveryDownloadResponseSchema>;
export type DiscoveryDownloadJob = z.infer<typeof discoveryDownloadJobSchema>;
export type DiscoveryDownloadJobsResponse = z.infer<typeof discoveryDownloadJobsResponseSchema>;
export type DiscoveryDownloadJobResponse = z.infer<typeof discoveryDownloadJobResponseSchema>;
export type DiscoveryDownloadJobIdRequest = z.infer<typeof discoveryDownloadJobIdRequestSchema>;
export type AgentMessageRequest = z.infer<typeof agentMessageRequestSchema>;
export type AgentSearchResult = z.infer<typeof agentSearchResultSchema>;
export type AgentDiscoveryResult = z.infer<typeof agentDiscoveryResultSchema>;
export type AgentDiscoveryGroup = z.infer<typeof agentDiscoveryGroupSchema>;
export type AgentParsedListItem = z.infer<typeof agentParsedListItemSchema>;
export type AgentImportResult = z.infer<typeof agentImportResultSchema>;
export type AgentMessageResponse = z.infer<typeof agentMessageResponseSchema>;
export type AgentThread = z.infer<typeof agentThreadSchema>;
export type AgentThreadMessage = z.infer<typeof agentThreadMessageSchema>;
export type AgentThreadResponse = z.infer<typeof agentThreadResponseSchema>;
export type AgentThreadsResponse = z.infer<typeof agentThreadsResponseSchema>;
export type CreateAgentThreadRequest = z.infer<typeof createAgentThreadRequestSchema>;
export type CreateMoveFileBatchRequest = z.infer<typeof createMoveFileBatchRequestSchema>;
export type CreateRenameFileBatchRequest = z.infer<typeof createRenameFileBatchRequestSchema>;
export type CreateBulkRenameFilesBatchRequest = z.infer<typeof createBulkRenameFilesBatchRequestSchema>;
export type CreateSetRatingBatchRequest = z.infer<typeof createSetRatingBatchRequestSchema>;
export type CreateSetFavoriteStatusBatchRequest = z.infer<typeof createSetFavoriteStatusBatchRequestSchema>;
export type CreateMarkDuplicateBatchRequest = z.infer<typeof createMarkDuplicateBatchRequestSchema>;
export type EditableFileMetadata = z.infer<typeof editableFileMetadataSchema>;
export type MetadataGap = z.infer<typeof metadataGapSchema>;
export type MetadataGapsResponse = z.infer<typeof metadataGapsResponseSchema>;
export type QualityUpgradeCandidate = z.infer<typeof qualityUpgradeCandidateSchema>;
export type QualityUpgradeSuggestion = z.infer<typeof qualityUpgradeSuggestionSchema>;
export type QualityUpgradeSuggestionsResponse = z.infer<typeof qualityUpgradeSuggestionsResponseSchema>;
export type IncompleteAlbum = z.infer<typeof incompleteAlbumSchema>;
export type IncompleteAlbumsResponse = z.infer<typeof incompleteAlbumsResponseSchema>;
export type AlbumMergeVariant = z.infer<typeof albumMergeVariantSchema>;
export type AlbumMergeSuggestion = z.infer<typeof albumMergeSuggestionSchema>;
export type AlbumMergeSuggestionsResponse = z.infer<typeof albumMergeSuggestionsResponseSchema>;
export type AlternateEdition = z.infer<typeof alternateEditionSchema>;
export type AlternateEditionGroup = z.infer<typeof alternateEditionGroupSchema>;
export type AlternateEditionGroupsResponse = z.infer<typeof alternateEditionGroupsResponseSchema>;
export type TasteProfile = z.infer<typeof tasteProfileSchema>;
export type TasteProfileEntry = z.infer<typeof tasteProfileEntrySchema>;
export type TasteProfileResponse = z.infer<typeof tasteProfileResponseSchema>;
export type UpdateTasteProfileRequest = z.infer<typeof updateTasteProfileRequestSchema>;
export type CreateAlbumMergeBatchRequest = z.infer<typeof createAlbumMergeBatchRequestSchema>;
export type CreateSetFileMetadataBatchRequest = z.infer<typeof createSetFileMetadataBatchRequestSchema>;
export type CreateRemoveFileBatchRequest = z.infer<typeof createRemoveFileBatchRequestSchema>;
export type CreateDuplicateCleanupBatchRequest = z.infer<typeof createDuplicateCleanupBatchRequestSchema>;
export type CreateSetInternalTagsBatchRequest = z.infer<typeof createSetInternalTagsBatchRequestSchema>;
export type CreateBulkSetInternalTagsBatchRequest = z.infer<typeof createBulkSetInternalTagsBatchRequestSchema>;
export type OperationBatchIdRequest = z.infer<typeof operationBatchIdRequestSchema>;
