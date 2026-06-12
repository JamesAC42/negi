import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import {
  saveDiscoveryCandidateRequestSchema,
  savedDiscoveryCandidateSchema,
  type SaveDiscoveryCandidateRequest,
  type SavedDiscoveryCandidate
} from "@music-os/core";

interface SavedDiscoveryCandidateRow {
  id: string;
  candidate_key: string;
  source: string;
  query: string;
  release_artist: string | null;
  release_title: string;
  username: string | null;
  folder: string | null;
  result_count: number;
  available_count: number;
  total_size_bytes: number | null;
  primary_format: string | null;
  quality_label: string;
  match_label: string;
  results_json: string;
  created_at: string;
  updated_at: string;
}

export class SavedDiscoveryCandidateService {
  constructor(private readonly db: Database.Database) {}

  listCandidates(limit = 100): SavedDiscoveryCandidate[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM saved_discovery_candidates
         ORDER BY updated_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(limit) as SavedDiscoveryCandidateRow[];
    return rows.map(mapCandidate);
  }

  saveCandidate(candidate: SaveDiscoveryCandidateRequest): SavedDiscoveryCandidate {
    const parsed = saveDiscoveryCandidateRequestSchema.parse(candidate);
    const existing = this.db
      .prepare("SELECT id FROM saved_discovery_candidates WHERE candidate_key = ?")
      .get(parsed.candidateKey) as { id: string } | undefined;
    const id = existing?.id ?? nanoid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO saved_discovery_candidates (
           id,
           candidate_key,
           source,
           query,
           release_artist,
           release_title,
           username,
           folder,
           result_count,
           available_count,
           total_size_bytes,
           primary_format,
           quality_label,
           match_label,
           results_json,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @candidateKey,
           @source,
           @query,
           @releaseArtist,
           @releaseTitle,
           @username,
           @folder,
           @resultCount,
           @availableCount,
           @totalSizeBytes,
           @primaryFormat,
           @qualityLabel,
           @matchLabel,
           @resultsJson,
           @now,
           @now
         )
         ON CONFLICT(candidate_key) DO UPDATE SET
           source = excluded.source,
           query = excluded.query,
           release_artist = excluded.release_artist,
           release_title = excluded.release_title,
           username = excluded.username,
           folder = excluded.folder,
           result_count = excluded.result_count,
           available_count = excluded.available_count,
           total_size_bytes = excluded.total_size_bytes,
           primary_format = excluded.primary_format,
           quality_label = excluded.quality_label,
           match_label = excluded.match_label,
           results_json = excluded.results_json,
           updated_at = excluded.updated_at`
      )
      .run({
        id,
        candidateKey: parsed.candidateKey,
        source: parsed.source,
        query: parsed.query,
        releaseArtist: parsed.releaseArtist,
        releaseTitle: parsed.releaseTitle,
        username: parsed.username,
        folder: parsed.folder,
        resultCount: parsed.resultCount,
        availableCount: parsed.availableCount,
        totalSizeBytes: parsed.totalSizeBytes,
        primaryFormat: parsed.primaryFormat,
        qualityLabel: parsed.qualityLabel,
        matchLabel: parsed.matchLabel,
        resultsJson: JSON.stringify(parsed.results),
        now
      });

    return this.getCandidate(id);
  }

  getCandidate(candidateId: string): SavedDiscoveryCandidate {
    const row = this.db.prepare("SELECT * FROM saved_discovery_candidates WHERE id = ?").get(candidateId) as
      | SavedDiscoveryCandidateRow
      | undefined;
    if (!row) {
      throw new Error(`Saved Discovery candidate not found: ${candidateId}`);
    }
    return mapCandidate(row);
  }

  removeCandidate(candidateId: string): void {
    const result = this.db.prepare("DELETE FROM saved_discovery_candidates WHERE id = ?").run(candidateId);
    if (result.changes === 0) {
      throw new Error(`Saved Discovery candidate not found: ${candidateId}`);
    }
  }
}

function mapCandidate(row: SavedDiscoveryCandidateRow): SavedDiscoveryCandidate {
  return savedDiscoveryCandidateSchema.parse({
    id: row.id,
    candidateKey: row.candidate_key,
    source: row.source,
    query: row.query,
    releaseArtist: row.release_artist,
    releaseTitle: row.release_title,
    username: row.username,
    folder: row.folder,
    resultCount: row.result_count,
    availableCount: row.available_count,
    totalSizeBytes: row.total_size_bytes,
    primaryFormat: row.primary_format,
    qualityLabel: row.quality_label,
    matchLabel: row.match_label,
    results: parseJson(row.results_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function parseJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}
