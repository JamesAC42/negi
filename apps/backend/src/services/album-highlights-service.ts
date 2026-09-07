import type { AlbumHighlightsResponse, CatalogueAlbum } from "@music-os/core";
import type { ArtistProfileService } from "./artist-profile-service.js";
import type { CatalogueService } from "./catalogue-service.js";
import type { LibraryRepository } from "./library-repository.js";
import { musicKey } from "./album-completeness.js";
import { ArtistBackgroundCache } from "./artist-background-cache.js";

interface RatedGroup {
  id: string;
  title: string;
  "first-release-date"?: string;
  "primary-type"?: string;
  "secondary-types"?: string[];
  "artist-credit"?: { artist?: { id: string } }[];
  rating?: { value: number | null; "votes-count": number };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Optional community ratings load independently of artist navigation and release grids. */
export class AlbumHighlightsService {
  private snapshots = new ArtistBackgroundCache<AlbumHighlightsResponse>();
  constructor(private profiles: ArtistProfileService, private catalogue: CatalogueService, private library: LibraryRepository) {}
  async get(artistId: string, artistName: string): Promise<AlbumHighlightsResponse> {
    const result = this.snapshots.get(artistId,
      () => ({ artistId, resolvedArtistId: null, albums: [], sourceUrl: null, note: null }),
      () => this.load(artistId, artistName),
      (value) => ({ ...value, note: "Community ratings are temporarily unavailable. The full discography is still available below." }));
    if (!result.albums.length) return result;
    // Re-evaluate local ownership on every read; downloads may finish during cache lifetime.
    const locals = this.library.listAlbumGroups().filter((album) => musicKey(album.artist) === musicKey(artistName));
    const incomplete = new Set(this.library.listIncompleteAlbums(Number.MAX_SAFE_INTEGER).map((album) => album.key));
    return { ...result, albums: result.albums.map((album) => {
      const matches = locals.filter((local) => musicKey(local.album) === musicKey(album.title));
      const local = matches.length === 1 ? matches[0] : undefined;
      const libraryStatus: CatalogueAlbum["libraryStatus"] = !local ? "missing" : incomplete.has(local.id) ? "partial" : "unverified";
      return { ...album, ownedTracks: local?.fileCount ?? 0, libraryAlbumId: local?.id ?? null, libraryStatus };
    }) };
  }
  async getComplete(artistId: string, artistName: string): Promise<AlbumHighlightsResponse> {
    await this.get(artistId, artistName);
    await this.snapshots.complete(artistId);
    return this.get(artistId, artistName);
  }
  private async load(artistId: string, artistName: string): Promise<AlbumHighlightsResponse> {
    const mbid = uuid.test(artistId) ? artistId : await this.profiles.musicBrainzArtistId(artistId, artistName);
    const result: AlbumHighlightsResponse = { artistId, resolvedArtistId: mbid, albums: [], sourceUrl: mbid ? `https://musicbrainz.org/artist/${mbid}/ratings` : null, note: null };
    if (!mbid) return { ...result, note: "Community ratings need a verified MusicBrainz artist match. Browse the full discography below." };
    // One capped request, never N individual album lookups or an unbounded catalogue scan.
    const data = await this.catalogue.request<{ "release-groups": RatedGroup[]; "release-group-count": number }>("release-group", {
      artist: mbid, type: "album", inc: "ratings+artist-credits", limit: "100", offset: "0",
    });
    const groups = Array.isArray(data["release-groups"]) ? data["release-groups"] : [];
    const eligible = groups.filter((group) => uuid.test(group.id) && typeof group.title === "string" && group.title.trim() &&
      group["primary-type"] === "Album" && !(group["secondary-types"] ?? []).some((type) => /live|compilation|remix|demo|spokenword|interview|audiobook/i.test(type)) &&
      group["artist-credit"]?.some((credit) => credit.artist?.id === mbid) &&
      typeof group.rating?.value === "number" && Number.isFinite(group.rating.value) && group.rating.value >= 0 && group.rating.value <= 5 &&
      Number.isSafeInteger(group.rating["votes-count"]) && group.rating["votes-count"] >= 3);
    result.albums = [...new Map(eligible.map((group) => [group.id, group])).values()]
      .sort((a, b) => b.rating!.value! - a.rating!.value! || b.rating!["votes-count"] - a.rating!["votes-count"] || a.title.localeCompare(b.title))
      .slice(0, 6).map((group) => ({ id: group.id, title: group.title, date: group["first-release-date"] || null,
        type: "Album", secondaryTypes: group["secondary-types"] ?? [], provider: "musicbrainz", sourceUrl: `https://musicbrainz.org/release-group/${group.id}`,
        ownedTracks: 0, libraryAlbumId: null, libraryStatus: "missing", rating: group.rating!.value!, votes: group.rating!["votes-count"] }));
    result.note = !result.albums.length ? "No studio albums with at least 3 MusicBrainz community votes are available yet." : "Highest average community ratings, with at least 3 votes per album. Ratings are out of 5; they are not sales or streaming charts.";
    if (data["release-group-count"] > groups.length) result.note += " Based on the first 100 catalogue entries; this artist's full catalogue is larger.";
    return result;
  }
}
