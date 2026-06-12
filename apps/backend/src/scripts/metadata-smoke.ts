import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendApp } from "../app.js";
import { MetadataResolver } from "../services/metadata-resolver.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-metadata-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
const sourceDir = join(fixtureDir, "source");
const libraryPath = join(fixtureDir, "library");

try {
  await mkdir(sourceDir, { recursive: true });
  await mkdir(libraryPath, { recursive: true });
  const sourcePath = join(sourceDir, "Filename Artist - Filename Title.mp3");
  await writeFile(sourcePath, Buffer.from("not real mp3 audio, but enough for filename metadata smoke"));

  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const root = app.library.addRoot(libraryPath, "library");
  await writeFile(join(libraryPath, "Complete Metadata.mp3"), makeId3Fixture("Complete Metadata", "Complete Artist", "Complete Album", "1991"));
  await writeFile(join(libraryPath, "Gap Artist - Gap Title 1999.mp3"), Buffer.from("metadata gap fixture"));
  const scan = await app.scanner.scanRoot(root);
  assert(scan.scanned === 2, `expected 2 scanned files, got ${scan.scanned}`);
  const gaps = app.library.listMetadataGaps();
  assert(gaps.length === 1, `expected one metadata gap, got ${gaps.length}`);
  assert(gaps[0].file.filename === "Gap Artist - Gap Title 1999.mp3", `unexpected metadata gap file ${gaps[0].file.filename}`);
  assert(gaps[0].missingFields.includes("album"), `expected missing album, got ${gaps[0].missingFields.join(", ")}`);
  assert(gaps[0].suggestedMetadata.artist === "Gap Artist", `expected artist suggestion, got ${gaps[0].suggestedMetadata.artist}`);
  assert(gaps[0].suggestedMetadata.title === "Gap Title 1999", `expected title suggestion, got ${gaps[0].suggestedMetadata.title}`);
  assert(gaps[0].suggestedMetadata.year === "1999", `expected year suggestion, got ${gaps[0].suggestedMetadata.year}`);

  const created = await app.imports.createFromPaths([sourcePath], root.id);
  const item = created.items[0];

  assert(item.status === "needs_review", `expected needs_review, got ${item.status}`);
  assert(item.detectedArtist === "Filename Artist", `expected filename artist, got ${item.detectedArtist}`);
  assert(item.detectedTitle === "Filename Title", `expected filename title, got ${item.detectedTitle}`);
  assert(item.selectedCandidate?.source === "filename", `expected filename selected candidate, got ${item.selectedCandidate?.source}`);
  assert(item.confidenceScore != null && item.confidenceScore < 0.75, `expected low confidence score, got ${item.confidenceScore}`);
  assert(
    item.warnings.some((warning) => warning.includes("Low metadata confidence")),
    `expected low confidence warning, got ${item.warnings.join(", ")}`
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        recordings: [
          {
            id: "musicbrainz-compilation-recording",
            title: "Harder, Better, Faster, Stronger",
            score: 100,
            length: 224000,
            "first-release-date": "2001",
            "artist-credit": [{ name: "Daft Punk" }],
            releases: [{ title: "All The Hits Now: Inverno 2001", date: "2001" }]
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;
  try {
    const resolver = new MetadataResolver({
      host: "127.0.0.1",
      port: 0,
      databasePath,
      mpvPath: "mpv",
      musicBrainzEnabled: true
    });
    const resolved = await resolver.resolve({
      filePath: join(sourceDir, "Daft Punk - Harder Better Faster Stronger.mp3"),
      durationMs: 224000,
      tags: {
        title: "Harder, Better, Faster, Stronger",
        artist: "Daft Punk",
        album: "Discovery",
        year: "2001"
      }
    });
    assert(resolved.selected?.source === "embedded", `expected embedded to beat MusicBrainz compilation, got ${resolved.selected?.source}`);
    assert(resolved.selected.album === "Discovery", `expected embedded album Discovery, got ${resolved.selected?.album}`);
    assert(
      resolved.candidates.some((candidate) => candidate.source === "musicbrainz"),
      "expected MusicBrainz candidate to remain available for review"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  app.close();
  console.log(JSON.stringify({ ok: true, metadataGaps: gaps.length, item }, null, 2));
} finally {
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
