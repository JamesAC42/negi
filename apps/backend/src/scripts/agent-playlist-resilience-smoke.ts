import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentMessageResponse, DiscoveryDownloadJob, DiscoveryResult } from "@music-os/core";
import { createBackendApp, type BackendApp } from "../app.js";
import { AgentPlaylistWorkflowService } from "../services/agent-playlist-workflow-service.js";
import { OperationService } from "../services/operation-service.js";
import type { DiscoveryDownloadService } from "../services/discovery-download-service.js";

const fixture = await mkdtemp(join(tmpdir(), "music-os-playlist-resilience-"));
let app: BackendApp | undefined;
try {
  const libraryPath = join(fixture, "library");
  await mkdir(libraryPath);
  await writeFile(join(libraryPath, "owned.mp3"), makeId3Fixture("Owned", "Owned Artist", "Owned Album", "2000"));
  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath: join(fixture, "db.sqlite"), mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "fixture");
  await app.scanner.scanRoot(root);
  const owned = app.db.prepare("SELECT id FROM files WHERE staged = 0").get() as { id: string };
  const firstPath = join(fixture, "first.mp3");
  const secondPath = join(fixture, "second.mp3");
  await writeFile(firstPath, makeId3Fixture("First", "First Artist", "First Album", "2001"));
  await writeFile(secondPath, makeId3Fixture("Second", "Second Artist", "Second Album", "2002"));
  const selected = [
    makeDiscoveryResult("first", "First Artist", "First", firstPath, 1000),
    makeDiscoveryResult("second", "Second Artist", "Second", secondPath, 1000)
  ];
  const imported = await app.imports.createFromSlskdDownloads([secondPath, firstPath], root.id, { selectedResults: selected });
  const firstItem = imported.items.find((item) => item.detectedTitle === "First")!;
  const secondItem = imported.items.find((item) => item.detectedTitle === "Second")!;
  const job: DiscoveryDownloadJob = {
    id: "fixture-job", status: "succeeded", progress: 1, selectedCount: 3, completedCount: 2,
    imported, message: null, error: null, createdAt: "", startedAt: "", completedAt: ""
  };
  const downloads = {
    createJob: () => job,
    getJob: () => ({ ...job, imported: job.imported ? app!.imports.getImport(job.imported.id) : null })
  };
  const operations = new OperationService(app.db, app.imports, app.library, downloads);
  const workflows = new AgentPlaylistWorkflowService(app.db, app.library, operations, app.imports, app.playlists, downloads as unknown as DiscoveryDownloadService);
  let importBatches = 0;
  let failFirst = true;
  const approvedIds: string[] = [];
  const approveItem = app.imports.approveItem.bind(app.imports);
  app.imports.approveItem = async (id, rootId) => {
    approvedIds.push(id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (id === firstItem.id && failFirst) throw new Error("Fixture source unavailable");
    return approveItem(id, rootId);
  };
  const applyBatch = operations.applyBatch.bind(operations);
  operations.applyBatch = async (id) => {
    if (operations.getBatch(id).operations.some((op) => op.type === "import_file")) importBatches += 1;
    return applyBatch(id);
  };
  const queue = operations.createQueueDownloadBatch(selected, "fixture", "agent", root.id);
  operations.approveBatch(queue.id);
  await operations.applyBatch(queue.id);
  const thread = app.agentThreads.createThread("Resilience fixture").thread;
  app.db.prepare(`INSERT INTO agent_playlist_workflows
    (id, thread_id, operation_batch_id, status, playlist_name, owned_file_ids_json, playlist_item_refs_json, download_job_id)
    VALUES (?, ?, ?, 'waiting_for_download', ?, ?, ?, ?)`).run(
      "workflow", thread.id, queue.id, "Partial fixture", JSON.stringify([owned.id]),
      JSON.stringify([{ type: "download", discoveryId: "first" }, { type: "owned", fileId: owned.id },
        { type: "download", discoveryId: "second" }, { type: "download", discoveryId: "missing" }]), job.id
    );

  // Polling and the download callback can overlap the import await.
  await Promise.all([workflows.advance("workflow"), workflows.advanceAll(), workflows.advanceForDownloadJob(job.id),
    ...Array.from({ length: 8 }, () => workflows.advance("workflow"))]);
  let workflow = workflows.listWorkflows().find((item) => item.id === "workflow")!;
  assert.equal(workflow.status, "partial");
  assert.equal(importBatches, 1, "overlapping workflow events must share one import batch");
  assert.equal(approvedIds.length, 2, "each pending item is attempted exactly once");
  assert.deepEqual(workflow.delivery, {
    requestedTrackCount: 4, readyTrackCount: 2, missingTrackCount: 2, pendingImportCount: 1,
    tracks: [
      { discoveryId: "first", fileId: firstItem.fileId, state: "pending" },
      { discoveryId: null, fileId: owned.id, state: "owned" },
      { discoveryId: "second", fileId: secondItem.fileId, state: "imported" },
      { discoveryId: "missing", fileId: null, state: "missing" }
    ]
  });
  assert.match(workflow.error!, /Fixture source unavailable/);
  assert.ok(workflow.playlistId);
  const playlistId = workflow.playlistId;
  assert.deepEqual(app.playlists.getPlaylist(playlistId).items.map((item) => item.file.id), [owned.id, secondItem.fileId]);
  assert.equal(app.agentThreads.getThread(thread.id).messages.length, 1, "one partial result message");

  await workflows.advanceAll();
  await workflows.advance("workflow");
  assert.equal(importBatches, 1, "terminal partial results must not automatically retry");

  // Explicit recovery imports only the failed item, adds it at its planned position,
  // and retains user additions and the existing playlist identity.
  const extraPath = join(libraryPath, "user-extra.mp3");
  await writeFile(extraPath, makeId3Fixture("User Extra", "User Artist", "User Album", "2003"));
  await app.scanner.scanRoot(root);
  const extra = app.db.prepare("SELECT id FROM files WHERE path = ?").get(extraPath) as { id: string };
  const addExtra = operations.createAddTracksToPlaylistBatch(playlistId, [extra.id]);
  operations.approveBatch(addExtra.id);
  await operations.applyBatch(addExtra.id);
  // Historical workflows stopped at failed even though other items imported.
  app.db.prepare("UPDATE agent_playlist_workflows SET status = 'failed', error = 'Historical import failure' WHERE id = 'workflow'").run();
  failFirst = false;
  await Promise.all([workflows.resume("workflow"), workflows.resume("workflow")]);
  workflow = workflows.listWorkflows().find((item) => item.id === "workflow")!;
  assert.equal(workflow.status, "partial", "one missing download must remain visible after import recovery");
  assert.equal(workflow.playlistId, playlistId);
  assert.deepEqual(workflow.delivery, {
    requestedTrackCount: 4, readyTrackCount: 3, missingTrackCount: 1, pendingImportCount: 0,
    tracks: [
      { discoveryId: "first", fileId: firstItem.fileId, state: "imported" },
      { discoveryId: null, fileId: owned.id, state: "owned" },
      { discoveryId: "second", fileId: secondItem.fileId, state: "imported" },
      { discoveryId: "missing", fileId: null, state: "missing" }
    ]
  });
  assert.equal(approvedIds.filter((id) => id === firstItem.id).length, 2);
  assert.equal(approvedIds.filter((id) => id === secondItem.id).length, 1, "successful imports must not be retried");
  assert.deepEqual(app.playlists.getPlaylist(playlistId).items.map((item) => item.file.id), [firstItem.fileId, owned.id, secondItem.fileId, extra.id]);
  const messages = app.agentThreads.getThread(thread.id).messages.length;
  const batches = operations.listBatches().length;
  await workflows.resume("workflow");
  assert.equal(operations.listBatches().length, batches, "repeat recovery must not create another operation or playlist");
  assert.equal(app.agentThreads.getThread(thread.id).messages.length, messages, "unchanged partial result must not post again");

  // Total download failure still saves the usable owned portion as a playlist.
  job.status = "failed";
  job.error = "Fixture peer disconnected";
  job.imported = null;
  job.completedCount = 0;
  job.selectedCount = 1;
  app.db.prepare(`INSERT INTO agent_playlist_workflows
    (id, thread_id, operation_batch_id, status, playlist_name, owned_file_ids_json, playlist_item_refs_json, download_job_id)
    VALUES ('failed-download', ?, ?, 'waiting_for_download', 'Owned survives', ?, ?, ?)`).run(
      thread.id, queue.id, JSON.stringify([owned.id]),
      JSON.stringify([{ type: "owned", fileId: owned.id }, { type: "download", discoveryId: "missing" }]), job.id
    );
  await workflows.advance("failed-download");
  const failedDownload = workflows.listWorkflows().find((item) => item.id === "failed-download")!;
  assert.equal(failedDownload.status, "partial");
  assert.deepEqual(failedDownload.delivery, {
    requestedTrackCount: 2, readyTrackCount: 1, missingTrackCount: 1, pendingImportCount: 0,
    tracks: [
      { discoveryId: null, fileId: owned.id, state: "owned" },
      { discoveryId: "missing", fileId: null, state: "missing" }
    ]
  });
  assert.ok(failedDownload.playlistId);
  assert.equal(app.playlists.getPlaylist(failedDownload.playlistId).items.length, 1);

  // Different albums often share filenames. Resolve the longest path suffix,
  // and use insertion order even when the public import list is sorted differently.
  const duplicatePaths = [join(fixture, "Album A", "01 - Intro.mp3"), join(fixture, "Album B", "01 - Intro.mp3")];
  await mkdir(join(fixture, "Album A"));
  await mkdir(join(fixture, "Album B"));
  await writeFile(duplicatePaths[0]!, makeId3Fixture("Intro A", "Artist A", "Album A", "2004"));
  await writeFile(duplicatePaths[1]!, makeId3Fixture("Intro B", "Artist B", "Album B", "2005"));
  const duplicates = duplicatePaths.map((path, index) => ({
    ...makeDiscoveryResult(`duplicate-${index}`, `Artist ${index}`, "Intro", path, 1000),
    path: `Remote Folder\\Album ${index === 0 ? "A" : "B"}\\01 - Intro.mp3`
  }));
  const duplicateImport = await app.imports.createFromSlskdDownloads([duplicatePaths[1]!, duplicatePaths[0]!], root.id, { selectedResults: duplicates });
  const itemA = duplicateImport.items.find((item) => item.detectedTitle === "Intro A")!;
  const itemB = duplicateImport.items.find((item) => item.detectedTitle === "Intro B")!;
  app.db.prepare("UPDATE import_items SET created_at = '2020-01-01' WHERE id = ?").run(itemA.id);
  app.db.prepare("UPDATE import_items SET created_at = '2020-01-02' WHERE id = ?").run(itemB.id);
  job.status = "succeeded";
  job.error = null;
  job.imported = duplicateImport;
  job.completedCount = 2;
  job.selectedCount = 2;
  app.db.prepare(`INSERT INTO agent_playlist_workflows
    (id, operation_batch_id, status, playlist_name, owned_file_ids_json, playlist_item_refs_json, download_job_id)
    VALUES ('duplicate-names', ?, 'waiting_for_download', 'Duplicate names', '[]', ?, ?)`).run(
      queue.id, JSON.stringify([{ type: "download", discoveryId: "duplicate-0" }, { type: "download", discoveryId: "duplicate-1" }]), job.id
    );
  await workflows.advance("duplicate-names");
  const duplicateWorkflow = workflows.listWorkflows().find((item) => item.id === "duplicate-names")!;
  assert.equal(duplicateWorkflow.status, "completed");
  assert.ok(duplicateWorkflow.playlistId);
  assert.deepEqual(app.playlists.getPlaylist(duplicateWorkflow.playlistId).items.map((item) => item.file.id), [itemA.fileId, itemB.fileId]);
  assert.deepEqual(duplicateWorkflow.delivery?.tracks, [
    { discoveryId: "duplicate-0", fileId: itemA.fileId, state: "imported" },
    { discoveryId: "duplicate-1", fileId: itemB.fileId, state: "imported" }
  ]);

  // A plain download response must never register an implicit playlist workflow.
  const before = workflows.listWorkflows().length;
  workflows.registerAgentResponse("not-a-playlist", null, {
    intent: "search_library", reply: "Download", searchQuery: "fixture", results: [], discoveryResults: [], parsedListItems: [], importResults: [], playback: null, operationBatch: operations.getBatch(queue.id)
  } as AgentMessageResponse);
  assert.equal(workflows.listWorkflows().length, before);
  console.log(JSON.stringify({ ok: true, concurrency: true, partialImport: true, partialDownload: true, resumeOrdering: true, preservesUserTracks: true, repeatRecovery: true, duplicateBasenameOrder: true, perTrackDelivery: true }));
} finally {
  app?.close();
  await rm(fixture, { recursive: true, force: true });
}

function makeDiscoveryResult(idSuffix: string, artist: string, title: string, completedFilePath: string, sizeBytes: number): DiscoveryResult {
  const filename = completedFilePath.split(/[\\/]/).filter(Boolean).at(-1) ?? `${artist} - ${title}.mp3`;
  return {
    id: idSuffix,
    source: "slskd",
    username: "remote-user",
    filename,
    path: `Remote Folder\\${filename}`,
    folder: "Remote Folder",
    sizeBytes,
    extension: "mp3",
    bitrate: 320_000,
    sampleRate: 44_100,
    lengthSeconds: 210,
    isLocked: false,
    hasFreeUploadSlot: true,
    uploadSpeedBytesPerSecond: 2_000_000,
    queueLength: 0,
    raw: {
      filename: `Remote Folder\\${filename}`
    }
  };
}

function makeId3Fixture(title: string, artist: string, album: string, year: string): Buffer {
  const frames = Buffer.concat([makeTextFrame("TIT2", title), makeTextFrame("TPE1", artist), makeTextFrame("TALB", album), makeTextFrame("TYER", year)]);
  return Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0]), encodeSyncSafe(frames.length), frames]);
}

function makeTextFrame(id: string, value: string): Buffer {
  const body = Buffer.concat([Buffer.from([0]), Buffer.from(value, "latin1")]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  return Buffer.concat([Buffer.from(id, "ascii"), size, Buffer.from([0, 0]), body]);
}

function encodeSyncSafe(size: number): Buffer {
  return Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}
