import { RECORD_NEEDLE_DROP_MS, recordAlbumKey, type LibraryFilesResponse, type PlaybackStateResponse } from "@music-os/core";
type File = LibraryFilesResponse["files"][number];

/** Album position uses the library's complete track order, not the remaining queue. */
export function recordAlbumProgress(files: File[], current: File | null, playback: PlaybackStateResponse) {
  if (!current) return { ratio: 0, track: 0, tracks: 0, approximate: false };
  const key = recordAlbumKey(current);
  const number = (value?: string) => Number.parseInt(value ?? "", 10) || 0;
  const albumFiles = key ? files.filter((file) => recordAlbumKey(file) === key) : [current];
  // A file can occur in multiple playlists. Alternate copies of a numbered track share a groove.
  const unique = new Map<string, File>();
  for (const file of [current, ...albumFiles]) {
    const track = number(file.displayTags.tracknumber ?? file.displayTags.track);
    const identity = track ? `${number(file.displayTags.discnumber ?? file.displayTags.disc)}:${track}` : file.id;
    if (!unique.has(identity)) unique.set(identity, file);
  }
  const ordered = [...unique.values()].sort((a, b) =>
    number(a.displayTags.discnumber ?? a.displayTags.disc) - number(b.displayTags.discnumber ?? b.displayTags.disc) ||
    number(a.displayTags.tracknumber ?? a.displayTags.track) - number(b.displayTags.tracknumber ?? b.displayTags.track) ||
    a.filename.localeCompare(b.filename, undefined, { numeric: true }));
  const index = ordered.findIndex((file) => file.id === current.id);
  const known = ordered.filter((file) => file.durationMs != null && file.durationMs > 0);
  const estimate = known.length ? known.reduce((sum, file) => sum + file.durationMs!, 0) / known.length : 180_000;
  const duration = (file: File) => file.id === current.id && playback.durationMs ? playback.durationMs : file.durationMs || estimate;
  const total = ordered.reduce((sum, file) => sum + duration(file), 0);
  const elapsed = ordered.slice(0, Math.max(0, index)).reduce((sum, file) => sum + duration(file), 0) +
    Math.min(Math.max(0, playback.positionMs), duration(current));
  return { ratio: Math.min(1, Math.max(0, elapsed / total)), track: index + 1, tracks: ordered.length,
    approximate: known.length !== ordered.length };
}

/** Start at the first visible frame, never at an earlier backend wall-clock time. */
export function createRecordAnimationClock(): (frameTime: number, running: boolean) => number {
  let previousFrame: number | null = null;
  let wasRunning = false;
  let elapsed = 0;
  return (frameTime, running) => {
    if (running && wasRunning && previousFrame != null) elapsed += Math.max(0, frameTime - previousFrame);
    previousFrame = frameTime;
    wasRunning = running;
    return elapsed;
  };
}

export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
export const easeOut = (n: number) => 1 - (1 - clamp(n)) ** 3;
export const easeIn = (n: number) => clamp(n) ** 3;
/** A restrained overshoot gives arriving objects a little weight. */
export const settle = (n: number) => {
  const t = clamp(n) - 1;
  return 1 + 1.7 * t ** 3 + .7 * t ** 2;
};
export const phase = (elapsed: number, start: number, end: number, curve = ease) => curve((elapsed - start) / (end - start));
export const arc = (n: number) => Math.sin(Math.PI * clamp(n));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const recordChangeTiming = {
  centered: 520,
  armParked: 650,
  vinylRaised: 1_080,
  sleeved: 1_430,
  swap: 1_850,
  sleeveArrived: 2_320,
  vinylOut: 2_730,
  vinylDown: 3_330,
  armIn: 3_690,
  needleDrop: RECORD_NEEDLE_DROP_MS
} as const;

export function recordChangeLabel(elapsed: number): string {
  if (elapsed < recordChangeTiming.armParked) return "Lifting the tonearm";
  if (elapsed < recordChangeTiming.sleeved) return "Putting this record away";
  if (elapsed < recordChangeTiming.sleeveArrived) return "A new album, a new atmosphere";
  if (elapsed < recordChangeTiming.vinylDown) return "Setting the next record down";
  if (elapsed < recordChangeTiming.needleDrop) return "Dropping the needle";
  return "Letting the record turn";
}
