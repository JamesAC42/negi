import type { DiscoveryResult } from "@music-os/core";
import {
  clusterDiscoveryGroups,
  filterDiscoveryGroups,
  filterDiscoveryGroupsByLibrary,
  groupDiscoveryResults,
  sortDiscoveryGroups,
  summarizeDiscoveryLibraryMatch,
  type DiscoveryLibraryFile
} from "../../../desktop/src/renderer/discovery-candidates.js";

const results: DiscoveryResult[] = [
  makeDiscoveryResult("source-a", "Remote Artist\\Remote Album [FLAC]\\01 - First.flac", 36_000_000, "flac", 900_000),
  makeDiscoveryResult("source-a", "Remote Artist\\Remote Album [FLAC]\\02 - Second.flac", 35_000_000, "flac", 910_000),
  makeDiscoveryResult("source-a", "Remote Artist\\Remote Album [FLAC]\\03 - Third.flac", 34_000_000, "flac", 920_000),
  makeDiscoveryResult("source-a", "Remote Artist\\Remote Album [FLAC]\\04 - Fourth.flac", 34_000_000, "flac", 915_000),
  makeDiscoveryResult("source-a", "Remote Artist\\Remote Album [FLAC]\\05 - Fifth.flac", 33_000_000, "flac", 905_000),
  makeDiscoveryResult("source-a", "Remote Artist\\Remote Album [FLAC]\\06 - Sixth.flac", 32_000_000, "flac", 900_000),
  makeDiscoveryResult("source-a", "Remote Artist\\Remote Album [FLAC]\\07 - Seventh.flac", 31_000_000, "flac", 895_000),
  makeDiscoveryResult("source-b", "Remote Artist\\Remote Album [MP3]\\01 - First.mp3", 9_000_000, "mp3", 192_000),
  makeDiscoveryResult("source-c", "Remote Artist - Loose Song.mp3", 8_000_000, "mp3", 192_000),
  ...Array.from({ length: 34 }, (_, index) =>
    makeDiscoveryResult(
      "source-d",
      `Remote Artist\\Remote Discography\\${String(index + 1).padStart(2, "0")} - Collection Track ${index + 1}.mp3`,
      8_000_000,
      "mp3",
      192_000
    )
  )
];

const libraryFiles: DiscoveryLibraryFile[] = [
  {
    id: "local-1",
    filename: "01 - First.mp3",
    extension: "mp3",
    bitrate: 128_000,
    sizeBytes: 6_000_000,
    displayTags: {
      artist: "Remote Artist",
      album: "Remote Album",
      title: "First"
    }
  }
];

const groups = groupDiscoveryResults(results, "Remote Artist Remote Album");
assert(groups.length === 4, `expected four source groups, got ${groups.length}`);
assert(groups[0]?.qualityLabel === "lossless album", `expected lossless album first, got ${groups[0]?.qualityLabel}`);
assert(
  groups.some((group) => group.releaseCompleteness === "collection" && group.qualityLabel === "large collection"),
  "expected oversized remote folder to be classified as a large collection"
);

const lossless = filterDiscoveryGroups(groups, "lossless", "available");
assert(lossless.length === 1, `expected one lossless group, got ${lossless.length}`);

const sortedByTracks = sortDiscoveryGroups(groups, "tracks");
assert(sortedByTracks[0]?.releaseCompleteness === "collection", "most-tracks sort should put the large collection first");
assert(sortedByTracks[0]?.files.length === 34, `expected largest source first, got ${sortedByTracks[0]?.files.length}`);

const actionable = filterDiscoveryGroupsByLibrary(groups, libraryFiles, "actionable");
assert(actionable.length > 0, "expected at least one actionable remote source");

const clusters = clusterDiscoveryGroups(groups);
assert(clusters.length === 3, `expected album plus loose-song plus collection clusters, got ${clusters.length}`);
assert(clusters[0]?.sourceCount === 2, `expected album cluster to combine two sources, got ${clusters[0]?.sourceCount}`);

const match = summarizeDiscoveryLibraryMatch(groups[0]!, libraryFiles);
assert(match.status === "possible_upgrade", `expected possible upgrade, got ${match.status}`);
assert(
  actionable.some((group) => group.id === groups[0]!.id),
  "lossless remote album should remain actionable over a low-bitrate local copy"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      groups: groups.length,
      clusters: clusters.length,
      firstQuality: groups[0]?.qualityLabel,
      libraryMatch: match.status
    },
    null,
    2
  )
);

function makeDiscoveryResult(
  username: string,
  path: string,
  sizeBytes: number,
  extension: string,
  bitrate: number
): DiscoveryResult {
  const filename = path.split(/[\\/]+/).at(-1) ?? path;
  const folder = path.includes("\\") ? path.split("\\").slice(0, -1).join("\\") : null;
  return {
    id: Buffer.from([username, path].join("\0")).toString("base64url"),
    source: "slskd",
    username,
    filename,
    path,
    folder,
    sizeBytes,
    extension,
    bitrate,
    sampleRate: 44100,
    lengthSeconds: 180,
    isLocked: false,
    raw: { path }
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
