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

console.log(JSON.stringify({ ok: true }, null, 2));

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
