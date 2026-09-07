import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { CatalogueArtworkCache } from "../services/catalogue-artwork-cache.js";
import { CatalogueService } from "../services/catalogue-service.js";

const db = new Database(":memory:");
try {
  let calls = 0,
    active = 0,
    maxActive = 0;
  const artwork = { data: Buffer.from("fixture"), mimeType: "image/jpeg" };
  const cache = new CatalogueArtworkCache(db, async (url) => {
    calls++;
    active++;
    maxActive = Math.max(active, maxActive);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (url.pathname.includes("error")) throw new Error("Transient failure");
    return url.pathname.includes("missing") ? null : artwork;
  });
  await Promise.all([cache.get("same"), cache.get("same")]);
  assert.equal(calls, 1, "Concurrent lookups are deduplicated");
  const next = new CatalogueArtworkCache(db, async () => {
    throw new Error("Cache should survive service recreation");
  });
  assert.deepEqual(await next.get("same"), artwork);
  await cache.get("missing");
  await cache.get("missing");
  assert.equal(calls, 2, "Cache missing covers");
  await assert.rejects(cache.get("error"));
  await assert.rejects(cache.get("error"));
  assert.equal(calls, 4, "Retry transient errors");
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => cache.get("cover-" + i)),
  );
  assert(maxActive <= 4, "Bound upstream concurrency");
  db.prepare("UPDATE catalogue_artwork_cache SET expires = 0 WHERE id = ?").run(
    "same",
  );
  await cache.get("same");
  assert.equal(calls, 17, "Expired cache refetches");
  const fast = new CatalogueArtworkCache(db, async () => artwork);
  for (let i = 0; i < 260; i++) await fast.get("bounded-" + i);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) n FROM catalogue_artwork_cache").get() as {
        n: number;
      }
    ).n,
    256,
  );

  const service = new CatalogueService(
    {} as any,
    {
      listAlbumGroups: () => [
        {
          id: "local",
          artist: "Artist",
          album: "Album",
          files: [{ displayTags: { title: "Owned track", discnumber: "1" } }],
        },
      ],
    } as any,
  );
  service.request = (async (path: string) => {
    if (path.startsWith("release-group/"))
      return { id: "group", title: "Album", "artist-credit": [] };
    if (path === "release")
      return {
        releases: [
          { id: "edition", date: "2020", media: [{ "track-count": 2 }] },
        ],
      };
    return {
      id: "edition",
      media: [
        {
          position: 1,
          tracks: [
            { position: 1, title: "Owned track", length: 1000 },
            { position: 2, title: "Missing track", length: 2000 },
          ],
        },
      ],
    };
  }) as any;
  const release = await service.release("group", "Artist", "local");
  assert.equal(release.ownedTracks, 1);
  assert.deepEqual(
    release.tracks.map((t) => t.owned),
    [true, false],
  );
  console.log(
    "PASS: persistent cache, deduplication, miss caching, transient retries, concurrency, expiry, bounded storage and track ownership.",
  );
} finally {
  db.close();
}
