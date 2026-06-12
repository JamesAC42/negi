import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BackendApp } from "../app.js";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-durable-workflow-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");
let app: BackendApp | null = null;

try {
  await mkdir(libraryPath, { recursive: true });
  await writeFile(join(libraryPath, "durable-one.mp3"), makeId3Fixture("Durable One", "Durable Artist", "Durable Album", "1981"));
  await writeFile(join(libraryPath, "durable-two.mp3"), makeId3Fixture("Durable Two", "Durable Artist", "Durable Album", "1981"));

  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "durable-workflow");
  const scan = await app.scanner.scanRoot(root);
  assert(scan.inserted === 2, `expected 2 inserted files, got ${scan.inserted}`);

  const proposal = await app.agent.handleMessage("make a durable artist playlist");
  assert(proposal.operationBatch != null, "agent playlist request should create an operation batch");
  assert(proposal.operationBatch.status === "proposed", `expected proposed status, got ${proposal.operationBatch.status}`);
  assert(app.playlists.listPlaylists().length === 0, "paused proposal should not create a playlist");
  const batchId = proposal.operationBatch.id;
  app.close();
  app = null;

  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const resumed = app.operations.getBatch(batchId);
  assert(resumed.status === "proposed", `expected proposed batch after restart, got ${resumed.status}`);
  assert(resumed.operations.length === 1, `expected one persisted operation, got ${resumed.operations.length}`);
  assert(resumed.operations[0].type === "create_playlist", `expected create_playlist operation, got ${resumed.operations[0].type}`);

  const approved = app.operations.approveBatch(batchId);
  assert(approved.status === "approved", `expected approved status, got ${approved.status}`);
  const applied = await app.operations.applyBatch(batchId);
  assert(applied.status === "applied", `expected applied status, got ${applied.status}`);
  assert(app.playlists.listPlaylists().length === 1, "resumed workflow should create a playlist after apply");

  const audited = app.operations.getBatch(batchId);
  assert(audited.operations[0].before != null, "applied operation should retain before audit data");
  assert(audited.operations[0].after != null, "applied operation should retain after audit data");
  assert(audited.operations[0].error == null, "applied operation should not retain an error");

  app.close();
  app = null;
  console.log(JSON.stringify({ ok: true, batchId, status: audited.status, operations: audited.operations.length }, null, 2));
} finally {
  app?.close();
  await rm(fixtureDir, { recursive: true, force: true });
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

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
