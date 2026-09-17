import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentMessageResponseSchema, agentRunRequestSchema, tasteProfileSchema, type CatalogueArtist, type CatalogueAlbum, type DiscoveryResult, type AcquisitionJob, type AgentMessageResponse } from "@music-os/core";
import { createBackendApp } from "../app.js";
import { AgentCatalogService, agentCapabilities, parseCatalogRequest } from "../services/agent-catalog-service.js";
import { AgentService } from "../services/agent-service.js";
import { AgentRunService } from "../services/agent-run-service.js";
import { AlbumAcquisitionService } from "../services/album-acquisition-service.js";
import { inspectReleaseFiles } from "../services/album-source-matching.js";
import { parseAgentModelPlan } from "../services/agent-model-provider.js";

const directory = await mkdtemp(join(tmpdir(), "music-os-agent-catalog-"));
const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath: join(directory, "fixture.sqlite"), mpvPath: "mpv", musicBrainzEnabled: false });
try {
  const artist: CatalogueArtist = { id: "apple:1", provider: "apple", name: "Fixture Artist", description: "A fixture", country: null, type: null, begin: null, end: null, tags: ["Dream Pop"] };
  const makeAlbum = (id: number, title: string, status: CatalogueAlbum["libraryStatus"] = "missing"): CatalogueAlbum => ({
    id: "apple:" + id, provider: "apple", title, date: "2025-01-01", type: "Album", secondaryTypes: [], ownedTracks: status === "complete" ? 9 : 0, libraryStatus: status, libraryAlbumId: null,
  });
  const calls: number[] = [];
  let searches = 0;
  const catalog = {
    async searchArtists(query: string) { searches++; return [{ ...artist, name: query }, { ...artist, id: "apple:2", name: query + " Tribute" }]; },
    async browse(id: string, name: string, offset = 0) {
      calls.push(offset);
      return { artist, albums: offset === 0 ? [makeAlbum(10, "Already owned", "complete"), makeAlbum(11, "New Album")] : [makeAlbum(12, "Second Album")], total: 3, nextOffset: offset === 0 ? 24 : null };
    },
    async release() { throw new Error("Plan building must not download or look up all track lists."); },
  };
  const jobs: AcquisitionJob[] = [];
  const createRequests: unknown[] = [];
  const acquisition = {
    create(request: { artist: string; album: string }) {
      createRequests.push(request);
      const job: AcquisitionJob = { id: "job-" + jobs.length, artist: request.artist, album: request.album, status: "queued", progress: 0, message: "Queued", error: null, createdAt: new Date().toISOString() };
      jobs.push(job);
      return job;
    },
    list() { return jobs; },
  };
  const profile = tasteProfileSchema.parse({ favoriteArtists: ["Fixture Artist", "Blocked Artist"], preferredGenres: ["Dream Pop"], blockedArtists: ["Blocked Artist"], preferredFormats: ["flac"], qualityPreferences: { preferLossless: true, allowMp3IfRare: false, minimumBitrateKbps: 320 } });
  const result = (id: string, extension: string, bitrate: number, title = "Song"): DiscoveryResult => ({
    id, source: "slskd", username: "fixture-peer-" + id, filename: "01 " + title + "." + extension,
    path: "Fixture Artist/New Album/01 " + title + "." + extension, folder: "Fixture Artist/New Album", extension, bitrate, sizeBytes: 40_000_000, sampleRate: 44100, lengthSeconds: 180,
    isLocked: false, hasFreeUploadSlot: true, uploadSpeedBytesPerSecond: 1_000_000, queueLength: 0, raw: {},
  });
  const remote = [result("flac", "flac", 900_000), result("mp3", "mp3", 320_000), result("wrong-song", "flac", 900_000, "Different Song")];
  remote.push({ ...result("wrong-artist", "flac", 900000), path: "Fixture Artistry/New Album/01 Song.flac" });
  const makeService = () => new AgentCatalogService(app.db, catalog, catalog, {
    async getComplete() { return { artistId: artist.id, resolvedArtistId: null, artists: [
      { artist: { ...artist, name: "Blocked Artist", id: "apple:3" }, reasons: ["Listener connection"], sources: ["musicmap" as const], connection: "related" as const, strength: 1, sharedTags: [], libraryAlbumCount: 0, libraryMatch: "none" as const },
      { artist: { ...artist, name: "Related Artist", id: "apple:4" }, reasons: ["Shared Dream Pop"], sources: ["musicmap" as const], connection: "related" as const, strength: 1, sharedTags: [], libraryAlbumCount: 0, libraryMatch: "none" as const },
    ], sources: [], note: null }; }
  }, acquisition, { async search(query) { return { query, results: remote, total: remote.length }; } }, app.operations, { getEffectiveProfile: () => profile });
  let service = makeService();
  const choose = async (previous: AgentMessageResponse, label: string, key: string) => {
    const choice = previous.catalogPlan!.choices.find((entry) => entry.label === label);
    assert.ok(choice, "Missing choice: " + label);
    return service.choose(previous, choice.id, key);
  };
  assert.equal(agentCapabilities.length, 10);
  assert.equal(parseCatalogRequest("Make a playlist like Fixture Artist"), null);
  assert.equal(parseCatalogRequest("Download the discography of Fixture Artist")?.capability, "discography");
  assert.equal(parseCatalogRequest("Find missing albums by Fixture Artist")?.query, "Fixture Artist");

  const first = (await service.handle("Download the discography of Fixture Artist"))!;
  assert.equal(first.catalogPlan?.status, "clarification");
  assert.equal(jobs.length, 0);
  const scope = await choose(first, "Fixture Artist", "artist-choice");
  assert.equal(scope.catalogPlan?.title, "What should I collect by Fixture Artist?");
  const review = await choose(scope, "Whole catalog", "scope-choice");
  assert.deepEqual(calls, [0, 24], "Must enumerate every catalog page");
  assert.deepEqual(review.catalogPlan?.items.map((item) => item.title), ["New Album", "Second Album"]);
  assert.equal(jobs.length, 0, "Review must not start downloads");
  agentMessageResponseSchema.parse(review);
  const accepted = await choose(review, "Download all 2 releases", "accepted-plan");
  assert.equal(jobs.length, 2);
  assert.equal(accepted.catalogPlan?.status, "queued");
  assert.deepEqual(accepted.catalogPlan?.jobIds, ["job-0", "job-1"]);
  assert.ok(JSON.stringify(createRequests).includes("minimumBitrateKbps"));
  service = makeService();
  assert.deepEqual(await choose(review, "Download all 2 releases", "accepted-plan"), JSON.parse(JSON.stringify(accepted)));
  assert.equal(jobs.length, 2, "Restart/repeated acceptance must not enqueue duplicates");
  await assert.rejects(service.choose(review, "made-up-id", "forged"), /no longer available/);

  const taste = (await service.handle("Recommend albums based on my taste"))!;
  assert.deepEqual(taste.catalogPlan?.choices.map((item) => item.label), ["Fixture Artist"]);
  const relatedFirst = (await service.handle("Find artists similar to Fixture Artist"))!;
  const related = await choose(relatedFirst, "Fixture Artist", "related");
  assert.deepEqual(related.catalogPlan?.choices.map((item) => item.label), ["Related Artist"]);

  const song = (await service.handle("Find the song Song by Fixture Artist"))!;
  assert.deepEqual(song.catalogPlan?.items.map((item) => item.id), ["flac"], "Wrong artist, extra title tokens, and blocked formats must not be proposed");
  const trackReview = await service.choose(song, song.catalogPlan!.choices[0]!.id, "track-pick");
  const trackBatch = await choose(trackReview, "Download this track", "track-accepted");
  assert.equal(trackBatch.operationBatch?.operations.length, 1);
  assert.equal(trackBatch.operationBatch?.operations[0]?.type, "queue_download");
  const payload = trackBatch.operationBatch!.operations[0]!.payload as { results: DiscoveryResult[] };
  assert.equal(payload.results[0]?.id, "flac", "Download batch must persist the actual source");
  assert.ok(!trackBatch.operationBatch?.operations.some((operation) => operation.type === "create_playlist"));

  profile.qualityPreferences.allowMp3IfRare = true;
  const mp3Search = (await service.handle("Find the song Song by Fixture Artist"))!;
  const mp3Choice = mp3Search.catalogPlan!.choices.find((entry) => entry.action.itemId === "mp3")!;
  const mp3Review = await service.choose(mp3Search, mp3Choice.id, "mp3-review");
  profile.qualityPreferences.allowMp3IfRare = false;
  const operationCount = app.db.prepare("SELECT COUNT(*) AS count FROM operation_batches").get() as { count: number };
  await assert.rejects(choose(mp3Review, "Download this track", "stale-quality"), /quality preferences changed/);
  assert.deepEqual(app.db.prepare("SELECT COUNT(*) AS count FROM operation_batches").get(), operationCount);
  const ambiguousSong = (await service.handle("Find the song Stand by Me by Ben E. King"))!;
  assert.equal(ambiguousSong.catalogPlan?.title, "Clarify the song and artist");
  const quotedSong = (await service.handle('Find the song "Stand by Me" by Ben E. King'))!;
  assert.equal(quotedSong.catalogPlan?.title, "Choose a song source");
  assert.ok(!quotedSong.catalogPlan?.summary.includes("by Me by"));
  const tracks = [{ title: "Song", disc: 1, number: 1, durationMs: 180000 }];
  const low = result("low", "mp3", 192000);
  const high = result("high", "mp3", 320000);
  const quality = inspectReleaseFiles([low, high], tracks, "Fixture Artist", "New Album", tracks, { preferredFormats: ["mp3"], qualityPreferences: { preferLossless: false, allowMp3IfRare: true, minimumBitrateKbps: 320 } });
  assert.equal(quality.picks[0]?.result.id, "high");
  const losslessOnly = inspectReleaseFiles([high], tracks, "Fixture Artist", "New Album", tracks, profile);
  assert.equal(losslessOnly.picks.length, 0);
  const mp3Preferred = inspectReleaseFiles([remote[0]!, high], tracks, "Fixture Artist", "New Album", tracks, { preferredFormats: ["mp3"], qualityPreferences: { preferLossless: false, allowMp3IfRare: true, minimumBitrateKbps: 320 } });
  assert.equal(mp3Preferred.picks[0]?.result.id, "high");

  const thread = app.agentThreads.createThread("Catalog test").thread;
  const runs = new AgentRunService(app.db, app.agent, undefined, undefined, undefined, false, service);
  const run = await runs.run("Download the album New Album", thread.id);
  assert.equal(run.status, "completed");
  const followup = await runs.run("Fixture Artist", thread.id);
  assert.equal(followup.response?.catalogPlan?.choices[0]?.label, "Fixture Artist");
  const songClarification = await runs.run("Find the song Song", thread.id);
  assert.equal(songClarification.response?.catalogPlan?.title, "Who performs this song?");
  const songContinuation = await runs.run("Fixture Artist", thread.id);
  assert.deepEqual(songContinuation.response?.catalogPlan?.items.map((item) => item.id), ["flac"]);
  const songReviewRun = await runs.run("Review song", thread.id, { runId: songContinuation.id, choiceId: songContinuation.response!.catalogPlan!.choices[0]!.id });
  const songOperationRun = await runs.run("Download this track", thread.id, { runId: songReviewRun.id, choiceId: songReviewRun.response!.catalogPlan!.choices[0]!.id });
  const songOperation = songOperationRun.response!.operationBatch!;
  app.operations.approveBatch(songOperation.id);
  const reloaded = app.agentThreads.getThread(thread.id).messages.find((message) => message.response?.operationBatch?.id === songOperation.id);
  assert.equal(reloaded?.response?.operationBatch?.status, "approved", "Reopening a conversation must read the current operation status");

  const preferenceAgent = new AgentService(app.library, app.operations, app.playback, undefined, undefined, {
    getProfile: () => app.tasteProfile.getProfile(), getEffectiveProfile: () => profile,
  });
  assert.deepEqual(preferenceAgent.getPlanningContext().tasteProfile?.preferredGenres, ["Dream Pop"]);
  const blockedPlaylist = await preferenceAgent.handleMessage("Make a playlist", {
    suggestedIntent: "research_playlist", trackCandidates: [{ artist: "Blocked Artist", title: "Never Queue" }],
  });
  assert.equal(blockedPlaylist.operationBatch, null);
  assert.match(blockedPlaylist.reply, /blocked artists/);
  const otherThread = app.agentThreads.createThread("Other").thread;
  const bad = await runs.run("Fixture Artist", otherThread.id, { runId: followup.id, choiceId: followup.response!.catalogPlan!.choices[0]!.id });
  assert.equal(bad.status, "failed");
  assert.match(bad.error!, /this conversation/);
  agentRunRequestSchema.parse({ message: "Choose", threadId: thread.id, catalogAction: { runId: run.id, choiceId: "choice" } });
  const parsed = parseAgentModelPlan(JSON.stringify({ summary: "Catalog plan", intent: "catalog", catalogRequest: { capability: "discography", query: "Fixture Artist" } }));
  assert.equal(parsed?.intent, "catalog");
  assert.equal(parsed?.catalogRequest?.capability, "discography");
  assert.ok(searches >= 2);
  // Exercise the real acquisition enqueue path with >100 jobs, without allowing
  // any worker/network/download to start. A rollback must leave no research.
  app.albumAcquisitions.close();
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(directory, "library")));
  app.library.addRoot(join(directory, "library"), "Fixture");
  let workerCalls = 0;
  const acquisitionFixture = new AlbumAcquisitionService(app.db, app.library, app.imports, app.discoveryDownloads, app.discovery, {
    async release() { workerCalls++; throw new Error("Unexpected research before commit"); },
    async resolve() { workerCalls++; throw new Error("Unexpected research before commit"); },
  } as never);
  assert.throws(() => app.db.transaction(() => {
    acquisitionFixture.create({ artist: "Rollback Artist", album: "Rollback Album" });
    assert.equal(workerCalls, 0);
    throw new Error("Rollback fixture");
  })(), /Rollback fixture/);
  await Promise.resolve();
  assert.equal(workerCalls, 0);
  const ids = app.db.transaction(() => Array.from({ length: 105 }, (_, index) => {
    const job = acquisitionFixture.create({ artist: "Bulk Artist", album: "Bulk " + index });
    assert.ok(job.id);
    assert.equal(workerCalls, 0);
    return job.id;
  }))();
  assert.equal(acquisitionFixture.list(ids).length, 105);
  assert.equal(acquisitionFixture.create({ artist: "Bulk Artist", album: "Bulk 0" }).id, ids[0], "Active deduplication must look beyond the last 100 jobs");
  acquisitionFixture.close();
  await Promise.resolve();
  assert.equal(workerCalls, 0);
  console.log(JSON.stringify({ ok: true, capabilities: agentCapabilities.length, catalogPages: calls.length, reviewRequired: true, idempotentAcceptance: true, threadIsolation: true, qualityPreferences: true, noPlaylistRequired: true }));
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
