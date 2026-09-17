import type { AlbumGroup } from "@music-os/core";

/** Preserve library order and stop before allocating results that the palette never shows. */
export function findCommandTracks<T extends AlbumGroup>(albums: readonly T[], normalizedQuery: string) {
  const matches: Array<{ album: T; file: T["files"][number]; label: string }> = [];
  if (normalizedQuery.length < 2) return matches;
  for (const album of albums) {
    for (const file of album.files) {
      const label = file.displayTags.title ?? file.filename;
      if (!`${label} ${file.displayTags.artist ?? album.artist} ${album.album}`.toLocaleLowerCase().includes(normalizedQuery)) continue;
      matches.push({ album, file, label });
      if (matches.length === 6) return matches;
    }
  }
  return matches;
}
