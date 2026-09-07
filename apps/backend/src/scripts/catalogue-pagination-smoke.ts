import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogueSection, CatalogueSort } from "@music-os/core";
import { createBackendApp } from "../app.js";

const temp = await mkdtemp(join(tmpdir(), "music-os-catalogue-pagination-"));
const app = createBackendApp({
  host: "127.0.0.1", port: 0, databasePath: join(temp, "db.sqlite"),
  mpvPath: "mpv", musicBrainzEnabled: false,
});
try {
  // Newer releases are deliberately in the second upstream page.
  const groups = Array.from({ length: 106 }, (_, i) => ({
    id: "group-" + String(i).padStart(3, "0"),
    title: "Album " + String(105 - i).padStart(3, "0"),
    "first-release-date": i > 103 ? "" : String(1900 + Math.floor(i / 2)),
    "primary-type": "Album",
  }));
  const calls: { artist: string; offset: number; limit: number }[] = [];
  let failSecondPage = true;
  app.catalogue.request = async <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
    if (path.startsWith("artist/")) return { id: path.slice(7), name: "Test Artist" } as T;
    assert.equal(path, "release-group", "Browsing must not fetch covers or track lists");
    const offset = Number(params.offset), limit = Number(params.limit);
    calls.push({ artist: params.artist, offset, limit });
    if (params.artist === "retry" && offset > 0 && failSecondPage) {
      failSecondPage = false;
      throw new Error("Temporary upstream failure");
    }
    return {
      "release-groups": params.artist === "empty" ? [] : groups.slice(offset, offset + limit),
      "release-group-count": params.artist === "empty" ? 0 : groups.length,
    } as T;
  };
  for (const sort of ["newest", "oldest", "title"] as CatalogueSort[]) {
    const ids: string[] = [];
    const dates: (string | null)[] = [];
    const titles: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await app.catalogue.browse("artist", "Test Artist", offset, sort);
      assert.equal(page.total, 106);
      assert.equal(page.albums.length, Math.min(24, 106 - offset));
      ids.push(...page.albums.map((a) => a.id));
      dates.push(...page.albums.map((a) => a.date));
      titles.push(...page.albums.map((a) => a.title));
      if (page.nextOffset !== null) assert(page.nextOffset > offset);
      offset = page.nextOffset;
    }
    assert.equal(new Set(ids).size, 106, "All releases appear exactly once");
    if (sort === "title") {
      assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b)));
    } else {
      assert.deepEqual(dates.slice(-2), [null, null], "Undated releases stay last");
      const known = dates.slice(0, -2) as string[];
      assert.deepEqual(known, [...known].sort((a, b) => sort === "newest" ? b.localeCompare(a) : a.localeCompare(b)));
      if (sort === "newest") assert.equal(ids[0], "group-103", "Latest release can come from a later upstream page");
      if (sort === "oldest") assert.equal(ids[0], "group-001", "Date ties use title order");
    }
    const repeated = await app.catalogue.browse("artist", "Test Artist", 24, sort);
    assert.deepEqual(repeated.albums.map((a) => a.id), ids.slice(24, 48), "Stable page boundaries");
  }
  assert.deepEqual(calls, [
    { artist: "artist", offset: 0, limit: 100 },
    { artist: "artist", offset: 100, limit: 100 },
  ], "Loading more and changing sort reuse the cached metadata index");
  const beyond = await app.catalogue.browse("artist", "Test Artist", 200);
  assert.equal(beyond.nextOffset, null);
  assert.deepEqual(beyond.albums, []);
  const empty = await app.catalogue.browse("empty", "Test Artist");
  assert.equal(empty.total, 0);
  assert.equal(empty.nextOffset, null);
  await assert.rejects(app.catalogue.browse("retry", "Test Artist"), /Temporary upstream failure/);
  const recovered = await app.catalogue.browse("retry", "Test Artist");
  assert.equal(recovered.total, 106, "A failed index fetch can be retried");
  assert.equal(recovered.albums[0].id, "group-103");
  const sectionGroups = groups.map((group, index) => ({
    ...group,
    "primary-type": ["Album", "EP", "Album", "Broadcast"][index % 4],
    "secondary-types": index % 4 === 2 ? [index % 8 === 2 ? "Live" : "Compilation"] : [],
  }));
  app.catalogue.request = async <T>(path: string, params: Record<string, string> = {}): Promise<T> => path.startsWith("artist/")
    ? { id: "sections", name: "Test Artist" } as T
    : { "release-groups": sectionGroups.slice(Number(params.offset), Number(params.offset) + Number(params.limit)), "release-group-count": sectionGroups.length } as T;
  for (const [index, section] of (["albums", "eps-singles", "live-compilations", "other"] as CatalogueSection[]).entries()) {
    const expected = sectionGroups.filter((_, i) => i % 4 === index).sort((a, b) => a.title.localeCompare(b.title));
    const first = await app.catalogue.browse("sections", "Test Artist", 0, "title", section);
    const last = await app.catalogue.browse("sections", "Test Artist", first.nextOffset!, "title", section);
    assert.equal(first.total, expected.length, "Total belongs to this section only");
    assert.equal(first.nextOffset, 24);
    assert.equal(last.nextOffset, null);
    assert.deepEqual([...first.albums, ...last.albums].map((album) => album.id), expected.map((group) => group.id), "Section filtering precedes sorting and pagination");
  }
  console.log("PASS: globally sorted pagination, append order, date ties, undated releases, cached page/sort changes, empty catalogue and failed fetch retry");
} finally {
  app.close();
  await rm(temp, { recursive: true, force: true });
}
