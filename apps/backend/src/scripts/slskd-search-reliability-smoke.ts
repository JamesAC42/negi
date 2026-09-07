import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { getBackendConfig } from "../config.js";
import { SlskdService } from "../services/slskd-service.js";

const downloadDirectory = await mkdtemp(join(tmpdir(), "music-os-slskd-search-smoke-"));
const settings: Record<string, string> = {
  MUSIC_OS_SLSKD_BROWSE_TIMEOUT_MS: "50",
  MUSIC_OS_SLSKD_SEARCH_TIMEOUT_MS: "10",
  MUSIC_OS_SLSKD_SEARCH_GRACE_MS: "1",
  MUSIC_OS_SLSKD_SEARCH_QUEUE_TIMEOUT_MS: "150",
  MUSIC_OS_SLSKD_SEARCH_INITIAL_POLL_MS: "1",
  MUSIC_OS_SLSKD_SEARCH_POLL_MAX_MS: "1",
  MUSIC_OS_SLSKD_SEARCH_PARTIAL_AFTER_MS: "1",
  MUSIC_OS_SLSKD_SEARCH_COMPLETED_EMPTY_GRACE_MS: "1",
};
const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
Object.assign(process.env, settings);
let transferRecords: Record<string, unknown>[] = [];
const cancelled: string[] = [];
let rejectCancellation = false;
let stallBrowse = false;
let browseRequests = 0;
let active = 0;
let maximumActive = 0;
let nextId = 0;
const searches = new Map<string, { query: string; created: number; polls: number }>();
const server = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url?.startsWith("/api/v0/users/")) {
    browseRequests++;
    if (stallBrowse) return;
    let body = "";
    for await (const chunk of req) body += chunk;
    const { directory } = JSON.parse(body) as { directory: string };
    res.end(JSON.stringify([
      { name: directory, files: [
        { filename: "01 Song.flac", size: 123, length: 174, sampleRate: 96000 },
        { filename: directory + "/02 Another.flac", size: 456, isLocked: true },
        { filename: "../Outside.flac", size: 123 },
        { filename: "Elsewhere/Outside.flac", size: 123 },
        { filename: "Cover.jpg", size: 789 },
      ] },
      { name: "Other/Album", files: [{ filename: "03 Wrong.flac", size: 123 }] },
    ]));
    return;
  }
  if (req.url?.startsWith("/api/v0/transfers/downloads")) {
    if (req.method === "DELETE") {
      if (rejectCancellation) { res.statusCode = 503; res.end('{}'); return; }
      const id = req.url.split("/").at(-1)!.split("?")[0]!;
      cancelled.push(id);
      transferRecords.find((record) => record.id === id)!.state = "Completed, Cancelled";
      res.statusCode = 204;
      res.end();
      return;
    }
    res.end(JSON.stringify(transferRecords));
    return;
  }
  if (req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const query = (JSON.parse(body) as { searchText: string }).searchText;
    const id = String(++nextId);
    searches.set(id, { query, created: Date.now(), polls: 0 });
    active++;
    maximumActive = Math.max(maximumActive, active);
    res.end(JSON.stringify({ id }));
    return;
  }
  const id = req.url!.split("/").at(-1)!.split("?")[0]!;
  const search = searches.get(id)!;
  search.polls++;
  const complete = search.query !== "stuck" && Date.now() - search.created >= 35;
  const files = [{ username: "peer", files: [{ filename: "Artist/Album/01 Song.flac", size: 123 }] }];
  if (complete) active--;
  res.end(JSON.stringify({ state: complete ? "Completed, TimedOut" : "InProgress", isComplete: complete,
    fileCount: 1, responses: complete || search.query === "preview" ? files : [] }));
});
try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = new SlskdService({ ...getBackendConfig(), slskdDownloadDirectory: downloadDirectory, slskdUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  const searchesCompleted = await Promise.all([
    client.search("first album", 100, { waitForComplete: true, attempts: 1 }),
    client.search("second album", 100, { waitForComplete: true, attempts: 1 }),
  ]);
  assert.equal(maximumActive, 1, "Concurrent album searches must not flood the outgoing network queue");
  assert(searchesCompleted.every((search) => search.total === 1), "Wait past nominal search timeout for delayed result publication");
  await assert.rejects(client.search("stuck", 100, { waitForComplete: true, attempts: 1 }), /does not mean the album is unavailable/);
  const preview = await client.search("preview", 1, { attempts: 1 });
  assert.equal(preview.total, 1);
  assert.equal(searches.get(String(nextId))!.polls, 1, "Manual preview remains immediate when response bodies exist");
  const selected = searchesCompleted[0]!.results;
  const seed = { ...selected[0]!, hasFreeUploadSlot: true, uploadSpeedBytesPerSecond: 1000000, queueLength: 0 };
  const folder = await client.browseResultFolder(seed);
  assert.deepEqual(folder.map((file) => file.path), ["Artist/Album/01 Song.flac", "Artist/Album/02 Another.flac"]);
  assert.equal(folder[0]!.raw.filename, "Artist/Album/01 Song.flac", "Downloads must retain the complete remote filename");
  assert.equal(folder[0]!.username, seed.username);
  assert.equal(folder[0]!.hasFreeUploadSlot, true);
  assert.equal(folder[0]!.uploadSpeedBytesPerSecond, 1000000);
  assert.equal(folder[0]!.sampleRate, 96000);
  assert.equal(folder[1]!.isLocked, true, "Directory expansion must preserve locked files");
  const windowsPath = String.raw`Artist\Album\01 Song.flac`;
  const windowsFolder = await client.browseResultFolder({ ...seed, path: windowsPath, raw: { filename: windowsPath } });
  assert.equal(windowsFolder[0]!.path, windowsPath, "Soulseek Windows separators are preserved");
  const beforeLocked = browseRequests;
  assert.deepEqual(await client.browseResultFolder({ ...seed, isLocked: true }), []);
  assert.equal(browseRequests, beforeLocked, "Never browse a locked search anchor");
  stallBrowse = true;
  await assert.rejects(client.browseResultFolder(seed), /timeout|aborted/i, "An offline folder must not block research indefinitely");
  const queued = { id: "selected", username: "peer", filename: "Artist/Album/01 Song.flac", size: 123, state: "Queued, Remotely" };
  transferRecords = Array.from({ length: 14 }, (_, index) => ({ ...queued, id: String(index),
    state: index === 13 ? "Completed, TimedOut" : "Completed, Rejected" }));
  const timedOutAlbum = await client.inspectDownloadResults(selected);
  assert.equal(timedOutAlbum.transfers.failed, 14, "All rejected/timed-out album files must trigger failed-source recovery");
  assert.equal(timedOutAlbum.transfers.completed, 0, "Completed, TimedOut is terminal failure, not download success");
  assert.deepEqual(timedOutAlbum.completedPaths, []);
  transferRecords = ["Cancelled", "TimedOut", "Errored", "Rejected", "Aborted", "Succeeded"]
    .map((state, index) => ({ ...queued, id: String(index), state: "Completed, " + state }));
  const terminalStates = await client.inspectDownloadResults(selected);
  assert.equal(terminalStates.transfers.failed, 5, "Cover every upstream slskd failed terminal state");
  assert.equal(terminalStates.transfers.completed, 1, "Succeeded remains a successful transfer");
  transferRecords = [
    { ...queued },
    { ...queued, id: "other-peer", username: "another-peer" },
    { ...queued, id: "other-folder", filename: "Other/Album/01 Song.flac" },
    { ...queued, id: "other-size", size: 999 },
  ];
  await client.cancelDownloadResults(selected);
  assert.deepEqual(cancelled, ["selected"], "Cancellation only touches exact selected source, full path and size");
  transferRecords = [{ ...queued, state: "InProgress" }];
  await assert.rejects(client.cancelDownloadResults(selected), /no longer exclusively queued/);
  assert.equal(cancelled.length, 1, "An active source must keep being monitored");
  rejectCancellation = true;
  transferRecords = [{ ...queued }];
  await assert.rejects(client.cancelDownloadResults(selected), /503/);
  assert.equal(cancelled.length, 1, "Failed cancellation cannot authorize source failover");
  console.log("PASS: queued search completion, serialized album searches, stalled-search errors, manual previews, exact queued-transfer cancellation, and bounded exact-folder expansion, and terminal transfer classification");
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(downloadDirectory, { recursive: true, force: true });
}
