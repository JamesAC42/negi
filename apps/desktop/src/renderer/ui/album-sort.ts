import type { AlbumGroup } from "@music-os/core";

export type AlbumCollectionSort = "artistAlbum" | "recent" | "listens" | "likes" | "rating";
export type ArtistCollectionSort = "artist" | Exclude<AlbumCollectionSort, "artistAlbum">;
type Metric = Exclude<AlbumCollectionSort, "artistAlbum">;
type SortFile = Pick<AlbumGroup["files"][number], "ctime" | "mtime" | "playCount" | "liked" | "rating">;
type SortAlbum = { artist: string; album: string; year?: string | null; files: SortFile[] };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function albumMetric(files: SortFile[], mode: Metric): number {
  let value = 0;
  let rated = 0;
  for (const file of files) {
    if (mode === "recent") {
      const timestamp = Date.parse(file.ctime ?? file.mtime);
      value = Math.max(value, Number.isFinite(timestamp) ? timestamp : 0);
    } else if (mode === "listens") value += file.playCount;
    else if (mode === "likes") value += Number(Boolean(file.liked));
    else if (file.rating != null) { value += file.rating; rated++; }
  }
  return mode === "rating" ? (rated ? value / rated : -1) : value;
}

/** Keys belong to this sort only: mutable playback/rating data never leaves a stale cached score. */
export function sortAlbumCollection<T extends SortAlbum>(albums: T[], mode: AlbumCollectionSort, includeYear = false): T[] {
  const compare = (left: T, right: T) => collator.compare(left.artist, right.artist) ||
    collator.compare(left.album, right.album) || (includeYear ? collator.compare(left.year ?? "", right.year ?? "") : 0);
  if (mode === "artistAlbum") return [...albums].sort(compare);
  return albums.map((album) => ({ album, score: albumMetric(album.files, mode) }))
    .sort((left, right) => right.score - left.score || compare(left.album, right.album))
    .map(({ album }) => album);
}

export function sortArtistCollection<T extends { artist: string; albums: SortAlbum[] }>(sections: T[], mode: ArtistCollectionSort): T[] {
  const compare = (left: T, right: T) => collator.compare(left.artist, right.artist);
  if (mode === "artist") return [...sections].sort(compare);
  return sections.map((section) => {
    let score = 0;
    let ratedAlbums = 0;
    for (const album of section.albums) {
      const value = albumMetric(album.files, mode);
      if (mode === "recent") score = Math.max(score, value);
      else if (mode !== "rating") score += value;
      else if (value >= 0) { score += value; ratedAlbums++; }
    }
    // Artist ratings intentionally average album averages, rather than weighting long albums more.
    if (mode === "rating") score = ratedAlbums ? score / ratedAlbums : -1;
    return { section, score };
  }).sort((left, right) => right.score - left.score || compare(left.section, right.section))
    .map(({ section }) => section);
}
