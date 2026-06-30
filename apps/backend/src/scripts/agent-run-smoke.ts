import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { agentPlaylistWorkflowsResponseSchema, type AgentStep, type DiscoverySearchResponse } from "@music-os/core";
import type { BackendApp } from "../app.js";
import { createBackendApp } from "../app.js";
import { AgentService } from "../services/agent-service.js";
import { AgentRunService } from "../services/agent-run-service.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-agent-run-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
let app: BackendApp | null = null;

try {
  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
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
          summary: "Fixture model recognized an external discovery request",
          intent: "search_discovery",
          searchQuery: "daft punk",
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
    undefined
  );
  const researchPlaylistRun = await researchPlaylistRuns.run("make me a playlist of songs for a late night electronic mood");
  assert(researchPlaylistRun.response?.intent === "research_playlist", `expected research_playlist intent, got ${researchPlaylistRun.response?.intent}`);
  assert(researchPlaylistRun.response?.discoveryResults.length === 2, "expected researched playlist to find two Discovery candidates");
  assert(researchPlaylistRun.response?.researchSources?.[0]?.url === "https://www.reddit.com/r/ifyoulikeblank/example", "expected research source to be preserved");
  assert(researchPlaylistRun.response?.operationBatch?.operations.some((operation) => operation.type === "queue_download") === true, "expected researched playlist to propose queue_download");
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

  const releaseContextSearchCalls: string[] = [];
  const releaseContextAgent = new AgentService(app.library, app.operations, app.playback, {
    async search(query: string): Promise<DiscoverySearchResponse> {
      releaseContextSearchCalls.push(query);
      return query === "green day dookie" || query === "dookie"
        ? {
            query,
            total: 1,
            results: [
              {
                id: "green-day-dookie-result",
                source: "slskd",
                username: "remote-user",
                filename: "06 - When I Come Around.flac",
                path: "Green Day/Dookie/06 - When I Come Around.flac",
                folder: "Green Day/Dookie",
                sizeBytes: 32_000_000,
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
  const releaseContextRuns = new AgentRunService(app.db, releaseContextAgent, undefined, {
    name: "fixture_metadata",
    async lookup() {
      return {
        summary: "Fixture metadata resolved the containing album",
        queryHints: ["Green Day Dookie", "Dookie", "Green Day When I Come Around", "When I Come Around"]
      };
    }
  });
  const releaseContextRun = await releaseContextRuns.run("find the green day album with when i come around on it");
  assert(
    releaseContextSearchCalls[0] === "green day dookie",
    `expected release metadata hint to be searched first, got ${releaseContextSearchCalls[0]}`
  );
  assert(
    releaseContextRun.response?.intent === "search_discovery",
    `expected release-context prompt to use Discovery, got ${releaseContextRun.response?.intent}`
  );
  assert(releaseContextRun.response?.discoveryResults.length === 1, "expected release-context search to find a Discovery result");

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
