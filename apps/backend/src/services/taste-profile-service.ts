import type Database from "better-sqlite3";
import {
  tasteProfileSchema,
  type TasteProfile,
  type TasteProfileEntry,
  type TasteProfileResponse
} from "@music-os/core";

const profileKeys = [
  "favoriteArtists",
  "favoriteAlbums",
  "favoriteTracks",
  "preferredGenres",
  "preferredEras",
  "preferredCountries",
  "preferredLabels",
  "blockedArtists",
  "blockedGenres",
  "overplayedTracks",
  "preferredFormats",
  "qualityPreferences",
  "taggingPreferences",
  "folderOrganizationPreferences",
  "playlistStylePreferences",
  "notes"
] as const satisfies ReadonlyArray<keyof TasteProfile>;

export class TasteProfileService {
  constructor(private readonly db: Database.Database) {}

  getProfile(): TasteProfileResponse {
    const rows = this.db
      .prepare("SELECT * FROM taste_profile ORDER BY key ASC")
      .all() as TasteProfileRow[];
    const values: Partial<TasteProfile> = {};
    const entries: TasteProfileEntry[] = [];

    for (const row of rows) {
      const value = parseJsonValue(row.value_json);
      if (isTasteProfileKey(row.key)) {
        values[row.key] = value as never;
      }
      entries.push({
        key: row.key,
        value,
        source: row.source,
        confidence: row.confidence,
        updatedAt: row.updated_at
      });
    }

    const profile = tasteProfileSchema.parse(values);
    const updatedAt =
      entries.reduce<string | null>((latest, entry) => (latest == null || entry.updatedAt > latest ? entry.updatedAt : latest), null);
    return {
      profile,
      entries,
      updatedAt
    };
  }

  updateProfile(profile: TasteProfile, source = "user"): TasteProfileResponse {
    const parsed = tasteProfileSchema.parse(profile);
    const now = new Date().toISOString();
    const upsert = this.db.prepare(
      `INSERT INTO taste_profile (key, value_json, source, confidence, created_at, updated_at)
       VALUES (@key, @valueJson, @source, 1, @now, @now)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         source = excluded.source,
         confidence = excluded.confidence,
         updated_at = excluded.updated_at`
    );

    const transaction = this.db.transaction(() => {
      for (const key of profileKeys) {
        upsert.run({
          key,
          valueJson: JSON.stringify(parsed[key]),
          source,
          now
        });
      }
    });
    transaction();

    return this.getProfile();
  }
}

interface TasteProfileRow {
  key: string;
  value_json: string;
  source: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isTasteProfileKey(key: string): key is keyof TasteProfile {
  return (profileKeys as readonly string[]).includes(key);
}
