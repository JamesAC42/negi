import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DiscoverySearchResponse } from "@music-os/core";
import type { BackendApp } from "../app.js";
import { createBackendApp } from "../app.js";
import { AgentService } from "../services/agent-service.js";
import { OperationService } from "../services/operation-service.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-agent-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");
const sourcePath = join(fixtureDir, "source");
let app: BackendApp | null = null;

try {
  await mkdir(libraryPath, { recursive: true });
  await mkdir(sourcePath, { recursive: true });
  await writeFile(join(libraryPath, "phase-six-one.mp3"), makeId3Fixture("Phase Six One", "Agent Smoke Artist", "Agent Smoke Album", "1986"));
  await writeFile(join(libraryPath, "phase-six-two.mp3"), makeId3Fixture("Phase Six Two", "Agent Smoke Artist", "Agent Smoke Album", "1986"));
  await writeFile(join(libraryPath, "other.mp3"), makeId3Fixture("Other Track", "Other Artist", "Other Album", "1987"));

  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "agent-smoke");
  const scan = await app.scanner.scanRoot(root);
  assert(scan.inserted === 3, `expected 3 inserted files, got ${scan.inserted}`);

  const search = await app.agent.handleMessage("find phase six");
  assert(search.intent === "search_library", `expected search_library intent, got ${search.intent}`);
  assert(search.results.length === 2, `expected 2 search results, got ${search.results.length}`);
  assert(search.operationBatch === null, "search should not create an operation batch");

  const proposal = await app.agent.handleMessage("make a phase six playlist");
  assert(proposal.intent === "propose_playlist", `expected propose_playlist intent, got ${proposal.intent}`);
  assert(proposal.results.length === 2, `expected 2 proposal results, got ${proposal.results.length}`);
  assert(proposal.operationBatch != null, "playlist request should propose an operation batch");
  assert(proposal.operationBatch.source === "agent", `expected agent batch source, got ${proposal.operationBatch.source}`);
  assert(proposal.operationBatch.status === "proposed", `expected proposed batch, got ${proposal.operationBatch.status}`);
  assert(proposal.operationBatch.operations[0].type === "create_playlist", "expected create_playlist operation");
  assert(app.playlists.listPlaylists().length === 0, "proposed batch should not create playlist before approval/apply");

  app.operations.approveBatch(proposal.operationBatch.id);
  const applied = await app.operations.applyBatch(proposal.operationBatch.id);
  assert(applied.status === "applied", `expected applied playlist batch, got ${applied.status}`);

  const playlists = app.playlists.listPlaylists();
  assert(playlists.length === 1, `expected one playlist, got ${playlists.length}`);
  assert(playlists[0].items.length === 2, `expected two playlist items, got ${playlists[0].items.length}`);
  assert(
    playlists[0].items.every((item) => item.file.displayTags.artist === "Agent Smoke Artist"),
    "expected playlist items to use indexed library files"
  );

  const queuedDownloadCalls: string[][] = [];
  const executableOperations = new OperationService(app.db, app.imports, app.library, {
    createJob(results) {
      queuedDownloadCalls.push(results.map((result) => result.id));
      return {
        id: "fake-discovery-download-job",
        status: "queued",
        progress: 0,
        selectedCount: results.length,
        completedCount: 0,
        imported: null,
        message: "fake queued",
        error: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null
      };
    }
  });

  const discoveryAgent = new AgentService(app.library, executableOperations, app.playback, {
    async search(query: string): Promise<DiscoverySearchResponse> {
      return {
        query,
        total: 2,
        results: [
          {
            id: "remote-owned",
            source: "slskd",
            username: "remote-user",
            filename: "01 - Phase Six One.flac",
            path: "Remote/Agent Smoke Album/01 - Phase Six One.flac",
            folder: "Remote/Agent Smoke Album",
            sizeBytes: 30_000_000,
            extension: "flac",
            bitrate: 900_000,
            sampleRate: 44_100,
            lengthSeconds: 220,
            isLocked: false,
            raw: {}
          },
          {
            id: "remote-new",
            source: "slskd",
            username: "remote-user",
            filename: "Unowned Discovery Track.mp3",
            path: "Remote/Other/Unowned Discovery Track.mp3",
            folder: "Remote/Other",
            sizeBytes: 7_000_000,
            extension: "mp3",
            bitrate: 320_000,
            sampleRate: 44_100,
            lengthSeconds: 190,
            isLocked: true,
            raw: {}
          }
        ]
      };
    }
  });

  const discovery = await discoveryAgent.handleMessage("search soulseek phase six");
  assert(discovery.intent === "search_discovery", `expected search_discovery intent, got ${discovery.intent}`);
  assert(discovery.results.length === 0, "discovery search should not return library result rows");
  assert(discovery.discoveryResults.length === 2, `expected 2 discovery candidates, got ${discovery.discoveryResults.length}`);
  assert(discovery.discoveryResults[0].ownedMatchCount > 0, "expected owned match count for known library track");
  assert(discovery.discoveryResults[1].ownedMatchCount === 0, "expected no owned matches for unrelated remote candidate");
  assert(discovery.discoveryGroups?.length === 2, `expected 2 grouped discovery releases, got ${discovery.discoveryGroups?.length}`);
  assert(discovery.discoveryGroups[0]?.releaseArtist === null, `expected no invented grouped release artist, got ${discovery.discoveryGroups[0]?.releaseArtist}`);
  assert(discovery.discoveryGroups[0]?.releaseTitle === "Agent Smoke Album", `expected grouped release title, got ${discovery.discoveryGroups[0]?.releaseTitle}`);
  assert(discovery.discoveryGroups[0]?.sourceCount === 1, `expected one source in grouped release, got ${discovery.discoveryGroups[0]?.sourceCount}`);
  assert(discovery.discoveryGroups[0]?.ownedMatchCount > 0, "expected grouped release to carry owned match count");
  assert(discovery.operationBatch === null, "discovery search should not queue downloads or create operations");

  const downloadProposal = await discoveryAgent.handleMessage("propose download soulseek phase six");
  assert(downloadProposal.intent === "search_discovery", `expected search_discovery intent, got ${downloadProposal.intent}`);
  assert(downloadProposal.operationBatch != null, "download request should create a reviewable operation batch");
  assert(downloadProposal.operationBatch.source === "agent", `expected agent source, got ${downloadProposal.operationBatch.source}`);
  assert(downloadProposal.operationBatch.status === "proposed", `expected proposed status, got ${downloadProposal.operationBatch.status}`);
  assert(downloadProposal.operationBatch.operations.length === 1, "expected one queue_download operation");
  assert(downloadProposal.operationBatch.operations[0].type === "queue_download", "expected queue_download operation");
  executableOperations.approveBatch(downloadProposal.operationBatch.id);
  const appliedDownload = await executableOperations.applyBatch(downloadProposal.operationBatch.id);
  assert(appliedDownload.status === "applied", `expected applied queue_download batch, got ${appliedDownload.status}`);
  assert(queuedDownloadCalls.length === 1, `expected one download handoff, got ${queuedDownloadCalls.length}`);
  assert(queuedDownloadCalls[0].length === 1, `expected one unlocked result queued, got ${queuedDownloadCalls[0].length}`);
  assert(queuedDownloadCalls[0][0] === "remote-owned", `expected unlocked remote result, got ${queuedDownloadCalls[0][0]}`);

  await writeFile(join(libraryPath, "phase-six-one-copy.mp3"), makeId3Fixture("Phase Six One", "Agent Smoke Artist", "Agent Smoke Album", "1986"));
  const duplicateScan = await app.scanner.scanRoot(root);
  assert(duplicateScan.inserted === 1, `expected one inserted duplicate file, got ${duplicateScan.inserted}`);

  const duplicateProposal = await app.agent.handleMessage("find duplicates and keep the best copies");
  assert(
    duplicateProposal.intent === "propose_duplicate_cleanup",
    `expected propose_duplicate_cleanup intent, got ${duplicateProposal.intent}`
  );
  assert(duplicateProposal.operationBatch != null, "duplicate cleanup should create a reviewable operation batch");
  assert(duplicateProposal.operationBatch.source === "agent", `expected agent duplicate source, got ${duplicateProposal.operationBatch.source}`);
  assert(duplicateProposal.operationBatch.status === "proposed", `expected proposed duplicate batch, got ${duplicateProposal.operationBatch.status}`);
  assert(duplicateProposal.operationBatch.operations.length === 1, `expected one duplicate mark operation, got ${duplicateProposal.operationBatch.operations.length}`);
  assert(duplicateProposal.operationBatch.operations[0].type === "mark_duplicate", "expected mark_duplicate operation");
  assert(app.library.countFiles() === 4, `proposed duplicate cleanup should not remove files, got ${app.library.countFiles()}`);

  app.operations.approveBatch(duplicateProposal.operationBatch.id);
  const appliedDuplicate = await app.operations.applyBatch(duplicateProposal.operationBatch.id);
  assert(appliedDuplicate.status === "applied", `expected applied duplicate mark batch, got ${appliedDuplicate.status}`);
  assert(app.library.countFiles() === 4, `applied duplicate mark should not remove files, got ${app.library.countFiles()}`);

  const parsedList = await app.agent.handleMessage(`parse this RYM list:
1. Agent Smoke Artist - Phase Six One (1986)
2. Yellow Magic Orchestra - Solid State Survivor (1979)
3. Other Artist - Other Track - 1987`);
  assert(parsedList.intent === "parse_pasted_list", `expected parse_pasted_list intent, got ${parsedList.intent}`);
  assert(parsedList.parsedListItems.length === 3, `expected 3 parsed list items, got ${parsedList.parsedListItems.length}`);
  assert(parsedList.parsedListItems[0].rank === 1, `expected first item rank 1, got ${parsedList.parsedListItems[0].rank}`);
  assert(parsedList.parsedListItems[0].artist === "Agent Smoke Artist", `unexpected parsed artist ${parsedList.parsedListItems[0].artist}`);
  assert(parsedList.parsedListItems[0].title === "Phase Six One", `unexpected parsed title ${parsedList.parsedListItems[0].title}`);
  assert(parsedList.parsedListItems[0].year === "1986", `unexpected parsed year ${parsedList.parsedListItems[0].year}`);
  assert(parsedList.parsedListItems[0].ownedMatchCount > 0, "expected owned matches for parsed library item");
  assert(parsedList.parsedListItems[1].ownedMatchCount === 0, "expected no owned matches for missing parsed item");
  assert(parsedList.parsedListItems[2].title === "Other Track", `unexpected parsed trailing title ${parsedList.parsedListItems[2].title}`);
  assert(parsedList.parsedListItems[2].ownedMatchCount > 0, "expected owned matches for parsed trailing-year item");
  assert(parsedList.operationBatch === null, "parsing pasted lists should not create operation batches");

  const incomingPath = join(sourcePath, "agent-import.mp3");
  await writeFile(incomingPath, makeId3Fixture("Agent Import Title", "Agent Import Artist", "Agent Import Album", "1988"));
  const staged = await app.imports.createFromPaths([incomingPath], root.id);
  assert(staged.items.length === 1, `expected one staged import item, got ${staged.items.length}`);

  const importProposal = await app.agent.handleMessage("propose import agent import");
  assert(importProposal.intent === "propose_import", `expected propose_import intent, got ${importProposal.intent}`);
  assert(importProposal.importResults.length === 1, `expected one import result, got ${importProposal.importResults.length}`);
  assert(importProposal.importResults[0].title === "Agent Import Title", `unexpected import result title ${importProposal.importResults[0].title}`);
  assert(importProposal.operationBatch != null, "import request should create a reviewable operation batch");
  assert(importProposal.operationBatch.source === "agent", `expected agent import batch source, got ${importProposal.operationBatch.source}`);
  assert(importProposal.operationBatch.status === "proposed", `expected proposed import batch, got ${importProposal.operationBatch.status}`);
  assert(importProposal.operationBatch.operations[0].type === "import_file", "expected import_file operation");
  assert(app.library.countFiles() === 4, `proposed import should not add to library count, got ${app.library.countFiles()}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        search,
        proposedBatchId: proposal.operationBatch.id,
        playlist: playlists[0],
        discovery,
        downloadProposal,
        duplicateProposal,
        parsedList,
        importProposal
      },
      null,
      2
    )
  );
} finally {
  app?.close();
  await rm(fixtureDir, { recursive: true, force: true });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function makeId3Fixture(title: string, artist: string, album: string, year: string): Buffer {
  const frames = Buffer.concat([
    makeTextFrame("TIT2", title),
    makeTextFrame("TPE1", artist),
    makeTextFrame("TALB", album),
    makeTextFrame("TYER", year)
  ]);
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
