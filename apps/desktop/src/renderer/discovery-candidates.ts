import type { DiscoveryResult } from "@music-os/core";

export type DiscoveryGroup = {
  id: string;
  username: string | null;
  folder: string | null;
  files: DiscoveryResult[];
  previewFiles: DiscoveryResult[];
  releaseArtist: string | null;
  releaseTitle: string;
  matchScore: number;
  matchLabel: string;
  releaseCompleteness: "album" | "ep" | "single" | "folder" | "collection";
  primaryFormat: string | null;
  totalSizeBytes: number | null;
  formats: string[];
  lockedCount: number;
  availableCount: number;
  losslessCount: number;
  averageBitrate: number | null;
  score: number;
  qualityLabel: string;
};

export type DiscoveryCluster = {
  id: string;
  releaseArtist: string | null;
  releaseTitle: string;
  groups: DiscoveryGroup[];
  bestGroup: DiscoveryGroup;
  sourceCount: number;
  fileCount: number;
  availableCount: number;
  totalSizeBytes: number | null;
  formats: string[];
  qualityLabel: string;
  matchLabel: string;
};

export type DiscoverySort = "best" | "match" | "tracks" | "size" | "user";
export type DiscoveryFormatFilter = "all" | "lossless" | "compressed";
export type DiscoveryAvailabilityFilter = "all" | "available";
export type DiscoveryLibraryFilter = "all" | "actionable" | "missing" | "owned";
export type DiscoveryLibraryMatchStatus = "not_in_library" | "possible_upgrade" | "already_owned";

export type DiscoveryLibraryFile = {
  id: string;
  filename: string;
  extension: string;
  bitrate: number | null;
  sizeBytes: number;
  missing?: boolean;
  staged?: boolean;
  displayTags: Record<string, string>;
};

export type DiscoveryLibraryMatch = {
  status: DiscoveryLibraryMatchStatus;
  label: string;
  detail: string;
  matchedFileCount: number;
  localQualityLabel: string | null;
  remoteQualityLabel: string | null;
};

export function filterDiscoveryGroups(
  groups: DiscoveryGroup[],
  formatFilter: DiscoveryFormatFilter,
  availabilityFilter: DiscoveryAvailabilityFilter
): DiscoveryGroup[] {
  return groups.filter((group) => {
    if (availabilityFilter === "available" && group.availableCount === 0) {
      return false;
    }
    if (formatFilter === "lossless" && group.losslessCount === 0) {
      return false;
    }
    if (formatFilter === "compressed" && group.losslessCount === group.files.length) {
      return false;
    }
    return true;
  });
}

export function sortDiscoveryGroups(groups: DiscoveryGroup[], sortMode: DiscoverySort): DiscoveryGroup[] {
  return [...groups].sort((a, b) => compareDiscoveryGroups(a, b, sortMode));
}

export function clusterDiscoveryGroups(groups: DiscoveryGroup[]): DiscoveryCluster[] {
  const clusters = new Map<string, DiscoveryGroup[]>();
  for (const group of groups) {
    const key = discoveryClusterKey(group);
    clusters.set(key, [...(clusters.get(key) ?? []), group]);
  }

  return [...clusters.entries()]
    .map(([id, grouped]) => {
      const sortedGroups = [...grouped].sort((a, b) => compareDiscoveryGroups(a, b, "best"));
      const bestGroup = sortedGroups[0];
      const formats = [
        ...new Set(sortedGroups.flatMap((group) => group.formats))
      ].sort();
      const totalSizeBytes = sortedGroups.reduce<number | null>((total, group) => {
        if (group.totalSizeBytes == null) {
          return total;
        }
        return (total ?? 0) + group.totalSizeBytes;
      }, null);

      return {
        id,
        releaseArtist: bestGroup.releaseArtist,
        releaseTitle: bestGroup.releaseTitle,
        groups: sortedGroups,
        bestGroup,
        sourceCount: sortedGroups.length,
        fileCount: sortedGroups.reduce((total, group) => total + group.files.length, 0),
        availableCount: sortedGroups.reduce((total, group) => total + group.availableCount, 0),
        totalSizeBytes,
        formats,
        qualityLabel: getClusterQualityLabel(sortedGroups),
        matchLabel: bestGroup.matchLabel
      };
    })
    .sort((a, b) => compareDiscoveryGroups(a.bestGroup, b.bestGroup, "best"));
}

export function filterDiscoveryGroupsByLibrary(
  groups: DiscoveryGroup[],
  libraryFiles: DiscoveryLibraryFile[],
  libraryFilter: DiscoveryLibraryFilter
): DiscoveryGroup[] {
  if (libraryFilter === "all") {
    return groups;
  }

  return groups.filter((group) => {
    const match = summarizeDiscoveryLibraryMatch(group, libraryFiles);
    if (libraryFilter === "actionable") {
      return match.status !== "already_owned";
    }
    if (libraryFilter === "missing") {
      return match.status === "not_in_library";
    }
    return match.status === "already_owned" || match.status === "possible_upgrade";
  });
}

export function summarizeDiscoveryLibraryMatch(group: DiscoveryGroup, libraryFiles: DiscoveryLibraryFile[]): DiscoveryLibraryMatch {
  const activeFiles = libraryFiles.filter((file) => !file.missing && !file.staged);
  const releaseTitle = normalizeIdentity(group.releaseTitle);
  const releaseArtist = group.releaseArtist ? normalizeIdentity(group.releaseArtist) : null;
  const matchedFiles = activeFiles.filter((file) => isLibraryReleaseMatch(file, releaseTitle, releaseArtist, group));
  const remoteQuality = getRemoteQuality(group);

  if (matchedFiles.length === 0) {
    return {
      status: "not_in_library",
      label: "not in library",
      detail: "No matching indexed album or track",
      matchedFileCount: 0,
      localQualityLabel: null,
      remoteQualityLabel: remoteQuality.label
    };
  }

  const localQuality = getLocalQuality(matchedFiles);
  const hasUpgrade = group.availableCount > 0 && remoteQuality.score > localQuality.score + 64;
  return {
    status: hasUpgrade ? "possible_upgrade" : "already_owned",
    label: hasUpgrade ? "possible upgrade" : "already indexed",
    detail: `${matchedFiles.length.toLocaleString()} indexed match${matchedFiles.length === 1 ? "" : "es"}${
      localQuality.label && remoteQuality.label ? ` · local ${localQuality.label}, remote ${remoteQuality.label}` : ""
    }`,
    matchedFileCount: matchedFiles.length,
    localQualityLabel: localQuality.label,
    remoteQualityLabel: remoteQuality.label
  };
}

export function groupDiscoveryResults(results: DiscoveryResult[], query = ""): DiscoveryGroup[] {
  const groups = new Map<string, DiscoveryResult[]>();

  for (const result of results) {
    const key = `${result.username ?? "unknown"}\u0000${result.folder ?? "single files"}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return [...groups.entries()]
    .map(([key, files]) => {
      const [usernameValue, folderValue] = key.split("\u0000");
      const release = inferReleaseCandidate(folderValue === "single files" ? null : folderValue, files);
      const audioFiles = files.filter(isAudioDiscoveryResult);
      const stageableAudioFiles = audioFiles.filter((file) => !file.isLocked);
      const metricFiles = audioFiles.length > 0 ? audioFiles : files;
      const totalSizeBytes = metricFiles.reduce<number | null>((total, file) => {
        if (file.sizeBytes == null) {
          return total;
        }
        return (total ?? 0) + file.sizeBytes;
      }, null);
      const formats = [
        ...new Set(metricFiles.map((file) => file.extension?.toUpperCase()).filter((format): format is string => Boolean(format)))
      ].sort();
      const sortedFiles = [...files].sort(compareDiscoveryFiles);
      const lockedCount = files.filter((file) => file.isLocked).length;
      const losslessCount = audioFiles.filter((file) => isLosslessExtension(file.extension)).length;
      const bitrates = audioFiles.map((file) => file.bitrate).filter((bitrate): bitrate is number => bitrate != null && bitrate > 0);
      const averageBitrate =
        bitrates.length === 0 ? null : bitrates.reduce((total, bitrate) => total + bitrate, 0) / bitrates.length;
      const matchScore = scoreQueryMatch(release, files, query);
      const group: DiscoveryGroup = {
        id: key,
        username: usernameValue === "unknown" ? null : usernameValue,
        folder: folderValue === "single files" ? null : folderValue,
        files: sortedFiles,
        previewFiles: buildPreviewFiles(sortedFiles),
        releaseArtist: release.artist,
        releaseTitle: release.title,
        matchScore,
        matchLabel: getMatchLabel(matchScore, query),
        releaseCompleteness: getReleaseCompleteness(files),
        primaryFormat: getPrimaryFormat(files),
        totalSizeBytes,
        formats,
        lockedCount,
        availableCount: stageableAudioFiles.length,
        losslessCount,
        averageBitrate,
        score: 0,
        qualityLabel: ""
      };

      return {
        ...group,
        score: scoreDiscoveryGroup(group),
        qualityLabel: getDiscoveryQualityLabel(group)
      };
    })
    .sort((a, b) => compareDiscoveryGroups(a, b, "best"));
}

export function getDiscoveryFolderLabel(group: DiscoveryGroup): string {
  if (!group.folder) {
    return "Single files";
  }
  const parts = group.folder.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? group.folder;
}

function discoveryClusterKey(group: DiscoveryGroup): string {
  const artist = group.releaseArtist ? normalizeIdentity(group.releaseArtist) : "";
  const title = normalizeIdentity(group.releaseTitle || getDiscoveryFolderLabel(group));
  const fallback = normalizeIdentity([group.username, group.folder, group.files[0]?.filename].filter(Boolean).join(" "));
  return `${artist}\u0000${title || fallback}`;
}

function getClusterQualityLabel(groups: DiscoveryGroup[]): string {
  if (groups.some((group) => group.qualityLabel === "lossless album")) {
    return "lossless sources";
  }
  if (groups.some((group) => group.qualityLabel === "mixed quality")) {
    return "mixed sources";
  }
  if (groups.some((group) => group.releaseCompleteness === "album")) {
    return "album sources";
  }
  return groups[0]?.qualityLabel ?? "source candidates";
}

function compareDiscoveryGroups(a: DiscoveryGroup, b: DiscoveryGroup, sortMode: DiscoverySort): number {
  if (sortMode === "match" && b.matchScore !== a.matchScore) {
    return b.matchScore - a.matchScore;
  }
  if (sortMode === "tracks" && b.files.length !== a.files.length) {
    return b.files.length - a.files.length;
  }
  if (sortMode === "size" && (b.totalSizeBytes ?? 0) !== (a.totalSizeBytes ?? 0)) {
    return (b.totalSizeBytes ?? 0) - (a.totalSizeBytes ?? 0);
  }
  if (sortMode === "user") {
    const userCompare = (a.username ?? "").localeCompare(b.username ?? "");
    return userCompare === 0 ? getDiscoveryFolderLabel(a).localeCompare(getDiscoveryFolderLabel(b)) : userCompare;
  }
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (b.files.length !== a.files.length) {
    return b.files.length - a.files.length;
  }
  return getDiscoveryFolderLabel(a).localeCompare(getDiscoveryFolderLabel(b));
}

function scoreDiscoveryGroup(group: DiscoveryGroup): number {
  const audioCount = group.files.filter(isAudioDiscoveryResult).length;
  const fileCountScore = Math.min(audioCount, 18) * 3;
  const albumShapeScore = audioCount >= 7 && audioCount <= 24 ? 18 : audioCount >= 3 ? 8 : 0;
  const availabilityScore = audioCount === 0 ? 0 : (group.availableCount / audioCount) * 18;
  const losslessScore = audioCount === 0 ? 0 : (group.losslessCount / audioCount) * 16;
  const bitrateScore = group.averageBitrate == null ? 0 : Math.min(group.averageBitrate / 1000, 1000) / 100;
  const folderScore = group.folder ? Math.min(group.folder.split(/[\\/]+/).filter(Boolean).length, 4) * 3 : 0;
  const lockedPenalty = group.lockedCount > 0 ? Math.min(group.lockedCount * 2, 12) : 0;
  const collectionPenalty = group.releaseCompleteness === "collection" ? 28 : 0;
  return Math.max(
    0,
    fileCountScore +
      albumShapeScore +
      availabilityScore +
      losslessScore +
      bitrateScore +
      folderScore +
      group.matchScore * 1.5 -
      lockedPenalty -
      collectionPenalty
  );
}

function getDiscoveryQualityLabel(group: DiscoveryGroup): string {
  const audioFiles = group.files.filter(isAudioDiscoveryResult);
  if (group.releaseCompleteness === "collection") {
    return group.losslessCount > 0 ? "lossless collection" : "large collection";
  }
  if (audioFiles.length === 0) {
    return "non-audio assets";
  }
  if (audioFiles.length === 1) {
    return isLosslessExtension(audioFiles[0]?.extension) ? "lossless file" : "single file";
  }
  if (group.losslessCount === audioFiles.length) {
    return audioFiles.length >= 7 ? "lossless album" : "lossless folder";
  }
  if (group.losslessCount > 0) {
    return "mixed quality";
  }
  if (audioFiles.length >= 7 && audioFiles.length <= 24) {
    return "album candidate";
  }
  return "folder candidate";
}

function getReleaseCompleteness(files: DiscoveryResult[]): DiscoveryGroup["releaseCompleteness"] {
  const audioCount = files.filter(isAudioDiscoveryResult).length;
  if (audioCount === 1) {
    return "single";
  }
  if (audioCount > 30) {
    return "collection";
  }
  if (audioCount >= 7 && audioCount <= 30) {
    return "album";
  }
  if (audioCount >= 3 && audioCount <= 6) {
    return "ep";
  }
  return "folder";
}

function buildPreviewFiles(files: DiscoveryResult[]): DiscoveryResult[] {
  if (files.length <= 5) {
    return files;
  }

  const first = files.slice(0, 3);
  const middle = files[Math.floor(files.length / 2)];
  const last = files.at(-1);
  const preview = [...first];
  for (const file of [middle, last]) {
    if (file && !preview.some((item) => item.id === file.id)) {
      preview.push(file);
    }
  }
  return preview.slice(0, 5);
}

function compareDiscoveryFiles(a: DiscoveryResult, b: DiscoveryResult): number {
  const trackA = readTrackNumber(a.filename);
  const trackB = readTrackNumber(b.filename);
  if (trackA != null && trackB != null && trackA !== trackB) {
    return trackA - trackB;
  }
  if (trackA != null && trackB == null) {
    return -1;
  }
  if (trackA == null && trackB != null) {
    return 1;
  }
  return a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: "base" });
}

type InferredRelease = {
  artist: string | null;
  title: string;
  searchText: string;
};

function inferReleaseCandidate(folder: string | null, files: DiscoveryResult[]): InferredRelease {
  const folderParts = folder?.split(/[\\/]+/).filter(Boolean) ?? [];
  const folderLabel = cleanReleaseText(folderParts.at(-1) ?? "");
  const parentLabel = cleanReleaseText(folderParts.at(-2) ?? "");
  const folderRelease = parseArtistTitle(folderLabel);
  if (folderRelease) {
    return {
      artist: folderRelease.artist,
      title: folderRelease.title,
      searchText: normalizeSearchText([folderLabel, parentLabel, ...files.map((file) => file.filename)].join(" "))
    };
  }

  const fileRelease = inferReleaseFromFiles(files);
  const artist = parentLabel && isLikelyArtistFolder(parentLabel) ? parentLabel : fileRelease.artist;
  const title = folderLabel || fileRelease.title || files[0]?.filename || "Unknown release";
  return {
    artist,
    title,
    searchText: normalizeSearchText([artist, title, folder ?? "", ...files.map((file) => file.filename)].filter(Boolean).join(" "))
  };
}

function inferReleaseFromFiles(files: DiscoveryResult[]): { artist: string | null; title: string | null } {
  const parsed = files
    .map((file) => parseArtistTitle(stripTrackPrefix(stripExtension(file.filename))))
    .filter((item): item is { artist: string; title: string } => item != null);
  if (parsed.length === 0) {
    return { artist: null, title: null };
  }
  const artist = mostCommon(parsed.map((item) => item.artist));
  return {
    artist,
    title: parsed.length === 1 ? parsed[0]?.title ?? null : null
  };
}

function parseArtistTitle(value: string): { artist: string; title: string } | null {
  const cleaned = cleanReleaseText(value);
  const match = cleaned.match(/^(.+?)\s+-\s+(.+)$/);
  if (!match) {
    return null;
  }
  const artist = cleanReleaseText(match[1] ?? "");
  const title = cleanReleaseText(match[2] ?? "");
  if (!artist || !title) {
    return null;
  }
  return { artist, title };
}

function scoreQueryMatch(release: InferredRelease, files: DiscoveryResult[], query: string): number {
  const tokens = normalizeSearchText(query)
    .split(" ")
    .filter((token) => token.length > 1);
  if (tokens.length === 0) {
    return 0;
  }

  const releaseText = normalizeSearchText([release.artist, release.title].filter(Boolean).join(" "));
  const fileText = normalizeSearchText(files.map((file) => file.filename).join(" "));
  const candidateText = `${release.searchText} ${fileText}`.trim();
  const matchedTokens = tokens.filter((token) => candidateText.includes(token)).length;
  const tokenScore = (matchedTokens / tokens.length) * 16;
  const titleScore = releaseText.includes(tokens.join(" ")) ? 8 : 0;
  const artistScore = release.artist && normalizeSearchText(release.artist).includes(tokens[0] ?? "") ? 4 : 0;
  return tokenScore + titleScore + artistScore;
}

function getMatchLabel(matchScore: number, query: string): string {
  if (!query.trim()) {
    return "unranked";
  }
  if (matchScore >= 24) {
    return "strong match";
  }
  if (matchScore >= 14) {
    return "likely match";
  }
  if (matchScore > 0) {
    return "partial match";
  }
  return "weak match";
}

function getPrimaryFormat(files: DiscoveryResult[]): string | null {
  return mostCommon(files.map((file) => file.extension?.toUpperCase()).filter((value): value is string => Boolean(value)));
}

function isLibraryReleaseMatch(
  file: DiscoveryLibraryFile,
  releaseTitle: string,
  releaseArtist: string | null,
  group: DiscoveryGroup
): boolean {
  const tags = file.displayTags;
  const album = normalizeIdentity(tags.album ?? "");
  const title = normalizeIdentity(tags.title ?? stripExtension(file.filename));
  const artist = normalizeIdentity(tags.albumartist ?? tags.artist ?? "");
  const filename = normalizeIdentity(file.filename);
  const groupTrackTitles = new Set(group.files.map((result) => normalizeIdentity(stripTrackPrefix(stripExtension(result.filename)))));

  if (releaseTitle && album && identitiesMatch(album, releaseTitle)) {
    return !releaseArtist || !artist || identitiesMatch(artist, releaseArtist);
  }

  if (group.files.length === 1 && groupTrackTitles.has(title)) {
    return !releaseArtist || !artist || identitiesMatch(artist, releaseArtist) || filename.includes(releaseArtist);
  }

  return Boolean(releaseTitle && filename.includes(releaseTitle) && (!releaseArtist || filename.includes(releaseArtist)));
}

function identitiesMatch(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  return a === b || a.includes(b) || b.includes(a);
}

function getRemoteQuality(group: DiscoveryGroup): { score: number; label: string | null } {
  const losslessBonus = group.losslessCount > 0 ? 1_000_000 : 0;
  const bitrate = group.averageBitrate ?? 0;
  const format = group.primaryFormat ?? null;
  return {
    score: losslessBonus + bitrate / 1000,
    label: format ? `${format}${bitrate > 0 ? ` ${Math.round(bitrate / 1000)} kbps avg` : ""}` : null
  };
}

function getLocalQuality(files: DiscoveryLibraryFile[]): { score: number; label: string | null } {
  let bestScore = 0;
  let bestLabel: string | null = null;
  for (const file of files) {
    const losslessBonus = isLosslessExtension(file.extension) ? 1_000_000 : 0;
    const score = losslessBonus + (file.bitrate ?? 0) / 1000;
    if (score >= bestScore) {
      bestScore = score;
      bestLabel = `${file.extension.toUpperCase()}${file.bitrate ? ` ${Math.round(file.bitrate / 1000)} kbps` : ""}`;
    }
  }
  return { score: bestScore, label: bestLabel };
}

function normalizeIdentity(value: string): string {
  return normalizeSearchText(cleanReleaseText(value));
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function isLikelyArtistFolder(value: string): boolean {
  return Boolean(value) && !/\b(album|music|downloads?|discography|complete|flac|mp3|lossless)\b/i.test(value);
}

function stripTrackPrefix(value: string): string {
  return value.replace(/^\s*(?:cd\s*\d+\s*)?(?:\d{1,2}[-._\s]+)+/i, "").trim();
}

function stripExtension(value: string): string {
  return value.replace(/\.[a-z0-9]{2,5}$/i, "");
}

function cleanReleaseText(value: string): string {
  return value
    .replace(/\[[^\]]*(?:flac|mp3|aac|m4a|v0|v2|320|256|192|kbps|lossless|web|cd|vinyl|scene)[^\]]*\]/gi, "")
    .replace(/\([^\)]*(?:flac|mp3|aac|m4a|v0|v2|320|256|192|kbps|lossless|web|cd|vinyl|scene)[^\)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readTrackNumber(filename: string): number | null {
  const match = filename.match(/(?:^|[\s._-])(\d{1,2})(?:[\s._-])/);
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function isLosslessExtension(extension: string | null | undefined): boolean {
  return extension != null && ["flac", "alac", "wav", "aiff", "aif", "ape", "wv"].includes(extension.toLowerCase());
}

export function isAudioDiscoveryResult(result: DiscoveryResult): boolean {
  const extension = result.extension?.toLowerCase();
  return extension != null && audioExtensions.has(extension);
}

const audioExtensions = new Set(["aac", "aiff", "alac", "ape", "dsf", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"]);
