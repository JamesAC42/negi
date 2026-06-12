import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DiscoveryResult, SaveDiscoveryCandidateRequest } from "@music-os/core";
import type { BackendApp } from "../app.js";
import { createBackendApp } from "../app.js";

const fixtureDir = await mkdtemp(join(tmpdir(), "music-os-saved-discovery-"));
const databasePath = join(fixtureDir, "music-os.sqlite");
let app: BackendApp | null = null;

try {
  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });

  const candidate = makeCandidate("remote-user\u0000Remote Folder", "Remote Album");
  const saved = app.savedDiscoveryCandidates.saveCandidate(candidate);
  assert(saved.candidateKey === candidate.candidateKey, "saved candidate should keep candidate key");
  assert(saved.results.length === 2, `expected two saved results, got ${saved.results.length}`);
  assert(app.savedDiscoveryCandidates.listCandidates().length === 1, "expected one saved candidate");

  const updated = app.savedDiscoveryCandidates.saveCandidate(makeCandidate(candidate.candidateKey, "Remote Album Deluxe"));
  assert(updated.id === saved.id, "saving the same candidate key should update existing row");
  assert(updated.releaseTitle === "Remote Album Deluxe", `expected updated title, got ${updated.releaseTitle}`);
  assert(app.savedDiscoveryCandidates.listCandidates().length === 1, "upsert should not duplicate saved candidates");

  app.close();
  app = null;

  app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath, mpvPath: "mpv", musicBrainzEnabled: false });
  const restored = app.savedDiscoveryCandidates.listCandidates();
  assert(restored.length === 1, `expected one restored candidate, got ${restored.length}`);
  assert(restored[0]?.releaseTitle === "Remote Album Deluxe", "saved candidate should survive restart");

  app.savedDiscoveryCandidates.removeCandidate(restored[0]!.id);
  assert(app.savedDiscoveryCandidates.listCandidates().length === 0, "removed candidate should not be listed");

  app.close();
  app = null;
  console.log(JSON.stringify({ ok: true, savedId: saved.id }, null, 2));
} finally {
  app?.close();
  await rm(fixtureDir, { recursive: true, force: true });
}

function makeCandidate(candidateKey: string, releaseTitle: string): SaveDiscoveryCandidateRequest {
  const results = [makeDiscoveryResult("01 - Remote Song.flac"), makeDiscoveryResult("02 - Remote Song Two.flac")];
  return {
    candidateKey,
    source: "slskd",
    query: "remote album",
    releaseArtist: "Remote Artist",
    releaseTitle,
    username: "remote-user",
    folder: "Remote Folder",
    resultCount: results.length,
    availableCount: results.length,
    totalSizeBytes: 123456789,
    primaryFormat: "FLAC",
    qualityLabel: "lossless album",
    matchLabel: "strong match",
    results
  };
}

function makeDiscoveryResult(filename: string): DiscoveryResult {
  return {
    id: Buffer.from(["remote-user", `Remote Folder\\${filename}`, "0"].join("\0")).toString("base64url"),
    source: "slskd",
    username: "remote-user",
    filename,
    path: `Remote Folder\\${filename}`,
    folder: "Remote Folder",
    sizeBytes: null,
    extension: "flac",
    bitrate: null,
    sampleRate: null,
    lengthSeconds: null,
    isLocked: false,
    raw: {
      filename: `Remote Folder\\${filename}`
    }
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
