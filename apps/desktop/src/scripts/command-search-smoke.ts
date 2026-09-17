import assert from "node:assert/strict";
import type { AlbumGroup } from "@music-os/core";
import { findCommandTracks } from "../renderer/command-search";
let reads = 0;
const albums = Array.from({ length: 600 }, (_, a) => ({
  id: `album-${a}`, artist: `Artist ${a}`, album: `Album ${a}`,
  files: Array.from({ length: 100 }, (_, f) => ({ id: `file-${a}-${f}`, filename: `Filename ${f}`, displayTags: {
    get title() { reads++; return f % 11 ? `Track ${a}-${f}` : undefined; }, artist: f % 2 ? `Singer ${a}` : undefined,
  } })),
})) as unknown as AlbumGroup[];
function reference(query: string) {
  if (query.length < 2) return [];
  return albums.flatMap(album => album.files.map(file => ({ album, file, label: file.displayTags.title ?? file.filename })))
    .filter(({ album, file, label }) => `${label} ${file.displayTags.artist ?? album.artist} ${album.album}`.toLocaleLowerCase().includes(query)).slice(0, 6);
}
for (const query of ["", "t", "track", "filename", "singer 2", "artist 4", "album 599", "no such song"]) {
  assert.deepEqual(findCommandTracks(albums, query), reference(query), `match content/order for ${query}`);
}
reads = 0; reference("track"); const before = reads;
reads = 0; findCommandTracks(albums, "track"); const after = reads;
assert.equal(before, 60000); assert.equal(after, 7, "stop at sixth match, including one filename fallback");
console.log(JSON.stringify({ok:true,tracks:60000,titleReadsBefore:before,titleReadsAfter:after}));
