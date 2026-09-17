import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { sortAlbumCollection, sortArtistCollection, type AlbumCollectionSort, type ArtistCollectionSort } from "../renderer/ui/album-sort.js";

type Album = Parameters<typeof sortAlbumCollection>[0][number] & { id: string };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const compare = (a: Album, b: Album, year = false) => collator.compare(a.artist, b.artist) || collator.compare(a.album, b.album) || (year ? collator.compare(a.year ?? "", b.year ?? "") : 0);
function originalMetric(files: Album["files"], mode: string): number {
  if (mode === "recent") return Math.max(0, ...files.map(file => {
    const value = Date.parse(file.ctime ?? file.mtime);
    return Number.isFinite(value) ? value : 0;
  }));
  if (mode === "listens") return files.reduce((total, file) => total + file.playCount, 0);
  if (mode === "likes") return files.reduce((total, file) => total + Number(Boolean(file.liked)), 0);
  const rated = files.filter(file => file.rating != null);
  return rated.length ? rated.reduce((total, file) => total + (file.rating ?? 0), 0) / rated.length : -1;
}
function originalAlbumSort(albums: Album[], mode: AlbumCollectionSort, year = false) {
  return [...albums].sort((a, b) => (mode === "artistAlbum" ? 0 : originalMetric(b.files, mode) - originalMetric(a.files, mode)) || compare(a, b, year));
}
function originalArtistMetric(albums: Album[], mode: ArtistCollectionSort) {
  if (mode === "recent") return Math.max(0, ...albums.map(album => originalMetric(album.files, mode)));
  if (mode !== "rating") return albums.reduce((sum, album) => sum + originalMetric(album.files, mode), 0);
  const ratings = albums.map(album => originalMetric(album.files, mode)).filter(value => value >= 0);
  return ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : -1;
}
const albums: Album[] = Array.from({ length: 180 }, (_, i) => ({
  id: String(i), artist: `Artist ${i % 12}`, album: `Album ${i % 9}`, year: i % 4 ? String(1990 + i % 30) : null,
  files: Array.from({ length: i % 15 }, (_, j) => ({
    ctime: j % 3 ? new Date(Date.UTC(2010 + i % 16, i % 12, j + 1)).toISOString() : null,
    mtime: j % 4 ? "2020-01-01T00:00:00Z" : "invalid", playCount: (i + j) % 17,
    liked: (i + j) % 3 === 0, rating: j % 3 ? (i + j) % 5 + 1 : null,
  })),
}));
const modes: AlbumCollectionSort[] = ["artistAlbum", "recent", "listens", "likes", "rating"];
for (const mode of modes) for (const year of [false, true]) {
  assert.deepEqual(sortAlbumCollection(albums, mode, year), originalAlbumSort(albums, mode, year), `${mode} preserves ties, missing metadata and year policy`);
}
const sections = Array.from({ length: 12 }, (_, i) => ({ artist: `Artist ${i}`, albums: albums.filter(album => album.artist === `Artist ${i}`) }));
sections.push({ artist: "Empty", albums: [] });
for (const mode of ["artist", "recent", "listens", "likes", "rating"] as ArtistCollectionSort[]) {
  const expected = [...sections].sort((a, b) => (mode === "artist" ? 0 : originalArtistMetric(b.albums, mode) - originalArtistMetric(a.albums, mode)) || collator.compare(a.artist, b.artist));
  assert.deepEqual(sortArtistCollection(sections, mode), expected, `${mode} preserves artist aggregate semantics`);
}
assert.deepEqual(albums.map(album => album.id), Array.from({ length: 180 }, (_, i) => String(i)), "Inputs remain in their original order");
const tied = [albums[0]!, { ...albums[0]!, id: "same-key" }];
for (const mode of modes) assert.deepEqual(sortAlbumCollection(tied, mode), tied, "Exact ties remain stable");
const editable = [structuredClone(albums[1]!), structuredClone(albums[2]!)];
const previous = sortAlbumCollection(editable, "listens");
previous[1]!.files[0]!.playCount = 100000;
assert.equal(sortAlbumCollection(editable, "listens")[0], previous[1], "Each sort observes updated metrics");

const fixture: Album[] = Array.from({ length: 5000 }, (_, i) => ({
  id: String(i), artist: `Artist ${i % 400}`, album: `Album ${i}`,
  files: Array.from({ length: 12 }, (_, j) => ({ ctime: new Date(Date.UTC(2010 + i * 7919 % 16, i % 12, j + 1)).toISOString(), mtime: "", playCount: 0, liked: false, rating: null })),
}));
const parse = Date.parse;
let parses = 0;
Date.parse = (value: string) => { parses++; return parse(value); };
try {
  const measure = (sort: () => Album[]) => {
    const times: number[] = [];
    let count = 0;
    let result: Album[] = [];
    for (let round = 0; round < 7; round++) {
      parses = 0;
      const start = performance.now(); result = sort(); times.push(performance.now() - start); count = parses;
    }
    times.sort((a, b) => a - b);
    return { medianMs: Math.round(times[3]! * 10) / 10, dateParses: count, result };
  };
  const before = measure(() => originalAlbumSort(fixture, "recent"));
  const after = measure(() => sortAlbumCollection(fixture, "recent"));
  assert.deepEqual(after.result, before.result);
  assert.equal(after.dateParses, 60000, "Each track timestamp is parsed exactly once per album sort");
  parses = 0;
  sortArtistCollection([{ artist: "All", albums: fixture }], "recent");
  assert.equal(parses, 60000, "Each track timestamp is parsed exactly once per artist sort");
  console.log(JSON.stringify({ ok: true, albums: 5000, tracks: 60000, before: { medianMs: before.medianMs, dateParses: before.dateParses }, after: { medianMs: after.medianMs, dateParses: after.dateParses } }));
} finally { Date.parse = parse; }
