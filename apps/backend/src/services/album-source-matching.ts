import type { CatalogueTrack, DiscoveryResult, TasteProfile } from "@music-os/core";
import { musicKey, musicTitleKey } from "./album-completeness.js";
import { compareDiscoveryResultAvailability } from "./discovery-availability.js";

export type AlbumSourcePreferences = Pick<TasteProfile, "qualityPreferences" | "preferredFormats">;
export type AlbumFilePick = { result: DiscoveryResult; track: CatalogueTrack };
export interface AlbumMatchReport {
  picks: AlbumFilePick[];
  missing: CatalogueTrack[];
  locked: number;
  lowQuality: number;
  eligible: number;
}

const lossless = /^(flac|alac|wav|aiff|ape)$/i;
const audio = /^(flac|alac|wav|aiff|ape|mp3|m4a|aac|ogg|opus)$/i;
const extension = (r: DiscoveryResult) => r.extension || r.filename.split(".").at(-1) || "";
const sourceKey = (r: DiscoveryResult) => r.username + "\0" + r.path;
const trackKey = (t: CatalogueTrack) => t.disc + ":" + t.number;

// VBR and efficient codecs should not be judged by a 320 kbps MP3 target.
// Unknown lossy quality remains ineligible unless size and duration can establish it.
function bitrate(r: DiscoveryResult) {
  const reported = r.bitrate && r.bitrate > 0 ? r.bitrate : null;
  if (reported) return reported > 10000 ? reported / 1000 : reported;
  return r.sizeBytes && r.lengthSeconds
    ? r.sizeBytes * 8 / r.lengthSeconds / 1000
    : 0;
}
function highQuality(r: DiscoveryResult, preferences?: AlbumSourcePreferences) {
  const ext = extension(r);
  if (lossless.test(ext)) return true;
  if (preferences && /^mp3$/i.test(ext) && !preferences.qualityPreferences.allowMp3IfRare) return false;
  if (preferences?.qualityPreferences.minimumBitrateKbps != null) return bitrate(r) >= preferences.qualityPreferences.minimumBitrateKbps;
  const minimum = /^opus$/i.test(ext) ? 160
    : /^(aac|m4a|ogg)$/i.test(ext) || r.raw.isVariableBitRate === true ? 192 : 256;
  return bitrate(r) >= minimum;
}
function preferenceScore(result: DiscoveryResult, preferences?: AlbumSourcePreferences): number {
  const ext = extension(result).toLowerCase();
  const index = preferences?.preferredFormats.map((format) => format.toLowerCase()).indexOf(ext) ?? -1;
  return ((preferences?.qualityPreferences.preferLossless ?? true) && lossless.test(ext) ? 1000 : 0)
    + (index >= 0 ? 100 - index : 0);
}
function compareSources(a: DiscoveryResult, b: DiscoveryResult, preferences?: AlbumSourcePreferences) {
  // Preserve lossless preference, but do not let a large lossless bitrate
  // outrank a peer that can actually start transferring the same music.
  return preferenceScore(b, preferences) - preferenceScore(a, preferences)
    || compareDiscoveryResultAvailability(a, b)
    || bitrate(b) - bitrate(a);
}
function compareFolders(a: AlbumFilePick[], b: AlbumFilePick[], preferences?: AlbumSourcePreferences) {
  const losslessCount = (picks: AlbumFilePick[]) => picks.filter((p) => lossless.test(extension(p.result))).length;
  const quality = (picks: AlbumFilePick[]) => preferences ? picks.reduce((sum, pick) => sum + preferenceScore(pick.result, preferences), 0) : losslessCount(picks);
  const count = b.length - a.length || quality(b) - quality(a);
  if (count || !a.length || !b.length) return count;
  // Files in a folder normally share one peer's availability. Use the least
  // available file if a combined search observed changing queue conditions.
  const worst = (picks: AlbumFilePick[]) => picks.map((p) => p.result)
    .sort(compareDiscoveryResultAvailability).at(-1)!;
  return compareDiscoveryResultAvailability(worst(a), worst(b))
    || b.reduce((sum, p) => sum + bitrate(p.result), 0) - a.reduce((sum, p) => sum + bitrate(p.result), 0);
}
function unnumbered(value: string) {
  return value.replace(/^(?:(?:cd|disc|disk)\s*\d+\s*[-._ ]+)?(?:\d{1,2}[-.])?\d{1,3}[\s._-]+/i, "");
}
function albumBase(value: string) {
  return value.replace(/\s*(?:[-–—]\s*)?(?:EP|Single)$/i, "")
    .replace(/\s*[\[(](?:deluxe|expanded|anniversary|remastered|special edition)[^\])]*[\])]/gi, "").trim();
}
function albumNames(value: string) {
  const base = albumBase(value);
  const bilingual = base.match(/^(.+?)\s*[（(]([^()（）]+)[）)]$/u);
  if (bilingual && differentScript(bilingual[1], bilingual[2])
    && !/\b(?:version|ver|remix|live|deluxe|edition)\b/i.test(bilingual[2])) {
    return [base, ...bilingual.slice(1).filter((name) => musicKey(name).length >= 4)];
  }
  return [base];
}
function titleForms(value: string, artist: string, album: string, filename = true) {
  const forms = new Set<string>();
  const add = (v: string) => { forms.add(musicTitleKey(v)); if (filename) forms.add(musicTitleKey(unnumbered(v))); };
  // Only remove release/encoding annotations. Live, remix, instrumental and
  // alternate-version labels remain part of the identity.
  const cleaned = value.replace(/[\[(](?:(?:\d{4}\s+)?(?:re)?master(?:ed)?(?:\s+\d{4})?|(?:FLAC|MP3|AAC|ALAC|WAV|OGG|OPUS)(?:\s+\d+)?|\d+\s*(?:kbps|bit))[\])]/gi, "").trim();
  for (const text of [value, cleaned]) {
    add(text);
    if (!filename) continue;
    const parts = text.split(/\s+[-–—]\s+|_+/);
    const withoutContext = parts.filter((part) => ![musicKey(artist), musicKey(album), musicKey(albumBase(album))].includes(musicKey(unnumbered(part))));
    if (withoutContext.length && withoutContext.length !== parts.length) add(withoutContext.join(" - "));
  }
  return forms;
}
function fileNumber(r: DiscoveryResult) {
  const prefix = r.filename.match(/^(?:(?:cd|disc|disk)[ ._-]*\d+[ ._-]+|\d{1,2}[-.](?=\d{2,3}[\s._-]))?(\d{1,3})[\s._-]+/i);
  return Number(prefix?.[1]) || null;
}
function differentScript(a: string, b: string) {
  const nonLatin = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}]/u;
  return nonLatin.test(a) !== nonLatin.test(b);
}
function discNumber(r: DiscoveryResult) {
  const folder = r.path.match(/[\\/](?:cd|disc|disk)[ ._-]*(\d+)(?:[\\/]|[ ._-])/i);
  const prefix = r.filename.match(/^(?:(?:cd|disc|disk)[ ._-]*(\d+)[ ._-]+|(\d{1,2})[-.]\d{2,3}[\s._-]+)/i);
  return Number(folder?.[1] ?? prefix?.[1] ?? prefix?.[2]) || null;
}

export function inspectReleaseFiles(
  results: DiscoveryResult[],
  tracks: CatalogueTrack[],
  artist: string,
  album: string,
  allTracks: CatalogueTrack[] = tracks,
  preferences?: AlbumSourcePreferences,
): AlbumMatchReport {
  const groups = new Map<string, DiscoveryResult[]>();
  const report: AlbumMatchReport = { picks: [], missing: tracks, locked: 0, lowQuality: 0, eligible: 0 };
  const seen = new Set<string>();
  for (const r of results) {
    if (seen.has(sourceKey(r))) continue;
    seen.add(sourceKey(r));
    if (!r.username || !audio.test(extension(r))) continue;
    const path = musicKey(r.path);
    if (!path.includes(musicKey(artist)) || !albumNames(album).some((name) => path.includes(musicKey(name)))) continue;
    if (r.isLocked) { report.locked++; continue; }
    if (!highQuality(r, preferences)) { report.lowQuality++; continue; }
    report.eligible++;
    const folder = (r.folder ?? r.path.replace(/[\\/][^\\/]+$/, "")).replaceAll("/", "\\")
      .replace(/\\(?:cd|disc|disk)[ ._-]*\d+$/i, "");
    const key = r.username + "\0" + folder;
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }
  const titleCounts = new Map<string, number>();
  for (const t of allTracks) titleCounts.set(musicTitleKey(t.title), (titleCounts.get(musicTitleKey(t.title)) ?? 0) + 1);
  const eligibleFiles = [...groups.values()].flat();
  const forms = new Map(eligibleFiles.map((r) => [r, titleForms(r.filename.replace(/\.[^.]+$/, ""), artist, album)]));
  const samePositionAndDuration = (r: DiscoveryResult, track: CatalogueTrack) => {
    const disc = discNumber(r);
    return !(disc !== null && disc !== track.disc)
      && !(disc === null && (titleCounts.get(musicTitleKey(track.title)) ?? 0) > 1)
      && !(track.durationMs && r.lengthSeconds && Math.abs(r.lengthSeconds * 1000 - track.durationMs) >= 12000);
  };
  const exactTracks = new Set(tracks.filter((track) => {
    const wanted = titleForms(track.title, artist, album, false);
    return eligibleFiles.some((r) => samePositionAndDuration(r, track)
      && [...wanted].some((w) => !!w && forms.get(r)!.has(w)));
  }).map(trackKey));
  const candidates = [...groups.values()].map((files) => {
    const used = new Set<string>();
    // Transliteration is only inferred from a complete, unambiguous numbered
    // folder whose every track agrees with the catalogue duration. Never infer
    // identity from the duration of an isolated song or only the missing subset.
    const ordered = new Map<string, DiscoveryResult>();
    let ordinalSafe = allTracks.length >= 3 && files.length === allTracks.length;
    for (const r of files) {
      const number = fileNumber(r);
      const discs = new Set(allTracks.map((t) => t.disc));
      const disc = discNumber(r) ?? (discs.size === 1 ? allTracks[0]?.disc : null);
      const key = disc + ":" + number;
      if (!number || !disc || ordered.has(key)) ordinalSafe = false;
      ordered.set(key, r);
    }
    for (const t of allTracks) {
      const r = ordered.get(trackKey(t));
      const wanted = titleForms(t.title, artist, album, false);
      const exact = r && [...wanted].some((w) => !!w && forms.get(r)!.has(w));
      const version = /\b(?:live|remix|instrumental|karaoke|acoustic|demo|sped[ _-]*up|slowed|english[ _-]*version)\b/i;
      if (!r || !t.durationMs || !r.lengthSeconds
        || Math.abs(r.lengthSeconds * 1000 - t.durationMs) > 3000
        || (!exact && !differentScript(t.title, r.filename))
        || (!exact && version.test(r.path))) ordinalSafe = false;
    }
    return tracks.flatMap((track) => {
      const wanted = titleForms(track.title, artist, album, false);
      const matches = files.filter((r) => {
        if (used.has(sourceKey(r))) return false;
        if (!samePositionAndDuration(r, track)) return false;
        const exact = [...wanted].some((w) => !!w && forms.get(r)!.has(w));
        // Providers sometimes keep featured artists in a separate credit field.
        // Only reconcile that filename annotation with an exact ordinal and
        // duration; never substitute a bonus collaboration for the original.
        const disc = discNumber(r) ?? (new Set(allTracks.map((t) => t.disc)).size === 1 ? allTracks[0]?.disc : null);
        const credited = !exactTracks.has(trackKey(track)) && disc === track.disc
          && fileNumber(r) === track.number && !!track.durationMs && !!r.lengthSeconds
          && Math.abs(r.lengthSeconds * 1000 - track.durationMs) <= 3000;
        let creditMatch = false;
        if (credited) {
          const filename = r.filename.replace(/\.[^.]+$/, "");
          const version = /\b(?:live|remix|instrumental|karaoke|acoustic|demo|version|ver\.|sped|slowed)\b/i;
          const creditedNames = [filename.replace(/\s*[\[(](?:feat(?:uring)?\.?|ft\.?)\s+[^()[\]]+[\])]/gi,
            (credit) => version.test(credit) ? credit : "")];
          // Some peers append " - Selected Artist, Collaborator" to the title.
          // Remove only that terminal credit list, retaining every title/version
          // segment, even when the song has the same name as its album.
          const parts = filename.split(/\s+[-\u2013\u2014]\s+/);
          const artists = parts.at(-1)!.split(/\s*,\s*/);
          if (parts.length > 1 && artists.length > 1 && musicKey(artists[0]) === musicKey(artist)
            && artists.every((name) => !!musicKey(name) && !version.test(name))) {
            creditedNames.push(parts.slice(0, -1).join(" - "));
          }
          creditMatch = creditedNames.some((cleaned) => cleaned !== filename
            && [...wanted].some((w) => !!w && titleForms(cleaned, artist, album).has(w)));
        }
        return exact || creditMatch || (ordinalSafe && ordered.get(trackKey(track)) === r);
      }).sort((a, b) => compareSources(a, b, preferences));
      const result = matches[0];
      if (!result) return [];
      used.add(sourceKey(result));
      return [{ result, track }];
    });
  }).sort((a, b) => compareFolders(a, b, preferences));
  // Prefer a complete folder. If unavailable, combine confidently identified
  // tracks from multiple peers without reusing a file for two disc positions.
  const complete = candidates.find((picks) => picks.length === tracks.length);
  if (complete) report.picks = complete;
  else {
    const byTrack = new Map<string, AlbumFilePick>();
    const used = new Set<string>();
    for (const pick of candidates.flat().sort((a, b) => compareSources(a.result, b.result, preferences))) {
      if (byTrack.has(trackKey(pick.track)) || used.has(sourceKey(pick.result))) continue;
      byTrack.set(trackKey(pick.track), pick);
      used.add(sourceKey(pick.result));
    }
    report.picks = tracks.flatMap((t) => byTrack.has(trackKey(t)) ? [byTrack.get(trackKey(t))!] : []);
  }
  const matched = new Set(report.picks.map((p) => trackKey(p.track)));
  report.missing = tracks.filter((t) => !matched.has(trackKey(t)));
  return report;
}

export function matchReleaseFiles(results: DiscoveryResult[], tracks: CatalogueTrack[], artist: string, album: string): AlbumFilePick[] {
  const report = inspectReleaseFiles(results, tracks, artist, album);
  return report.missing.length ? [] : report.picks;
}

export function albumSearchQueries(artist: string, album: string): string[] {
  const clean = (text: string) => text.normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const baseAlbum = albumBase(album);
  return [...new Set([
    artist + " " + album,
    ...albumNames(baseAlbum).map((name) => clean(artist + " " + name)),
    ...(musicKey(baseAlbum).length >= 3 ? [clean(baseAlbum)] : []),
  ])].filter(Boolean);
}

export function albumMatchFailure(report: AlbumMatchReport, resultCount: number, searches: number) {
  if (!resultCount) return "No files were returned by Soulseek after " + searches + " searches. No source is currently available; retry later.";
  const missing = report.missing.slice(0, 4).map((t) => t.title).join(", ")
    + (report.missing.length > 4 ? " and " + (report.missing.length - 4) + " more" : "");
  return "Matched " + report.picks.length + "/" + (report.picks.length + report.missing.length)
    + " tracks across " + resultCount + " results from " + searches + " searches. Still missing: " + missing + "."
    + (report.locked ? " " + report.locked + " matching files were locked." : "")
    + (report.lowQuality ? " " + report.lowQuality + " files had low or unverified audio quality." : "");
}
