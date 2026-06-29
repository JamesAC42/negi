import { createServer } from "node:http";
import {
  addLibraryRootRequestSchema,
  albumGroupsResponseSchema,
  alternateEditionGroupsResponseSchema,
  albumMergeSuggestionsResponseSchema,
  agentMessageRequestSchema,
  agentMessageResponseSchema,
  agentRunRequestSchema,
  agentRunResponseSchema,
  agentRunsResponseSchema,
  agentThreadResponseSchema,
  agentThreadsResponseSchema,
  createAgentThreadRequestSchema,
  createAddTracksToPlaylistBatchRequestSchema,
  approveImportItemRequestSchema,
  createAlbumMergeBatchRequestSchema,
  createBulkAlbumMergeBatchRequestSchema,
  createBulkDuplicateCleanupBatchRequestSchema,
  createAssociateFileWithTrackBatchRequestSchema,
  createAssociateTrackWithAlbumBatchRequestSchema,
  createBulkImportApprovalBatchRequestSchema,
  createBulkSetFileMetadataBatchRequestSchema,
  createDuplicateCleanupBatchRequestSchema,
  createBulkSetInternalTagsBatchRequestSchema,
  createImportApprovalBatchRequestSchema,
  createImportFromPathsRequestSchema,
  createMarkDuplicateBatchRequestSchema,
  createMergeDuplicateTracksBatchRequestSchema,
  createMoveFileBatchRequestSchema,
  createQueueDownloadBatchRequestSchema,
  createBulkRenameFilesBatchRequestSchema,
  createDeletePlaylistBatchRequestSchema,
  createPlaylistBatchRequestSchema,
  createRemoveFilesBatchRequestSchema,
  createRemoveTracksFromPlaylistBatchRequestSchema,
  createRemoveFileBatchRequestSchema,
  createRenameFileBatchRequestSchema,
  createUpdatePlaylistBatchRequestSchema,
  saveDiscoveryCandidateRequestSchema,
  saveDiscoveryListRequestSchema,
  createSetFavoriteStatusBatchRequestSchema,
  createSetFileMetadataBatchRequestSchema,
  createSetInternalTagsBatchRequestSchema,
  createSetRatingBatchRequestSchema,
  discoveryDownloadJobIdRequestSchema,
  discoveryDownloadJobResponseSchema,
  discoveryDownloadJobsResponseSchema,
  discoveryDownloadRequestSchema,
  discoveryDownloadResponseSchema,
  discoveryHealthResponseSchema,
  discoverySearchRequestSchema,
  discoverySearchResponseSchema,
  duplicateGroupsResponseSchema,
  importBatchResponseSchema,
  importItemResponseSchema,
  incompleteAlbumsResponseSchema,
  importsInboxResponseSchema,
  jobResponseSchema,
  jobsResponseSchema,
  libraryFilesResponseSchema,
  libraryRootResponseSchema,
  libraryRootsResponseSchema,
  libraryScanResultSchema,
  metadataDiagnosticsResponseSchema,
  metadataGapsResponseSchema,
  operationBatchIdRequestSchema,
  operationBatchResponseSchema,
  operationBatchesResponseSchema,
  playFileRequestSchema,
  playAlbumRequestSchema,
  playPlaylistRequestSchema,
  playQueueRequestSchema,
  enqueuePlaybackRequestSchema,
  playbackStateSchema,
  visualizerCapabilitiesSchema,
  waveformResponseSchema,
  playlistResponseSchema,
  playlistsResponseSchema,
  qualityUpgradeSuggestionsResponseSchema,
  rejectImportItemRequestSchema,
  scanLibraryRootRequestSchema,
  setPlaybackRepeatModeRequestSchema,
  savedDiscoveryCandidateResponseSchema,
  savedDiscoveryCandidatesResponseSchema,
  savedDiscoveryListResponseSchema,
  savedDiscoveryListsResponseSchema,
  tasteProfileResponseSchema,
  updateTasteProfileRequestSchema,
  updateLibraryRootWatchRequestSchema,
  updateImportItemMetadataRequestSchema,
  watchedLibraryScanResultSchema
} from "@music-os/core";
import { createBackendApp } from "./app.js";
import { getBackendConfig } from "./config.js";
import { inspectImportItem, inspectLibraryFile } from "./services/metadata-diagnostics.js";

const config = getBackendConfig();
const app = createBackendApp(config);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const origin = request.headers.origin;
  const allowedOrigin = getAllowedDevOrigin(origin);

  if (allowedOrigin) {
    response.setHeader("access-control-allow-origin", allowedOrigin);
  }
  response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, app.health());
      return;
    }

    if (request.method === "GET" && url.pathname === "/discovery/health") {
      writeJson(response, 200, discoveryHealthResponseSchema.parse(await app.discovery.health()));
      return;
    }

    if (request.method === "POST" && url.pathname === "/discovery/search") {
      const body = discoverySearchRequestSchema.parse(await readJson(request));
      if (body.source !== "slskd") {
        throw new Error(`Unsupported Discovery source: ${body.source}`);
      }
      const result = await app.discovery.search(body.query, body.responseLimit);
      writeJson(response, 200, discoverySearchResponseSchema.parse(result));
      return;
    }

    if (request.method === "GET" && url.pathname === "/discovery/saved-candidates") {
      writeJson(
        response,
        200,
        savedDiscoveryCandidatesResponseSchema.parse({ candidates: app.savedDiscoveryCandidates.listCandidates() })
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/discovery/saved-candidates") {
      const body = saveDiscoveryCandidateRequestSchema.parse(await readJson(request));
      writeJson(
        response,
        200,
        savedDiscoveryCandidateResponseSchema.parse({ candidate: app.savedDiscoveryCandidates.saveCandidate(body) })
      );
      return;
    }

    const savedDiscoveryCandidateMatch = url.pathname.match(/^\/discovery\/saved-candidates\/([^/]+)$/);
    if (request.method === "DELETE" && savedDiscoveryCandidateMatch) {
      app.savedDiscoveryCandidates.removeCandidate(decodeURIComponent(savedDiscoveryCandidateMatch[1]));
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/discovery/saved-lists") {
      writeJson(response, 200, savedDiscoveryListsResponseSchema.parse({ lists: app.savedDiscoveryLists.listLists() }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/discovery/saved-lists") {
      const body = saveDiscoveryListRequestSchema.parse(await readJson(request));
      writeJson(
        response,
        200,
        savedDiscoveryListResponseSchema.parse({ list: app.savedDiscoveryLists.saveList(body) })
      );
      return;
    }

    const savedDiscoveryListMatch = url.pathname.match(/^\/discovery\/saved-lists\/([^/]+)$/);
    if (request.method === "DELETE" && savedDiscoveryListMatch) {
      app.savedDiscoveryLists.removeList(decodeURIComponent(savedDiscoveryListMatch[1]));
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/discovery/download") {
      const body = discoveryDownloadRequestSchema.parse(await readJson(request));
      const job = app.discoveryDownloads.createJob(body.results, body.libraryRootId);
      writeJson(
        response,
        202,
        discoveryDownloadResponseSchema.parse({
          job,
          message: `Queued ${job.selectedCount} selected file${job.selectedCount === 1 ? "" : "s"}`
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/discovery/downloads") {
      writeJson(response, 200, discoveryDownloadJobsResponseSchema.parse({ jobs: app.discoveryDownloads.listJobs() }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/jobs") {
      writeJson(response, 200, jobsResponseSchema.parse({ jobs: app.jobs.listJobs() }));
      return;
    }

    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (request.method === "GET" && jobMatch) {
      writeJson(response, 200, jobResponseSchema.parse(app.jobs.getJob(decodeURIComponent(jobMatch[1]))));
      return;
    }

    if (request.method === "POST" && url.pathname === "/discovery/downloads/retry") {
      const body = discoveryDownloadJobIdRequestSchema.parse(await readJson(request));
      const job = app.discoveryDownloads.retryJob(body.jobId);
      writeJson(response, 200, discoveryDownloadJobResponseSchema.parse({ job }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/discovery/downloads/cancel") {
      const body = discoveryDownloadJobIdRequestSchema.parse(await readJson(request));
      const job = app.discoveryDownloads.cancelJob(body.jobId);
      writeJson(response, 200, discoveryDownloadJobResponseSchema.parse({ job }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/library/roots") {
      writeJson(response, 200, libraryRootsResponseSchema.parse({ roots: app.library.listRoots() }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/library/roots") {
      const body = addLibraryRootRequestSchema.parse(await readJson(request));
      const root = app.library.addRoot(body.path, body.name ?? deriveRootName(body.path), body.watchEnabled);
      writeJson(response, 201, libraryRootResponseSchema.parse({ root }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/library/roots/watch") {
      const body = updateLibraryRootWatchRequestSchema.parse(await readJson(request));
      const root = app.library.setRootWatchEnabled(body.rootId, body.watchEnabled);
      writeJson(response, 200, libraryRootResponseSchema.parse({ root }));
      return;
    }

    const removeRootMatch = url.pathname.match(/^\/library\/roots\/([^/]+)$/);
    if (request.method === "DELETE" && removeRootMatch) {
      app.library.removeRoot(decodeURIComponent(removeRootMatch[1]));
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/library/scan") {
      const body = scanLibraryRootRequestSchema.parse(await readJson(request));
      const root = app.library.getRoot(body.rootId);
      const result = await app.scanner.scanRoot(root);
      writeJson(response, 200, libraryScanResultSchema.parse(result));
      return;
    }

    if (request.method === "POST" && url.pathname === "/library/scan-watched") {
      const result = await app.scanner.scanRoots(app.library.listWatchedRoots());
      writeJson(response, 200, watchedLibraryScanResultSchema.parse(result));
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/artwork/file/")) {
      const fileId = decodeURIComponent(url.pathname.slice("/artwork/file/".length));
      const artwork = fileId ? await app.artwork.getFileArtwork(fileId).catch(() => null) : null;
      writeArtwork(response, artwork);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/artwork/album/")) {
      const albumId = decodeURIComponent(url.pathname.slice("/artwork/album/".length));
      const artwork = albumId ? await app.artwork.getAlbumArtwork(albumId).catch(() => null) : null;
      writeArtwork(response, artwork);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/artist-image/")) {
      const artist = decodeURIComponent(url.pathname.slice("/artist-image/".length));
      const imageUrl = artist ? await findArtistImageUrl(artist).catch(() => null) : null;
      if (!imageUrl) {
        response.writeHead(404, { "content-type": "text/plain", "cache-control": "public, max-age=3600" });
        response.end("no artist image");
        return;
      }
      response.writeHead(302, { location: imageUrl, "cache-control": "public, max-age=86400" });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/library/files") {
      const query = url.searchParams.get("query") ?? "";
      const limit = parseOptionalPositiveInteger(url.searchParams.get("limit"));
      const offset = parseOptionalPositiveInteger(url.searchParams.get("offset")) ?? 0;
      const files = app.library.listFiles(query, limit ?? Number.POSITIVE_INFINITY, offset);
      writeJson(response, 200, libraryFilesResponseSchema.parse({ files, total: app.library.countFiles(query) }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/library/albums") {
      const limit = parseOptionalPositiveInteger(url.searchParams.get("limit"));
      const offset = parseOptionalPositiveInteger(url.searchParams.get("offset")) ?? 0;
      const allAlbums = app.library.listAlbumGroups();
      const albums = limit == null ? allAlbums.slice(offset) : allAlbums.slice(offset, offset + limit);
      writeJson(response, 200, albumGroupsResponseSchema.parse({ albums, total: allAlbums.length }));
      return;
    }

    const fileDiagnosticsMatch = url.pathname.match(/^\/library\/files\/([^/]+)\/diagnostics$/);
    if (request.method === "GET" && fileDiagnosticsMatch) {
      const diagnostics = await inspectLibraryFile(app.library, decodeURIComponent(fileDiagnosticsMatch[1]));
      writeJson(response, 200, metadataDiagnosticsResponseSchema.parse(diagnostics));
      return;
    }

    const fileRatingMatch = url.pathname.match(/^\/library\/files\/([^/]+)\/rating$/);
    if (request.method === "POST" && fileRatingMatch) {
      const body = (await readJson(request)) as { rating?: unknown };
      const rating = body.rating == null ? null : Number(body.rating);
      if (rating != null && (!Number.isInteger(rating) || rating < 0 || rating > 5)) {
        throw new Error("rating must be null or an integer from 0 to 5");
      }
      const file = app.library.setFileRating(decodeURIComponent(fileRatingMatch[1]), rating);
      writeJson(response, 200, libraryFilesResponseSchema.parse({ files: [file], total: 1 }));
      return;
    }

    const fileFavoriteMatch = url.pathname.match(/^\/library\/files\/([^/]+)\/favorite-status$/);
    if (request.method === "POST" && fileFavoriteMatch) {
      const body = (await readJson(request)) as { liked?: unknown; disliked?: unknown };
      const liked = parseNullableBoolean(body.liked, "liked");
      const disliked = parseNullableBoolean(body.disliked, "disliked");
      if (liked === true && disliked === true) {
        throw new Error("A file cannot be both liked and disliked");
      }
      const file = app.library.setFileFavoriteStatus(decodeURIComponent(fileFavoriteMatch[1]), { liked, disliked });
      writeJson(response, 200, libraryFilesResponseSchema.parse({ files: [file], total: 1 }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/library/duplicates") {
      const groups = app.library.listDuplicateGroups();
      writeJson(
        response,
        200,
        duplicateGroupsResponseSchema.parse({
          groups,
          totalGroups: groups.length,
          totalFiles: groups.reduce((total, group) => total + group.count, 0)
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/library/metadata-gaps") {
      const items = app.library.listMetadataGaps();
      writeJson(response, 200, metadataGapsResponseSchema.parse({ items, total: items.length }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/library/quality-upgrades") {
      const suggestions = app.library.listQualityUpgradeSuggestions();
      writeJson(response, 200, qualityUpgradeSuggestionsResponseSchema.parse({ suggestions, total: suggestions.length }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/library/incomplete-albums") {
      const albums = app.library.listIncompleteAlbums();
      writeJson(response, 200, incompleteAlbumsResponseSchema.parse({ albums, total: albums.length }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/library/album-merge-suggestions") {
      const suggestions = app.library.listAlbumMergeSuggestions();
      writeJson(response, 200, albumMergeSuggestionsResponseSchema.parse({ suggestions, total: suggestions.length }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/library/alternate-editions") {
      const groups = app.library.listAlternateEditionGroups();
      writeJson(response, 200, alternateEditionGroupsResponseSchema.parse({ groups, total: groups.length }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/settings/taste-profile") {
      writeJson(response, 200, tasteProfileResponseSchema.parse(app.tasteProfile.getProfile()));
      return;
    }

    if (request.method === "PUT" && url.pathname === "/settings/taste-profile") {
      const body = updateTasteProfileRequestSchema.parse(await readJson(request));
      writeJson(response, 200, tasteProfileResponseSchema.parse(app.tasteProfile.updateProfile(body.profile, body.source)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/imports/inbox") {
      writeJson(response, 200, importsInboxResponseSchema.parse({ imports: app.imports.listInbox() }));
      return;
    }

    const importDiagnosticsMatch = url.pathname.match(/^\/imports\/items\/([^/]+)\/diagnostics$/);
    if (request.method === "GET" && importDiagnosticsMatch) {
      const item = app.imports.getItem(decodeURIComponent(importDiagnosticsMatch[1]));
      const diagnostics = await inspectImportItem(item);
      writeJson(response, 200, metadataDiagnosticsResponseSchema.parse(diagnostics));
      return;
    }

    if (request.method === "POST" && url.pathname === "/imports/create-from-paths") {
      const body = createImportFromPathsRequestSchema.parse(await readJson(request));
      const created = await app.imports.createFromPaths(body.paths, body.libraryRootId);
      writeJson(response, 201, importBatchResponseSchema.parse({ import: created }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/imports/approve-item") {
      const body = approveImportItemRequestSchema.parse(await readJson(request));
      const item = await app.imports.approveItem(body.importItemId, body.libraryRootId);
      writeJson(response, 200, importItemResponseSchema.parse({ item }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/imports/reject-item") {
      const body = rejectImportItemRequestSchema.parse(await readJson(request));
      const item = app.imports.rejectItem(body.importItemId);
      writeJson(response, 200, importItemResponseSchema.parse({ item }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/imports/update-item-metadata") {
      const body = updateImportItemMetadataRequestSchema.parse(await readJson(request));
      const item = app.imports.updateItemMetadata(body.importItemId, body.metadata);
      writeJson(response, 200, importItemResponseSchema.parse({ item }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/operations/batches") {
      writeJson(response, 200, operationBatchesResponseSchema.parse({ batches: app.operations.listBatches() }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/agent/runs") {
      writeJson(response, 200, agentRunsResponseSchema.parse({ runs: app.agentRuns.listRuns() }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/agent/runs") {
      const body = agentRunRequestSchema.parse(await readJson(request));
      const run = await app.agentRuns.run(body.message, body.threadId);
      writeJson(response, 201, agentRunResponseSchema.parse({ run }));
      return;
    }

    const agentRunMatch = url.pathname.match(/^\/agent\/runs\/([^/]+)$/);
    if (request.method === "GET" && agentRunMatch) {
      const run = app.agentRuns.getRun(decodeURIComponent(agentRunMatch[1]));
      writeJson(response, 200, agentRunResponseSchema.parse({ run }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/playlists") {
      writeJson(response, 200, playlistsResponseSchema.parse({ playlists: app.playlists.listPlaylists() }));
      return;
    }

    const playlistMatch = url.pathname.match(/^\/playlists\/([^/]+)$/);
    if (request.method === "GET" && playlistMatch) {
      const playlist = app.playlists.getPlaylist(decodeURIComponent(playlistMatch[1]));
      writeJson(response, 200, playlistResponseSchema.parse({ playlist }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-import-approval") {
      const body = createImportApprovalBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createImportApprovalBatch(body.importItemId, body.libraryRootId);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-bulk-import-approval") {
      const body = createBulkImportApprovalBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createImportApprovalBatchForItems(body.importItemIds, body.libraryRootId);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-playlist") {
      const body = createPlaylistBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createPlaylistBatch(body.name, body.description, body.fileIds ?? []);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-update-playlist") {
      const body = createUpdatePlaylistBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createUpdatePlaylistBatch(body.playlistId, {
        name: body.name,
        description: body.description ?? null
      });
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-delete-playlist") {
      const body = createDeletePlaylistBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createDeletePlaylistBatch(body.playlistId);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-add-tracks-to-playlist") {
      const body = createAddTracksToPlaylistBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createAddTracksToPlaylistBatch(body.playlistId, body.fileIds);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-remove-tracks-from-playlist") {
      const body = createRemoveTracksFromPlaylistBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createRemoveTracksFromPlaylistBatch(body.playlistId, body.itemIds);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-associate-file-with-track") {
      const body = createAssociateFileWithTrackBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createAssociateFileWithTrackBatch(body.fileId, body.trackId);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-associate-track-with-album") {
      const body = createAssociateTrackWithAlbumBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createAssociateTrackWithAlbumBatch(body.trackId, body.albumId);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-merge-duplicate-tracks") {
      const body = createMergeDuplicateTracksBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createMergeDuplicateTracksBatch(body.canonicalTrackId, body.duplicateTrackId);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-move-file") {
      const body = createMoveFileBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createMoveFileBatch(body.fileId, body.destinationPath);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-rename-file") {
      const body = createRenameFileBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createRenameFileBatch(body.fileId, body.filename);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-bulk-rename-files") {
      const body = createBulkRenameFilesBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createBulkRenameFilesBatch(body.fileIds, body.pattern);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-file-metadata") {
      const body = createSetFileMetadataBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createSetFileMetadataBatch(body.fileId, body.metadata);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-bulk-file-metadata") {
      const body = createBulkSetFileMetadataBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createBulkSetFileMetadataBatch(body.fileIds, body.metadata);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-rating") {
      const body = createSetRatingBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createSetRatingBatch(body.fileId, body.rating);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-favorite-status") {
      const body = createSetFavoriteStatusBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createSetFavoriteStatusBatch(body.fileId, { liked: body.liked, disliked: body.disliked });
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-album-merge") {
      const body = createAlbumMergeBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createAlbumMergeBatch(body.canonicalAlbum, body.fileIds);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-bulk-album-merge") {
      const body = createBulkAlbumMergeBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createBulkAlbumMergeBatch(body.merges);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-remove-file") {
      const body = createRemoveFileBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createRemoveFileBatch(body.fileId);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-remove-files") {
      const body = createRemoveFilesBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createRemoveFilesBatch(body.fileIds, body.reason);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-duplicate-cleanup") {
      const body = createDuplicateCleanupBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createDuplicateCleanupBatch(body.keepFileId, body.removeFileIds);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-bulk-duplicate-cleanup") {
      const body = createBulkDuplicateCleanupBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createBulkDuplicateCleanupBatch(body.groups);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-mark-duplicate") {
      const body = createMarkDuplicateBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createMarkDuplicateBatch(body.canonicalFileId, body.duplicateFileId, body.reason);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-internal-tags") {
      const body = createSetInternalTagsBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createSetInternalTagsBatch(body.trackId, body.tags);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-bulk-internal-tags") {
      const body = createBulkSetInternalTagsBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createBulkSetInternalTagsBatch(body.fileIds, body.tags);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/propose-queue-download") {
      const body = createQueueDownloadBatchRequestSchema.parse(await readJson(request));
      const batch = app.operations.createQueueDownloadBatch(body.results, body.query, "user", body.libraryRootId);
      writeJson(response, 201, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/approve-batch") {
      const body = operationBatchIdRequestSchema.parse(await readJson(request));
      const batch = app.operations.approveBatch(body.batchId);
      writeJson(response, 200, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/reject-batch") {
      const body = operationBatchIdRequestSchema.parse(await readJson(request));
      const batch = app.operations.rejectBatch(body.batchId);
      writeJson(response, 200, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/apply-batch") {
      const body = operationBatchIdRequestSchema.parse(await readJson(request));
      const batch = await app.operations.applyBatch(body.batchId);
      writeJson(response, 200, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/operations/revert-batch") {
      const body = operationBatchIdRequestSchema.parse(await readJson(request));
      const batch = await app.operations.revertBatch(body.batchId);
      writeJson(response, 200, operationBatchResponseSchema.parse({ batch }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/playback/state") {
      writeJson(response, 200, playbackStateSchema.parse(await app.playback.getState()));
      return;
    }

    if (request.method === "GET" && url.pathname === "/playback/visualizer/capabilities") {
      writeJson(response, 200, visualizerCapabilitiesSchema.parse(app.visualizer.capabilities()));
      return;
    }

    if (request.method === "GET" && url.pathname === "/playback/visualizer/stream") {
      app.visualizer.subscribe(response, url.searchParams.get("mode"));
      return;
    }

    const waveformMatch = request.method === "GET" ? url.pathname.match(/^\/playback\/waveform\/([^/]+)$/) : null;
    if (waveformMatch) {
      const file = app.library.getFile(decodeURIComponent(waveformMatch[1]));
      const waveform = waveformResponseSchema.parse(await app.waveforms.getWaveform(file));
      writeJson(response, waveform.status === "pending" ? 202 : 200, waveform);
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/play-playlist") {
      const body = playPlaylistRequestSchema.parse(await readJson(request));
      const files = app.playlists.getPlaylistFiles(body.playlistId);
      const state = await app.playback.playQueue(files, 0);
      writeJson(response, 200, playbackStateSchema.parse(state));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/play-album") {
      const body = playAlbumRequestSchema.parse(await readJson(request));
      const files = app.library.getAlbumFiles(body.albumId);
      const state = await app.playback.playQueue(files, 0);
      writeJson(response, 200, playbackStateSchema.parse(state));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/play-file") {
      const body = playFileRequestSchema.parse(await readJson(request));
      const file = app.library.getFile(body.fileId);
      const state = await app.playback.playFile(file);
      writeJson(response, 200, playbackStateSchema.parse(state));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/play-queue") {
      const body = playQueueRequestSchema.parse(await readJson(request));
      const files = body.fileIds.map((fileId) => app.library.getFile(fileId));
      const state = await app.playback.playQueue(files, body.startIndex);
      writeJson(response, 200, playbackStateSchema.parse(state));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/enqueue") {
      const body = enqueuePlaybackRequestSchema.parse(await readJson(request));
      const files = body.fileIds.map((fileId) => app.library.getFile(fileId));
      const state = await app.playback.enqueue(files, body.position);
      writeJson(response, 200, playbackStateSchema.parse(state));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/repeat") {
      const body = setPlaybackRepeatModeRequestSchema.parse(await readJson(request));
      writeJson(response, 200, playbackStateSchema.parse(await app.playback.setRepeatMode(body.repeatMode)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/pause") {
      writeJson(response, 200, playbackStateSchema.parse(await app.playback.pause()));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/resume") {
      writeJson(response, 200, playbackStateSchema.parse(await app.playback.resume()));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/stop") {
      writeJson(response, 200, playbackStateSchema.parse(await app.playback.stop()));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/next") {
      writeJson(response, 200, playbackStateSchema.parse(await app.playback.next()));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/previous") {
      writeJson(response, 200, playbackStateSchema.parse(await app.playback.previous()));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/seek") {
      const body = (await readJson(request)) as { positionMs?: unknown };
      const positionMs = Number(body.positionMs);
      if (!Number.isFinite(positionMs) || positionMs < 0) {
        throw new Error("positionMs must be a non-negative number");
      }
      writeJson(response, 200, playbackStateSchema.parse(await app.playback.seek(positionMs)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/playback/volume") {
      const body = (await readJson(request)) as { volumePercent?: unknown };
      const volumePercent = Number(body.volumePercent);
      if (!Number.isFinite(volumePercent) || volumePercent < 0 || volumePercent > 100) {
        throw new Error("volumePercent must be a number from 0 to 100");
      }
      writeJson(response, 200, playbackStateSchema.parse(await app.playback.setVolume(volumePercent)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/agent/message") {
      const body = agentMessageRequestSchema.parse(await readJson(request));
      const result = await app.agentThreads.sendMessage(body.message, body.threadId);
      writeJson(response, 200, agentMessageResponseSchema.parse(result));
      return;
    }

    if (request.method === "GET" && url.pathname === "/agent/threads/active") {
      writeJson(response, 200, agentThreadResponseSchema.parse(app.agentThreads.getActiveThread()));
      return;
    }

    if (request.method === "GET" && url.pathname === "/agent/threads") {
      writeJson(response, 200, agentThreadsResponseSchema.parse({ threads: app.agentThreads.listThreads() }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/agent/threads") {
      const body = createAgentThreadRequestSchema.parse(await readJson(request));
      writeJson(response, 201, agentThreadResponseSchema.parse(app.agentThreads.createThread(body.title)));
      return;
    }

    const agentThreadMatch = url.pathname.match(/^\/agent\/threads\/([^/]+)$/);
    if (request.method === "GET" && agentThreadMatch) {
      writeJson(response, 200, agentThreadResponseSchema.parse(app.agentThreads.getThread(decodeURIComponent(agentThreadMatch[1]))));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  } catch (error) {
    const status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
    writeJson(response, status, {
      error: "request_failed",
      message: error instanceof Error ? error.message : String(error)
    });
    return;
  }
});

server.listen(config.port, config.host, () => {
  console.log(`music-os backend listening at http://${config.host}:${config.port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown(): void {
  server.close(() => {
    app.close();
    process.exit(0);
  });
}

function getAllowedDevOrigin(origin: string | undefined): string | null {
  if (!origin) {
    return null;
  }
  if (origin === "null") {
    return origin;
  }

  try {
    const url = new URL(origin);
    if ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.protocol === "http:") {
      return origin;
    }
  } catch {
    return null;
  }

  return null;
}

function writeJson(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function parseOptionalPositiveInteger(value: string | null): number | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function parseNullableBoolean(value: unknown, key: string): boolean | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be boolean or null`);
  }
  return value;
}

function writeArtwork(
  response: import("node:http").ServerResponse,
  artwork: { data: Buffer; mimeType: string } | null
): void {
  if (!artwork) {
    response.writeHead(404, { "content-type": "text/plain", "cache-control": "public, max-age=30" });
    response.end("no artwork");
    return;
  }
  response.writeHead(200, {
    "content-type": artwork.mimeType,
    "content-length": artwork.data.length,
    "cache-control": "public, max-age=86400"
  });
  response.end(artwork.data);
}

function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function deriveRootName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

async function findArtistImageUrl(artist: string): Promise<string | null> {
  const query = artist.trim();
  if (!query) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const wikidataImage = await findWikidataArtistImageUrl(query, controller.signal);
    if (wikidataImage) {
      return wikidataImage;
    }

    for (const searchQuery of [`${query} band`, `${query} musician`, query]) {
      const wikipediaImage = await findWikipediaArtistImageUrl(searchQuery, controller.signal);
      if (wikipediaImage) {
        return wikipediaImage;
      }
    }

    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function findWikidataArtistImageUrl(query: string, signal: AbortSignal): Promise<string | null> {
  const searchUrl = new URL("https://www.wikidata.org/w/api.php");
  searchUrl.searchParams.set("action", "wbsearchentities");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("language", "en");
  searchUrl.searchParams.set("limit", "5");
  searchUrl.searchParams.set("search", query);

  const searchResponse = await fetch(searchUrl, {
    headers: { "user-agent": "music-os/0.1 artist-image lookup" },
    signal
  });
  if (!searchResponse.ok) {
    return null;
  }

  const searchBody = (await searchResponse.json()) as {
    search?: Array<{ id?: string; description?: string }>;
  };
  const entityId =
    searchBody.search?.find((result) => /musician|singer|band|composer|rapper|songwriter|record producer/i.test(result.description ?? ""))?.id ??
    searchBody.search?.[0]?.id;
  if (!entityId) {
    return null;
  }

  const entityUrl = new URL("https://www.wikidata.org/wiki/Special:EntityData/" + encodeURIComponent(entityId) + ".json");
  const entityResponse = await fetch(entityUrl, {
    headers: { "user-agent": "music-os/0.1 artist-image lookup" },
    signal
  });
  if (!entityResponse.ok) {
    return null;
  }

  const entityBody = (await entityResponse.json()) as {
    entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: string } } }>> }>;
  };
  const filename = entityBody.entities?.[entityId]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (!filename) {
    return null;
  }

  const commonsUrl = new URL("https://commons.wikimedia.org/wiki/Special:Redirect/file/" + encodeURIComponent(filename));
  commonsUrl.searchParams.set("width", "1200");
  return commonsUrl.toString();
}

async function findWikipediaArtistImageUrl(query: string, signal: AbortSignal): Promise<string | null> {
    const wikipediaUrl = new URL("https://en.wikipedia.org/w/api.php");
    wikipediaUrl.searchParams.set("action", "query");
    wikipediaUrl.searchParams.set("format", "json");
    wikipediaUrl.searchParams.set("generator", "search");
  wikipediaUrl.searchParams.set("gsrnamespace", "0");
  wikipediaUrl.searchParams.set("gsrsearch", query);
    wikipediaUrl.searchParams.set("gsrlimit", "1");
    wikipediaUrl.searchParams.set("prop", "pageimages");
    wikipediaUrl.searchParams.set("pithumbsize", "1200");

    const response = await fetch(wikipediaUrl, {
      headers: { "user-agent": "music-os/0.1 artist-image lookup" },
    signal
    });
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as {
      query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
    };
    const imageUrl = Object.values(body.query?.pages ?? {}).find((page) => page.thumbnail?.source)?.thumbnail?.source;
    return imageUrl && imageUrl.startsWith("https://") ? imageUrl : null;
}
