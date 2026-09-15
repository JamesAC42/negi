import type { AlbumGroup, CatalogueTrack } from "@music-os/core";

export const musicKey = (value: string) => value.normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// Preserve exact identities for real symbol-only titles such as "&" and "+ +".
// Keep the broad artist/album musicKey unchanged; blank tags are never a title.
export function musicTitleKey(value: string) {
  const key = musicKey(value);
  const symbols = value.normalize("NFKC").replace(/\s/gu, "");
  return key || (/^[\p{P}\p{S}]+$/u.test(symbols) ? "symbols:" + symbols : "");
}

export function missingReleaseTracks(tracks: CatalogueTrack[], files: { displayTags: Record<string, string> }[], allTracks: CatalogueTrack[] = tracks): CatalogueTrack[] {
  const titleCounts = new Map<string, number>();
  for (const track of allTracks) titleCounts.set(musicTitleKey(track.title), (titleCounts.get(musicTitleKey(track.title)) ?? 0) + 1);
  const seen = new Set<string>();
  const remaining = files.filter(({ displayTags: tags }) => {
    const key = [musicTitleKey(tags.title ?? ""), parseInt(tags.discnumber ?? tags.disc ?? "0", 10),
      parseInt(tags.tracknumber ?? tags.track ?? "0", 10)].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return tracks.filter((track) => {
    const wanted = musicTitleKey(track.title);
    const index = remaining.findIndex(({ displayTags: tags }) => !!wanted && musicTitleKey(tags.title ?? "") === wanted
      && ((!tags.discnumber && !tags.disc) ? titleCounts.get(musicTitleKey(track.title)) === 1
        : parseInt(tags.discnumber ?? tags.disc, 10) === track.disc));
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

export interface AlbumCatalogueSnapshot {
  artistId: string;
  releaseGroupId: string;
  tracks: CatalogueTrack[];
  year?: string;
}

export function albumCatalogueSnapshot(value: unknown, album: AlbumGroup): AlbumCatalogueSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (typeof p.artistId !== "string" || !p.artistId.trim() || typeof p.releaseGroupId !== "string" || !p.releaseGroupId.trim()
    || !Array.isArray(p.tracks) || !p.tracks.length) return null;
  if (typeof p.albumId === "string" && p.albumId) {
    if (p.albumId !== album.id) return null;
  } else {
    if (typeof p.artist !== "string" || typeof p.album !== "string"
      || musicKey(p.artist) !== musicKey(album.artist) || musicKey(p.album) !== musicKey(album.album)) return null;
    const year = typeof p.year === "string" ? p.year.match(/\d{4}/)?.[0] : undefined;
    if (album.year && year !== album.year.match(/\d{4}/)?.[0]) return null;
  }
  const positions = new Set<string>();
  const tracks: CatalogueTrack[] = [];
  for (const raw of p.tracks) {
    if (!raw || typeof raw !== "object") return null;
    const t = raw as Record<string, unknown>;
    if (typeof t.title !== "string" || !t.title.trim() || !Number.isInteger(t.disc) || Number(t.disc) < 1
      || !Number.isInteger(t.number) || Number(t.number) < 1
      || (t.durationMs != null && (typeof t.durationMs !== "number" || !Number.isFinite(t.durationMs) || t.durationMs < 0))) return null;
    const key = `${t.disc}:${t.number}`;
    if (positions.has(key)) return null;
    positions.add(key);
    tracks.push({ title: t.title, disc: Number(t.disc), number: Number(t.number), durationMs: t.durationMs as number | null ?? null, owned: false });
  }
  return { artistId: p.artistId, releaseGroupId: p.releaseGroupId, tracks, ...(typeof p.year === "string" ? { year: p.year } : {}) };
}
