import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import {
  savedDiscoveryListSchema,
  saveDiscoveryListRequestSchema,
  type SaveDiscoveryListRequest,
  type SavedDiscoveryList
} from "@music-os/core";

interface SavedDiscoveryListRow {
  id: string;
  name: string;
  source: string;
  original_text: string;
  items_json: string;
  item_count: number;
  missing_count: number;
  owned_count: number;
  created_at: string;
  updated_at: string;
}

export class SavedDiscoveryListService {
  constructor(private readonly db: Database.Database) {}

  listLists(limit = 100): SavedDiscoveryList[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM saved_discovery_lists
         ORDER BY updated_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(limit) as SavedDiscoveryListRow[];
    return rows.map(mapList);
  }

  saveList(input: SaveDiscoveryListRequest): SavedDiscoveryList {
    const parsed = saveDiscoveryListRequestSchema.parse(input);
    const id = nanoid();
    const now = new Date().toISOString();
    const itemCount = parsed.items.length;
    const ownedCount = parsed.items.filter((item) => item.ownedMatchCount > 0).length;
    const missingCount = itemCount - ownedCount;

    this.db
      .prepare(
        `INSERT INTO saved_discovery_lists (
           id,
           name,
           source,
           original_text,
           items_json,
           item_count,
           missing_count,
           owned_count,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @name,
           'pasted_list',
           @originalText,
           @itemsJson,
           @itemCount,
           @missingCount,
           @ownedCount,
           @now,
           @now
         )`
      )
      .run({
        id,
        name: parsed.name,
        originalText: parsed.originalText,
        itemsJson: JSON.stringify(parsed.items),
        itemCount,
        missingCount,
        ownedCount,
        now
      });

    return this.getList(id);
  }

  getList(listId: string): SavedDiscoveryList {
    const row = this.db.prepare("SELECT * FROM saved_discovery_lists WHERE id = ?").get(listId) as
      | SavedDiscoveryListRow
      | undefined;
    if (!row) {
      throw new Error(`Saved Discovery list not found: ${listId}`);
    }
    return mapList(row);
  }

  removeList(listId: string): void {
    const result = this.db.prepare("DELETE FROM saved_discovery_lists WHERE id = ?").run(listId);
    if (result.changes === 0) {
      throw new Error(`Saved Discovery list not found: ${listId}`);
    }
  }
}

function mapList(row: SavedDiscoveryListRow): SavedDiscoveryList {
  return savedDiscoveryListSchema.parse({
    id: row.id,
    name: row.name,
    source: row.source,
    originalText: row.original_text,
    items: parseJson(row.items_json, []),
    itemCount: row.item_count,
    missingCount: row.missing_count,
    ownedCount: row.owned_count,
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
