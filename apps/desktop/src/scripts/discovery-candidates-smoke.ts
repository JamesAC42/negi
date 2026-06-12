import type { DiscoveryResult } from "@music-os/core";
import {
  clusterDiscoveryGroups,
  filterDiscoveryGroups,
  filterDiscoveryGroupsByLibrary,
  getDiscoveryFolderLabel,
  groupDiscoveryResults,
  sortDiscoveryGroups,
  summarizeDiscoveryLibraryMatch,
  type DiscoveryLibraryFile
} from "../renderer/discovery-candidates.js";

const losslessAlbum = Array.from({ length: 9 }, (_, index) =>
  discoveryResult({
    username: "user-b",
    filename: `${String(index + 1).padStart(2, "0")} - Album Track ${index + 1}.flac`,
    path: `Music/Artist/Great Album/${String(index + 1).padStart(2, "0")} - Album Track ${index + 1}.flac`,
    folder: "Music/Artist/Great Album",
    extension: "flac",
    sizeBytes: 32_000_000,
    bitrate: 920_000
  })
);

const lockedAlbum = Array.from({ length: 12 }, (_, index) =>
  discoveryResult({
    username: "user-a",
    filename: `${String(index + 1).padStart(2, "0")} - Locked Track ${index + 1}.mp3`,
    path: `Music/Artist/Locked Album/${String(index + 1).padStart(2, "0")} - Locked Track ${index + 1}.mp3`,
    folder: "Music/Artist/Locked Album",
    extension: "mp3",
    sizeBytes: 8_000_000,
    bitrate: 320_000,
    isLocked: true
  })
);

const singles = [
  discoveryResult({
    username: "user-c",
    filename: "Single.mp3",
    path: "Downloads/Single.mp3",
    folder: "Downloads",
    extension: "mp3",
    sizeBytes: 7_000_000,
    bitrate: 256_000
  }),
  discoveryResult({
    username: "user-c",
    filename: "Another Single.mp3",
    path: "Downloads/Another Single.mp3",
    folder: "Downloads",
    extension: "mp3",
    sizeBytes: 6_000_000,
    bitrate: 192_000
  })
];

const queryMatchedAlbum = Array.from({ length: 10 }, (_, index) =>
  discoveryResult({
    username: "user-d",
    filename: `${String(index + 1).padStart(2, "0")} - Aja Track ${index + 1}.mp3`,
    path: `Music/Steely Dan/Steely Dan - Aja/${String(index + 1).padStart(2, "0")} - Aja Track ${index + 1}.mp3`,
    folder: "Music/Steely Dan/Steely Dan - Aja",
    extension: "mp3",
    sizeBytes: 9_000_000,
    bitrate: 320_000
  })
);

const queryMatchedLosslessAlbum = Array.from({ length: 10 }, (_, index) =>
  discoveryResult({
    username: "user-e",
    filename: `${String(index + 1).padStart(2, "0")} - Aja Track ${index + 1}.flac`,
    path: `Uploads/Steely Dan/Aja/${String(index + 1).padStart(2, "0")} - Aja Track ${index + 1}.flac`,
    folder: "Uploads/Steely Dan/Aja",
    extension: "flac",
    sizeBytes: 31_000_000,
    bitrate: 880_000
  })
);

const groups = groupDiscoveryResults([...singles, ...lockedAlbum.reverse(), ...losslessAlbum.reverse(), ...queryMatchedAlbum]);

assert(groups.length === 4, `expected 4 grouped candidates, got ${groups.length}`);
assert(getDiscoveryFolderLabel(groups[0]) === "Great Album", "best candidate should be the unlocked lossless album");
assert(groups[0]?.qualityLabel === "lossless album", `expected lossless album label, got ${groups[0]?.qualityLabel}`);
assert(groups[0]?.availableCount === 9, `expected 9 available lossless album files, got ${groups[0]?.availableCount}`);
assert(groups[0]?.files[0]?.filename.startsWith("01 -"), "files should sort by leading track number");
assert(groups[0]?.previewFiles.length === 5, `expected compact 5-file preview, got ${groups[0]?.previewFiles.length}`);
assert(groups[0]?.previewFiles.at(-1)?.filename.startsWith("09 -"), "preview should include the final track");
assert(groups[0]?.releaseArtist === "Artist", `expected parent artist inference, got ${groups[0]?.releaseArtist}`);
assert(groups[0]?.releaseTitle === "Great Album", `expected release title inference, got ${groups[0]?.releaseTitle}`);
assert(groups[0]?.releaseCompleteness === "album", `expected album completeness, got ${groups[0]?.releaseCompleteness}`);

const availableOnly = filterDiscoveryGroups(groups, "all", "available");
assert(availableOnly.length === 3, `available filter should hide locked-only folders, got ${availableOnly.length}`);
assert(availableOnly.every((group) => group.availableCount > 0), "available filter returned a locked-only group");

const losslessOnly = filterDiscoveryGroups(groups, "lossless", "all");
assert(losslessOnly.length === 1, `lossless filter should keep one group, got ${losslessOnly.length}`);
assert(getDiscoveryFolderLabel(losslessOnly[0]) === "Great Album", "lossless filter kept the wrong group");

const compressedOnly = filterDiscoveryGroups(groups, "compressed", "all");
assert(compressedOnly.length === 3, `compressed filter should hide fully lossless group, got ${compressedOnly.length}`);

const userSorted = sortDiscoveryGroups(groups, "user");
assert(userSorted[0]?.username === "user-a", `user sort should start with user-a, got ${userSorted[0]?.username}`);

const sizeSorted = sortDiscoveryGroups(groups, "size");
assert(getDiscoveryFolderLabel(sizeSorted[0]) === "Great Album", "size sort should put the largest folder first");

const queryGroups = groupDiscoveryResults([...singles, ...losslessAlbum, ...queryMatchedAlbum], "steely dan aja");
assert(queryGroups[0]?.releaseArtist === "Steely Dan", `query match should infer Steely Dan, got ${queryGroups[0]?.releaseArtist}`);
assert(queryGroups[0]?.releaseTitle === "Aja", `query match should infer Aja, got ${queryGroups[0]?.releaseTitle}`);
assert(queryGroups[0]?.matchLabel === "strong match", `expected strong match label, got ${queryGroups[0]?.matchLabel}`);
const querySorted = sortDiscoveryGroups(queryGroups, "match");
assert(querySorted[0]?.releaseTitle === "Aja", "match sort should put the closest query release first");

const clusteredQueryGroups = clusterDiscoveryGroups(
  groupDiscoveryResults([...queryMatchedAlbum, ...queryMatchedLosslessAlbum, ...losslessAlbum], "steely dan aja")
);
const ajaCluster = clusteredQueryGroups.find((cluster) => cluster.releaseTitle === "Aja");
assert(ajaCluster != null, "expected an Aja release cluster");
assert(ajaCluster.sourceCount === 2, `expected two Aja source folders, got ${ajaCluster.sourceCount}`);
assert(ajaCluster.groups.length === 2, `expected source groups to remain selectable, got ${ajaCluster.groups.length}`);
assert(ajaCluster.qualityLabel === "lossless sources", `expected lossless cluster label, got ${ajaCluster.qualityLabel}`);

const ownedLibrary = libraryFile({
  filename: "01 - Aja Track 1.mp3",
  extension: "mp3",
  bitrate: 192_000,
  displayTags: { artist: "Steely Dan", albumartist: "Steely Dan", album: "Aja", title: "Aja Track 1" }
});
const queryMatch = summarizeDiscoveryLibraryMatch(querySorted[0], [ownedLibrary]);
assert(queryMatch.status === "possible_upgrade", `expected possible upgrade match, got ${queryMatch.status}`);
assert(queryMatch.matchedFileCount === 1, `expected one indexed match, got ${queryMatch.matchedFileCount}`);

const missingMatch = summarizeDiscoveryLibraryMatch(groups[0], [ownedLibrary]);
assert(missingMatch.status === "not_in_library", `expected missing release match, got ${missingMatch.status}`);

const ownedLossless = libraryFile({
  filename: "01 - Album Track 1.flac",
  extension: "flac",
  bitrate: 920_000,
  displayTags: { artist: "Artist", albumartist: "Artist", album: "Great Album", title: "Album Track 1" }
});
const ownedMatch = summarizeDiscoveryLibraryMatch(groups[0], [ownedLossless]);
assert(ownedMatch.status === "already_owned", `expected already owned lossless match, got ${ownedMatch.status}`);

const actionableGroups = filterDiscoveryGroupsByLibrary(queryGroups, [ownedLibrary], "actionable");
assert(actionableGroups.some((group) => group.releaseTitle === "Aja"), "actionable filter should keep possible upgrades");
const missingGroups = filterDiscoveryGroupsByLibrary(queryGroups, [ownedLibrary], "missing");
assert(!missingGroups.some((group) => group.releaseTitle === "Aja"), "missing filter should hide owned upgrade candidates");

console.log(JSON.stringify({ ok: true, best: getDiscoveryFolderLabel(groups[0]), groups: groups.length }, null, 2));

function discoveryResult(overrides: Partial<DiscoveryResult>): DiscoveryResult {
  const path = overrides.path ?? overrides.filename ?? "unknown.mp3";
  const filename = overrides.filename ?? path.split(/[\\/]/).at(-1) ?? path;
  return {
    id: `${overrides.username ?? "user"}:${path}:${overrides.sizeBytes ?? 0}`,
    source: "slskd",
    username: overrides.username ?? "user",
    filename,
    path,
    folder: overrides.folder ?? null,
    sizeBytes: overrides.sizeBytes ?? null,
    extension: overrides.extension ?? null,
    bitrate: overrides.bitrate ?? null,
    sampleRate: overrides.sampleRate ?? null,
    lengthSeconds: overrides.lengthSeconds ?? null,
    isLocked: overrides.isLocked ?? false,
    raw: overrides.raw ?? {}
  };
}

function libraryFile(overrides: Partial<DiscoveryLibraryFile>): DiscoveryLibraryFile {
  const filename = overrides.filename ?? "unknown.mp3";
  return {
    id: overrides.id ?? filename,
    filename,
    extension: overrides.extension ?? "mp3",
    bitrate: overrides.bitrate ?? null,
    sizeBytes: overrides.sizeBytes ?? 1,
    missing: overrides.missing ?? false,
    staged: overrides.staged ?? false,
    displayTags: overrides.displayTags ?? {}
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
