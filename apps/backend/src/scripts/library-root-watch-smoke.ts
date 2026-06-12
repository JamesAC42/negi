import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BackendApp } from "../app.js";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-root-watch-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");
const otherLibraryPath = join(fixtureDir, "other-library");
let app: BackendApp | null = null;

try {
  await mkdir(libraryPath, { recursive: true });
  await mkdir(otherLibraryPath, { recursive: true });
  await writeFile(join(libraryPath, "watched.mp3"), "watched audio");
  await writeFile(join(otherLibraryPath, "manual.mp3"), "manual audio");

  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });

  const root = app.library.addRoot(libraryPath, "watched root", true);
  const manualRoot = app.library.addRoot(otherLibraryPath, "manual root", false);
  assert(root.watchEnabled, "new root should persist initial watch flag");
  assert(app.library.getRoot(root.id).watchEnabled, "getRoot should return watch flag");
  assert(!manualRoot.watchEnabled, "manual root should not be watched");
  assert(app.library.listWatchedRoots().length === 1, "expected one watched root");

  const watchedScan = await app.scanner.scanRoots(app.library.listWatchedRoots());
  assert(watchedScan.rootsScanned === 1, `expected one scanned watched root, got ${watchedScan.rootsScanned}`);
  assert(watchedScan.totals.scanned === 1, `expected one watched file scanned, got ${watchedScan.totals.scanned}`);
  assert(app.library.countFiles() === 1, `expected only watched root file indexed, got ${app.library.countFiles()}`);

  const disabled = app.library.setRootWatchEnabled(root.id, false);
  assert(!disabled.watchEnabled, "watch flag should be disabled");

  app.close();
  app = null;

  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const restored = app.library.getRoot(root.id);
  assert(!restored.watchEnabled, "watch flag should survive restart");

  const enabled = app.library.setRootWatchEnabled(root.id, true);
  assert(enabled.watchEnabled, "watch flag should be re-enabled");

  app.library.setRootWatchEnabled(root.id, false);
  const duplicate = app.library.addRoot(libraryPath, "watched root duplicate", true);
  assert(duplicate.id === root.id, "duplicate root add should return existing root");
  assert(duplicate.watchEnabled, "duplicate root add should update requested watch flag");

  app.close();
  app = null;
  console.log(JSON.stringify({ ok: true, rootId: root.id }, null, 2));
} finally {
  app?.close();
  await rm(fixtureDir, { recursive: true, force: true });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
