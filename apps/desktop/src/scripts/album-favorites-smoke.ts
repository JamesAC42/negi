import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { indexAlbumFavorites, normalizeAlbumFavoriteEntry as normalize } from "../renderer/album-favorites";
const albums = Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}`, artist: `Artist ${i % 80}`, album: `Album ${i}`, year: i % 3 ? "2026" : null }));
albums.push({ id: "unicode", artist: "Ａｒｔｉｓｔ", album: "An   Album", year: "2001" });
const entries = albums.filter((_, i) => i % 2 === 0).map((album, i) => [album.id, `${album.artist} - ${album.album}`, `${album.artist} — ${album.album}${album.year ? ` (${album.year})` : ""}`, album.album][i % 4]);
entries.push(" artist – an album (2001) ", "unknown", "ID-7");
// Preserve all four historical matching forms, including Unicode and whitespace normalization.
const start = performance.now();
const expected = albums.filter(album => entries.some(entry => {
  const key = normalize(entry);
  return key === normalize(album.id) || key === normalize(`${album.artist} - ${album.album}`) ||
    key === normalize(`${album.artist} — ${album.album}${album.year ? ` (${album.year})` : ""}`) || key === normalize(album.album);
})).map(album => album.id);
const scanMs = performance.now() - start;
const indexedAt = performance.now();
const indexed = indexAlbumFavorites(albums, entries);
const indexMs = performance.now() - indexedAt;
assert.deepEqual([...indexed], expected);
assert.ok(indexed.has("unicode"));
assert.equal(indexAlbumFavorites(albums, []).size, 0, "removing favorites invalidates the match set");
assert.deepEqual([...indexAlbumFavorites(albums, ["id-3"])], ["id-3"]);
console.log(JSON.stringify({ ok: true, albums: albums.length, favorites: entries.length, scanMs, indexMs }));
