import type { AlbumGroup } from "@music-os/core";

type FavoriteAlbum = Pick<AlbumGroup, "id" | "artist" | "album" | "year">;
export function normalizeAlbumFavoriteEntry(value: string): string {
  return value.normalize("NFKC").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/** Normalize saved entries once, then perform four constant-time lookups per album. */
export function indexAlbumFavorites(albums: readonly FavoriteAlbum[], entries: readonly string[]): Set<string> {
  const saved = new Set(entries.map(normalizeAlbumFavoriteEntry));
  const ids = new Set<string>();
  if (!saved.size) return ids;
  for (const album of albums) {
    if ([album.id, `${album.artist} - ${album.album}`,
      `${album.artist} — ${album.album}${album.year ? ` (${album.year})` : ""}`, album.album]
      .some(key => saved.has(normalizeAlbumFavoriteEntry(key)))) ids.add(album.id);
  }
  return ids;
}
