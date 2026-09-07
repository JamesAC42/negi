import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CatalogueResponseCache } from "../services/catalogue-response-cache.js";

const directory = mkdtempSync(join(tmpdir(), "music-os-catalogue-cache-"));
const path = join(directory, "cache.sqlite");
let db = new Database(path);
let now = 1_000;
const ttl = 3_600_000;
try {
  const cache = new CatalogueResponseCache(db, () => now);
  const response = { artists: [{ id: "artist", name: "Fixture artist" }] };
  cache.set("artist?query=fixture", response, ttl);
  assert.deepEqual(cache.get("artist?query=fixture"), response);
  assert.equal(cache.get("artist?query=different"), undefined);
  for (const value of [null, false, 0, "", [], {}]) {
    const key = JSON.stringify(value);
    cache.set(key, value, ttl);
    assert.deepEqual(cache.get(key), value, "Valid empty responses are cache hits");
  }
  cache.set("undefined", undefined, ttl);
  assert.equal(cache.get("undefined"), undefined);
  db.close();
  db = new Database(path);
  const restarted = new CatalogueResponseCache(db, () => now);
  assert.deepEqual(restarted.get("artist?query=fixture"), response, "Survives connection and service recreation");
  now += ttl;
  assert.equal(restarted.get("artist?query=fixture"), undefined, "Expires at TTL boundary");
  restarted.set("fresh", response, ttl);
  const count = () => (db.prepare("SELECT COUNT(*) value FROM catalogue_response_cache").get() as { value: number }).value;
  assert.equal(count(), 1, "Writes prune all expired entries");
  for (let index = 0; index < 399; index++) restarted.set(`entry-${index}`, index, ttl);
  assert.equal(count(), 400);
  assert.deepEqual(restarted.get("fresh"), response, "Reading promotes an older entry");
  restarted.set("overflow", true, ttl);
  assert.equal(count(), 400);
  assert.equal(restarted.get("entry-0"), undefined, "Evicts least recently accessed entry even within one millisecond");
  assert.equal(restarted.get("entry-1"), 1, "Keeps other entries when capacity is reached");
  assert.deepEqual(restarted.get("fresh"), response, "Preserves recently read entries");
  db.prepare("UPDATE catalogue_response_cache SET json = ? WHERE key = ?").run("broken JSON", "fresh");
  assert.equal(restarted.get("fresh"), undefined, "Malformed cached JSON falls back to a miss");
  console.log("PASS: persistent catalogue responses, empty results, expiry, bounded LRU eviction, and corrupt entry recovery.");
} finally {
  db.close();
  rmSync(directory, { recursive: true, force: true });
}
