import { detectAgentIntent, extractAgentSearchQuery } from "../services/agent-service.js";

const greenDayIntent = detectAgentIntent("find the green day album with when i come around on it");
assert(greenDayIntent === "search_discovery", `expected Green Day release lookup to use Discovery, got ${greenDayIntent}`);
assert(
  extractAgentSearchQuery("find the green day album with when i come around on it", greenDayIntent) === "green day when come around",
  "expected release lookup query to strip command and filler words"
);

const situationalIntent = detectAgentIntent("find a daft punk song here");
assert(situationalIntent === "search_discovery", `expected vague song lookup to use Discovery, got ${situationalIntent}`);
assert(
  extractAgentSearchQuery("find a daft punk song here", situationalIntent) === "daft punk",
  "expected vague song lookup query to avoid literal filler words"
);

const localIntent = detectAgentIntent("search my library for gaucho");
assert(localIntent === "search_library", `expected explicit library prompt to stay local, got ${localIntent}`);
assert(extractAgentSearchQuery("search my library for gaucho", localIntent) === "gaucho", "expected local query to strip library wording");

const recommendationIntent = detectAgentIntent("make me a playlist of songs like this that you think I would like");
assert(
  recommendationIntent === "research_playlist",
  `expected taste/current-context playlist prompt to use research_playlist, got ${recommendationIntent}`
);

const currentArtistIntent = detectAgentIntent("make me a playlist like this artist");
assert(currentArtistIntent === "research_playlist", `expected current-artist playlist prompt to use research_playlist, got ${currentArtistIntent}`);

const moodPlaylistIntent = detectAgentIntent("make me a playlist for studying late at night");
assert(moodPlaylistIntent === "research_playlist", `expected playlist-for-mood prompt to use research_playlist, got ${moodPlaylistIntent}`);

const seededEditPlaylistIntent = detectAgentIntent(
  "can you make a playlist used for hype edits like a remix of abba gimme gimme gimme, dua lipa dont start now, lady hear me tonight by modjo, or dvrst close eyes; do some deep research and find niche stuff like these"
);
assert(
  seededEditPlaylistIntent === "research_playlist",
  `expected a playlist request with named tracks and edits to use research_playlist, got ${seededEditPlaylistIntent}`
);

const downloadablePlaylistIntent = detectAgentIntent("build me a playlist like these tracks, research it, then download the missing songs from Soulseek");
assert(
  downloadablePlaylistIntent === "research_playlist",
  `expected a playlist request mentioning downloads and Soulseek to use research_playlist, got ${downloadablePlaylistIntent}`
);

const localPlaylistIntent = detectAgentIntent("make a playlist from my library for gaucho");
assert(localPlaylistIntent === "propose_playlist", `expected explicit local playlist prompt to stay local, got ${localPlaylistIntent}`);

console.log(JSON.stringify({ ok: true }, null, 2));

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
