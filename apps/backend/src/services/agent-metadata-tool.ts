import type { BackendConfig } from "../config.js";

export interface AgentMetadataLookup {
  summary: string;
  queryHints: string[];
}

export interface AgentMetadataTool {
  readonly name: string;
  lookup(message: string): Promise<AgentMetadataLookup | null>;
}

export class MusicBrainzAgentMetadataTool implements AgentMetadataTool {
  readonly name = "musicbrainz_metadata";

  constructor(private readonly config: BackendConfig) {}

  async lookup(message: string): Promise<AgentMetadataLookup | null> {
    if (this.config.musicBrainzEnabled === false) {
      return null;
    }
    const target = parseMusicTarget(message);
    const releaseContext = wantsReleaseContext(message);
    const query = target ? [target.artist, target.title].filter(Boolean).join(" ") : targetQueryFromMessage(message);
    if (!query) {
      return null;
    }

    const [recordingHints, releaseHints] = await Promise.all([
      this.searchRecordings(query, releaseContext).catch(() => []),
      this.searchReleases(query).catch(() => [])
    ]);
    const queryHints = dedupeHints([
      ...releaseHints,
      ...recordingHints,
      ...targetSearchHints(target)
    ]).slice(0, 10);
    if (queryHints.length === 0) {
      return null;
    }
    return {
      summary: `Found ${queryHints.length} metadata-derived search hint${queryHints.length === 1 ? "" : "s"}`,
      queryHints
    };
  }

  private async searchRecordings(query: string, releaseContext: boolean): Promise<string[]> {
    const url = new URL("https://musicbrainz.org/ws/2/recording/");
    url.searchParams.set("query", query);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "6");
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": this.userAgent()
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as MusicBrainzRecordingSearchResponse;
    return (payload.recordings ?? []).flatMap((recording) => {
      const title = cleanHint(recording.title);
      const artist = cleanHint(recording["artist-credit"]?.map((credit) => credit.name).join(" "));
      const release = cleanHint(recording.releases?.[0]?.title);
      const releaseHints = [joinHint(artist, release), release].filter((hint): hint is string => Boolean(hint));
      const trackHints = [joinHint(artist, title), title].filter((hint): hint is string => Boolean(hint));
      return releaseContext ? [...releaseHints, ...trackHints] : [...trackHints, ...releaseHints];
    });
  }

  private async searchReleases(query: string): Promise<string[]> {
    const url = new URL("https://musicbrainz.org/ws/2/release/");
    url.searchParams.set("query", query);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "6");
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": this.userAgent()
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as MusicBrainzReleaseSearchResponse;
    return (payload.releases ?? []).flatMap((release) => {
      const title = cleanHint(release.title);
      const artist = cleanHint(release["artist-credit"]?.map((credit) => credit.name).join(" "));
      return [joinHint(artist, title), title].filter((hint): hint is string => Boolean(hint));
    });
  }

  private userAgent(): string {
    return this.config.musicBrainzUserAgent ?? "MusicOS/0.1.0 (local-dev)";
  }
}

interface MusicTarget {
  artist: string | null;
  title: string;
}

function parseMusicTarget(message: string): MusicTarget | null {
  const cleaned = message
    .replace(/[“”]/g, "\"")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const quoted = cleaned.match(/(?:song|track|single)?\s*["']([^"']{2,})["']/i);
  if (quoted) {
    const artist = parseArtistBeforeTitle(cleaned.slice(0, quoted.index ?? 0));
    return { artist, title: quoted[1].trim() };
  }

  const beforeContext = cleaned
    .replace(/\b(?:the\s+)?album\s+(?:it'?s\s+)?(?:on|from|appears\s+on|appeared\s+on)\b.*$/i, "")
    .replace(/\b(?:what|which)\s+(?:album|release|record)\b.*$/i, "")
    .replace(/[?,.!]+$/g, "")
    .trim();
  const targetText = targetQueryFromMessage(beforeContext);
  if (!targetText) {
    return null;
  }

  const bySplit = targetText.match(/^(.+?)\s+by\s+(.+)$/i);
  if (bySplit) {
    return { artist: bySplit[2].trim(), title: bySplit[1].trim() };
  }

  const dashSplit = targetText.match(/^(.+?)\s+-\s+(.+)$/);
  if (dashSplit) {
    return { artist: dashSplit[1].trim(), title: dashSplit[2].trim() };
  }

  const words = targetText.split(/\s+/);
  if (words.length >= 5) {
    return {
      artist: words.slice(0, 2).join(" "),
      title: words.slice(2).join(" ")
    };
  }
  return { artist: null, title: targetText };
}

function parseArtistBeforeTitle(value: string): string | null {
  const cleaned = targetQueryFromMessage(value);
  return cleaned || null;
}

function targetSearchHints(target: MusicTarget | null): string[] {
  if (!target) {
    return [];
  }
  return [joinHint(target.artist, target.title), target.title].filter((hint): hint is string => Boolean(hint));
}

function wantsReleaseContext(message: string): boolean {
  return /\b(album|release|record|single|ep)\b/i.test(message) && /\b(on|from|appears|appeared|its|it's)\b/i.test(message);
}

function targetQueryFromMessage(message: string): string {
  return message
    .replace(/[^\p{L}\p{N}\s'"-]+/gu, " ")
    .replace(
      /\b(?:please|find|search|discover|discovery|soulseek|slsk|slskd|download|downloads|queue|grab|stage|propose|import|playlist|external|online|for|me|the|album|release|record|single|its|it's|on)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeHints(hints: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const hint of hints) {
    const cleaned = cleanHint(hint);
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function joinHint(left: string | null, right: string | null): string | null {
  return left && right ? `${left} ${right}` : right;
}

function cleanHint(value: string | undefined | null): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned && cleaned.length >= 2 ? cleaned : null;
}

interface MusicBrainzRecordingSearchResponse {
  recordings?: MusicBrainzRecording[];
}

interface MusicBrainzRecording {
  title?: string;
  "artist-credit"?: Array<{ name: string }>;
  releases?: Array<{ title?: string }>;
}

interface MusicBrainzReleaseSearchResponse {
  releases?: MusicBrainzRelease[];
}

interface MusicBrainzRelease {
  title?: string;
  "artist-credit"?: Array<{ name: string }>;
}
