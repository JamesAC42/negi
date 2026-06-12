import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-quality-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const libraryPath = join(fixtureDir, "library");

try {
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "quality");

  app.library.upsertFile(
    makeIndexedFile({
      rootId: root.id,
      path: join(libraryPath, "Steely Dan - Doctor Wu.flac"),
      extension: "flac",
      bitrate: 920_000,
      tags: { title: "Doctor Wu", artist: "Steely Dan", album: "Katy Lied", year: "1975" }
    })
  );
  app.library.upsertFile(
    makeIndexedFile({
      rootId: root.id,
      path: join(libraryPath, "Steely Dan - Doctor Wu.mp3"),
      extension: "mp3",
      bitrate: 128_000,
      tags: { title: "Doctor Wu", artist: "Steely Dan", album: "Katy Lied", year: "1975" }
    })
  );
  app.library.upsertFile(
    makeIndexedFile({
      rootId: root.id,
      path: join(libraryPath, "Other Artist - Other Track.mp3"),
      extension: "mp3",
      bitrate: 320_000,
      tags: { title: "Other Track", artist: "Other Artist", album: "Other Album", year: "1999" }
    })
  );

  const suggestions = app.library.listQualityUpgradeSuggestions();
  assert(suggestions.length === 1, `expected one quality suggestion, got ${suggestions.length}`);
  assert(suggestions[0].artist === "Steely Dan", `expected Steely Dan suggestion, got ${suggestions[0].artist}`);
  assert(suggestions[0].title === "Doctor Wu", `expected Doctor Wu suggestion, got ${suggestions[0].title}`);
  assert(suggestions[0].preferred.file.extension === "flac", `expected preferred FLAC, got ${suggestions[0].preferred.file.extension}`);
  assert(suggestions[0].candidates.length === 1, `expected one lower-quality candidate, got ${suggestions[0].candidates.length}`);
  assert(suggestions[0].candidates[0].file.extension === "mp3", `expected MP3 candidate, got ${suggestions[0].candidates[0].file.extension}`);

  app.close();
  console.log(JSON.stringify({ ok: true, suggestions: suggestions.length }, null, 2));
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function makeIndexedFile(input: {
  rootId: string;
  path: string;
  extension: string;
  bitrate: number;
  tags: Record<string, string>;
}) {
  const now = new Date().toISOString();
  return {
    libraryRootId: input.rootId,
    path: input.path,
    normalizedPath: input.path.toLowerCase(),
    filename: input.path.split(/[\\/]/).pop() ?? input.path,
    extension: input.extension,
    sizeBytes: input.extension === "flac" ? 28_000_000 : 4_000_000,
    mtime: now,
    ctime: now,
    sha256: `${input.extension}-${input.bitrate}`,
    quickHash: `${input.extension}-${input.bitrate}`.slice(0, 16),
    durationMs: 236_000,
    codec: input.extension,
    container: input.extension,
    bitrate: input.bitrate,
    sampleRate: 44_100,
    channels: 2,
    scanStatus: "scanned",
    tags: Object.entries(input.tags).map(([key, value]) => ({ key, value, source: "smoke" }))
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
