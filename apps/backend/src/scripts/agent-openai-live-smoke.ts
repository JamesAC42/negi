import { getBackendConfig } from "../config.js";
import { createAgentModelProvider } from "../services/agent-model-provider.js";

if (process.env.MUSIC_OS_LIVE_OPENAI_AGENT_SMOKE !== "1") {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "Set MUSIC_OS_LIVE_OPENAI_AGENT_SMOKE=1 to run the live OpenAI planner smoke." }, null, 2));
  process.exit(0);
}

const config = getBackendConfig();
if (config.agentModelProvider !== "openai" || !config.openaiApiKey) {
  throw new Error("Live OpenAI planner smoke requires MUSIC_OS_AGENT_MODEL_PROVIDER=openai and OPENAI_API_KEY or MUSIC_OS_OPENAI_API_KEY.");
}

const provider = createAgentModelProvider(config);
const plan = await provider.plan("make me a playlist of songs for studying late at night that you think I would like", {
  librarySummary: "fixture library",
  favoriteArtists: ["Daft Punk", "Air", "Stereolab"],
  favoriteTracks: ["Air - La femme d'argent", "Daft Punk - Something About Us"],
  highRotationTracks: ["Boards of Canada - Roygbiv"],
  recentTracks: ["Stereolab - French Disko"],
  tasteProfile: {
    preferredGenres: ["downtempo", "synth-pop", "indie electronic"],
    blockedArtists: ["Blocked Fixture Artist"],
    playlistStylePreferences: "Prefer deep cuts over obvious singles."
  }
});

assert(plan != null, "expected hosted model to return a parseable plan");
assert(plan.intent === "research_playlist", `expected research_playlist intent, got ${plan.intent}`);
assert(typeof plan.playlistName === "string" && plan.playlistName.length > 0, "expected playlistName");
assert(typeof plan.playlistDescription === "string" && plan.playlistDescription.length > 0, "expected playlistDescription");
assert((plan.trackCandidates?.length ?? 0) >= 8, `expected at least 8 track candidates, got ${plan.trackCandidates?.length ?? 0}`);
assert(
  plan.trackCandidates?.every((candidate) => candidate.artist && candidate.title && candidate.reason && candidate.query) === true,
  "expected every track candidate to include artist, title, reason, and query"
);
assert((plan.searchQueryHints?.length ?? 0) > 0, "expected Soulseek search query hints");

console.log(
  JSON.stringify(
    {
      ok: true,
      provider: provider.name,
      model: config.openaiModel,
      playlistName: plan.playlistName,
      candidates: plan.trackCandidates?.length ?? 0,
      sources: plan.researchSources?.length ?? 0,
      firstCandidate: plan.trackCandidates?.[0] ?? null
    },
    null,
    2
  )
);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
