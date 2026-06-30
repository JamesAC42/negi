import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentModelPlan } from "../services/agent-model-provider.js";
import { createAgentModelProvider } from "../services/agent-model-provider.js";
import { AgentRunService } from "../services/agent-run-service.js";
import { createBackendApp } from "../app.js";
import { getBackendConfig } from "../config.js";
import { rankDiscoveryResultsByAvailability } from "../services/discovery-availability.js";

if (process.env.MUSIC_OS_LIVE_OPENAI_AGENT_SMOKE !== "1" || process.env.MUSIC_OS_LIVE_SLSKD_AGENT_WORKFLOW !== "1") {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        reason: "Set MUSIC_OS_LIVE_OPENAI_AGENT_SMOKE=1 and MUSIC_OS_LIVE_SLSKD_AGENT_WORKFLOW=1 to run the live agent download/import/playlist workflow."
      },
      null,
      2
    )
  );
  process.exit(0);
}

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-agent-openai-slskd-workflow-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  const config = getBackendConfig();
  if (config.agentModelProvider !== "openai" || !config.openaiApiKey) {
    throw new Error("Live agent workflow requires MUSIC_OS_AGENT_MODEL_PROVIDER=openai and OPENAI_API_KEY or MUSIC_OS_OPENAI_API_KEY.");
  }
  if (!config.slskdUrl) {
    throw new Error("Live agent workflow requires MUSIC_OS_SLSKD_URL.");
  }
  if (!config.slskdApiKey && (!config.slskdUsername || !config.slskdPassword)) {
    throw new Error("Live agent workflow requires MUSIC_OS_SLSKD_API_KEY or MUSIC_OS_SLSKD_USERNAME/PASSWORD.");
  }
  if (!config.slskdDownloadDirectory) {
    throw new Error("Live agent workflow requires MUSIC_OS_SLSKD_DOWNLOAD_DIR.");
  }

  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({
    ...config,
    databasePath,
    port: 0,
    musicBrainzEnabled: false,
    agentAutoStartResearchPlaylists: true
  });

  try {
    app.library.addRoot(libraryPath, "agent-openai-slskd-live-workflow");
    const health = await app.discovery.health();
    assert(health.reachable, `slskd is not reachable: ${health.message ?? "no health message"}`);

    const planner = createAgentModelProvider(config);
    const plan = await planner.plan("make me a playlist of songs for studying late at night that you think I would like", {
      librarySummary: "fixture live workflow library",
      favoriteArtists: ["Daft Punk", "Air", "Stereolab"],
      favoriteTracks: ["Air - La femme d'argent", "Daft Punk - Something About Us"],
      highRotationTracks: ["Boards of Canada - Roygbiv"],
      recentTracks: ["Stereolab - French Disko"],
      tasteProfile: {
        preferredGenres: ["downtempo", "synth-pop", "indie electronic"],
        playlistStylePreferences: "Prefer deep cuts over obvious singles."
      }
    });
    assert(plan?.intent === "research_playlist", `expected research_playlist plan, got ${plan?.intent}`);

    const candidate = await firstDownloadableCandidate(app, plan);
    assert(candidate != null, "expected at least one hosted candidate to have an unlocked slskd match");

    const singleCandidatePlan: AgentModelPlan = {
      summary: "Live smoke narrowed hosted planning to one downloadable candidate",
      intent: "research_playlist",
      searchQuery: candidate.query,
      searchQueryHints: [candidate.query],
      playlistName: "Live Agent Workflow Smoke",
      playlistDescription: "Temporary live workflow smoke playlist.",
      researchSources: plan.researchSources ?? [],
      trackCandidates: [
        {
          artist: candidate.artist,
          title: candidate.title,
          album: candidate.album,
          reason: candidate.reason,
          query: candidate.query
        }
      ]
    };
    const runs = new AgentRunService(
      app.db,
      app.agent,
      {
        name: "fixture_live_openai_candidate",
        async plan() {
          return singleCandidatePlan;
        }
      },
      undefined,
      app.agentPlaylistWorkflows,
      true
    );

    const run = await runs.run("make me a playlist of songs for a temporary live workflow smoke");
    assert(run.response?.intent === "research_playlist", `expected research_playlist response, got ${run.response?.intent}`);
    assert(run.response.operationBatch?.status === "applied", `expected auto-applied operation batch, got ${run.response.operationBatch?.status}`);
    const workflow = await waitForWorkflow(app, run.id);
    assert(workflow.playlistId != null, "expected workflow to create a playlist");
    assert(workflow.importId != null, "expected workflow to import downloaded files");
    const playlist = app.playlists.getPlaylist(workflow.playlistId);
    assert(playlist.items.length > 0, "expected completed playlist to contain imported tracks");
    const thread = app.agentThreads.getThread(run.threadId!);
    assert(
      thread.messages.some((message) => message.role === "agent" && message.text.startsWith("Here's your playlist: Live Agent Workflow Smoke.")),
      "expected final playlist-ready message in the agent thread"
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          plannedPlaylist: plan.playlistName,
          candidate: {
            artist: candidate.artist,
            title: candidate.title,
            query: candidate.query,
            selectedFilename: candidate.selectedFilename
          },
          runId: run.id,
          workflow,
          playlist: {
            id: playlist.id,
            name: playlist.name,
            items: playlist.items.length
          }
        },
        null,
        2
      )
    );
  } finally {
    app.close();
  }
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

async function firstDownloadableCandidate(app: ReturnType<typeof createBackendApp>, plan: AgentModelPlan) {
  const candidates = (plan.trackCandidates ?? []).filter((candidate) => candidate.query).slice(0, Number(process.env.MUSIC_OS_LIVE_SLSKD_PREFLIGHT_CANDIDATES ?? 5));
  for (const candidate of candidates) {
    const search = await app.discovery.search(candidate.query!, Number(process.env.MUSIC_OS_LIVE_SLSKD_PREFLIGHT_RESPONSE_LIMIT ?? 20));
    const selected = rankDiscoveryResultsByAvailability(search.results.filter((result) => !result.isLocked))[0] ?? null;
    if (selected) {
      return {
        artist: candidate.artist,
        title: candidate.title,
        album: candidate.album,
        reason: candidate.reason,
        query: candidate.query!,
        selectedFilename: selected.filename
      };
    }
  }
  return null;
}

async function waitForWorkflow(app: ReturnType<typeof createBackendApp>, runId: string) {
  const timeoutMs = Number(process.env.MUSIC_OS_LIVE_SLSKD_TIMEOUT_MS ?? 180_000);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await app.agentPlaylistWorkflows.advanceAll();
    const workflow = app.agentPlaylistWorkflows.listWorkflows().find((item) => item.runId === runId);
    if (workflow?.status === "completed") {
      return workflow;
    }
    if (workflow?.status === "failed") {
      throw new Error(workflow.error ?? "agent playlist workflow failed");
    }
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for live agent playlist workflow ${runId}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
