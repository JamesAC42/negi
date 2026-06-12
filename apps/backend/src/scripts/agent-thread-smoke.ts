import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BackendApp } from "../app.js";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-agent-thread-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");
let app: BackendApp | null = null;

try {
  await mkdir(libraryPath, { recursive: true });
  await writeFile(join(libraryPath, "thread-one.mp3"), makeId3Fixture("Thread One", "Thread Artist", "Thread Album", "1982"));

  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "agent-thread");
  await app.scanner.scanRoot(root);

  const empty = app.agentThreads.getActiveThread();
  assert(empty.messages.length === 0, `expected empty active thread, got ${empty.messages.length} messages`);

  const first = await app.agentThreads.sendMessage("find thread artist");
  assert(first.threadId === empty.thread.id, "first response should use active thread id");
  assert(first.results.length === 1, `expected one search result, got ${first.results.length}`);

  const withFirstMessage = app.agentThreads.getThread(empty.thread.id);
  assert(withFirstMessage.thread.title === "find thread artist", `expected thread title from first message, got ${withFirstMessage.thread.title}`);
  assert(withFirstMessage.messages.length === 2, `expected user+agent messages, got ${withFirstMessage.messages.length}`);
  assert(withFirstMessage.messages[0].role === "user", `expected first message user, got ${withFirstMessage.messages[0].role}`);
  assert(withFirstMessage.messages[1].response?.results.length === 1, "expected persisted agent response payload");

  const second = await app.agentThreads.sendMessage("make a thread artist playlist", empty.thread.id);
  assert(second.threadId === empty.thread.id, "second response should stay in same thread");
  assert(second.operationBatch != null, "second response should persist operation batch payload");
  assert(second.operationBatch.agentThreadId === empty.thread.id, "agent operation batch should link to the source thread");
  assert(
    app.operations.getBatch(second.operationBatch.id).agentThreadId === empty.thread.id,
    "reloaded operation batch should retain source thread link"
  );
  assert(
    app.operations.listBatches().some((batch) => batch.id === second.operationBatch?.id && batch.agentThreadId === empty.thread.id),
    "listed operation batches should expose source thread link"
  );

  const newThread = app.agentThreads.createThread("Second Thread");
  assert(newThread.thread.id !== empty.thread.id, "new thread should get a different id");
  assert(newThread.messages.length === 0, "new thread should start with no messages");
  const secondThreadResponse = await app.agentThreads.sendMessage("find nothing here", newThread.thread.id);
  assert(secondThreadResponse.threadId === newThread.thread.id, "response should target second thread");
  assert(app.agentThreads.getThread(newThread.thread.id).messages.length === 2, "second thread should keep its own transcript");
  assert(app.agentThreads.getThread(empty.thread.id).messages.length === 4, "first thread transcript should remain unchanged");
  const listed = app.agentThreads.listThreads();
  assert(listed.length === 2, `expected two listed threads, got ${listed.length}`);
  assert(listed.some((thread) => thread.id === empty.thread.id), "thread list should include first thread");
  assert(listed.some((thread) => thread.id === newThread.thread.id), "thread list should include second thread");
  app.close();
  app = null;

  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const restored = app.agentThreads.getActiveThread();
  assert(restored.thread.id === newThread.thread.id, "most recently updated active thread should survive restart");
  assert(restored.messages.length === 2, `expected two restored messages in active thread, got ${restored.messages.length}`);
  const restoredFirst = app.agentThreads.getThread(empty.thread.id);
  assert(restoredFirst.messages.length === 4, `expected four restored messages in first thread, got ${restoredFirst.messages.length}`);
  assert(restoredFirst.messages[3].response?.operationBatch?.status === "proposed", "expected proposed operation batch in restored response");
  assert(restoredFirst.messages[3].response?.operationBatch?.agentThreadId === empty.thread.id, "restored response should retain agent thread id");

  app.close();
  app = null;
  console.log(JSON.stringify({ ok: true, activeThread: restored.thread, threadCount: app == null ? listed.length : 0 }, null, 2));
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
