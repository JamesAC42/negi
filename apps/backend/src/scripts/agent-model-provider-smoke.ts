import { parseAgentModelPlan } from "../services/agent-model-provider.js";

const fenced = parseAgentModelPlan(`
Here is the plan:
\`\`\`json
{
  "summary": "Use discussion sources {with braces} and pick tracks.",
  "intent": "research_playlist",
  "searchQuery": "late night synth pop",
  "searchQueryHints": ["late night synth pop", "synth pop deep cuts"],
  "playlistName": "Neon Late Night",
  "trackCandidates": [
    { "artist": "Chromatics", "title": "Cherry", "album": "Cherry", "query": "chromatics cherry" }
  ],
  "researchSources": [
    { "title": "Fixture source", "url": "https://example.com/thread", "summary": "Discussion summary." }
  ]
}
\`\`\`
Extra text with {ignored: true}.
`);

assert(fenced?.intent === "research_playlist", `expected fenced intent, got ${fenced?.intent}`);
assert(fenced.searchQuery === "late night synth pop", `expected search query, got ${fenced.searchQuery}`);
assert(fenced.trackCandidates?.[0]?.artist === "Chromatics", "expected parsed track candidate");
assert(fenced.researchSources?.[0]?.url === "https://example.com/thread", "expected parsed research source");

const plain = parseAgentModelPlan('{"summary":"Fallback hints","searchQueryHints":["antifragile"]}');
assert(plain?.searchQueryHints[0] === "antifragile", "expected plain JSON hints");

const invalid = parseAgentModelPlan("No structured plan here.");
assert(invalid == null, "expected invalid text to return null");

console.log(JSON.stringify({ ok: true, parsedPlaylistName: fenced.playlistName }, null, 2));

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
