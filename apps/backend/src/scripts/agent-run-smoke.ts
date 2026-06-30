import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { agentPlaylistWorkflowsResponseSchema, type AgentStep, type DiscoveryResult, type DiscoverySearchResponse } from "@music-os/core";
import type { BackendApp } from "../app.js";
import { createBackendApp } from "../app.js";
import { AgentService } from "../services/agent-service.js";
import { AgentRunService } from "../services/agent-run-service.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-agent-run-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
let app: BackendApp | null = null;

try {
  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const agentImportRootPath = join(fixtureDir, "agent-import-root");
  await mkdir(agentImportRootPath, { recursive: true });
  const agentImportRoot = app.library.addRoot(agentImportRootPath, "agent-import-root");
  const searchCalls: string[] = [];
  const agent = new AgentService(app.library, app.operations, app.playback, {
    async search(query: string): Promise<DiscoverySearchResponse> {
      searchCalls.push(query);
      if (query === "antifragile" || query === "impurities") {
        return {
          query,
          total: query === "antifragile" ? 2 : 1,
          results: [
            {
              id: `${query}-remote-one`,
              source: "slskd",
              username: "remote-user",
              filename: query === "antifragile" ? "01 - ANTIFRAGILE.flac" : "02 - Impurities.flac",
              path: query === "antifragile" ? "LE SSERAFIM/ANTIFRAGILE/01 - ANTIFRAGILE.flac" : "LE SSERAFIM/ANTIFRAGILE/02 - Impurities.flac",
              folder: "LE SSERAFIM/ANTIFRAGILE",
              sizeBytes: 42_000_000,
              extension: "flac",
              bitrate: 920_000,
              sampleRate: 44_100,
              lengthSeconds: 184,
              isLocked: false,
              hasFreeUploadSlot: true,
              uploadSpeedBytesPerSecond: 2_000_000,
              queueLength: 0,
              raw: {}
            },
            ...(query === "antifragile"
              ? [
                  {
                    id: "antifragile-remote-two",
                    source: "slskd" as const,
                    username: "remote-user",
                    filename: "02 - Impurities.flac",
                    path: "LE SSERAFIM/ANTIFRAGILE/02 - Impurities.flac",
                    folder: "LE SSERAFIM/ANTIFRAGILE",
                    sizeBytes: 39_000_000,
                    extension: "flac",
                    bitrate: 900_000,
                    sampleRate: 44_100,
                    lengthSeconds: 196,
                    isLocked: false,
                    hasFreeUploadSlot: true,
                    uploadSpeedBytesPerSecond: 2_000_000,
                    queueLength: 0,
                    raw: {}
                  }
                ]
              : [])
          ]
        };
      }
      return { query, total: 0, results: [] };
    }
  });
  const runs = new AgentRunService(app.db, agent, undefined, {
    name: "fixture_metadata",
    async lookup(message) {
      return message.includes("le sserafim")
        ? {
            summary: "Fixture metadata found title-only fallback",
            queryHints: ["antifragile"]
          }
        : null;
    }
  });
  const run = await runs.run("propose download le sserafim antifragile");

  assert(run.status === "completed", `expected completed run, got ${run.status}`);
  assert(run.response?.intent === "search_discovery", `expected search_discovery intent, got ${run.response?.intent}`);
  assert(run.response.operationBatch != null, "expected reviewable download operation batch");
  assert(run.response.operationBatch.status === "proposed", `expected proposed batch, got ${run.response.operationBatch.status}`);
  assert(searchCalls.includes("le sserafim antifragile"), "expected original query attempt");
  assert(searchCalls.includes("antifragile"), "expected title-only fallback query attempt");
  assert(
    run.steps.some((step: AgentStep) => step.toolName === "fixture_metadata" && step.output && (step.output as { queryHints?: string[] }).queryHints?.includes("antifragile")),
    "expected traced metadata lookup hints"
  );
  assert(
    run.steps.some((step: AgentStep) => step.toolName === "search_soulseek" && step.output && (step.output as { resultCount?: number }).resultCount === 0),
    "expected traced empty search step"
  );
  assert(
    run.steps.some((step: AgentStep) => step.toolName === "search_soulseek" && step.output && (step.output as { resultCount?: number }).resultCount === 2),
    "expected traced successful fallback search step"
  );
  assert(
    run.steps.some((step: AgentStep) => step.type === "approval" && step.toolName === "propose_queue_download"),
    "expected approval-gated queue download proposal step"
  );

  const restored = runs.getRun(run.id);
  assert(restored.steps.length === run.steps.length, "expected run steps to persist");
  assert(restored.response?.operationBatch?.id === run.response.operationBatch.id, "expected response payload to persist");
  assert(restored.threadId != null, "expected run to attach to an agent thread");
  const threadMessages = app.agentThreads.getThread(restored.threadId).messages;
  assert(threadMessages.length === 2, `expected user+agent thread messages, got ${threadMessages.length}`);
  assert(threadMessages[1]?.response?.runId === run.id, "expected persisted agent message response to include run id");

  const modelSearchCalls: string[] = [];
  const modelAgent = new AgentService(app.library, app.operations, app.playback, {
    async search(query: string): Promise<DiscoverySearchResponse> {
      modelSearchCalls.push(query);
      return query === "impurities"
        ? {
            query,
            total: 1,
            results: [
              {
                id: "model-hint-result",
                source: "slskd",
                username: "remote-user",
                filename: "02 - Impurities.flac",
                path: "LE SSERAFIM/ANTIFRAGILE/02 - Impurities.flac",
                folder: "LE SSERAFIM/ANTIFRAGILE",
                sizeBytes: 39_000_000,
                extension: "flac",
                bitrate: 900_000,
                sampleRate: 44_100,
                lengthSeconds: 196,
                isLocked: false,
                hasFreeUploadSlot: true,
                uploadSpeedBytesPerSecond: 2_000_000,
                queueLength: 0,
                raw: {}
              }
            ]
          }
        : { query, total: 0, results: [] };
    }
  });
  const modelRuns = new AgentRunService(
    app.db,
    modelAgent,
    {
      name: "fixture_model",
      async plan() {
        return {
          summary: "Fixture model generated a track-title fallback",
          searchQueryHints: ["impurities"]
        };
      }
    },
    undefined,
    app.agentPlaylistWorkflows
  );
  const modelRun = await modelRuns.run("propose download blocked idol group hidden album");
  assert(modelSearchCalls.includes("impurities"), "expected model-provided query hint to be searched");
  assert(modelRun.response?.operationBatch != null, "expected model-hint run to create a reviewable download batch");
  assert(
    modelRun.steps.some((step: AgentStep) => step.toolName === "model:fixture_model" && step.output && (step.output as { searchQueryHints?: string[] }).searchQueryHints?.includes("impurities")),
    "expected traced model planning hints"
  );

  const modelIntentSearchCalls: string[] = [];
  const modelIntentAgent = new AgentService(app.library, app.operations, app.playback, {
    async search(query: string): Promise<DiscoverySearchResponse> {
      modelIntentSearchCalls.push(query);
      return query === "daft punk"
        ? {
            query,
            total: 1,
            results: [
              {
                id: "daft-punk-result",
                source: "slskd",
                username: "remote-user",
                filename: "01 - One More Time.flac",
                path: "Daft Punk/Discovery/01 - One More Time.flac",
                folder: "Daft Punk/Discovery",
                sizeBytes: 45_000_000,
                extension: "flac",
                bitrate: 950_000,
                sampleRate: 44_100,
                lengthSeconds: 320,
                isLocked: false,
                hasFreeUploadSlot: true,
                uploadSpeedBytesPerSecond: 2_000_000,
                queueLength: 0,
                raw: {}
              }
            ]
          }
        : { query, total: 0, results: [] };
    }
  });
  const modelIntentRuns = new AgentRunService(
    app.db,
    modelIntentAgent,
    {
      name: "fixture_model",
      async plan() {
        return {
          summary: "Fixture model recognized an external Discovery request",
          searchQueryHints: ["discovery", "random access memories"]
        };
      }
    },
    undefined,
    app.agentPlaylistWorkflows
  );
  const modelIntentRun = await modelIntentRuns.run("find a daft punk song here");
  assert(modelIntentRun.response?.intent === "search_discovery", `expected model intent to route Discovery, got ${modelIntentRun.response?.intent}`);
  assert(modelIntentRun.response?.searchQuery === "daft punk", `expected cleaned model search query, got ${modelIntentRun.response?.searchQuery}`);
  assert(modelIntentSearchCalls[0] === "daft punk", `expected cleaned model query first, got ${modelIntentSearchCalls[0]}`);
  assert(!modelIntentSearchCalls.includes("daft punk song here"), "did not expect literal filler query to be searched");

  const researchPlaylistSearchCalls: string[] = [];
  const researchPlaylistAgent = new AgentService(app.library, app.operations, app.playback, {
    async search(query: string): Promise<DiscoverySearchResponse> {
      researchPlaylistSearchCalls.push(query);
      if (query === "air la femme d'argent" || query === "boards of canada roygbiv") {
        return {
          query,
          total: 1,
          results: [
            {
              id: `${query}-result`,
              source: "slskd",
              username: "remote-user",
              filename: query === "air la femme d'argent" ? "01 - La femme d'argent.flac" : "06 - Roygbiv.flac",
              path: query === "air la femme d'argent" ? "Air/Moon Safari/01 - La femme d'argent.flac" : "Boards of Canada/Music Has the Right to Children/06 - Roygbiv.flac",
              folder: query === "air la femme d'argent" ? "Air/Moon Safari" : "Boards of Canada/Music Has the Right to Children",
              sizeBytes: 42_000_000,
              extension: "flac",
              bitrate: 900_000,
              sampleRate: 44_100,
              lengthSeconds: 420,
              isLocked: false,
              hasFreeUploadSlot: true,
              uploadSpeedBytesPerSecond: 2_000_000,
              queueLength: 0,
              raw: {}
            }
          ]
        };
      }
      return { query, total: 0, results: [] };
    }
  });
  const researchPlaylistRuns = new AgentRunService(
    app.db,
    researchPlaylistAgent,
    {
      name: "fixture_model",
      async plan() {
        return {
          summary: "Fixture model researched a late-night electronic playlist",
          intent: "research_playlist",
          searchQuery: "late night electronic",
          playlistName: "Late Night Electronic",
          playlistDescription: "Downtempo electronic recommendations from the fixture model.",
          researchSources: [
            {
              title: "Fixture Reddit downtempo thread",
              url: "https://www.reddit.com/r/ifyoulikeblank/example",
              summary: "Fixture discussion source for late-night electronic recommendations."
            }
          ],
          searchQueryHints: [],
          trackCandidates: [
            { artist: "Air", title: "La femme d'argent", album: "Moon Safari", query: "air la femme d'argent" },
            { artist: "Boards of Canada", title: "Roygbiv", album: "Music Has the Right to Children", query: "boards of canada roygbiv" }
          ]
        };
      }
    },
    undefined,
    app.agentPlaylistWorkflows
  );
  const researchPlaylistRun = await researchPlaylistRuns.run("make me a playlist of songs for a late night electronic mood");
  assert(researchPlaylistRun.response?.intent === "research_playlist", `expected research_playlist intent, got ${researchPlaylistRun.response?.intent}`);
  assert(researchPlaylistRun.response?.discoveryResults.length === 2, "expected researched playlist to find two Discovery candidates");
  assert(researchPlaylistRun.response?.researchSources?.[0]?.url === "https://www.reddit.com/r/ifyoulikeblank/example", "expected research source to be preserved");
  assert(researchPlaylistRun.response?.operationBatch?.operations.some((operation) => operation.type === "queue_download") === true, "expected researched playlist to propose queue_download");
  const researchQueueOperation = researchPlaylistRun.response?.operationBatch?.operations.find((operation) => operation.type === "queue_download");
  assert(
    (researchQueueOperation?.payload as { libraryRootId?: string } | undefined)?.libraryRootId === agentImportRoot.id,
    "expected researched playlist queue_download to carry the default library root"
  );
  assert(researchPlaylistSearchCalls.includes("air la femme d'argent"), "expected first candidate query");
  assert(researchPlaylistSearchCalls.includes("boards of canada roygbiv"), "expected second candidate query");
  const researchWorkflow = app.db
    .prepare("SELECT * FROM agent_playlist_workflows WHERE run_id = ?")
    .get(researchPlaylistRun.id) as { status: string; playlist_name: string } | undefined;
  assert(researchWorkflow?.status === "waiting_for_batch", `expected registered playlist workflow, got ${researchWorkflow?.status}`);
  assert(researchWorkflow.playlist_name === "Late Night Electronic", `expected workflow playlist name, got ${researchWorkflow.playlist_name}`);
  const workflowResponse = agentPlaylistWorkflowsResponseSchema.parse({
    workflows: app.agentPlaylistWorkflows.listWorkflows()
  });
  assert(workflowResponse.workflows.some((workflow) => workflow.runId === researchPlaylistRun.id), "expected workflow to parse through public schema");

  const broadCandidateSearchCalls: string[] = [];
  const broadCandidateRun = await new AgentRunService(
    app.db,
    new AgentService(app.library, app.operations, app.playback, {
      async search(query: string): Promise<DiscoverySearchResponse> {
        broadCandidateSearchCalls.push(query);
        return query === "deep artist 15 late candidate 15"
          ? {
              query,
              total: 1,
              results: [
                {
                  id: "late-candidate-15-result",
                  source: "slskd",
                  username: "deep-user",
                  filename: "15 - Late Candidate 15.flac",
                  path: "Deep Artist 15/Deep Album/15 - Late Candidate 15.flac",
                  folder: "Deep Artist 15/Deep Album",
                  sizeBytes: 44_000_000,
                  extension: "flac",
                  bitrate: 920_000,
                  sampleRate: 44_100,
                  lengthSeconds: 245,
                  isLocked: false,
                  hasFreeUploadSlot: true,
                  uploadSpeedBytesPerSecond: 1_500_000,
                  queueLength: 0,
                  raw: {}
                }
              ]
            }
          : { query, total: 0, results: [] };
      }
    }),
    {
      name: "fixture_model",
      async plan() {
        return {
          summary: "Fixture model returned a full slate of researched candidates",
          intent: "research_playlist",
          playlistName: "Broad Candidate Search",
          playlistDescription: "Verifies late researched candidates are still searched.",
          searchQueryHints: [],
          trackCandidates: Array.from({ length: 15 }, (_, index) => {
            const number = index + 1;
            return {
              artist: `Deep Artist ${number}`,
              title: `Late Candidate ${number}`,
              album: "Deep Album",
              query: `deep artist ${number} late candidate ${number}`
            };
          })
        };
      }
    },
    undefined,
    app.agentPlaylistWorkflows
  ).run("make me a playlist for late candidate coverage");
  assert(
    broadCandidateSearchCalls.includes("deep artist 15 late candidate 15"),
    `expected researched playlist search to continue through the full model candidate set, got ${JSON.stringify(broadCandidateSearchCalls)}`
  );
  assert(
    broadCandidateRun.response?.discoveryResults[0]?.discoveryId === "late-candidate-15-result",
    "expected late searched candidate to be selected for the playlist"
  );

  const orderedCandidateRun = await new AgentRunService(
    app.db,
    new AgentService(app.library, app.operations, app.playback, {
      async search(query: string): Promise<DiscoverySearchResponse> {
        if (query === "order artist first song") {
          return {
            query,
            total: 1,
            results: [
              {
                id: "ordered-first-mp3",
                source: "slskd",
                username: "order-user",
                filename: "01 - First Song.mp3",
                path: "Order Artist/Order Album/01 - First Song.mp3",
                folder: "Order Artist/Order Album",
                sizeBytes: 8_000_000,
                extension: "mp3",
                bitrate: 320_000,
                sampleRate: 44_100,
                lengthSeconds: 210,
                isLocked: false,
                hasFreeUploadSlot: true,
                uploadSpeedBytesPerSecond: 1_000_000,
                queueLength: 0,
                raw: {}
              }
            ]
          };
        }
        if (query === "order artist second song") {
          return {
            query,
            total: 1,
            results: [
              {
                id: "ordered-second-flac",
                source: "slskd",
                username: "order-user",
                filename: "02 - Second Song.flac",
                path: "Order Artist/Order Album/02 - Second Song.flac",
                folder: "Order Artist/Order Album",
                sizeBytes: 42_000_000,
                extension: "flac",
                bitrate: 920_000,
                sampleRate: 44_100,
                lengthSeconds: 240,
                isLocked: false,
                hasFreeUploadSlot: true,
                uploadSpeedBytesPerSecond: 1_000_000,
                queueLength: 0,
                raw: {}
              }
            ]
          };
        }
        return { query, total: 0, results: [] };
      }
    }),
    {
      name: "fixture_model",
      async plan() {
        return {
          summary: "Fixture model returned a deliberately ordered playlist",
          intent: "research_playlist",
          playlistName: "Ordered Candidate Playlist",
          searchQueryHints: [],
          trackCandidates: [
            { artist: "Order Artist", title: "First Song", album: "Order Album", query: "order artist first song" },
            { artist: "Order Artist", title: "Second Song", album: "Order Album", query: "order artist second song" }
          ]
        };
      }
    },
    undefined,
    app.agentPlaylistWorkflows
  ).run("make me an ordered researched playlist");
  assert(
    orderedCandidateRun.response?.discoveryResults.map((result) => result.discoveryId).join(",") === "ordered-first-mp3,ordered-second-flac",
    `expected researched playlist to preserve model candidate order, got ${orderedCandidateRun.response?.discoveryResults.map((result) => result.discoveryId).join(",")}`
  );
  const orderedQueueOperation = orderedCandidateRun.response?.operationBatch?.operations.find((operation) => operation.type === "queue_download");
  assert(orderedQueueOperation != null, "expected ordered candidate run to create a queue_download operation");
  assert(
    (orderedQueueOperation.payload as { results?: DiscoveryResult[] }).results?.map((result) => result.id).join(",") === "ordered-first-mp3,ordered-second-flac",
    "expected queued downloads to preserve researched playlist order"
  );

  const previousSearchConcurrency = process.env.MUSIC_OS_AGENT_RESEARCH_PLAYLIST_SEARCH_CONCURRENCY;
  const previousCandidateSearchLimit = process.env.MUSIC_OS_AGENT_RESEARCH_PLAYLIST_CANDIDATE_SEARCH_LIMIT;
  process.env.MUSIC_OS_AGENT_RESEARCH_PLAYLIST_SEARCH_CONCURRENCY = "2";
  process.env.MUSIC_OS_AGENT_RESEARCH_PLAYLIST_CANDIDATE_SEARCH_LIMIT = "4";
  let activeSearches = 0;
  let maxActiveSearches = 0;
  try {
    const parallelCandidateRun = await new AgentRunService(
      app.db,
      new AgentService(app.library, app.operations, app.playback, {
        async search(query: string): Promise<DiscoverySearchResponse> {
          activeSearches += 1;
          maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
          await delay(25);
          activeSearches -= 1;
          const match = query.match(/^parallel artist (\d+) parallel song \d+$/);
          if (!match) {
            return { query, total: 0, results: [] };
          }
          const number = match[1]!;
          return {
            query,
            total: 1,
            results: [
              {
                id: `parallel-${number}`,
                source: "slskd",
                username: "parallel-user",
                filename: `${number.padStart(2, "0")} - Parallel Song ${number}.flac`,
                path: `Parallel Artist ${number}/Parallel Album/${number.padStart(2, "0")} - Parallel Song ${number}.flac`,
                folder: `Parallel Artist ${number}/Parallel Album`,
                sizeBytes: 30_000_000 + Number(number),
                extension: "flac",
                bitrate: 900_000,
                sampleRate: 44_100,
                lengthSeconds: 200 + Number(number),
                isLocked: false,
                hasFreeUploadSlot: true,
                uploadSpeedBytesPerSecond: 1_250_000,
                queueLength: 0,
                raw: {}
              }
            ]
          };
        }
      }),
      {
        name: "fixture_model",
        async plan() {
          return {
            summary: "Fixture model returned candidates that should be searched concurrently",
            intent: "research_playlist",
            playlistName: "Parallel Candidate Playlist",
            searchQueryHints: [],
            trackCandidates: Array.from({ length: 4 }, (_, index) => {
              const number = index + 1;
              return {
                artist: `Parallel Artist ${number}`,
                title: `Parallel Song ${number}`,
                album: "Parallel Album",
                query: `parallel artist ${number} parallel song ${number}`
              };
            })
          };
        }
      },
      undefined,
      app.agentPlaylistWorkflows
    ).run("make me a researched playlist without serial soulseek stalls");
    const parallelLibraryStep = parallelCandidateRun.steps.find((step) => step.toolName === "search_library");
    const parallelMissingCount =
      typeof parallelLibraryStep?.output === "object" &&
      parallelLibraryStep.output != null &&
      Array.isArray((parallelLibraryStep.output as { missing?: unknown }).missing)
        ? (parallelLibraryStep.output as { missing: unknown[] }).missing.length
        : 0;
    assert(
      parallelMissingCount === 4,
      `expected four missing parallel candidates to reach Soulseek search, got ${parallelMissingCount}`
    );
    assert(maxActiveSearches > 1, `expected researched playlist searches to overlap, max active was ${maxActiveSearches}`);
    assert(
      parallelCandidateRun.response?.discoveryResults.map((result) => result.discoveryId).join(",") === "parallel-1,parallel-2,parallel-3,parallel-4",
      `expected parallel candidate search to preserve playlist order, got ${parallelCandidateRun.response?.discoveryResults.map((result) => result.discoveryId).join(",")}`
    );
  } finally {
    if (previousSearchConcurrency === undefined) {
      delete process.env.MUSIC_OS_AGENT_RESEARCH_PLAYLIST_SEARCH_CONCURRENCY;
    } else {
      process.env.MUSIC_OS_AGENT_RESEARCH_PLAYLIST_SEARCH_CONCURRENCY = previousSearchConcurrency;
    }
    if (previousCandidateSearchLimit === undefined) {
      delete process.env.MUSIC_OS_AGENT_RESEARCH_PLAYLIST_CANDIDATE_SEARCH_LIMIT;
    } else {
      process.env.MUSIC_OS_AGENT_RESEARCH_PLAYLIST_CANDIDATE_SEARCH_LIMIT = previousCandidateSearchLimit;
    }
  }

  const titleOnlyFallbackCalls: string[] = [];
  const titleOnlyFallbackRun = await new AgentRunService(
    app.db,
    new AgentService(app.library, app.operations, app.playback, {
      async search(query: string): Promise<DiscoverySearchResponse> {
        titleOnlyFallbackCalls.push(query);
        return query === "unblacklistable title"
          ? {
              query,
              total: 1,
              results: [
                {
                  id: "title-only-result",
                  source: "slskd",
                  username: "fallback-user",
                  filename: "07 - Unblacklistable Title.flac",
                  path: "Incoming/07 - Unblacklistable Title.flac",
                  folder: "Incoming",
                  sizeBytes: 36_000_000,
                  extension: "flac",
                  bitrate: 880_000,
                  sampleRate: 44_100,
                  lengthSeconds: 194,
                  isLocked: false,
                  hasFreeUploadSlot: true,
                  uploadSpeedBytesPerSecond: 1_500_000,
                  queueLength: 0,
                  raw: {}
                }
              ]
            }
          : { query, total: 0, results: [] };
      }
    }),
    {
      name: "fixture_model",
      async plan() {
        return {
          summary: "Fixture model supplied a candidate whose artist queries are suppressed upstream",
          intent: "research_playlist",
          playlistName: "Title Fallback",
          searchQueryHints: [],
          trackCandidates: [{ artist: "Suppressed Artist", title: "Unblacklistable Title", album: "Suppressed Album" }]
        };
      }
    },
    undefined,
    app.agentPlaylistWorkflows
  ).run("make me a playlist with a suppressed artist fallback");
  assert(titleOnlyFallbackCalls.includes("unblacklistable title"), "expected title-only fallback query to be attempted");
  assert(
    titleOnlyFallbackRun.response?.discoveryResults[0]?.discoveryId === "title-only-result",
    "expected title-only fallback result to be accepted when artist is absent from the path"
  );

  const albumTitleFallbackCalls: string[] = [];
  const albumTitleFallbackRun = await new AgentRunService(
    app.db,
    new AgentService(app.library, app.operations, app.playback, {
      async search(query: string): Promise<DiscoverySearchResponse> {
        albumTitleFallbackCalls.push(query);
        return query === "dookie when i come around"
          ? {
              query,
              total: 1,
              results: [
                {
                  id: "album-title-fallback-result",
                  source: "slskd",
                  username: "album-fallback-user",
                  filename: "07 - When I Come Around.flac",
                  path: "Green Day/Dookie/07 - When I Come Around.flac",
                  folder: "Green Day/Dookie",
                  sizeBytes: 31_000_000,
                  extension: "flac",
                  bitrate: 890_000,
                  sampleRate: 44_100,
                  lengthSeconds: 178,
                  isLocked: false,
                  hasFreeUploadSlot: true,
                  uploadSpeedBytesPerSecond: 1_700_000,
                  queueLength: 0,
                  raw: {}
                }
              ]
            }
          : { query, total: 0, results: [] };
      }
    }),
    {
      name: "fixture_model",
      async plan() {
        return {
          summary: "Fixture model supplied a candidate whose artist-title query needs album-title fallback",
          intent: "research_playlist",
          playlistName: "Album Fallback",
          searchQueryHints: [],
          trackCandidates: [{ artist: "Green Day", title: "When I Come Around", album: "Dookie", query: "green day when i come around" }]
        };
      }
    },
    undefined,
    app.agentPlaylistWorkflows
  ).run("make me a playlist with the green day song from dookie");
  assert(
    albumTitleFallbackCalls.includes("dookie when i come around"),
    `expected album-title fallback query to be attempted, got ${JSON.stringify(albumTitleFallbackCalls)}`
  );
  assert(
    albumTitleFallbackRun.response?.discoveryResults[0]?.discoveryId === "album-title-fallback-result",
    "expected album-title fallback result to be selected"
  );

  app.tasteProfile.updateProfile(
    {
      ...app.tasteProfile.getProfile().profile,
      preferredFormats: ["FLAC"],
      qualityPreferences: {
        preferLossless: true,
        allowMp3IfRare: false,
        minimumBitrateKbps: 900
      }
    },
    "fixture"
  );
  const qualityRuns = new AgentRunService(
    app.db,
    new AgentService(app.library, app.operations, app.playback, {
      async search(query: string): Promise<DiscoverySearchResponse> {
        return query === "quality artist quality song"
          ? {
              query,
              total: 2,
              results: [
                {
                  id: "quality-mp3",
                  source: "slskd",
                  username: "fast-user",
                  filename: "01 - Quality Song.mp3",
                  path: "Quality Artist/Quality Album/01 - Quality Song.mp3",
                  folder: "Quality Artist/Quality Album",
                  sizeBytes: 8_000_000,
                  extension: "mp3",
                  bitrate: 320_000,
                  sampleRate: 44_100,
                  lengthSeconds: 210,
                  isLocked: false,
                  hasFreeUploadSlot: true,
                  uploadSpeedBytesPerSecond: 5_000_000,
                  queueLength: 0,
                  raw: {}
                },
                {
                  id: "quality-flac",
                  source: "slskd",
                  username: "lossless-user",
                  filename: "01 - Quality Song.flac",
                  path: "Quality Artist/Quality Album/01 - Quality Song.flac",
                  folder: "Quality Artist/Quality Album",
                  sizeBytes: 42_000_000,
                  extension: "flac",
                  bitrate: 920_000,
                  sampleRate: 44_100,
                  lengthSeconds: 210,
                  isLocked: false,
                  hasFreeUploadSlot: false,
                  uploadSpeedBytesPerSecond: 400_000,
                  queueLength: 8,
                  raw: {}
                }
              ]
            }
          : { query, total: 0, results: [] };
      }
    }, undefined, app.tasteProfile),
    {
      name: "fixture_model",
      async plan() {
        return {
          summary: "Fixture model supplied a quality-sensitive candidate",
          intent: "research_playlist",
          playlistName: "Quality Preference",
          searchQueryHints: [],
          trackCandidates: [{ artist: "Quality Artist", title: "Quality Song", album: "Quality Album" }]
        };
      }
    },
    undefined,
    app.agentPlaylistWorkflows
  );
  const qualityRun = await qualityRuns.run("make me a high quality test playlist");
  assert(qualityRun.response?.discoveryResults[0]?.discoveryId === "quality-flac", "expected quality-aware selection to prefer FLAC over more available MP3");

  const versionRuns = new AgentRunService(
    app.db,
    new AgentService(app.library, app.operations, app.playback, {
      async search(query: string): Promise<DiscoverySearchResponse> {
        return query === "version artist plain song"
          ? {
              query,
              total: 2,
              results: [
                {
                  id: "version-exact-mp3",
                  source: "slskd",
                  username: "exact-user",
                  filename: "01 - Plain Song.mp3",
                  path: "Version Artist/Version Album/01 - Plain Song.mp3",
                  folder: "Version Artist/Version Album",
                  sizeBytes: 8_000_000,
                  extension: "mp3",
                  bitrate: 320_000,
                  sampleRate: 44_100,
                  lengthSeconds: 210,
                  isLocked: false,
                  hasFreeUploadSlot: true,
                  uploadSpeedBytesPerSecond: 1_000_000,
                  queueLength: 0,
                  raw: {}
                },
                {
                  id: "version-remix-flac",
                  source: "slskd",
                  username: "remix-user",
                  filename: "01 - Plain Song (Club Remix).flac",
                  path: "Version Artist/Version Album/01 - Plain Song (Club Remix).flac",
                  folder: "Version Artist/Version Album",
                  sizeBytes: 44_000_000,
                  extension: "flac",
                  bitrate: 920_000,
                  sampleRate: 44_100,
                  lengthSeconds: 230,
                  isLocked: false,
                  hasFreeUploadSlot: true,
                  uploadSpeedBytesPerSecond: 5_000_000,
                  queueLength: 0,
                  raw: {}
                }
              ]
            }
          : { query, total: 0, results: [] };
      }
    }, undefined, app.tasteProfile),
    {
      name: "fixture_model",
      async plan() {
        return {
          summary: "Fixture model supplied an exact-version candidate",
          intent: "research_playlist",
          playlistName: "Version Preference",
          searchQueryHints: [],
          trackCandidates: [{ artist: "Version Artist", title: "Plain Song", album: "Version Album" }]
        };
      }
    },
    undefined,
    app.agentPlaylistWorkflows
  );
  const versionRun = await versionRuns.run("make me a version-sensitive playlist");
  assert(
    versionRun.response?.discoveryResults[0]?.discoveryId === "version-exact-mp3",
    `expected exact song version to beat remix, got ${versionRun.response?.discoveryResults[0]?.discoveryId}`
  );

  const localRecommendationRun = await new AgentRunService(
    app.db,
    new AgentService(app.library, app.operations, app.playback, {
      async search(query: string): Promise<DiscoverySearchResponse> {
        return { query, total: 0, results: [] };
      }
    }),
    undefined,
    undefined,
    app.agentPlaylistWorkflows
  ).run("recommend songs like daft punk that you think i would like");
  assert(
    localRecommendationRun.response?.intent === "research_playlist",
    `expected natural recommendation prompt to route research_playlist, got ${localRecommendationRun.response?.intent}`
  );
  assert(
    localRecommendationRun.response.searchQuery === "daft punk",
    `expected recommendation filler words to be stripped, got ${localRecommendationRun.response.searchQuery}`
  );
  assert(
    localRecommendationRun.response.reply.includes("MUSIC_OS_AGENT_MODEL_PROVIDER=openai"),
    `expected missing hosted planner guidance, got ${localRecommendationRun.response.reply}`
  );

  const ownedLibraryPath = join(fixtureDir, "owned-library");
  await mkdir(ownedLibraryPath, { recursive: true });
  await writeFile(join(ownedLibraryPath, "durable-one.mp3"), makeId3Fixture("Durable One", "Durable Artist", "Durable Album", "1981"));
  await writeFile(join(ownedLibraryPath, "avoid-this.mp3"), makeId3Fixture("Avoid This", "Rejected Artist", "Rejected Album", "1982"));
  const ownedRoot = app.library.addRoot(ownedLibraryPath, "owned-agent-workflow");
  const ownedScan = await app.scanner.scanRoot(ownedRoot);
  assert(ownedScan.inserted === 2, `expected owned workflow fixture scan to insert two files, got ${ownedScan.inserted}`);
  const ownedPlaylistRuns = new AgentRunService(
    app.db,
    new AgentService(app.library, app.operations, app.playback, {
      async search(query: string): Promise<DiscoverySearchResponse> {
        return { query, total: 0, results: [] };
      }
    }),
    {
      name: "fixture_model",
      async plan() {
        return {
          summary: "Fixture model used an owned track for a playlist",
          intent: "research_playlist",
          searchQuery: "durable owned",
          playlistName: "Owned Durable",
          playlistDescription: "Owned-track workflow fixture.",
          searchQueryHints: [],
          trackCandidates: [{ artist: "Durable Artist", title: "Durable One", album: "Durable Album" }]
        };
      }
    },
    undefined,
    app.agentPlaylistWorkflows,
    true
  );
  const ownedPlaylistRun = await ownedPlaylistRuns.run("make me an owned durable playlist");
  const ownedWorkflow = app.agentPlaylistWorkflows.listWorkflows().find((workflow) => workflow.runId === ownedPlaylistRun.id);
  assert(ownedWorkflow != null, "expected owned workflow to be registered");
  assert(ownedPlaylistRun.response?.operationBatch != null, "expected owned playlist proposal batch");
  assert(
    ownedPlaylistRun.response.operationBatch.status === "applied",
    `expected owned playlist batch to auto-apply, got ${ownedPlaylistRun.response.operationBatch.status}`
  );
  const completedOwnedWorkflow = app.agentPlaylistWorkflows.listWorkflows().find((workflow) => workflow.runId === ownedPlaylistRun.id);
  assert(completedOwnedWorkflow?.status === "completed", `expected owned workflow completed, got ${completedOwnedWorkflow?.status}`);
  assert(
    completedOwnedWorkflow.playlistOperationBatchId === ownedPlaylistRun.response.operationBatch.id,
    "expected owned-only workflow to reuse the initial playlist batch"
  );
  const ownedThread = app.agentThreads.getThread(ownedPlaylistRun.threadId!);
  assert(
    ownedThread.messages.some((message) => message.role === "agent" && message.text.startsWith("Here's your playlist: Owned Durable.")),
    "expected completed workflow to add a final agent playlist message"
  );

  const currentFile = app.library.listFiles("durable one", 1)[0];
  assert(currentFile != null, "expected current playback fixture file");
  const dislikedFile = app.library.listFiles("avoid this", 1)[0];
  assert(dislikedFile != null, "expected disliked planning fixture file");
  app.library.setFileFavoriteStatus(dislikedFile.id, { liked: false, disliked: true });
  app.playbackHistory.recordEnded({
    fileId: dislikedFile.id,
    reason: "stop",
    positionMs: 1_000,
    durationMs: 180_000
  });
  app.tasteProfile.updateProfile(
    {
      ...app.tasteProfile.getProfile().profile,
      favoriteArtists: ["Durable Artist"],
      preferredGenres: ["sophisti-pop", "downtempo"],
      blockedArtists: ["Blocked Fixture Artist"],
      playlistStylePreferences: "Prefer deep cuts over obvious singles."
    },
    "fixture"
  );
  let sawCurrentTrackContext = false;
  let sawTasteProfileContext = false;
  let sawNegativeTasteContext = false;
  const currentContextRuns = new AgentRunService(
    app.db,
    new AgentService(
      app.library,
      app.operations,
      {
        getSnapshot() {
          return {
            status: "playing",
            currentFileId: currentFile.id,
            currentPath: currentFile.path,
            currentDisplayName: "Durable Artist - Durable One",
            positionMs: 0,
            durationMs: currentFile.durationMs,
            queue: [currentFile.id],
            queueIndex: 0,
            repeatMode: "none",
            volumePercent: 100,
            error: null
          };
        }
      } as never,
      {
        async search(query: string): Promise<DiscoverySearchResponse> {
          return { query, total: 0, results: [] };
        }
      },
      undefined,
      app.tasteProfile
    ),
    {
      name: "fixture_model",
      async plan(_message, context) {
        sawCurrentTrackContext = context?.currentTrack?.includes("Durable One") === true && context.currentArtist === "Durable Artist";
        sawTasteProfileContext =
          context?.tasteProfile?.preferredGenres?.includes("sophisti-pop") === true &&
          context.tasteProfile.blockedArtists?.includes("Blocked Fixture Artist") === true &&
          context.tasteProfile.playlistStylePreferences === "Prefer deep cuts over obvious singles.";
        sawNegativeTasteContext =
          context?.dislikedArtists?.includes("Rejected Artist") === true &&
          context.dislikedTracks?.some((track) => track.includes("Rejected Artist") && track.includes("Avoid This")) === true &&
          context.skippedTracks?.some((track) => track.includes("Rejected Artist") && track.includes("Avoid This")) === true;
        return {
          summary: "Fixture model used the current song context",
          intent: "research_playlist",
          playlistName: "Like Durable One",
          playlistDescription: "Current-song context fixture.",
          searchQueryHints: [],
          trackCandidates: [{ artist: "Durable Artist", title: "Durable One", album: "Durable Album" }]
        };
      }
    },
    undefined,
    app.agentPlaylistWorkflows
  );
  const currentContextRun = await currentContextRuns.run("make me a playlist like this song");
  assert(sawCurrentTrackContext, "expected model planning context to include current track metadata");
  assert(sawTasteProfileContext, "expected model planning context to include explicit taste profile");
  assert(sawNegativeTasteContext, "expected model planning context to include disliked and skipped track signals");
  assert(currentContextRun.response?.intent === "research_playlist", `expected current-song prompt to route research_playlist, got ${currentContextRun.response?.intent}`);
  assert(
    currentContextRun.response.searchQuery.includes("durable artist") && currentContextRun.response.searchQuery.includes("durable one"),
    `expected current-song contextual search query, got ${currentContextRun.response.searchQuery}`
  );
  const currentArtistRun = await currentContextRuns.run("make me a playlist like this artist");
  assert(currentArtistRun.response?.intent === "research_playlist", `expected current-artist prompt to route research_playlist, got ${currentArtistRun.response?.intent}`);
  assert(
    currentArtistRun.response.searchQuery === "durable artist",
    `expected current-artist contextual search query, got ${currentArtistRun.response.searchQuery}`
  );

  const releaseContextSearchCalls: string[] = [];
  const releaseContextAgent = new AgentService(app.library, app.operations, app.playback, {
    async search(query: string): Promise<DiscoverySearchResponse> {
      releaseContextSearchCalls.push(query);
      return query === "green day dookie" || query === "dookie"
        ? {
            query,
            total: 2,
            results: [
              {
                id: "green-day-dookie-burnout",
                source: "slskd",
                username: "remote-user",
                filename: "01 - Burnout.flac",
                path: "Green Day/Dookie/01 - Burnout.flac",
                folder: "Green Day/Dookie",
                sizeBytes: 32_000_000,
                extension: "flac",
                bitrate: 900_000,
                sampleRate: 44_100,
                lengthSeconds: 128,
                isLocked: false,
                hasFreeUploadSlot: true,
                uploadSpeedBytesPerSecond: 2_000_000,
                queueLength: 0,
                raw: {}
              },
              {
                id: "green-day-dookie-when-i-come-around",
                source: "slskd",
                username: "remote-user",
                filename: "06 - When I Come Around.flac",
                path: "Green Day/Dookie/06 - When I Come Around.flac",
                folder: "Green Day/Dookie",
                sizeBytes: 34_000_000,
                extension: "flac",
                bitrate: 900_000,
                sampleRate: 44_100,
                lengthSeconds: 178,
                isLocked: false,
                hasFreeUploadSlot: true,
                uploadSpeedBytesPerSecond: 2_000_000,
                queueLength: 0,
                raw: {}
              }
            ]
          }
        : { query, total: 0, results: [] };
    }
  });
  const releaseContextRuns = new AgentRunService(
    app.db,
    releaseContextAgent,
    undefined,
    {
      name: "fixture_metadata",
      async lookup() {
        return {
          summary: "Fixture metadata resolved the containing album",
          queryHints: ["Green Day Dookie", "Dookie", "Green Day When I Come Around", "When I Come Around"]
        };
      }
    },
    app.agentPlaylistWorkflows
  );
  const releaseContextRun = await releaseContextRuns.run("find the green day album with when i come around on it");
  assert(
    releaseContextSearchCalls[0] === "green day dookie",
    `expected release metadata hint to be searched first, got ${releaseContextSearchCalls[0]}`
  );
  assert(
    releaseContextRun.response?.intent === "search_discovery",
    `expected release-context prompt to use Discovery, got ${releaseContextRun.response?.intent}`
  );
  assert(releaseContextRun.response?.discoveryResults.length === 2, "expected release-context search to find Discovery results");
  const releaseQueueOperation = releaseContextRun.response.operationBatch?.operations.find((operation) => operation.type === "queue_download");
  assert(releaseQueueOperation != null, "expected release-context search to create a queue_download operation");
  const releaseQueuePayload = releaseQueueOperation.payload as { researchPlaylist?: { name?: string; playlistItemRefs?: unknown[] }; results?: DiscoveryResult[] };
  assert(releaseQueuePayload.researchPlaylist?.name === "Green Day - Dookie", `expected release playlist name, got ${releaseQueuePayload.researchPlaylist?.name}`);
  assert(releaseQueuePayload.researchPlaylist.playlistItemRefs?.length === 2, "expected release playlist item refs for selected tracks");
  assert(
    releaseQueuePayload.results?.map((result) => result.id).join(",") === "green-day-dookie-burnout,green-day-dookie-when-i-come-around",
    `expected release tracks sorted by track number, got ${releaseQueuePayload.results?.map((result) => result.id).join(",")}`
  );
  const releaseWorkflow = app.agentPlaylistWorkflows.listWorkflows().find((workflow) => workflow.runId === releaseContextRun.id);
  assert(releaseWorkflow?.playlistName === "Green Day - Dookie", `expected registered release workflow, got ${releaseWorkflow?.playlistName}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId: run.id,
        attemptedQueries: searchCalls,
        stepCount: run.steps.length,
        operationBatchId: run.response.operationBatch.id,
        modelRunId: modelRun.id,
        modelAttemptedQueries: modelSearchCalls,
        modelIntentRunId: modelIntentRun.id,
        modelIntentAttemptedQueries: modelIntentSearchCalls,
        researchPlaylistRunId: researchPlaylistRun.id,
        researchPlaylistAttemptedQueries: researchPlaylistSearchCalls,
        releaseContextRunId: releaseContextRun.id,
        releaseContextAttemptedQueries: releaseContextSearchCalls
      },
      null,
      2
    )
  );
} finally {
  app?.close();
  await rm(fixtureDir, { recursive: true, force: true });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeId3Fixture(title: string, artist: string, album: string, year: string): Buffer {
  const frames = Buffer.concat([
    makeTextFrame("TIT2", title),
    makeTextFrame("TPE1", artist),
    makeTextFrame("TALB", album),
    makeTextFrame("TYER", year)
  ]);
  return Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0]), encodeSyncSafe(frames.length), frames]);
}

function makeTextFrame(id: string, value: string): Buffer {
  const body = Buffer.concat([Buffer.from([0]), Buffer.from(value, "latin1")]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  return Buffer.concat([Buffer.from(id, "ascii"), size, Buffer.from([0, 0]), body]);
}

function encodeSyncSafe(size: number): Buffer {
  return Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}
