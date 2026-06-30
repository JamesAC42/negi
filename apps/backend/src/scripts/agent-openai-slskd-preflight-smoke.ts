import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";
import { getBackendConfig } from "../config.js";
import type { AgentModelPlan } from "../services/agent-model-provider.js";
import { createAgentModelProvider } from "../services/agent-model-provider.js";
import { AgentRunService } from "../services/agent-run-service.js";
import { rankDiscoveryResultsByAvailability } from "../services/discovery-availability.js";

if (process.env.MUSIC_OS_LIVE_OPENAI_AGENT_SMOKE !== "1" || process.env.MUSIC_OS_LIVE_SLSKD_PREFLIGHT !== "1") {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        reason: "Set MUSIC_OS_LIVE_OPENAI_AGENT_SMOKE=1 and MUSIC_OS_LIVE_SLSKD_PREFLIGHT=1 to verify hosted planning against live slskd search."
      },
      null,
      2
    )
  );
  process.exit(0);
}

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-agent-openai-slskd-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  const config = getBackendConfig();
  if (config.agentModelProvider !== "openai" || !config.openaiApiKey) {
    throw new Error("OpenAI agent/slskd preflight requires MUSIC_OS_AGENT_MODEL_PROVIDER=openai and OPENAI_API_KEY or MUSIC_OS_OPENAI_API_KEY.");
  }
  if (!config.slskdUrl) {
    throw new Error("OpenAI agent/slskd preflight requires MUSIC_OS_SLSKD_URL.");
  }
  if (!config.slskdApiKey && (!config.slskdUsername || !config.slskdPassword)) {
    throw new Error("OpenAI agent/slskd preflight requires MUSIC_OS_SLSKD_API_KEY or MUSIC_OS_SLSKD_USERNAME/PASSWORD.");
  }

  await mkdir(libraryPath, { recursive: true });
  const app = createBackendApp({
    ...config,
    databasePath,
    port: 0,
    musicBrainzEnabled: false
  });

  try {
    app.library.addRoot(libraryPath, "agent-openai-slskd-preflight");
    const health = await app.discovery.health();
    assert(health.reachable, `slskd is not reachable: ${health.message ?? "no health message"}`);

    const provider = createAgentModelProvider(config);
    const plan = await provider.plan("make me a playlist of songs for studying late at night that you think I would like", {
      librarySummary: "fixture library",
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
    const agentPlan: AgentModelPlan = plan;
    const candidates = (plan.trackCandidates ?? []).filter((candidate) => candidate.query).slice(0, Number(process.env.MUSIC_OS_LIVE_SLSKD_PREFLIGHT_CANDIDATES ?? 5));
    assert(candidates.length > 0, "expected hosted planner to return candidate queries");

    const searched = [];
    let unlockedMatches = 0;
    for (const candidate of candidates) {
      const search = await app.discovery.search(candidate.query!, Number(process.env.MUSIC_OS_LIVE_SLSKD_PREFLIGHT_RESPONSE_LIMIT ?? 20));
      const selected = rankDiscoveryResultsByAvailability(search.results.filter((result) => !result.isLocked))[0] ?? null;
      if (selected) {
        unlockedMatches += 1;
      }
      searched.push({
        artist: candidate.artist,
        title: candidate.title,
        query: candidate.query,
        resultCount: search.results.length,
        selected: selected
          ? {
              username: selected.username,
              filename: selected.filename,
              sizeBytes: selected.sizeBytes,
              hasFreeUploadSlot: selected.hasFreeUploadSlot ?? null,
              queueLength: selected.queueLength ?? null
            }
          : null
      });
    }

    assert(unlockedMatches > 0, `expected at least one unlocked live slskd match, got ${unlockedMatches}/${candidates.length}`);
    const runs = new AgentRunService(
      app.db,
      app.agent,
      {
        name: "fixture_live_openai_plan",
        async plan() {
          return agentPlan;
        }
      },
      undefined,
      app.agentPlaylistWorkflows,
      false
    );
    const run = await runs.run("make me a playlist of songs for studying late at night that you think I would like");
    assert(
      run.response?.intent === "research_playlist",
      `expected real agent path to keep research_playlist, got ${run.response?.intent}; run status ${run.status}; error ${run.error ?? "none"}`
    );
    assert(run.response.discoveryResults.length > 0, "expected real agent path to select live Discovery candidates");
    assert(
      run.response.operationBatch?.operations.some((operation) => operation.type === "queue_download") === true,
      "expected real agent path to propose a queue_download batch"
    );
    assert(app.discoveryDownloads.listJobs().length === 0, "preflight must not create download jobs");
    assert(app.imports.listInbox().length === 0, "preflight must not create imports");
    assert(app.library.countFiles() === 0, "preflight must not add library files");

    console.log(
      JSON.stringify(
        {
          ok: true,
          model: config.openaiModel,
          playlistName: plan.playlistName,
          plannedCandidates: plan.trackCandidates?.length ?? 0,
          searchedCandidates: candidates.length,
          unlockedMatches,
          agentSelectedCandidates: run.response.discoveryResults.length,
          operationBatchId: run.response.operationBatch?.id ?? null,
          searched,
          mutated: {
            downloadJobs: app.discoveryDownloads.listJobs().length,
            imports: app.imports.listInbox().length,
            libraryFiles: app.library.countFiles()
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

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
