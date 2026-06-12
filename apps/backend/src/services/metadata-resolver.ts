import { basename, extname } from "node:path";
import type { MetadataCandidate } from "@music-os/core";
import type { BackendConfig } from "../config.js";

export interface MetadataResolverInput {
  filePath: string;
  durationMs: number | null;
  tags: Record<string, string>;
}

export interface MetadataResolution {
  candidates: MetadataCandidate[];
  selected: MetadataCandidate | null;
  confidenceScore: number;
  warnings: string[];
}

export class MetadataResolver {
  constructor(private readonly config: BackendConfig) {}

  async resolve(input: MetadataResolverInput): Promise<MetadataResolution> {
    const candidates: MetadataCandidate[] = [
      ...buildEmbeddedCandidates(input),
      ...buildFilenameCandidates(input)
    ];
    const lookupSeed = chooseLookupSeed(candidates);

    if (this.config.musicBrainzEnabled !== false && lookupSeed?.title && lookupSeed.artist) {
      candidates.push(...(await this.lookupMusicBrainz(lookupSeed.title, lookupSeed.artist, input.durationMs)));
    }

    const deduped = dedupeCandidates(candidates).sort(sortCandidates);
    const selected = selectCandidate(deduped);
    const confidenceScore = selected?.score ?? 0;
    const warnings: string[] = [];

    if (!selected) {
      warnings.push("No metadata candidate could be generated");
    } else if (confidenceScore < 0.75) {
      warnings.push("Low metadata confidence; review before approval");
    }

    return {
      candidates: deduped.slice(0, 8),
      selected,
      confidenceScore,
      warnings
    };
  }

  private async lookupMusicBrainz(title: string, artist: string, durationMs: number | null): Promise<MetadataCandidate[]> {
    const query = `recording:"${escapeLucene(title)}" AND artist:"${escapeLucene(artist)}"`;
    const url = new URL("https://musicbrainz.org/ws/2/recording/");
    url.searchParams.set("query", query);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "5");

    try {
      const response = await fetch(url, {
        headers: {
          "accept": "application/json",
          "user-agent": this.config.musicBrainzUserAgent ?? "MusicOS/0.1.0 (local-dev)"
        },
        signal: AbortSignal.timeout(4000)
      });
      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as MusicBrainzRecordingSearchResponse;
      return (payload.recordings ?? []).map((recording) => mapMusicBrainzRecording(recording, title, artist, durationMs));
    } catch {
      return [];
    }
  }
}

function buildEmbeddedCandidates(input: MetadataResolverInput): MetadataCandidate[] {
  const title = clean(input.tags.title);
  const artist = clean(input.tags.artist ?? input.tags.albumartist);
  const album = clean(input.tags.album);
  const year = parseYear(input.tags.year ?? input.tags.date);
  if (!title && !artist && !album) {
    return [];
  }

  let score = 0.35;
  if (title) score += 0.2;
  if (artist) score += 0.2;
  if (album) score += 0.1;
  if (year) score += 0.05;

  return [
    {
      source: "embedded",
      externalId: null,
      title,
      artist,
      album,
      year,
      score: clampScore(score),
      reason: "Embedded audio tags",
      externalUrl: null
    }
  ];
}

function selectCandidate(candidates: MetadataCandidate[]): MetadataCandidate | null {
  const embedded = candidates.find((candidate) => candidate.source === "embedded");
  if (embedded && isCompleteEmbeddedCandidate(embedded)) {
    return embedded;
  }
  return candidates[0] ?? null;
}

function isCompleteEmbeddedCandidate(candidate: MetadataCandidate): boolean {
  return Boolean(candidate.title && candidate.artist && candidate.album && candidate.score >= 0.85);
}

function sortCandidates(left: MetadataCandidate, right: MetadataCandidate): number {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  return sourcePriority(right.source) - sourcePriority(left.source);
}

function sourcePriority(source: MetadataCandidate["source"]): number {
  if (source === "manual") return 4;
  if (source === "embedded") return 3;
  if (source === "musicbrainz") return 2;
  if (source === "filename") return 1;
  return 0;
}

function buildFilenameCandidates(input: MetadataResolverInput): MetadataCandidate[] {
  const parsed = parseFilename(input.filePath);
  if (!parsed.title && !parsed.artist) {
    return [];
  }

  return [
    {
      source: "filename",
      externalId: null,
      title: parsed.title,
      artist: parsed.artist,
      album: null,
      year: null,
      score: parsed.artist && parsed.title ? 0.62 : 0.42,
      reason: "Parsed from filename",
      externalUrl: null
    }
  ];
}

function chooseLookupSeed(candidates: MetadataCandidate[]): Pick<MetadataCandidate, "title" | "artist"> | null {
  return candidates.find((candidate) => candidate.title && candidate.artist) ?? null;
}

function parseFilename(filePath: string): { artist: string | null; title: string | null } {
  const name = basename(filePath, extname(filePath))
    .replace(/^\d{1,2}\s*[-_.]\s*/, "")
    .replaceAll("_", " ")
    .trim();
  const parts = name.split(/\s+-\s+/).map(clean).filter(Boolean) as string[];
  if (parts.length >= 2) {
    return { artist: parts[0], title: parts.slice(1).join(" - ") };
  }
  return { artist: null, title: clean(name) };
}

function mapMusicBrainzRecording(
  recording: MusicBrainzRecording,
  expectedTitle: string,
  expectedArtist: string,
  durationMs: number | null
): MetadataCandidate {
  const artist = clean(recording["artist-credit"]?.map((credit) => credit.name).join(""));
  const album = clean(recording.releases?.[0]?.title);
  const year = parseYear(recording["first-release-date"] ?? recording.releases?.[0]?.date);
  const title = clean(recording.title);
  const durationDelta = typeof recording.length === "number" && durationMs != null ? Math.abs(recording.length - durationMs) : null;
  const durationBonus = durationDelta == null ? 0 : durationDelta <= 3000 ? 0.1 : durationDelta <= 10000 ? 0.04 : -0.08;
  const score = clampScore(
    (Number(recording.score ?? 0) / 100) * 0.45 +
      similarity(title, expectedTitle) * 0.25 +
      similarity(artist, expectedArtist) * 0.2 +
      durationBonus
  );

  return {
    source: "musicbrainz",
    externalId: recording.id ?? null,
    title,
    artist,
    album,
    year,
    score,
    reason: "MusicBrainz recording search",
    externalUrl: recording.id ? `https://musicbrainz.org/recording/${recording.id}` : null
  };
}

function dedupeCandidates(candidates: MetadataCandidate[]): MetadataCandidate[] {
  const seen = new Set<string>();
  const result: MetadataCandidate[] = [];
  for (const candidate of candidates) {
    const key = [candidate.source, candidate.externalId, candidate.title, candidate.artist, candidate.album].join("|").toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function similarity(left: string | null, right: string | null): number {
  if (!left || !right) {
    return 0;
  }
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);
  if (a === b) {
    return 1;
  }
  if (a.includes(b) || b.includes(a)) {
    return 0.82;
  }
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap / Math.max(aTokens.size, bTokens.size, 1);
}

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function escapeLucene(value: string): string {
  return value.replace(/(["\\])/g, "\\$1");
}

function clean(value: string | undefined | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function parseYear(value: string | undefined | null): number | null {
  const match = value?.match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

interface MusicBrainzRecordingSearchResponse {
  recordings?: MusicBrainzRecording[];
}

interface MusicBrainzRecording {
  id?: string;
  title?: string;
  score?: string | number;
  length?: number;
  "first-release-date"?: string;
  "artist-credit"?: Array<{ name: string }>;
  releases?: Array<{ title?: string; date?: string }>;
}
