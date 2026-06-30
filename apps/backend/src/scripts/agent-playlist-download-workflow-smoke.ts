import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DiscoveryResult, DiscoverySearchResponse } from "@music-os/core";
import { createBackendApp, type BackendApp } from "../app.js";
import { AgentRunService } from "../services/agent-run-service.js";
import { AgentService } from "../services/agent-service.js";
import { AgentPlaylistWorkflowService } from "../services/agent-playlist-workflow-service.js";
import { DiscoveryDownloadService } from "../services/discovery-download-service.js";
import { OperationService } from "../services/operation-service.js";
import type { SlskdDownloadInspection, SlskdService } from "../services/slskd-service.js";

class FakeSlskd {
  constructor(private readonly completedPath: string) {}

  async search(query: string): Promise<DiscoverySearchResponse> {
    return query === "remote artist remote title" ? { query, total: 1, results: [makeDiscoveryResult()] } : { query, total: 0, results: [] };
  }

  async queueDownloadResults(results: DiscoveryResult[]): Promise<DiscoveryResult[]> {
    await writeFile(this.completedPath, makeId3Fixture("Remote Title", "Remote Artist", "Remote Album", "1985"));
    return results;
  }

  async findCompletedDownloadPaths(): Promise<string[]> {
    return [this.completedPath];
  }

  async inspectDownloadResults(): Promise<SlskdDownloadInspection> {
    return {
      downloadDirectory: this.completedPath,
      directoryError: null,
      filesSeen: 1,
      completedPaths: [this.completedPath],
      transfers: {
        total: 1,
        matched: 1,
        completed: 1,
        active: 0,
        queued: 0,
        failed: 0,
        other: 0,
        error: null,
        samples: []
      }
    };
  }
}

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-agent-playlist-download-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");
const downloadsPath = join(fixtureDir, "downloads");
const completedPath = join(downloadsPath, "Remote Artist - Remote Title.mp3");
let app: BackendApp | null = null;

try {
  process.env.MUSIC_OS_DISCOVERY_DOWNLOAD_POLL_MS = "100";
  process.env.MUSIC_OS_DISCOVERY_DOWNLOAD_INSPECT_MS = "100";
  await mkdir(libraryPath, { recursive: true });
  await mkdir(downloadsPath, { recursive: true });
  await writeFile(join(libraryPath, "Owned Artist - Owned Title.mp3"), makeId3Fixture("Owned Title", "Owned Artist", "Owned Album", "1984"));

  app = createBackendApp({
    host: "127.0.0.1",
    port: 0,
    databasePath,
    mpvPath: "mpv",
    musicBrainzEnabled: false,
    slskdDownloadDirectory: downloadsPath
  });
  const root = app.library.addRoot(libraryPath, "agent-playlist-download");
  const scan = await app.scanner.scanRoot(root);
  assert(scan.inserted === 1, `expected one owned fixture file, got ${scan.inserted}`);
  const fakeSlskd = new FakeSlskd(completedPath);
  const downloads = new DiscoveryDownloadService(app.db, fakeSlskd as unknown as SlskdService, app.imports);
  const operations = new OperationService(app.db, app.imports, app.library, downloads);
  const workflows = new AgentPlaylistWorkflowService(app.db, app.library, operations, app.imports, app.playlists, downloads);
  downloads.onJobSucceeded((jobId) => workflows.advanceForDownloadJob(jobId));
  const agent = new AgentService(app.library, operations, app.playback, fakeSlskd as unknown as Pick<SlskdService, "search">, app.imports, app.tasteProfile);
  const runs = new AgentRunService(
    app.db,
    agent,
    {
      name: "fixture_model",
      async plan() {
        return {
          summary: "Fixture model found a remote playlist track",
          intent: "research_playlist",
          searchQuery: "remote electronic",
          playlistName: "Downloaded Agent Playlist",
          playlistDescription: "A playlist that requires a downloaded track.",
          searchQueryHints: [],
          researchSources: [
            {
              title: "Fixture discussion",
              url: "https://example.com/music-thread",
              summary: "Fixture source for the remote track."
            }
          ],
          trackCandidates: [
            { artist: "Remote Artist", title: "Remote Title", album: "Remote Album", query: "remote artist remote title" },
            { artist: "Owned Artist", title: "Owned Title", album: "Owned Album", query: "owned artist owned title" }
          ]
        };
      }
    },
    undefined,
    workflows,
    true
  );

  const run = await runs.run("make me a playlist of songs for a remote electronic mood");
  assert(run.response?.intent === "research_playlist", `expected research_playlist response, got ${run.response?.intent}`);
  assert(run.response.operationBatch?.status === "applied", `expected auto-applied download batch, got ${run.response.operationBatch?.status}`);
  const workflow = await waitForWorkflow(workflows, run.id, "completed");
  assert(workflow.ownedFileIds.length === 1, `expected workflow to record one owned file, got ${workflow.ownedFileIds.length}`);
  assert(workflow.downloadJobId != null, "expected workflow to record the download job");
  assert(workflow.importId != null, "expected workflow to record the import batch");
  assert(workflow.importOperationBatchId != null, "expected workflow to approve downloaded import items");
  assert(workflow.playlistId != null, "expected workflow to create a playlist");

  const playlist = app.playlists.getPlaylist(workflow.playlistId);
  assert(playlist.name === "Downloaded Agent Playlist", `expected playlist name, got ${playlist.name}`);
  assert(playlist.items.length === 2, `expected two playlist items, got ${playlist.items.length}`);
  assert(playlist.items[0].file.displayTags.artist === "Remote Artist", `expected imported artist first, got ${playlist.items[0].file.displayTags.artist}`);
  assert(playlist.items[1].file.displayTags.artist === "Owned Artist", `expected owned artist second, got ${playlist.items[1].file.displayTags.artist}`);
  assert(app.library.countPlayableFiles() === 2, `expected owned plus imported playable files, got ${app.library.countPlayableFiles()}`);
  const thread = app.agentThreads.getThread(run.threadId!);
  const threadMessageTexts = thread.messages.map((message) => `${message.role}: ${message.text}`);
  assert(
    thread.messages.some((message) => message.role === "agent" && message.text === "Here's your playlist: Downloaded Agent Playlist. 2 tracks are ready."),
    `expected final playlist-ready message in the agent thread, got ${JSON.stringify(threadMessageTexts)}`
  );

  console.log(JSON.stringify({ ok: true, runId: run.id, workflow, playlistId: playlist.id }, null, 2));
} finally {
  app?.close();
  await rm(fixtureDir, { recursive: true, force: true });
}

async function waitForWorkflow(
  workflows: AgentPlaylistWorkflowService,
  runId: string,
  status: "completed" | "failed"
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const workflow = workflows.listWorkflows().find((item) => item.runId === runId);
    if (workflow?.status === status) {
      return workflow;
    }
    if (workflow?.status === "failed") {
      throw new Error(workflow.error ?? "workflow failed");
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for agent playlist workflow ${runId} to reach ${status}`);
}

function makeDiscoveryResult(): DiscoveryResult {
  return {
    id: Buffer.from(["remote-user", "Remote Folder\\Remote Artist - Remote Title.mp3", "0"].join("\0")).toString("base64url"),
    source: "slskd",
    username: "remote-user",
    filename: "Remote Artist - Remote Title.mp3",
    path: "Remote Folder\\Remote Artist - Remote Title.mp3",
    folder: "Remote Folder",
    sizeBytes: 8_000_000,
    extension: "mp3",
    bitrate: 320_000,
    sampleRate: 44_100,
    lengthSeconds: 210,
    isLocked: false,
    hasFreeUploadSlot: true,
    uploadSpeedBytesPerSecond: 2_000_000,
    queueLength: 0,
    raw: {
      filename: "Remote Folder\\Remote Artist - Remote Title.mp3"
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
