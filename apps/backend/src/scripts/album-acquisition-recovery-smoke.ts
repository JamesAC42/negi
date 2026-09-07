import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogueTrack, DiscoveryResult } from "@music-os/core";
import { AlbumAcquisitionService } from "../services/album-acquisition-service.js";

const tracks: CatalogueTrack[] = [
  { title: "First", disc: 1, number: 1, durationMs: 180000 },
  { title: "Second", disc: 1, number: 2, durationMs: 210000 },
];
const base = { artist: "Artist", album: "Album", artistId: "apple:1", releaseGroupId: "apple:2", libraryRootId: "root", tracks };
function source(track: CatalogueTrack, peer: string): DiscoveryResult {
  const filename = `${track.number} ${track.title}.flac`;
  return { id: peer + filename, source: "slskd", username: peer, filename, path: `Artist/Album/${filename}`,
    folder: "Artist/Album", extension: "flac", sizeBytes: 4, lengthSeconds: track.durationMs! / 1000,
    bitrate: null, sampleRate: 44100, isLocked: false, raw: {} };
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
function fixture() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY,type TEXT,status TEXT,progress REAL DEFAULT 0,payload_json TEXT,
    error_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,started_at TEXT,completed_at TEXT,cancel_requested INTEGER DEFAULT 0)`);
  const owned: { displayTags: Record<string, string> }[] = [];
  const children = new Map<string, any>();
  const batches = new Map<string, any>();
  const created: DiscoveryResult[][] = [];
  const events: string[] = [];
  const library = { getAlbumCatalogue: (): { artistId: string; releaseGroupId: string; tracks: CatalogueTrack[]; year?: string } | undefined => undefined, getRoot: () => ({ id: "root" }), listRoots: () => [{ id: "root" }],
    listAlbumGroups: () => [{ id: "album", artist: "Artist", album: "Album", files: owned }],
    setFileMetadataOverrides() {} };
  const imports = { getImport: (id: string) => batches.get(id), rejectItem() {},
    updateItemMetadata(id: string, metadata: Record<string, string>) {
      events.push("metadata:" + id);
      const item = [...batches.values()].flatMap((b) => b.items).find((i) => i.id === id);
      item.metadata = metadata;
    },
    async approveItem(id: string) {
      const item = [...batches.values()].flatMap((b) => b.items).find((i) => i.id === id);
      owned.push({ displayTags: { title: item.metadata.title, discnumber: "1" } });
      item.status = "imported";
      events.push("import:" + id);
    } };
  const downloads = { getJob: (id: string) => children.get(id), cancelJob(id: string) { children.get(id).status = "cancelled"; },
    retryJob() { throw new Error("Recovery must find a different source instead of restarting the failed peer"); },
    createJob(results: DiscoveryResult[]) {
      events.push("download");
      created.push(results);
      const child = { id: "child-" + created.length, status: "running", progress: 0,
        selectedCount: results.length, completedCount: 0 };
      children.set(child.id, child);
      return child;
    } };
  const catalogue = {
    async resolve(): Promise<{ artistId: string; groupId: string }> { throw new Error("Unexpected ambiguous identity resolution"); },
    async release(id: string) { return { id, title: "Album", artistIds: ["apple:1"], tracks }; },
  };
  const discovery = { async browseResultFolder(_result: DiscoveryResult): Promise<DiscoveryResult[]> { return []; }, async search() { events.push("search"); return { results: ["peer-a", "peer-b", "peer-c", "peer-d"].flatMap((peer) => tracks.map((t) => source(t, peer))) }; } };
  const appleCatalogue = {
    resolve: (...args: Parameters<typeof catalogue.resolve>) => catalogue.resolve(...args),
    release: (...args: Parameters<typeof catalogue.release>) => catalogue.release(...args),
  };
  const service = new AlbumAcquisitionService(db, library as any, imports as any, downloads as any, discovery as any, catalogue as any, appleCatalogue as any);
  function seed(id: string, payload: object, status = "queued") {
    db.prepare("INSERT INTO jobs(id,type,status,payload_json) VALUES(?,'album_acquisition',?,?)").run(id, status, JSON.stringify(payload));
  }
  function row(id: string) { return db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as any; }
  function payload(id: string) { return JSON.parse(row(id).payload_json); }
  async function tick(count = 1) { for (let i = 0; i < count; i++) { (service as any).tick(); await flush(); } }
  function close() { service.close(); db.close(); }
  return { db, service, seed, row, payload, tick, close, owned, children, batches, created, events, catalogue, appleCatalogue, imports, discovery, library };
}


// Unidentified checks use Apple without depending on MusicBrainz availability.
for (const scenario of ["apple", "fallback", "both-fail", "pinned", "partial", "wrong-artist"] as const) {
  const f = fixture();
  let mbCalls = 0;
  let appleCalls = 0;
  f.catalogue.resolve = async () => {
    mbCalls++;
    if (scenario !== "fallback") throw new Error("MusicBrainz is temporarily unavailable (HTTP 503). Please retry shortly.");
    return { artistId: "mb-artist", groupId: "mb-album" };
  };
  f.catalogue.release = async (id) => {
    mbCalls++;
    if (scenario !== "fallback") throw new Error("MusicBrainz is temporarily unavailable (HTTP 503). Please retry shortly.");
    return { id, title: "Album", artistIds: ["mb-artist"], tracks };
  };
  f.appleCatalogue.resolve = async () => {
    appleCalls++;
    if (scenario === "fallback" || scenario === "both-fail") throw new Error("Apple unavailable");
    return { artistId: "apple:1", groupId: "apple:2" };
  };
  f.appleCatalogue.release = async (id) => ({ id, title: "Album",
    artistIds: [scenario === "wrong-artist" ? "apple:other" : "apple:1"], tracks,
    trackListingComplete: scenario !== "partial" });
  try {
    f.seed("check", { artist: "Artist", album: "Album", albumId: "album", libraryRootId: "root",
      ...(scenario === "pinned" ? { artistId: "mb-artist", releaseGroupId: "mb-album" } : {}) });
    await f.tick();
    if (scenario === "apple" || scenario === "fallback") {
      assert.equal(f.created.length, 1);
      assert.equal(f.payload("check").artistId, scenario === "apple" ? "apple:1" : "mb-artist");
      if (scenario === "apple") assert.equal(mbCalls, 0, "A valid Apple listing avoids MusicBrainz entirely");
    } else {
      assert.equal(f.row("check").status, "failed");
      assert.equal(f.created.length, 0, "Unverified listings never trigger downloads");
      if (scenario === "pinned") assert.equal(appleCalls, 0, "Explicit editions never switch provider");
      else assert.match(f.row("check").error_json, /Apple:.*MusicBrainz:/);
    }
  } finally { f.close(); }
}

// Research capacity must not prevent completed transfers from being monitored.
{
  const f = fixture();
  const releases: (() => void)[] = [];
  let pending = 0;
  let maximum = 0;
  f.catalogue.release = async (id) => {
    pending++; maximum = Math.max(maximum, pending);
    await new Promise<void>((resolve) => releases.push(resolve));
    pending--;
    return { id, title: "Album", artistIds: ["apple:1"], tracks };
  };
  try {
    for (let i = 0; i < 5; i++) f.seed("research-" + i, { ...base, tracks: undefined, album: "Album " + i });
    for (let i = 0; i < 3; i++) {
      f.children.set("done-" + i, { id: "done-" + i, status: "succeeded", imported: { id: "empty" }, completedCount: 0, selectedCount: 0 });
      f.seed("monitor-" + i, { ...base, downloadJobId: "done-" + i });
    }
    f.batches.set("empty", { items: [] });
    await f.tick();
    assert.equal(pending, 2, "Only two releases may be researched concurrently");
    for (let i = 0; i < 3; i++) assert.equal(f.row("monitor-" + i).status, "succeeded", "Transfer monitoring is unrestricted");
    assert.equal(maximum, 2);
  } finally {
    f.service.close();
    releases.forEach((resolve) => resolve());
    await flush();
    f.close();
  }
}

// An unavailable peer is excluded during a bounded automatic source recovery.
{
  const f = fixture();
  try {
    f.seed("recover", base);
    await f.tick();
    assert.equal(f.created.length, 1);
    const peers = new Set<string>();
    for (let attempt = 0; attempt < 3; attempt++) {
      const child = f.children.get(f.payload("recover").downloadJobId);
      peers.add(f.created[attempt][0].username!);
      child.status = "failed"; child.error = "Peer offline";
      await f.tick(3);
    }
    assert.equal(f.created.length, 3, "Initial attempt plus at most two automatic source retries");
    assert.equal(peers.size, 3, "Failed peer/path pairs must not be selected again");
    assert.equal(f.row("recover").status, "failed", "Exhausted recovery remains reviewable");
  } finally { f.close(); }
}

// A title hit can reveal a complete peer folder without requiring more searches.
{
  const f = fixture();
  let searches = 0;
  const browsed: string[] = [];
  f.discovery.search = async () => { searches++; return { results: [source(tracks[0], "anchor")] }; };
  f.discovery.browseResultFolder = async (anchor) => {
    browsed.push(anchor.username!);
    return tracks.map((t) => source(t, anchor.username!));
  };
  try {
    f.seed("folder", base);
    await f.tick();
    assert.equal(searches, 1);
    assert.deepEqual(browsed, ["anchor"]);
    assert.equal(f.created[0].length, 2, "A verified folder expands one title hit into the complete album");
  } finally { f.close(); }
}
{
  const f = fixture();
  const browsed: string[] = [];
  f.discovery.search = async () => ({ results: [
    { ...source(tracks[0], "wrong-album"), path: "Artist/Unrelated/1 First.flac", folder: "Artist/Unrelated" },
    { ...source(tracks[0], "locked"), isLocked: true },
    { ...source(tracks[0], "poor-quality"), extension: "mp3", bitrate: 128 },
    source(tracks[0], "offline"), source(tracks[0], "available"),
  ] });
  f.discovery.browseResultFolder = async (anchor) => {
    browsed.push(anchor.username!);
    if (anchor.username === "offline") throw new Error("Peer offline");
    return tracks.map((t) => source(t, anchor.username!));
  };
  try {
    f.seed("folder-fallback", base);
    await f.tick();
    assert.deepEqual(browsed, ["offline", "available"], "Only eligible artist/album anchors can be browsed; failures advance to another peer");
    assert.equal(f.created[0].length, 2);
  } finally { f.close(); }
}
{
  const f = fixture();
  const browsed: string[] = [];
  f.discovery.search = async () => ({ results: ["one", "two", "three", "four", "five"].map((peer) => source(tracks[0], peer)) });
  f.discovery.browseResultFolder = async (anchor) => {
    browsed.push(anchor.username!);
    return [{ ...source(tracks[1], anchor.username!), path: "Other/Album/2 Second.flac", folder: "Other/Album" }];
  };
  try {
    f.seed("bounded-folders", base);
    await f.tick();
    assert.equal(browsed.length, 3, "Folder expansion is bounded across all search queries");
    assert.equal(new Set(browsed).size, 3, "Each peer folder is browsed at most once");
    assert.equal(f.row("bounded-folders").status, "failed");
    assert.equal(f.created.length, 0, "Wrong-artist folder files cannot complete the album");
  } finally { f.close(); }
}

// Initial catalogue validation is required, then internal tracklists survive
// provider outages during both automatic source recovery and manual retry.
{
  const f = fixture();
  let lookups = 0;
  f.catalogue.release = async (id) => {
    lookups++;
    if (lookups > 1) throw new Error("Catalogue unavailable");
    return { id, title: "Album", artistIds: ["apple:1"], tracks };
  };
  try {
    f.seed("cached", { ...base, tracks: undefined });
    await f.tick();
    assert.equal(lookups, 1, "Initial requests fetch and validate the selected release");
    f.children.get(f.payload("cached").downloadJobId).status = "failed";
    await f.tick(3);
    assert.equal(lookups, 1, "Failover reuses the validated tracklist during provider outages");
    assert.equal(f.created.length, 2);
    f.db.prepare("UPDATE jobs SET status='failed' WHERE id='cached'").run();
    f.children.get(f.payload("cached").downloadJobId).status = "failed";
    f.service.retry("cached");
    await f.tick(3);
    assert.equal(lookups, 1, "Manual retry also reuses persisted validated catalogue data");
    assert.equal(f.created.length, 3);
  } finally { f.close(); }
}
{
  const f = fixture();
  f.catalogue.release = async (id) => ({ id, title: "Album", artistIds: ["apple:999"], tracks });
  try {
    f.seed("wrong-artist", { ...base, tracks: undefined });
    await f.tick();
    assert.equal(f.row("wrong-artist").status, "failed");
    assert.match(f.row("wrong-artist").error_json, /does not belong/);
    assert.equal(f.events.includes("search"), false, "Initial artist mismatch cannot search or become cached tracks");
    assert.equal(f.payload("wrong-artist").tracks, undefined);
  } finally { f.close(); }
}

// Browsable partial provider lists cannot become authoritative album snapshots.
{
  const f = fixture();
  try {
    f.catalogue.release = async (id) => ({ id, title: "Album", artistIds: ["apple:1"], tracks: [tracks[0]], trackListingComplete: false });
    f.owned.push({ displayTags: { title: tracks[0].title } });
    f.seed("partial-list", { ...base, tracks: undefined });
    await f.tick();
    assert.equal(f.row("partial-list").status, "failed");
    assert.match(f.row("partial-list").error_json, /track listing is partial/);
    assert.equal(f.payload("partial-list").tracks, undefined);
    assert.equal(f.events.includes("search"), false);
    assert.equal(f.created.length, 0);
  } finally { f.close(); }
}

// The library badge and completion action must inspect the same edition.
for (const removeTrack of [false, true]) {
  const f = fixture();
  try {
    f.library.getAlbumCatalogue = () => ({ artistId: "apple:1", releaseGroupId: "apple:2", tracks, year: "2021" });
    f.catalogue.release = async () => { throw new Error("Must reuse the verified library edition"); };
    f.owned.push(...tracks.slice(0, removeTrack ? 1 : 2).map((t) => ({ displayTags: { title: t.title } })));
    f.seed("library-completion", { artist: "Artist", album: "Album", albumId: "album", libraryRootId: "root" });
    await f.tick();
    assert.equal(f.payload("library-completion").releaseGroupId, "apple:2");
    if (removeTrack) {
      assert.equal(f.created.length, 1);
      assert.deepEqual(f.created[0].map((r) => r.filename), ["2 Second.flac"]);
    } else {
      assert.equal(f.row("library-completion").status, "succeeded");
      assert.equal(f.created.length, 0);
      assert.equal(f.events.includes("search"), false);
    }
  } finally { f.close(); }
}
{
  const f = fixture();
  try {
    f.library.getAlbumCatalogue = () => ({ artistId: "apple:1", releaseGroupId: "apple:2", tracks });
    let selected = "";
    f.catalogue.release = async (id) => { selected = id; return { id, title: "Album", artistIds: ["apple:1"], tracks }; };
    f.seed("explicit-edition", { ...base, tracks: undefined, albumId: "album", releaseGroupId: "apple:3" });
    await f.tick();
    assert.equal(selected, "apple:3", "An explicitly selected different edition cannot be replaced by the library snapshot");
  } finally { f.close(); }
}

const temp = await mkdtemp(join(tmpdir(), "music-os-acquisition-recovery-"));
try {
  const staged = join(temp, "staged-1 First.flac");
  await writeFile(staged, "data");
  for (const failMetadata of [false, true]) {
    const f = fixture();
    try {
      const picks = tracks.map((track) => ({ track, result: source(track, "failed-peer") }));
      f.seed("partial", { ...base, picks, downloadJobId: "partial-child" });
      f.children.set("partial-child", { id: "partial-child", status: "succeeded", imported: { id: "partial-batch" }, selectedCount: 2, completedCount: 1 });
      f.batches.set("partial-batch", { items: [{ id: "first", stagingPath: staged, status: "pending" }] });
      if (failMetadata) f.imports.updateItemMetadata = () => { throw new Error("Metadata update failed"); };
      await f.tick(3);
      if (failMetadata) {
        assert.equal(f.row("partial").status, "failed");
        assert.equal(f.payload("partial").downloadJobId, "partial-child", "Import failures retain the successful child and staged files");
        assert.equal(f.created.length, 0, "Import failures must not redownload successful transfers");
        f.imports.updateItemMetadata = (id, metadata) => { f.batches.get("partial-batch").items[0].metadata = metadata; };
        f.service.retry("partial");
        await f.tick(3);
      }
      assert.equal(f.owned.length, 1, "Completed partial files are imported before recovery");
      assert.equal(f.created.length, 1);
      assert.deepEqual(f.created[0].map((r) => r.filename), ["2 Second.flac"], "Only missing tracks are searched again");
      assert.ok(f.events.indexOf("import:first") < f.events.indexOf("search"));
    } finally { f.close(); }
  }
} finally { await rm(temp, { recursive: true, force: true }); }

{
  const f = fixture();
  try {
    f.children.set("cancelled-child", { id: "cancelled-child", status: "failed" });
    f.seed("cancelled", { ...base, downloadJobId: "cancelled-child" }, "cancelled");
    await f.tick(3);
    assert.equal(f.created.length, 0);
    assert.equal(f.row("cancelled").status, "cancelled");
  } finally { f.close(); }
}

for (const ambiguous of [false, true]) {
  const f = fixture();
  try {
    f.owned.push(...tracks.map((t) => ({ displayTags: { title: t.title } })));
    f.seed("prior", base, "succeeded");
    if (ambiguous) f.seed("other-edition", { ...base, releaseGroupId: "apple:3" }, "succeeded");
    f.seed("legacy", { artist: "Artist", album: "Album", libraryRootId: "root" });
    await f.tick();
    assert.equal(f.row("legacy").status, ambiguous ? "failed" : "succeeded");
    if (!ambiguous) assert.equal(f.payload("legacy").releaseGroupId, "apple:2");
    else assert.match(f.row("legacy").error_json, /ambiguous identity/);
  } finally { f.close(); }
}
console.log("PASS: bounded research, unrestricted transfer monitoring, alternate-source retries and retry limit, partial imports, retained import links, cancellation and unambiguous historical identity recovery");
