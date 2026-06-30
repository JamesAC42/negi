import type {
  AgentDiscoveryResult,
  AgentDiscoveryGroup,
  AgentImportResult,
  AgentMessageResponse,
  AgentParsedListItem,
  AgentResearchSource,
  DiscoveryResult,
  ImportItem,
  LibraryFilesResponse,
  TasteProfile
} from "@music-os/core";
import type { AgentPlanningContext, AgentTrackCandidate } from "./agent-model-provider.js";
import { rankDiscoveryResultsByAvailability } from "./discovery-availability.js";
import { LibraryRepository } from "./library-repository.js";
import { OperationService } from "./operation-service.js";
import { PlaybackService } from "./playback-service.js";
import type { SlskdService } from "./slskd-service.js";
import type { ImportService } from "./import-service.js";
import type { TasteProfileService } from "./taste-profile-service.js";

type LibraryFile = LibraryFilesResponse["files"][number];
type DiscoverySearchTool = Pick<SlskdService, "search">;
type TasteProfileReader = Pick<TasteProfileService, "getProfile">;
type DiscoveryQualityPreference = {
  preferredFormats: string[];
  preferLossless: boolean;
  allowMp3IfRare: boolean;
  minimumBitrateKbps: number | null;
};
type CandidateDiscoveryQuery = {
  query: string;
  requireArtist: boolean;
};
type DiscoveryReleasePlaylistSelection = {
  name: string;
  results: DiscoveryResult[];
};
type ResearchPlaylistItemRef =
  | {
      type: "owned";
      fileId: string;
    }
  | {
      type: "download";
      discoveryId: string;
    };
type AgentStepType = "plan" | "tool" | "decision" | "approval" | "final";
type AgentStepStatus = "running" | "completed" | "failed";
export type AgentStepRecorder = (step: {
  type: AgentStepType;
  toolName?: string | null;
  status?: AgentStepStatus;
  summary: string;
  input?: unknown;
  output?: unknown;
  error?: string | null;
}) => void;

export interface AgentHandleMessageOptions {
  recordStep?: AgentStepRecorder;
  discoveryQueryHints?: string[];
  suggestedIntent?: AgentMessageResponse["intent"];
  suggestedSearchQuery?: string;
  playlistName?: string;
  playlistDescription?: string;
  trackCandidates?: AgentTrackCandidate[];
  researchSources?: AgentResearchSource[];
}

export class AgentService {
  constructor(
    private readonly library: LibraryRepository,
    private readonly operations: OperationService,
    private readonly playback: PlaybackService,
    private readonly discovery?: DiscoverySearchTool,
    private readonly imports?: ImportService,
    private readonly tasteProfile?: TasteProfileReader
  ) {}

  async startOperationBatch(batchId: string): Promise<NonNullable<AgentMessageResponse["operationBatch"]>> {
    this.operations.approveBatch(batchId);
    return this.operations.applyBatch(batchId);
  }

  getPlanningContext(): AgentPlanningContext {
    const files = this.library.listFiles("", 500);
    const playable = files.filter((file) => !file.missing && !file.staged);
    const liked = mergeFilesById(
      this.library.listLikedFiles(100),
      playable.filter((file) => file.liked === true || (file.rating ?? 0) >= 4)
    );
    const disliked = mergeFilesById(
      this.library.listDislikedFiles(100),
      playable.filter((file) => file.disliked === true || (file.rating != null && file.rating <= 2))
    ).slice(0, 20);
    const highRotation = mergeFilesById(
      this.library.listHighRotationFiles(100),
      [...playable].sort((left, right) => right.playCount - left.playCount)
    ).slice(0, 20);
    const recent = mergeFilesById(
      this.library.listRecentlyPlayedFiles(100),
      [...playable]
        .filter((file) => file.lastPlayedAt)
        .sort((left, right) => (right.lastPlayedAt ?? "").localeCompare(left.lastPlayedAt ?? ""))
    ).slice(0, 20);
    const skipped = [...playable]
      .filter((file) => file.skipCount > 0)
      .sort((left, right) => right.skipCount - left.skipCount || (right.lastSkippedAt ?? "").localeCompare(left.lastSkippedAt ?? ""))
      .slice(0, 20);
    const current = this.getCurrentPlaybackFile();
    const tasteProfile = this.getCompactTasteProfile();
    return {
      librarySummary: `${this.library.countPlayableFiles()} indexed playable files`,
      currentTrack: current ? formatPlanningTrack(current) : undefined,
      currentArtist: current?.displayTags.artist ?? current?.displayTags.albumartist,
      currentAlbum: current?.displayTags.album,
      tasteProfile,
      favoriteArtists: topValues(liked, (file) => file.displayTags.artist ?? file.displayTags.albumartist).slice(0, 12),
      favoriteAlbums: topValues(liked, (file) => file.displayTags.album).slice(0, 12),
      favoriteGenres: topValues(liked, (file) => file.displayTags.genre).slice(0, 12),
      favoriteTracks: liked.map(formatPlanningTrack).filter(Boolean).slice(0, 20),
      highRotationArtists: topValues(highRotation, (file) => file.displayTags.artist ?? file.displayTags.albumartist).slice(0, 12),
      highRotationTracks: highRotation.map(formatPlanningTrack).filter(Boolean).slice(0, 20),
      recentArtists: topValues(recent, (file) => file.displayTags.artist ?? file.displayTags.albumartist).slice(0, 12),
      recentTracks: recent.map(formatPlanningTrack).filter(Boolean).slice(0, 20),
      dislikedArtists: topValues(disliked, (file) => file.displayTags.artist ?? file.displayTags.albumartist).slice(0, 12),
      dislikedTracks: disliked.map(formatPlanningTrack).filter(Boolean).slice(0, 20),
      skippedTracks: skipped.map(formatPlanningTrack).filter(Boolean).slice(0, 20)
    };
  }

  private getCompactTasteProfile(): Partial<TasteProfile> | undefined {
    if (!this.tasteProfile) {
      return undefined;
    }
    try {
      return compactTasteProfile(this.tasteProfile.getProfile().profile);
    } catch {
      return undefined;
    }
  }

  private getDiscoveryQualityPreference(): DiscoveryQualityPreference {
    const profile = this.getCompactTasteProfile();
    return {
      preferredFormats: profile?.preferredFormats?.map((format) => format.toLowerCase()).filter(Boolean) ?? [],
      preferLossless: profile?.qualityPreferences?.preferLossless ?? true,
      allowMp3IfRare: profile?.qualityPreferences?.allowMp3IfRare ?? true,
      minimumBitrateKbps: profile?.qualityPreferences?.minimumBitrateKbps ?? null
    };
  }

  async handleMessage(message: string, options: AgentHandleMessageOptions = {}): Promise<AgentMessageResponse> {
    const detectedIntent = detectAgentIntent(message);
    const intent = applySuggestedIntent(detectedIntent, options.suggestedIntent, { hasTrackCandidates: (options.trackCandidates?.length ?? 0) > 0 });
    const searchQuery =
      cleanSuggestedAgentSearchQuery(options.suggestedSearchQuery) ||
      this.resolveContextualSearchQuery(message, intent) ||
      extractAgentSearchQuery(message, intent);
    options.recordStep?.({
      type: "plan",
      status: "completed",
      summary: intent === detectedIntent ? `Detected intent ${intent}` : `Detected intent ${detectedIntent}; using model intent ${intent}`,
      input: { message },
      output: {
        detectedIntent,
        suggestedIntent: options.suggestedIntent ?? null,
        suggestedSearchQuery: options.suggestedSearchQuery ?? null,
        intent,
        searchQuery
      }
    });
    if (intent === "parse_pasted_list") {
      return this.handlePastedList(message);
    }
    if (intent === "propose_import") {
      return this.handleImportProposal(searchQuery);
    }
    if (intent === "propose_duplicate_cleanup") {
      return this.handleDuplicateCleanupProposal(searchQuery);
    }
    if (intent === "search_discovery") {
      return this.handleDiscoverySearch(searchQuery, message, options);
    }
    if (intent === "research_playlist" || (intent === "propose_playlist" && (options.trackCandidates?.length ?? 0) > 0)) {
      return this.handleResearchPlaylist(searchQuery, message, options);
    }

    const results = this.library.listFiles(searchQuery).slice(0, intent === "propose_playlist" ? 50 : 20);

    if (intent === "unknown") {
      return {
        reply: "I can search the library, search Discovery, play matching tracks, or propose playlists from existing indexed files.",
        intent,
        searchQuery,
        results: [],
        discoveryResults: [],
        parsedListItems: [],
        importResults: [],
        operationBatch: null,
        playback: null
      };
    }

    if (
      results.length === 0 &&
      intent === "search_library" &&
      this.discovery &&
      shouldFallbackToDiscoveryForReleaseContext(message, options.discoveryQueryHints)
    ) {
      options.recordStep?.({
        type: "decision",
        status: "completed",
        summary: "No local library matches; falling back to Discovery for release-context lookup",
        input: { searchQuery, discoveryQueryHints: options.discoveryQueryHints ?? [] },
        output: { intent: "search_discovery" }
      });
      return this.handleDiscoverySearch(searchQuery, message, options);
    }

    if (results.length === 0) {
      return {
        reply: searchQuery ? `I searched the library for "${searchQuery}" and found no matching tracks.` : "I need a library search term.",
        intent,
        searchQuery,
        results: [],
        discoveryResults: [],
        parsedListItems: [],
        importResults: [],
        operationBatch: null,
        playback: null
      };
    }

    if (intent === "propose_playlist") {
      const name = playlistName(searchQuery);
      const batch = this.operations.createPlaylistBatch(
        name,
        `Agent proposal from library search: ${searchQuery}`,
        results.map((file) => file.id),
        "agent"
      );
      return {
        reply: `I found ${results.length} matching track${results.length === 1 ? "" : "s"} and proposed playlist "${name}". Review it in Operations.`,
        intent,
        searchQuery,
        results: results.map(mapAgentResult),
        discoveryResults: [],
        parsedListItems: [],
        importResults: [],
        operationBatch: batch,
        playback: null
      };
    }

    if (intent === "playback") {
      const playback = await this.playback.playQueue(results, 0);
      return {
        reply: `Playing ${results.length} matching track${results.length === 1 ? "" : "s"} for "${searchQuery}".`,
        intent,
        searchQuery,
        results: results.map(mapAgentResult),
        discoveryResults: [],
        parsedListItems: [],
        importResults: [],
        operationBatch: null,
        playback
      };
    }

    return {
      reply: `I found ${results.length} matching track${results.length === 1 ? "" : "s"} for "${searchQuery}".`,
      intent,
      searchQuery,
      results: results.map(mapAgentResult),
      discoveryResults: [],
      parsedListItems: [],
      importResults: [],
      operationBatch: null,
      playback: null
    };
  }

  private getCurrentPlaybackFile(): LibraryFile | null {
    const currentFileId = this.playback.getSnapshot().currentFileId;
    if (!currentFileId) {
      return null;
    }
    try {
      return this.library.getFile(currentFileId);
    } catch {
      return null;
    }
  }

  private resolveContextualSearchQuery(message: string, intent: AgentMessageResponse["intent"]): string {
    if (intent !== "research_playlist" && intent !== "search_discovery" && intent !== "search_library") {
      return "";
    }
    if (!mentionsCurrentPlaybackContext(message)) {
      return "";
    }
    const current = this.getCurrentPlaybackFile();
    if (!current) {
      return "";
    }
    const tags = current.displayTags;
    const artist = tags.artist ?? tags.albumartist ?? "";
    const title = tags.title ?? current.filename.replace(/\.[^.]+$/, "");
    if (/\b(this|current)\s+(artist|band)\b/i.test(message)) {
      return cleanFallbackQuery(artist || title);
    }
    return cleanFallbackQuery([artist, title].filter(Boolean).join(" "));
  }

  private handlePastedList(message: string): AgentMessageResponse {
    const parsed = parsePastedList(message).map((item) => ({
      ...item,
      ownedMatchCount: countParsedListOwnedMatches(item, this.library)
    }));

    return {
      reply:
        parsed.length === 0
          ? "I could not parse any chart/list items."
          : `Parsed ${parsed.length} list item${parsed.length === 1 ? "" : "s"} and checked them against the indexed library.`,
      intent: "parse_pasted_list",
      searchQuery: parsed[0]?.query ?? "",
      results: [],
      discoveryResults: [],
      parsedListItems: parsed,
      importResults: [],
      operationBatch: null,
      playback: null
    };
  }

  private handleImportProposal(searchQuery: string): AgentMessageResponse {
    const roots = this.library.listRoots();
    if (!this.imports) {
      return emptyImportResponse(searchQuery, "Import inbox is not configured.");
    }
    if (roots.length === 0) {
      return emptyImportResponse(searchQuery, "Add a library root before proposing import approvals.");
    }

    const reviewable = this.imports
      .listInbox()
      .flatMap((batch) => batch.items)
      .filter((item) => item.status === "needs_review");
    const matched = filterImportItems(reviewable, searchQuery).slice(0, 20);
    if (matched.length === 0) {
      return emptyImportResponse(
        searchQuery,
        searchQuery
          ? `I found no reviewable import items matching "${searchQuery}".`
          : "I found no reviewable import items."
      );
    }

    const batch = this.operations.createImportApprovalBatchForItems(
      matched.map((item) => item.id),
      roots[0].id,
      "agent"
    );
    return {
      reply: `I found ${matched.length} reviewable import item${matched.length === 1 ? "" : "s"} and proposed an import approval batch. Review it in Operations.`,
      intent: "propose_import",
      searchQuery,
      results: [],
      discoveryResults: [],
      parsedListItems: [],
      importResults: matched.map(mapAgentImportResult),
      operationBatch: batch,
      playback: null
    };
  }

  private handleDuplicateCleanupProposal(searchQuery: string): AgentMessageResponse {
    const groups = this.library.listDuplicateGroups();
    const filteredGroups = filterDuplicateGroups(groups, searchQuery).slice(0, 10);
    if (filteredGroups.length === 0) {
      return {
        reply: searchQuery
          ? `I found no exact duplicate groups matching "${searchQuery}".`
          : "I found no exact duplicate groups to mark.",
        intent: "propose_duplicate_cleanup",
        searchQuery,
        results: [],
        discoveryResults: [],
        parsedListItems: [],
        importResults: [],
        operationBatch: null,
        playback: null
      };
    }

    const proposals = filteredGroups.flatMap((group) => {
      const canonical = chooseDuplicateCanonical(group.files);
      return group.files
        .filter((file) => file.id !== canonical.id)
        .map((file) => ({
          canonical,
          duplicate: file
        }));
    });

    const operationBatch = this.operations.createBatch({
      source: "agent",
      summary: `Mark ${proposals.length} exact duplicate file${proposals.length === 1 ? "" : "s"} across ${
        filteredGroups.length
      } group${filteredGroups.length === 1 ? "" : "s"}`,
      riskLevel: "low",
      operations: proposals.map(({ canonical, duplicate }) => ({
        type: "mark_duplicate",
        payload: {
          canonicalFileId: canonical.id,
          duplicateFileId: duplicate.id,
          reason: "agent_exact_duplicate_cleanup"
        }
      }))
    });

    return {
      reply: `I found ${filteredGroups.length} exact duplicate group${
        filteredGroups.length === 1 ? "" : "s"
      } and proposed non-destructive duplicate marks for ${proposals.length} file${
        proposals.length === 1 ? "" : "s"
      }. Review it in Operations before anything changes.`,
      intent: "propose_duplicate_cleanup",
      searchQuery,
      results: proposals.flatMap(({ canonical, duplicate }) => [canonical, duplicate]).map(mapAgentResult),
      discoveryResults: [],
      parsedListItems: [],
      importResults: [],
      operationBatch,
      playback: null
    };
  }

  private async handleDiscoverySearch(
    searchQuery: string,
    originalMessage: string,
    options: AgentHandleMessageOptions
  ): Promise<AgentMessageResponse> {
    if (!searchQuery) {
      return {
        reply: "I need a Discovery search term.",
        intent: "search_discovery",
        searchQuery,
        results: [],
        discoveryResults: [],
        parsedListItems: [],
        importResults: [],
        operationBatch: null,
        playback: null
      };
    }
    if (!this.discovery) {
      return {
        reply: "Discovery search is not configured.",
        intent: "search_discovery",
        searchQuery,
        results: [],
        discoveryResults: [],
        parsedListItems: [],
        importResults: [],
        operationBatch: null,
        playback: null
      };
    }

    const queries = discoveryQueryVariants(searchQuery, options.discoveryQueryHints ?? [], wantsReleaseContext(originalMessage));
    options.recordStep?.({
      type: "decision",
      status: "completed",
      summary: `Prepared ${queries.length} Discovery search ${queries.length === 1 ? "query" : "queries"}`,
      input: { searchQuery },
      output: { queries }
    });

    let discovery = { query: searchQuery, results: [] as DiscoveryResult[], total: 0 };
    const collectedResults: DiscoveryResult[] = [];
    const attemptedQueries: string[] = [];
    for (const query of queries) {
      attemptedQueries.push(query);
      try {
        discovery = await this.discovery.search(query, 50);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.recordStep?.({
          type: "tool",
          toolName: "search_soulseek",
          status: "failed",
          summary: `Soulseek search failed for "${query}"`,
          input: { query, responseLimit: 50 },
          error: message
        });
        throw error;
      }
      options.recordStep?.({
        type: "tool",
        toolName: "search_soulseek",
        status: "completed",
        summary: `Soulseek search returned ${discovery.results.length} result${discovery.results.length === 1 ? "" : "s"} for "${query}"`,
        input: { query, responseLimit: 50 },
        output: { query: discovery.query, total: discovery.total, resultCount: discovery.results.length }
      });
      if (discovery.results.length > 0) {
        collectedResults.push(...discovery.results);
        if (!wantsReleaseContext(originalMessage)) {
          break;
        }
      }
    }

    const resultsForRanking = wantsReleaseContext(originalMessage) && collectedResults.length > 0 ? dedupeDiscoveryResults(collectedResults) : discovery.results;
    const discoveryResults = resultsForRanking.slice(0, 20).map((result) => mapAgentDiscoveryResult(result, this.library));
    const discoveryGroups = groupAgentDiscoveryResults(resultsForRanking, this.library).slice(0, 8);
    const ownedCount = discoveryResults.filter((result) => result.ownedMatchCount > 0).length;
    const unlockedCount = discoveryResults.filter((result) => !result.isLocked).length;
    options.recordStep?.({
      type: "tool",
      toolName: "rank_discovery_results",
      status: "completed",
      summary: `Ranked ${discoveryGroups.length} Discovery release group${discoveryGroups.length === 1 ? "" : "s"}`,
      input: { resultCount: discovery.results.length },
      output: {
        groupCount: discoveryGroups.length,
        unlockedCount,
        ownedCount,
        selectedQuery: discovery.query,
        attemptedQueries
      }
    });
    const releasePlaylistSelection = wantsReleaseContext(originalMessage) ? selectDiscoveryReleasePlaylistResults(resultsForRanking) : null;
    const operationBatch = releasePlaylistSelection
      ? this.createDiscoveryReleasePlaylistBatch(releasePlaylistSelection, searchQuery, originalMessage)
      : wantsDownloadProposal(originalMessage)
        ? this.createDiscoveryDownloadProposal(resultsForRanking, searchQuery)
        : null;
    if (releasePlaylistSelection || wantsDownloadProposal(originalMessage)) {
      options.recordStep?.({
        type: "approval",
        toolName: releasePlaylistSelection ? "propose_release_playlist_download" : "propose_queue_download",
        status: "completed",
        summary: releasePlaylistSelection
          ? `Created release playlist workflow for ${releasePlaylistSelection.name}`
          : operationBatch
            ? `Created reviewable queue_download batch with ${operationBatch.operations.length} operation${operationBatch.operations.length === 1 ? "" : "s"}`
            : "No unlocked Discovery results were available for a queue_download proposal",
        input: { searchQuery, selectedQuery: discovery.query },
        output: operationBatch ? { operationBatchId: operationBatch.id, operationCount: operationBatch.operations.length } : null
      });
    }

    return {
      reply:
        discoveryResults.length === 0
          ? `I searched Discovery for "${searchQuery}"${attemptedQueries.length > 1 ? ` using ${attemptedQueries.length} query variants` : ""} and found no candidates.`
          : operationBatch
            ? releasePlaylistSelection
              ? `I found ${releasePlaylistSelection.results.length} unlocked track candidate${releasePlaylistSelection.results.length === 1 ? "" : "s"} for ${releasePlaylistSelection.name} and created a download/import playlist workflow. I will post here when the playlist is ready.`
              : `I found ${discoveryResults.length} Discovery candidate${discoveryResults.length === 1 ? "" : "s"} for "${searchQuery}"${discovery.query !== searchQuery ? ` via fallback query "${discovery.query}"` : ""} and proposed a download batch with ${operationBatch.operations.length} reviewable operation. Review it in Operations before any staging work.`
            : `I found ${discoveryResults.length} Discovery candidate${discoveryResults.length === 1 ? "" : "s"} for "${searchQuery}"${discovery.query !== searchQuery ? ` via fallback query "${discovery.query}"` : ""} (${unlockedCount} unlocked, ${ownedCount} with possible library matches). Review candidates in Discovery before staging downloads.`,
      intent: "search_discovery",
      searchQuery,
      results: [],
      discoveryResults,
      discoveryGroups,
      parsedListItems: [],
      importResults: [],
      operationBatch,
      playback: null
    };
  }

  private async handleResearchPlaylist(
    searchQuery: string,
    originalMessage: string,
    options: AgentHandleMessageOptions
  ): Promise<AgentMessageResponse> {
    const candidates = dedupeTrackCandidates(options.trackCandidates ?? []).slice(0, 20);
    if (candidates.length === 0) {
      return {
        reply:
          "I can build researched playlists, but this backend did not return any researched track candidates. Make sure the backend is running with MUSIC_OS_AGENT_MODEL_PROVIDER=openai and OPENAI_API_KEY or MUSIC_OS_OPENAI_API_KEY, then try again.",
        intent: "research_playlist",
        searchQuery,
        results: [],
        discoveryResults: [],
        parsedListItems: [],
        importResults: [],
        operationBatch: null,
        playback: null
      };
    }

    options.recordStep?.({
      type: "decision",
      status: "completed",
      summary: `Using ${candidates.length} researched playlist candidate${candidates.length === 1 ? "" : "s"}`,
      input: { originalMessage, searchQuery },
      output: { candidates }
    });

    const ownedFiles: LibraryFile[] = [];
    const missingCandidates: Array<{ candidate: AgentTrackCandidate; index: number }> = [];
    const playlistItemRefs: Array<ResearchPlaylistItemRef | null> = Array.from({ length: candidates.length }, () => null);
    for (const [index, candidate] of candidates.entries()) {
      const owned = findOwnedCandidate(this.library, candidate);
      if (owned) {
        ownedFiles.push(owned);
        playlistItemRefs[index] = { type: "owned", fileId: owned.id };
      } else {
        missingCandidates.push({ candidate, index });
      }
    }
    options.recordStep?.({
      type: "tool",
      toolName: "search_library",
      status: "completed",
      summary: `Matched ${ownedFiles.length} candidate${ownedFiles.length === 1 ? "" : "s"} already in the library`,
      input: { candidateCount: candidates.length },
      output: {
        owned: ownedFiles.map((file) => ({ fileId: file.id, title: file.displayTags.title ?? file.filename, artist: file.displayTags.artist ?? file.displayTags.albumartist ?? null })),
        missing: missingCandidates.map((item) => item.candidate)
      }
    });

    const selectedDiscoveryResults: DiscoveryResult[] = [];
    const qualityPreference = this.getDiscoveryQualityPreference();
    if (this.discovery) {
      const candidateSearchLimit = researchedPlaylistCandidateSearchLimit(candidates.length);
      const selectedByCandidate = await mapWithConcurrency(
        missingCandidates.slice(0, candidateSearchLimit),
        researchedPlaylistSearchConcurrency(),
        async ({ candidate, index }) => {
          const queries = candidateDiscoveryQueries(candidate);
          let selected: DiscoveryResult | null = null;
          for (const query of queries) {
            const discovery = await this.discovery!.search(query.query, 30);
            options.recordStep?.({
              type: "tool",
              toolName: "search_soulseek",
              status: "completed",
              summary: `Soulseek search returned ${discovery.results.length} result${discovery.results.length === 1 ? "" : "s"} for "${query.query}"`,
              input: { candidate, query: query.query, requireArtist: query.requireArtist, responseLimit: 30 },
              output: { query: discovery.query, total: discovery.total, resultCount: discovery.results.length }
            });
            selected = selectDiscoveryTrackResult(discovery.results, candidate, qualityPreference, query);
            if (selected) {
              break;
            }
          }
          return { index, selected };
        }
      );
      for (const { index, selected } of selectedByCandidate.sort((left, right) => left.index - right.index)) {
        if (selected) {
          selectedDiscoveryResults.push(selected);
          playlistItemRefs[index] = { type: "download", discoveryId: selected.id };
        }
      }
    }

    const orderedDiscoveryResults = selectedDiscoveryResults.filter((result) => !result.isLocked).slice(0, 16);
    const operationBatch =
      ownedFiles.length > 0 || orderedDiscoveryResults.length > 0
        ? this.createResearchPlaylistBatch(
            options.playlistName ?? playlistName(searchQuery || originalMessage),
            options.playlistDescription ?? `Agent researched playlist from: ${originalMessage}`,
            ownedFiles.map((file) => file.id),
            orderedDiscoveryResults,
            playlistItemRefs.filter((ref): ref is ResearchPlaylistItemRef => ref != null),
            searchQuery || originalMessage
          )
        : null;
    options.recordStep?.({
      type: "approval",
      toolName: "propose_research_playlist",
      status: "completed",
      summary: operationBatch
        ? `Created reviewable research playlist batch with ${operationBatch.operations.length} operation${operationBatch.operations.length === 1 ? "" : "s"}`
        : "No owned tracks or unlocked Discovery candidates were available for a playlist batch",
      input: { ownedCount: ownedFiles.length, selectedDiscoveryCount: orderedDiscoveryResults.length },
      output: operationBatch ? { operationBatchId: operationBatch.id, operationCount: operationBatch.operations.length } : null
    });

    return {
      reply: operationBatch
        ? `I built a researched playlist proposal with ${ownedFiles.length} library match${ownedFiles.length === 1 ? "" : "es"} and ${orderedDiscoveryResults.length} Soulseek download candidate${orderedDiscoveryResults.length === 1 ? "" : "s"}. Review the batch in Operations.`
        : "I researched candidate tracks, but I could not match any local files or unlocked Soulseek candidates.",
      intent: "research_playlist",
      searchQuery,
      results: ownedFiles.map(mapAgentResult),
      discoveryResults: orderedDiscoveryResults.map((result) => mapAgentDiscoveryResult(result, this.library)),
      discoveryGroups: groupAgentDiscoveryResults(orderedDiscoveryResults, this.library),
      researchSources: options.researchSources ?? [],
      parsedListItems: [],
      importResults: [],
      operationBatch,
      playback: null
    };
  }

  private createDiscoveryDownloadProposal(results: DiscoveryResult[], searchQuery: string): AgentMessageResponse["operationBatch"] {
    const selected = rankDiscoveryResultsByAvailability(results.filter((result) => !result.isLocked)).slice(0, 10);
    if (selected.length === 0) {
      return null;
    }
    return this.operations.createQueueDownloadBatch(selected, searchQuery, "agent", this.library.listRoots()[0]?.id);
  }

  private createDiscoveryReleasePlaylistBatch(
    selection: DiscoveryReleasePlaylistSelection,
    query: string,
    originalMessage: string
  ): AgentMessageResponse["operationBatch"] {
    const playlistItemRefs = selection.results.map((result) => ({ type: "download" as const, discoveryId: result.id }));
    return this.createResearchPlaylistBatch(
      selection.name,
      `Agent release lookup from: ${originalMessage}`,
      [],
      selection.results,
      playlistItemRefs,
      query
    );
  }

  private createResearchPlaylistBatch(
    name: string,
    description: string,
    ownedFileIds: string[],
    discoveryResults: DiscoveryResult[],
    playlistItemRefs: ResearchPlaylistItemRef[],
    query: string
  ): AgentMessageResponse["operationBatch"] {
    const operations = [];
    if (discoveryResults.length > 0) {
      operations.push({
        type: "queue_download" as const,
        payload: {
          query,
          results: discoveryResults,
          libraryRootId: this.library.listRoots()[0]?.id,
          researchPlaylist: {
            name,
            description,
            ownedFileIds: [...new Set(ownedFileIds)],
            playlistItemRefs
          }
        }
      });
    }
    if (ownedFileIds.length > 0 && discoveryResults.length === 0) {
      operations.push({
        type: "create_playlist" as const,
        payload: {
          name,
          description,
          type: "manual",
          createdBy: "agent",
          fileIds: [...new Set(ownedFileIds)]
        }
      });
    }
    if (operations.length === 0) {
      return null;
    }
    return this.operations.createBatch({
      source: "agent",
      summary: `Create researched playlist ${name}`,
      riskLevel: discoveryResults.length > 0 ? "medium" : "low",
      operations
    });
  }
}

export function detectAgentIntent(message: string): AgentMessageResponse["intent"] {
  const text = message.toLowerCase();
  if (looksLikePastedList(message)) {
    return "parse_pasted_list";
  }
  if (/\b(duplicate|duplicates|dupes|cleanup|clean up)\b/.test(text) && /\b(mark|propose|find|show|list|keep|cleanup|clean up)\b/.test(text)) {
    return "propose_duplicate_cleanup";
  }
  if (/\b(import|imports|inbox)\b/.test(text) && /\b(propose|approve|review|stage|staged)\b/.test(text)) {
    return "propose_import";
  }
  if (/\b(discover|discovery|soulseek|slsk|slskd|download|external|find online)\b/.test(text)) {
    return "search_discovery";
  }
  if (wantsReleaseContext(message) && /\b(find|search|show|look|lookup|get|what|which)\b/.test(text)) {
    return "search_discovery";
  }
  if (wantsMusicLookup(message) && !explicitlyLocalLibrarySearch(message)) {
    return "search_discovery";
  }
  if (mentionsCurrentPlaybackContext(message) && /\b(like|similar|recommend|recommendation|playlist|mix|songs|tracks|find)\b/.test(text)) {
    return "research_playlist";
  }
  if (wantsMusicRecommendation(message)) {
    return "research_playlist";
  }
  if (/\b(playlist|mix)\b/.test(text) && /\b(make|create|build|propose|generate)\b/.test(text)) {
    if (
      !explicitlyLocalLibrarySearch(message) &&
      /\b(mood|vibe|like|similar|recommend|think i would like|for me|for\s+(a\s+|an\s+|the\s+)?[\p{L}\p{N}'-]+|based on|research|download|find)\b/u.test(text)
    ) {
      return "research_playlist";
    }
    return "propose_playlist";
  }
  if (/\b(play|queue|listen)\b/.test(text)) {
    return "playback";
  }
  if (/\b(find|search|show|list|look for)\b/.test(text)) {
    return "search_library";
  }
  return "unknown";
}

function applySuggestedIntent(
  detectedIntent: AgentMessageResponse["intent"],
  suggestedIntent: AgentMessageResponse["intent"] | undefined,
  options: { hasTrackCandidates?: boolean } = {}
): AgentMessageResponse["intent"] {
  if (!suggestedIntent || suggestedIntent === "unknown" || suggestedIntent === detectedIntent) {
    return detectedIntent;
  }
  if (suggestedIntent === "research_playlist" && options.hasTrackCandidates) {
    return suggestedIntent;
  }
  if (detectedIntent === "search_library" || detectedIntent === "unknown") {
    return suggestedIntent;
  }
  if (detectedIntent === "propose_playlist" && suggestedIntent === "research_playlist") {
    return suggestedIntent;
  }
  return detectedIntent;
}

export function extractAgentSearchQuery(message: string, intent: AgentMessageResponse["intent"]): string {
  let query = message.toLowerCase();
  query = query.replace(/[^\p{L}\p{N}\s'-]+/gu, " ");
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "album",
    "albums",
    "appears",
    "appeared",
    "by",
    "for",
    "from",
    "i",
    "in",
    "it",
    "it's",
    "its",
    "here",
    "library",
    "me",
    "music",
    "my",
    "of",
    "on",
    "please",
    "record",
    "release",
    "single",
    "song",
    "songs",
    "that",
    "track",
    "the",
    "tracks",
    "with"
  ]);
  const intentWords =
    intent === "propose_playlist"
      ? ["make", "create", "build", "propose", "generate", "playlist", "mix"]
      : intent === "research_playlist"
        ? [
            "make",
            "create",
            "build",
            "propose",
            "generate",
            "playlist",
            "mix",
            "songs",
            "song",
            "tracks",
            "track",
            "music",
            "mood",
            "vibe",
            "like",
            "similar",
            "recommend",
            "recommendation",
            "recommendations",
            "suggest",
            "suggestion",
            "suggestions",
            "research",
            "something",
            "stuff",
            "think",
            "would",
            "you"
          ]
      : intent === "playback"
        ? ["play", "queue", "listen"]
        : intent === "parse_pasted_list"
          ? ["parse", "chart", "list", "rym", "rateyourmusic", "albums", "tracks"]
        : intent === "propose_import"
          ? ["approve", "import", "imports", "inbox", "propose", "review", "stage", "staged"]
          : intent === "propose_duplicate_cleanup"
            ? [
                "best",
                "clean",
                "cleanup",
                "copies",
                "copy",
                "duplicate",
                "duplicates",
                "dupe",
                "dupes",
                "find",
                "keep",
                "list",
                "mark",
                "propose",
                "show",
                "up"
              ]
            : intent === "search_discovery"
              ? [
                  "discover",
                  "discovery",
                  "download",
                  "external",
                  "find",
                  "grab",
                  "online",
                  "propose",
                  "queue",
                  "search",
                  "show",
                  "soulseek",
                  "slsk",
                  "slskd",
                  "stage"
                ]
              : ["find", "search", "show", "list", "look", "for"];
  for (const word of intentWords) {
    stopWords.add(word);
  }

  return query
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word && !stopWords.has(word))
    .join(" ")
    .trim();
}

export function cleanSuggestedAgentSearchQuery(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const filler = new Set(["a", "an", "album", "download", "find", "here", "me", "please", "search", "song", "songs", "the", "this", "track", "tracks"]);
  return cleanFallbackQuery(value)
    .split(/\s+/)
    .filter((token) => token && !filler.has(token))
    .join(" ")
    .trim();
}

function mentionsCurrentPlaybackContext(message: string): boolean {
  return /\b(this|current|playing|now playing)\s+(song|track|artist|band)\b/i.test(message) || /\b(song|track|artist|band)\s+(playing|on now)\b/i.test(message);
}

function wantsMusicRecommendation(message: string): boolean {
  const text = message.toLowerCase();
  if (/\b(songs?|tracks?|music|artists?|albums?)\s+(like|similar to)\b/.test(text)) {
    return true;
  }
  if (/\b(like|similar to)\s+(this|that|current)\s+(song|track|artist|band|album)\b/.test(text)) {
    return true;
  }
  if (/\b(recommend|recommendation|suggest|suggestion|mood|vibe|think i(?:'|’)d like|think i would like|for me)\b/.test(text)) {
    return /\b(song|songs|track|tracks|music|artist|artists|album|albums|playlist|mix|something|stuff)\b/.test(text);
  }
  return false;
}

function wantsMusicLookup(message: string): boolean {
  return /\b(find|search|show|look|lookup|get)\b/i.test(message) && /\b(song|songs|track|tracks|album|albums|release|record|single|ep)\b/i.test(message);
}

function explicitlyLocalLibrarySearch(message: string): boolean {
  return /\b(my|local|indexed)\s+(library|files?|tracks?|songs?|music)\b/i.test(message) || /\b(in|from|inside)\s+(my\s+)?(library|local files?|indexed files?)\b/i.test(message);
}

function wantsDownloadProposal(message: string): boolean {
  const text = message.toLowerCase();
  return /\b(download|stage|queue|grab|propose)\b/.test(text);
}

function discoveryQueryVariants(searchQuery: string, hints: string[] = [], preferHints = false): string[] {
  const variants: string[] = [];
  const add = (value: string) => {
    const normalized = cleanFallbackQuery(value);
    if (normalized && !variants.some((existing) => normalizeFallbackKey(existing) === normalizeFallbackKey(normalized))) {
      variants.push(normalized);
    }
  };

  if (preferHints) {
    for (const hint of hints) {
      addUsefulExternalHint(searchQuery, hint, add, { allowLoose: true });
    }
  }
  add(searchQuery);
  add(removeSuppressedSearchTokens(searchQuery));

  const tokens = cleanFallbackQuery(searchQuery).split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) {
    add(tokens.slice(1).join(" "));
  }
  if (tokens.length >= 4) {
    add(tokens.slice(2).join(" "));
  }

  if (!preferHints) {
    for (const hint of hints) {
      addUsefulExternalHint(searchQuery, hint, add);
    }
  }

  return variants.slice(0, 6);
}

function addUsefulExternalHint(
  searchQuery: string,
  hint: string,
  add: (value: string) => void,
  options: { allowLoose?: boolean } = {}
): void {
  const cleanedHint = removeSuppressedSearchTokens(hint);
  if (!cleanedHint) {
    return;
  }
  const base = removeSuppressedSearchTokens(searchQuery) || cleanFallbackQuery(searchQuery);
  const baseTokens = meaningfulQueryTokens(base);
  const hintTokens = [...meaningfulQueryTokens(cleanedHint)];
  if (hintTokens.length === 0) {
    return;
  }

  const overlap = hintTokens.filter((token) => baseTokens.has(token)).length;
  const maxUsefulLength = Math.max(4, baseTokens.size * 2 + 1);
  if (!options.allowLoose && baseTokens.size > 0 && overlap === 0 && hintTokens.length > 3) {
    return;
  }
  if (hintTokens.length > maxUsefulLength) {
    return;
  }
  add(cleanedHint);
}

function removeSuppressedSearchTokens(searchQuery: string): string {
  let value = ` ${cleanFallbackQuery(searchQuery)} `;
  const suppressed = suppressedSearchTerms();
  for (const term of suppressed) {
    const escapedTerm = term.split(/\s+/).map(escapeRegExp).join("\\s+");
    const pattern = new RegExp(`\\s+${escapedTerm}(?=\\s+)`, "gi");
    value = value.replace(pattern, " ");
  }
  return cleanFallbackQuery(value);
}

function suppressedSearchTerms(): string[] {
  const configured = process.env.MUSIC_OS_SLSKD_SUPPRESSED_SEARCH_TERMS;
  const terms = configured
    ? configured.split(",").map((term) => cleanFallbackQuery(term))
    : ["the beatles", "beatles", "le sserafim", "sserafim"];
  return [...new Set(terms.filter(Boolean).sort((a, b) => b.length - a.length))];
}

function researchedPlaylistCandidateSearchLimit(candidateCount: number): number {
  const configured = process.env.MUSIC_OS_AGENT_RESEARCH_PLAYLIST_CANDIDATE_SEARCH_LIMIT;
  if (!configured) {
    return candidateCount;
  }
  const parsed = Number(configured);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(candidateCount, Math.floor(parsed)) : candidateCount;
}

function researchedPlaylistSearchConcurrency(): number {
  const configured = process.env.MUSIC_OS_AGENT_RESEARCH_PLAYLIST_SEARCH_CONCURRENCY;
  if (!configured) {
    return 1;
  }
  const parsed = Number(configured);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(8, Math.floor(parsed)) : 1;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await map(items[index]!);
      }
    })
  );
  return results;
}

function wantsReleaseContext(message: string): boolean {
  return /\b(album|release|record|single|ep)\b/i.test(message) && /\b(on|from|with|has|contains|include|includes|appears|appeared|came|comes|its|it's)\b/i.test(message);
}

function shouldFallbackToDiscoveryForReleaseContext(message: string, hints: string[] | undefined): boolean {
  return wantsReleaseContext(message) && (hints?.some((hint) => cleanFallbackQuery(hint)) ?? false);
}

function cleanFallbackQuery(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]+/gu, " ")
    .replace(/\b(flac|mp3|m4a|aac|alac|ape|ogg|opus|wav|wma)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFallbackKey(value: string): string {
  return cleanFallbackQuery(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function meaningfulQueryTokens(value: string): Set<string> {
  const stop = new Set(["a", "an", "and", "by", "for", "from", "in", "of", "the", "to", "with"]);
  return new Set(
    cleanFallbackQuery(value)
      .split(/\s+/)
      .filter((token) => token.length > 1 && !stop.has(token))
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function playlistName(query: string): string {
  if (!query) {
    return `Agent Playlist ${new Date().toISOString().slice(0, 10)}`;
  }
  return `Agent: ${titleCase(query)}`;
}

function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (match) => match.toUpperCase());
}

function formatPlanningTrack(file: LibraryFile): string {
  const tags = file.displayTags;
  const artist = tags.artist ?? tags.albumartist;
  const title = tags.title ?? file.filename.replace(/\.[^.]+$/, "");
  const album = tags.album;
  return [artist, title].filter(Boolean).join(" - ") + (album ? ` (${album})` : "");
}

function compactTasteProfile(profile: TasteProfile): Partial<TasteProfile> | undefined {
  const compact: Partial<TasteProfile> = {};
  const arrayKeys = [
    "favoriteArtists",
    "favoriteAlbums",
    "favoriteTracks",
    "preferredGenres",
    "preferredEras",
    "preferredCountries",
    "preferredLabels",
    "blockedArtists",
    "blockedGenres",
    "overplayedTracks",
    "preferredFormats"
  ] as const;
  for (const key of arrayKeys) {
    if (profile[key].length > 0) {
      compact[key] = profile[key].slice(0, 20) as never;
    }
  }

  if (profile.qualityPreferences.minimumBitrateKbps != null || !profile.qualityPreferences.preferLossless || !profile.qualityPreferences.allowMp3IfRare) {
    compact.qualityPreferences = profile.qualityPreferences;
  }
  for (const key of ["playlistStylePreferences", "notes"] as const) {
    const value = profile[key].trim();
    if (value) {
      compact[key] = value;
    }
  }

  return Object.keys(compact).length > 0 ? compact : undefined;
}

function topValues(files: LibraryFile[], getValue: (file: LibraryFile) => string | undefined | null): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const value = getValue(file)?.trim();
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value]) => value);
}

function mergeFilesById(...groups: LibraryFile[][]): LibraryFile[] {
  const seen = new Set<string>();
  const merged: LibraryFile[] = [];
  for (const group of groups) {
    for (const file of group) {
      if (!seen.has(file.id)) {
        seen.add(file.id);
        merged.push(file);
      }
    }
  }
  return merged;
}

function dedupeTrackCandidates(candidates: AgentTrackCandidate[]): AgentTrackCandidate[] {
  const seen = new Set<string>();
  const deduped: AgentTrackCandidate[] = [];
  for (const candidate of candidates) {
    const artist = candidate.artist.trim();
    const title = candidate.title.trim();
    if (!artist || !title) {
      continue;
    }
    const key = `${normalizeFallbackKey(artist)}\u0000${normalizeFallbackKey(title)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push({
        ...candidate,
        artist,
        title,
        album: candidate.album?.trim() || undefined,
        query: candidate.query?.trim() || undefined,
        reason: candidate.reason?.trim() || undefined
      });
    }
  }
  return deduped;
}

function findOwnedCandidate(library: LibraryRepository, candidate: AgentTrackCandidate): LibraryFile | null {
  const queries = candidateDiscoveryQueries(candidate);
  for (const query of queries) {
    const normalizedArtist = normalizeFallbackKey(candidate.artist);
    const normalizedTitle = normalizeFallbackKey(candidate.title);
    const match = library
      .listFiles(query.query, 10)
      .find((file) => {
        const tags = file.displayTags;
        const artist = normalizeFallbackKey(tags.artist ?? tags.albumartist ?? "");
        const title = normalizeFallbackKey(tags.title ?? file.filename.replace(/\.[^.]+$/, ""));
        return title.includes(normalizedTitle) && (!normalizedArtist || artist.includes(normalizedArtist));
      });
    if (match) {
      return match;
    }
  }
  return null;
}

function candidateDiscoveryQueries(candidate: AgentTrackCandidate): CandidateDiscoveryQuery[] {
  const queries: Array<{ query?: string | null; requireArtist: boolean }> = [];
  const add = (query: string | null | undefined, requireArtist: boolean) => {
    const cleaned = query ? cleanFallbackQuery(query) : "";
    if (!cleaned) {
      return;
    }
    queries.push({ query: cleaned, requireArtist });
    const unsuppressed = removeSuppressedSearchTokens(cleaned);
    if (unsuppressed && normalizeFallbackKey(unsuppressed) !== normalizeFallbackKey(cleaned)) {
      queries.push({ query: unsuppressed, requireArtist: false });
    }
  };

  add(candidate.query, true);
  add(`${candidate.artist} ${candidate.title}`, true);
  add(candidate.album ? `${candidate.artist} ${candidate.album} ${candidate.title}` : null, true);
  add(candidate.album ? `${candidate.album} ${candidate.title}` : null, false);
  add(candidate.title, false);

  return queries
    .filter((value) => Boolean(value.query))
    .filter((value, index, values) => values.findIndex((other) => normalizeFallbackKey(other.query ?? "") === normalizeFallbackKey(value.query ?? "")) === index)
    .map((value) => ({ query: value.query ?? "", requireArtist: value.requireArtist }))
    .slice(0, 7);
}

function selectDiscoveryTrackResult(
  results: DiscoveryResult[],
  candidate: AgentTrackCandidate,
  qualityPreference: DiscoveryQualityPreference,
  query: CandidateDiscoveryQuery
): DiscoveryResult | null {
  const normalizedArtist = normalizeFallbackKey(candidate.artist);
  const normalizedTitle = normalizeFallbackKey(candidate.title);
  const normalizedAlbum = normalizeFallbackKey(candidate.album ?? "");
  const eligible = results.filter((result) => {
    if (result.isLocked) {
      return false;
    }
    const haystack = normalizeFallbackKey([result.filename, result.path, result.folder].filter(Boolean).join(" "));
    const titleMatches = haystack.includes(normalizedTitle);
    const artistMatches = !normalizedArtist || haystack.includes(normalizedArtist);
    const albumMatches = Boolean(normalizedAlbum && haystack.includes(normalizedAlbum));
    return titleMatches && (artistMatches || albumMatches || !query.requireArtist);
  });
  return rankDiscoveryResultsByQuality(eligible, qualityPreference, candidate)[0] ?? null;
}

function rankDiscoveryResultsByQuality(
  results: DiscoveryResult[],
  qualityPreference: DiscoveryQualityPreference,
  candidate?: AgentTrackCandidate
): DiscoveryResult[] {
  return rankDiscoveryResultsByAvailability(results).sort((left, right) => {
    const qualityDelta =
      discoveryQualityScore(right, qualityPreference, candidate) -
      discoveryQualityScore(left, qualityPreference, candidate);
    if (qualityDelta !== 0) {
      return qualityDelta;
    }
    return 0;
  });
}

function discoveryQualityScore(
  result: DiscoveryResult,
  qualityPreference: DiscoveryQualityPreference,
  candidate?: AgentTrackCandidate
): number {
  const extension = (result.extension ?? result.filename.split(".").pop() ?? "").toLowerCase();
  let score = 0;
  if (candidate) {
    const haystack = normalizeFallbackKey([result.filename, result.path, result.folder].filter(Boolean).join(" "));
    const artist = normalizeFallbackKey(candidate.artist);
    const album = normalizeFallbackKey(candidate.album ?? "");
    if (artist && haystack.includes(artist)) {
      score += 40;
    }
    if (album && haystack.includes(album)) {
      score += 20;
    }
    const title = normalizeFallbackKey(candidate.title);
    if (title && normalizedDiscoveryFileTitle(result).includes(title)) {
      score += 140;
    }
    if (hasUnrequestedVersionQualifier(candidate, result)) {
      score -= 800;
    }
  }
  const preferredIndex = qualityPreference.preferredFormats.indexOf(extension);
  if (preferredIndex >= 0) {
    score += 200 - preferredIndex;
  }
  if (losslessFormats.has(extension)) {
    score += qualityPreference.preferLossless ? 100 : 15;
  } else if (extension === "mp3" && !qualityPreference.allowMp3IfRare) {
    score -= 80;
  }
  const bitrateKbps = result.bitrate == null ? null : result.bitrate > 2000 ? Math.round(result.bitrate / 1000) : result.bitrate;
  if (bitrateKbps != null) {
    score += Math.min(50, bitrateKbps / 20);
    if (qualityPreference.minimumBitrateKbps != null && bitrateKbps < qualityPreference.minimumBitrateKbps) {
      score -= 120;
    }
  }
  return score;
}

const losslessFormats = new Set(["flac", "alac", "wav", "aiff", "aif", "ape", "wv", "dsf"]);
const versionQualifierPattern = /\b(remix|edit|live|demo|instrumental|karaoke|cover|bootleg|acoustic)\b/i;

function hasUnrequestedVersionQualifier(candidate: AgentTrackCandidate, result: DiscoveryResult): boolean {
  if (versionQualifierPattern.test(candidate.title)) {
    return false;
  }
  return versionQualifierPattern.test([result.filename, result.path, result.folder].filter(Boolean).join(" "));
}

function normalizedDiscoveryFileTitle(result: DiscoveryResult): string {
  return normalizeFallbackKey(
    result.filename
      .replace(/\.[^.]+$/, "")
      .replace(/^\s*\d+\s*[-_.]\s*/, "")
      .replace(/\s*\([^)]*\b(?:remix|mix|edit|version|live|demo|instrumental|karaoke|cover|bootleg|acoustic)\b[^)]*\)\s*/gi, " ")
      .replace(/\s*\[[^\]]*\b(?:remix|mix|edit|version|live|demo|instrumental|karaoke|cover|bootleg|acoustic)\b[^\]]*\]\s*/gi, " ")
  );
}

function mapAgentResult(file: LibraryFile): AgentMessageResponse["results"][number] {
  const tags = file.displayTags;
  return {
    fileId: file.id,
    title: tags.title ?? file.filename,
    artist: tags.artist ?? tags.albumartist ?? null,
    album: tags.album ?? null,
    year: tags.year ?? tags.date ?? null
  };
}

function filterDuplicateGroups(groups: ReturnType<LibraryRepository["listDuplicateGroups"]>, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return groups;
  }
  return groups.filter((group) =>
    group.files.some((file) =>
      [file.filename, file.path, file.displayTags.title, file.displayTags.artist, file.displayTags.albumartist, file.displayTags.album]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    )
  );
}

function chooseDuplicateCanonical(files: LibraryFile[]): LibraryFile {
  return [...files].sort((left, right) => duplicateCanonicalScore(right) - duplicateCanonicalScore(left) || left.path.localeCompare(right.path))[0]!;
}

function duplicateCanonicalScore(file: LibraryFile): number {
  let score = 0;
  if (!file.missing) {
    score += 100;
  }
  if (file.displayTags.title) {
    score += 20;
  }
  if (file.displayTags.artist || file.displayTags.albumartist) {
    score += 20;
  }
  if (file.displayTags.album) {
    score += 10;
  }
  if (file.displayTags.year || file.displayTags.date) {
    score += 5;
  }
  score += Math.max(0, 160 - file.path.length) / 10;
  return score;
}

function mapAgentDiscoveryResult(result: DiscoveryResult, library: LibraryRepository): AgentDiscoveryResult {
  return {
    discoveryId: result.id,
    username: result.username,
    filename: result.filename,
    folder: result.folder,
    sizeBytes: result.sizeBytes,
    extension: result.extension,
    isLocked: result.isLocked,
    ownedMatchCount: countOwnedMatches(result, library)
  };
}

function dedupeDiscoveryResults(results: DiscoveryResult[]): DiscoveryResult[] {
  const seen = new Set<string>();
  const deduped: DiscoveryResult[] = [];
  for (const result of results) {
    if (seen.has(result.id)) {
      continue;
    }
    seen.add(result.id);
    deduped.push(result);
  }
  return deduped;
}

function groupAgentDiscoveryResults(results: DiscoveryResult[], library: LibraryRepository): AgentDiscoveryGroup[] {
  const groups = new Map<string, DiscoveryResult[]>();
  for (const result of results) {
    const release = inferDiscoveryRelease(result);
    const key = `${normalizeDiscoveryText(release.artist ?? "")}\u0000${normalizeDiscoveryText(release.title)}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return [...groups.values()]
    .map((groupResults) => {
      const release = inferDiscoveryRelease(groupResults[0]!);
      const mapped = groupResults.slice(0, 8).map((result) => mapAgentDiscoveryResult(result, library));
      const ownedMatchCount = mapped.reduce((total, result) => total + result.ownedMatchCount, 0);
      const formats = groupResults
        .map((result) => result.extension?.toUpperCase())
        .filter((format): format is string => Boolean(format));
      return {
        releaseArtist: release.artist,
        releaseTitle: release.title,
        sourceCount: new Set(groupResults.map((result) => `${result.username ?? "unknown"}\u0000${result.folder ?? result.path}`)).size,
        fileCount: groupResults.length,
        unlockedCount: groupResults.filter((result) => !result.isLocked).length,
        bestFormat: bestDiscoveryFormat(formats),
        ownedMatchCount,
        results: mapped
      };
    })
    .sort((a, b) => {
      if (b.unlockedCount !== a.unlockedCount) {
        return b.unlockedCount - a.unlockedCount;
      }
      if (b.fileCount !== a.fileCount) {
        return b.fileCount - a.fileCount;
      }
      return a.releaseTitle.localeCompare(b.releaseTitle);
    });
}

function selectDiscoveryReleasePlaylistResults(results: DiscoveryResult[]): DiscoveryReleasePlaylistSelection | null {
  const unlockedAudio = results.filter((result) => !result.isLocked && isAudioDiscoveryResult(result));
  if (unlockedAudio.length === 0) {
    return null;
  }

  const releaseGroups = new Map<string, DiscoveryResult[]>();
  for (const result of unlockedAudio) {
    const release = inferDiscoveryRelease(result);
    const key = `${normalizeDiscoveryText(release.artist ?? "")}\u0000${normalizeDiscoveryText(release.title)}`;
    releaseGroups.set(key, [...(releaseGroups.get(key) ?? []), result]);
  }

  const bestRelease = [...releaseGroups.values()].sort((left, right) => releaseResultScore(right) - releaseResultScore(left))[0];
  if (!bestRelease) {
    return null;
  }

  const sourceGroups = new Map<string, DiscoveryResult[]>();
  for (const result of bestRelease) {
    const key = `${result.username ?? "unknown"}\u0000${result.folder ?? result.path}`;
    sourceGroups.set(key, [...(sourceGroups.get(key) ?? []), result]);
  }
  const selectedSource = [...sourceGroups.values()].sort((left, right) => releaseResultScore(right) - releaseResultScore(left))[0] ?? bestRelease;
  const selected = sortDiscoveryTracks(selectedSource).slice(0, 40);
  const release = inferDiscoveryRelease(selected[0] ?? bestRelease[0]!);
  return {
    name: [release.artist, release.title].filter(Boolean).join(" - ") || release.title,
    results: selected
  };
}

function releaseResultScore(results: DiscoveryResult[]): number {
  return (
    results.length * 1000 +
    results.filter((result) => losslessFormats.has((result.extension ?? "").toLowerCase())).length * 100 +
    results.filter((result) => result.hasFreeUploadSlot === true).length * 10 -
    Math.min(...results.map((result) => result.queueLength ?? 0))
  );
}

function sortDiscoveryTracks(results: DiscoveryResult[]): DiscoveryResult[] {
  return [...results].sort((left, right) => discoveryTrackNumber(left) - discoveryTrackNumber(right) || left.filename.localeCompare(right.filename));
}

function discoveryTrackNumber(result: DiscoveryResult): number {
  const value = [result.filename, result.path].join(" ");
  const match = value.match(/(?:^|[\\/ ])(?:disc\s*)?\d{0,2}\s*[-_. ]\s*(\d{1,3})(?=\s*[-_. ])/i) ?? value.match(/(?:^|[\\/ ])(\d{1,3})\s*[-_. ]/);
  const parsed = Number(match?.[1]);
  return Number.isFinite(parsed) ? parsed : 9999;
}

function isAudioDiscoveryResult(result: DiscoveryResult): boolean {
  const extension = (result.extension ?? result.filename.split(".").pop() ?? "").toLowerCase();
  return audioDiscoveryExtensions.has(extension);
}

const audioDiscoveryExtensions = new Set(["aac", "aiff", "aif", "alac", "ape", "dsf", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"]);

function inferDiscoveryRelease(result: DiscoveryResult): { artist: string | null; title: string } {
  const folderParts = result.folder?.split(/[\\/]+/).filter(Boolean) ?? [];
  const folderLabel = cleanDiscoveryText(folderParts.at(-1) ?? "");
  const parentLabel = cleanDiscoveryText(folderParts.at(-2) ?? "");
  const folderRelease = parseDiscoveryArtistTitle(folderLabel);
  if (folderRelease) {
    return folderRelease;
  }

  const fileRelease = parseDiscoveryArtistTitle(stripDiscoveryTrackPrefix(result.filename.replace(/\.[^.]+$/, "")));
  return {
    artist: parentLabel && isLikelyDiscoveryArtistFolder(parentLabel) ? parentLabel : fileRelease?.artist ?? null,
    title: folderLabel || fileRelease?.title || result.filename
  };
}

function parseDiscoveryArtistTitle(value: string): { artist: string; title: string } | null {
  const match = cleanDiscoveryText(value).match(/^(.+?)\s+-\s+(.+)$/);
  const artist = cleanDiscoveryText(match?.[1] ?? "");
  const title = cleanDiscoveryText(match?.[2] ?? "");
  return artist && title ? { artist, title } : null;
}

function bestDiscoveryFormat(formats: string[]): string | null {
  if (formats.length === 0) {
    return null;
  }
  const priority = ["FLAC", "ALAC", "WAV", "AIFF", "AIF", "APE", "WV", "MP3", "M4A", "AAC", "OGG"];
  return [...new Set(formats)].sort((a, b) => {
    const left = priority.indexOf(a);
    const right = priority.indexOf(b);
    return (left === -1 ? 999 : left) - (right === -1 ? 999 : right) || a.localeCompare(b);
  })[0] ?? null;
}

function stripDiscoveryTrackPrefix(value: string): string {
  return value.replace(/^\s*(?:cd\s*\d+\s*)?(?:\d{1,3}[-._\s]+)+/i, "").trim();
}

function cleanDiscoveryText(value: string): string {
  return value
    .replace(/\[[^\]]*(?:flac|mp3|aac|m4a|v0|v2|320|256|192|kbps|lossless|web|cd|vinyl|scene)[^\]]*\]/gi, "")
    .replace(/\([^\)]*(?:flac|mp3|aac|m4a|v0|v2|320|256|192|kbps|lossless|web|cd|vinyl|scene)[^\)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDiscoveryText(value: string): string {
  return cleanDiscoveryText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyDiscoveryArtistFolder(value: string): boolean {
  return Boolean(value) && !/\b(album|music|remote|uploads?|downloads?|shared?|users?|discography|complete|flac|mp3|lossless)\b/i.test(value);
}

function mapAgentImportResult(item: ImportItem): AgentImportResult {
  return {
    importItemId: item.id,
    importId: item.importId,
    title: item.detectedTitle,
    artist: item.detectedArtist,
    album: item.detectedAlbum,
    year: item.detectedYear,
    status: item.status,
    duplicateCount: item.duplicateCandidates.length,
    confidenceScore: item.confidenceScore
  };
}

function filterImportItems(items: ImportItem[], searchQuery: string): ImportItem[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return items;
  }
  return items.filter((item) => importSearchText(item).includes(query));
}

function importSearchText(item: ImportItem): string {
  return [
    item.detectedArtist,
    item.detectedAlbum,
    item.detectedTitle,
    item.detectedYear?.toString(),
    item.stagingPath,
    item.proposedDestination
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function emptyImportResponse(searchQuery: string, reply: string): AgentMessageResponse {
  return {
    reply,
    intent: "propose_import",
    searchQuery,
    results: [],
    discoveryResults: [],
    parsedListItems: [],
    importResults: [],
    operationBatch: null,
    playback: null
  };
}

function countOwnedMatches(result: DiscoveryResult, library: LibraryRepository): number {
  const candidates = discoverySearchTerms(result);
  const matches = new Set<string>();
  for (const term of candidates) {
    for (const file of library.listFiles(term).slice(0, 10)) {
      matches.add(file.id);
    }
  }
  return matches.size;
}

function discoverySearchTerms(result: DiscoveryResult): string[] {
  const basename = result.filename.replace(/\.[^.]+$/, "");
  const withoutTrackNumber = basename.replace(/^\s*\d{1,3}\s*[-_. ]+\s*/, "");
  return [...new Set([withoutTrackNumber, basename].filter((value): value is string => Boolean(value?.trim())))];
}

type ParsedListBase = Omit<AgentParsedListItem, "ownedMatchCount">;

function looksLikePastedList(message: string): boolean {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (/\b(parse|pasted|rym|rateyourmusic|chart)\b/i.test(message) && lines.length >= 2) {
    return true;
  }
  return lines.filter((line) => parseListLine(line) != null).length >= 2;
}

function parsePastedList(message: string): ParsedListBase[] {
  return message
    .split(/\r?\n/)
    .map(parseListLine)
    .filter((item): item is ParsedListBase => item != null)
    .slice(0, 50);
}

function parseListLine(line: string): ParsedListBase | null {
  let value = line.trim();
  if (!value) {
    return null;
  }
  value = value.replace(/^[-*•]\s+/, "");

  let rank: number | null = null;
  const rankMatch = value.match(/^#?(\d{1,4})[\).:\-\s]+(.+)$/);
  if (rankMatch) {
    rank = Number.parseInt(rankMatch[1], 10);
    value = rankMatch[2].trim();
  }

  const yearMatch = value.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch?.[1] ?? null;
  value = value.replace(/\s*[\[(]?(?:19\d{2}|20\d{2})[\])]?\s*$/u, "").trim();

  const split = splitArtistTitle(value);
  const title = cleanListToken(split.title);
  const artist = split.artist ? cleanListToken(split.artist) : null;
  if (!title || title.length < 2 || isListInstruction(title)) {
    return null;
  }
  const query = [artist, title, year].filter(Boolean).join(" ");
  return { rank, artist, title, year, query };
}

function splitArtistTitle(value: string): { artist: string | null; title: string } {
  const separators = [" - ", " – ", " — ", " by "];
  for (const separator of separators) {
    const index = value.toLowerCase().indexOf(separator.trim() === "by" ? " by " : separator);
    if (index > 0) {
      return {
        artist: value.slice(0, index),
        title: value.slice(index + separator.length)
      };
    }
  }
  return { artist: null, title: value };
}

function cleanListToken(value: string): string {
  return value
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+[-–—:]+$/u, "")
    .trim();
}

function isListInstruction(value: string): boolean {
  return /\b(parse|pasted|rym|rateyourmusic|chart|list)\b/i.test(value) && value.split(/\s+/).length <= 6;
}

function countParsedListOwnedMatches(item: ParsedListBase, library: LibraryRepository): number {
  const terms = [...new Set([item.query, [item.artist, item.title].filter(Boolean).join(" "), item.title].filter(Boolean))];
  const matches = new Set<string>();
  for (const term of terms) {
    for (const file of library.listFiles(term).slice(0, 10)) {
      matches.add(file.id);
    }
  }
  return matches.size;
}
