/** Shared album identity for the turntable and natural queue boundaries. */
export function recordAlbumKey(file: { displayTags: Record<string, string> }): string | null {
  const tags = file.displayTags;
  const album = tags.album?.trim();
  const artist = (tags.albumartist || tags.artist)?.trim();
  if (!album || !artist) return null;
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return `${normalize(artist)}\u0000${normalize(album)}`;
}

export const RECORD_NEEDLE_DROP_MS = 3_900;
/** Let the new vinyl turn briefly after the stylus settles, before releasing audio. */
export const RECORD_PLAYBACK_START_MS = RECORD_NEEDLE_DROP_MS + 1_000;
export const RECORD_RETURN_MS = 250;
