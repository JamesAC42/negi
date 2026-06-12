import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentParsedListItem, SaveDiscoveryListRequest } from "@music-os/core";
import type { BackendApp } from "../app.js";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-saved-discovery-lists-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
let app: BackendApp | null = null;

try {
  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });

  const saved = app.savedDiscoveryLists.saveList(makeList());
  assert(saved.name === "RYM Japanese disco", `unexpected saved list name: ${saved.name}`);
  assert(saved.itemCount === 2, `expected two items, got ${saved.itemCount}`);
  assert(saved.missingCount === 1, `expected one missing item, got ${saved.missingCount}`);
  assert(saved.ownedCount === 1, `expected one owned item, got ${saved.ownedCount}`);
  assert(app.savedDiscoveryLists.listLists().length === 1, "expected one saved parsed list");

  app.close();
  app = null;

  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const restored = app.savedDiscoveryLists.listLists();
  assert(restored.length === 1, `expected one restored list, got ${restored.length}`);
  assert(restored[0]?.items[0]?.query === "Yellow Magic Orchestra Solid State Survivor", "parsed rows should survive restart");

  app.savedDiscoveryLists.removeList(restored[0]!.id);
  assert(app.savedDiscoveryLists.listLists().length === 0, "removed parsed list should not be listed");

  app.close();
  app = null;
  console.log(JSON.stringify({ ok: true, savedId: saved.id }, null, 2));
} finally {
  app?.close();
  await rm(fixtureDir, { recursive: true, force: true });
}

function makeList(): SaveDiscoveryListRequest {
  return {
    name: "RYM Japanese disco",
    originalText: "1. Yellow Magic Orchestra - Solid State Survivor (1979)\n2. Taeko Onuki - Sunshower (1977)",
    items: [
      makeItem(1, "Yellow Magic Orchestra", "Solid State Survivor", "1979", 0),
      makeItem(2, "Taeko Onuki", "Sunshower", "1977", 1)
    ]
  };
}

function makeItem(
  rank: number,
  artist: string,
  title: string,
  year: string,
  ownedMatchCount: number
): AgentParsedListItem {
  return {
    rank,
    artist,
    title,
    year,
    query: `${artist} ${title}`,
    ownedMatchCount
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
