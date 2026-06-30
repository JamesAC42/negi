import type { BackendConfig } from "../config.js";
import type { AgentMessageResponse } from "@music-os/core";

export interface AgentTrackCandidate {
  artist: string;
  title: string;
  album?: string;
  reason?: string;
  query?: string;
}

export interface AgentResearchSource {
  title: string;
  url: string;
  summary?: string;
}

export interface AgentPlanningContext {
  librarySummary?: string;
  currentTrack?: string;
  currentArtist?: string;
  currentAlbum?: string;
  favoriteArtists?: string[];
  favoriteAlbums?: string[];
  favoriteTracks?: string[];
  highRotationTracks?: string[];
  recentTracks?: string[];
}

export interface AgentModelPlan {
  summary: string;
  intent?: AgentMessageResponse["intent"];
  searchQuery?: string;
  searchQueryHints: string[];
  playlistName?: string;
  playlistDescription?: string;
  trackCandidates?: AgentTrackCandidate[];
  researchSources?: AgentResearchSource[];
}

export interface AgentModelProvider {
  readonly name: string;
  plan(message: string, context?: AgentPlanningContext): Promise<AgentModelPlan | null>;
}

export function createAgentModelProvider(config: BackendConfig): AgentModelProvider {
  if (config.agentModelProvider === "openai" && config.openaiApiKey) {
    return new OpenAIResponsesAgentModelProvider(
      config.openaiApiKey,
      config.openaiModel ?? "gpt-5.5",
      config.agentWebResearchEnabled !== false
    );
  }
  return new LocalAgentModelProvider();
}

class LocalAgentModelProvider implements AgentModelProvider {
  readonly name = "local";

  async plan(): Promise<AgentModelPlan | null> {
    return null;
  }
}

class OpenAIResponsesAgentModelProvider implements AgentModelProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly webResearchEnabled: boolean
  ) {}

  async plan(message: string, context: AgentPlanningContext = {}): Promise<AgentModelPlan | null> {
    const useWebResearch = this.webResearchEnabled && shouldUseWebResearch(message);
    const requestBody: Record<string, unknown> = {
      model: this.model,
      reasoning: { effort: "low" },
      max_output_tokens: useWebResearch ? 1400 : 800,
      instructions:
        "You plan music-library agent work for Music OS. Return compact JSON only. Never claim actions were taken. Mutating actions require local approval outside the model.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `User request: ${message}\n\n` +
                `Taste/library context: ${JSON.stringify(context)}\n\n` +
                "Return JSON with shape {\"summary\": string, \"intent\": string, \"searchQuery\": string, \"searchQueryHints\": string[], \"playlistName\": string, \"playlistDescription\": string, \"researchSources\": [{\"title\": string, \"url\": string, \"summary\": string}], \"trackCandidates\": [{\"artist\": string, \"title\": string, \"album\": string, \"reason\": string, \"query\": string}]}.\n" +
                "Allowed intents: search_library, search_discovery, research_playlist, parse_pasted_list, propose_import, propose_playlist, propose_duplicate_cleanup, playback, unknown.\n" +
                "Use search_library only when the user likely wants to search indexed local files. Use search_discovery when the user likely wants to find music not already known to be in the local library, asks broadly to find a song/album, or mentions Soulseek/downloads.\n" +
                "Use research_playlist when the user asks for a playlist, mood/occasion recommendations, music like an artist/song, or music they might like. For research_playlist, return 8-15 concrete trackCandidates.\n" +
                "When the user says this song, this track, current song, or current artist, resolve that using currentTrack/currentArtist/currentAlbum from the Taste/library context.\n" +
                "For research_playlist, use current web research when available. Prefer sources from music discussion and recommendation contexts such as Reddit, Last.fm, Rate Your Music, Album of the Year, Bandcamp, Discogs, AllMusic, Pitchfork, Stereogum, Resident Advisor, forums, and label/artist pages. Include only sources you actually used in researchSources.\n" +
                "searchQuery should be the cleaned music target, not filler words like here, this, song, album, find, search, or download.\n" +
                "searchQueryHints should be short Soulseek fallback searches, especially album/title/track names that avoid famous artist tokens likely to be suppressed."
            }
          ]
        }
      ]
    };
    if (useWebResearch) {
      requestBody.tools = [{ type: "web_search" }];
    }
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`OpenAI Responses API returned ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    return parsePlan(extractOutputText(body));
  }
}

function extractOutputText(body: Record<string, unknown>): string {
  const direct = body.output_text;
  if (typeof direct === "string") {
    return direct;
  }

  const output = Array.isArray(body.output) ? body.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const record = isRecord(item) ? item : null;
    const content = Array.isArray(record?.content) ? record.content : [];
    for (const part of content) {
      const partRecord = isRecord(part) ? part : null;
      const text = partRecord?.text;
      if (typeof text === "string") {
        chunks.push(text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function parsePlan(text: string): AgentModelPlan | null {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const intent = parseIntent(parsed.intent);
    const searchQuery = typeof parsed.searchQuery === "string" ? parsed.searchQuery.trim() : "";
    const playlistName = typeof parsed.playlistName === "string" ? parsed.playlistName.trim() : "";
    const playlistDescription = typeof parsed.playlistDescription === "string" ? parsed.playlistDescription.trim() : "";
    const trackCandidates = parseTrackCandidates(parsed.trackCandidates);
    const researchSources = parseResearchSources(parsed.researchSources);
    const searchQueryHints = Array.isArray(parsed.searchQueryHints)
      ? parsed.searchQueryHints.filter((hint): hint is string => typeof hint === "string").map((hint) => hint.trim()).filter(Boolean)
      : [];
    if (!summary && !intent && !searchQuery && searchQueryHints.length === 0 && trackCandidates.length === 0) {
      return null;
    }
    return {
      summary: summary || "Model generated search hints.",
      intent,
      searchQuery: searchQuery || undefined,
      searchQueryHints: [...new Set(searchQueryHints)].slice(0, 8),
      playlistName: playlistName || undefined,
      playlistDescription: playlistDescription || undefined,
      trackCandidates,
      researchSources
    };
  } catch {
    return null;
  }
}

function parseIntent(value: unknown): AgentMessageResponse["intent"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (
    value === "search_library" ||
    value === "search_discovery" ||
    value === "research_playlist" ||
    value === "parse_pasted_list" ||
    value === "propose_import" ||
    value === "propose_playlist" ||
    value === "propose_duplicate_cleanup" ||
    value === "playback" ||
    value === "unknown"
  ) {
    return value;
  }
  return undefined;
}

function parseTrackCandidates(value: unknown): AgentTrackCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const candidates: AgentTrackCandidate[] = [];
  for (const item of value) {
    const record = isRecord(item) ? item : null;
    const artist = typeof record?.artist === "string" ? record.artist.trim() : "";
    const title = typeof record?.title === "string" ? record.title.trim() : "";
    if (!artist || !title) {
      continue;
    }
    const album = typeof record?.album === "string" && record.album.trim() ? record.album.trim() : undefined;
    const reason = typeof record?.reason === "string" && record.reason.trim() ? record.reason.trim() : undefined;
    const query = typeof record?.query === "string" && record.query.trim() ? record.query.trim() : undefined;
    candidates.push({ artist, title, album, reason, query });
  }
  return dedupeTrackCandidates(candidates).slice(0, 20);
}

function dedupeTrackCandidates(candidates: AgentTrackCandidate[]): AgentTrackCandidate[] {
  const seen = new Set<string>();
  const deduped: AgentTrackCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.artist.toLowerCase()}\u0000${candidate.title.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(candidate);
    }
  }
  return deduped;
}

function parseResearchSources(value: unknown): AgentResearchSource[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sources: AgentResearchSource[] = [];
  for (const item of value) {
    const record = isRecord(item) ? item : null;
    const title = typeof record?.title === "string" ? record.title.trim() : "";
    const url = typeof record?.url === "string" ? record.url.trim() : "";
    if (!title || !/^https?:\/\//i.test(url)) {
      continue;
    }
    const summary = typeof record?.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined;
    sources.push({ title, url, summary });
  }
  return dedupeResearchSources(sources).slice(0, 12);
}

function dedupeResearchSources(sources: AgentResearchSource[]): AgentResearchSource[] {
  const seen = new Set<string>();
  const deduped: AgentResearchSource[] = [];
  for (const source of sources) {
    const key = source.url.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(source);
    }
  }
  return deduped;
}

function shouldUseWebResearch(message: string): boolean {
  return /\b(playlist|mix|mood|vibe|recommend|recommendation|similar|like this|like that|think i would like|research|reddit|last\.?fm|rate\s*your\s*music|rym|forum|forums)\b/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}
