import { execFile } from "node:child_process";
import type { CatalogueArtist, CatalogueArtistProfile } from "@music-os/core";
import type { CatalogueService } from "./catalogue-service.js";
import type { AppleCatalogueService } from "./apple-catalogue-service.js";
import { ArtistBackgroundCache } from "./artist-background-cache.js";
import { musicKey } from "./catalogue-service.js";

interface ArtistData {
  id: string; name: string; disambiguation?: string; country?: string; type?: string;
  area?: { name?: string }; "begin-area"?: { name?: string };
  "life-span"?: { begin?: string; end?: string; ended?: boolean };
  tags?: { name: string; count: number }[];
  relations?: { type?: string; url?: { resource?: string } }[];
}
type Download = (url: URL, userAgent: string) => Promise<unknown>;
function safeUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}
function appleIdentity(value: string): string | null {
  const url = safeUrl(value);
  if (!url || !["music.apple.com", "itunes.apple.com"].includes(url.hostname)) return null;
  return /\/artist\/(?:[^/]+\/)?(?:id)?([1-9]\d*)\/?$/.exec(url.pathname)?.[1] ?? null;
}
function blank(artist: CatalogueArtist): CatalogueArtistProfile {
  return { artist, biography: null, biographySourceUrl: null, imageUrl: null, imageSourceUrl: null,
    area: null, beginArea: null, ended: null,
    links: artist.sourceUrl ? [{ label: artist.provider === "apple" ? "Apple Music" : "MusicBrainz", url: artist.sourceUrl }] : [],
    metadataNote: null };
}
/** Only enrich identities linked by upstream IDs, never an unverified name match. */
export class ArtistProfileService {
  private snapshots = new ArtistBackgroundCache<CatalogueArtistProfile>();
  constructor(private catalogue: CatalogueService, private apple: AppleCatalogueService,
    private userAgent = "MusicOS/0.1.0", private download: Download = profileJson) {}
  async get(artistId: string, libraryArtist: string): Promise<CatalogueArtistProfile> {
    return this.snapshots.get(artistId, () => blank({ id: artistId, name: libraryArtist,
      description: "", country: null, type: null, begin: null, end: null, tags: [],
      provider: artistId.startsWith("apple:") ? "apple" : "musicbrainz",
      sourceUrl: artistId.startsWith("apple:") ? `https://music.apple.com/artist/${artistId.slice(6)}` : `https://musicbrainz.org/artist/${artistId}` }),
      (publish) => this.load(artistId, publish),
      (value) => ({ ...value, metadataNote: "Additional artist details are temporarily unavailable. You can keep exploring the catalogue." }));
  }
  /** For background consumers and fixtures only; route handlers use immediate snapshots. */
  async getComplete(artistId: string, artistName: string): Promise<CatalogueArtistProfile> {
    await this.get(artistId, artistName);
    return this.snapshots.complete(artistId);
  }
  /** Resolve verified identity as soon as metadata arrives, without waiting for biography. */
  async musicBrainzArtistId(artistId: string, artistName: string): Promise<string | null> {
    if (!artistId.startsWith("apple:")) return artistId;
    const deadline = Date.now() + 19_000;
    do {
      const profile = await this.get(artistId, artistName);
      for (const link of profile.links) {
        try {
          const url = new URL(link.url);
          const match = /^\/artist\/([0-9a-f-]{36})$/.exec(url.pathname);
          if (url.protocol === "https:" && url.hostname === "musicbrainz.org" && match) return match[1]!;
        } catch { /* Only validated upstream identities are usable. */ }
      }
      if (!profile.pending) return null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    return null;
  }
  private details(id: string) {
    return this.catalogue.request<ArtistData>("artist/" + id, { inc: "tags+url-rels" });
  }
  private async load(artistId: string, publish: (value: CatalogueArtistProfile) => void): Promise<CatalogueArtistProfile> {
    const deadline = Date.now() + 19_000;
    let data: ArtistData | undefined;
    let profile: CatalogueArtistProfile;
    if (artistId.startsWith("apple:")) {
      const artist = await this.apple.artist(artistId);
      profile = blank(artist);
      publish(profile);
      try {
        const candidates = (await this.catalogue.searchArtists(artist.name)).filter((candidate) => musicKey(candidate.name) === musicKey(artist.name));
        // Keep background enrichment bounded, even for common artist names.
        const details: ArtistData[] = [];
        for (const candidate of candidates.slice(0, 2)) {
          if (Date.now() >= deadline) throw new Error("Artist identity lookup timed out");
          details.push(await this.details(candidate.id));
        }
        const verified = details.filter((candidate) => candidate.relations?.some((relation) =>
          relation.url?.resource && appleIdentity(relation.url.resource) === artistId.slice(6)));
        if (verified.length === 1) data = verified[0];
        else profile.metadataNote = "Apple provides limited artist details. Choose MusicBrainz for a richer artist profile.";
      } catch {
        profile.metadataNote = "Additional artist details are temporarily unavailable. Apple catalogue information is still available.";
      }
    } else {
      data = await this.details(artistId);
      profile = blank({ id: data.id, name: data.name, description: data.disambiguation ?? "", country: null,
        type: null, begin: null, end: null, tags: [], provider: "musicbrainz", sourceUrl: `https://musicbrainz.org/artist/${data.id}` });
    }
    if (!data) return profile;
    profile.artist = { ...profile.artist, description: data.disambiguation ?? profile.artist.description,
      country: data.country ?? null, type: data.type ?? null,
      begin: data["life-span"]?.begin || null, end: data["life-span"]?.end || null,
      tags: [...new Set([...profile.artist.tags, ...(data.tags ?? []).sort((a, b) => b.count - a.count).slice(0, 8).map((tag) => tag.name)])] };
    profile.area = data.area?.name ?? null;
    profile.beginArea = data["begin-area"]?.name ?? null;
    profile.ended = data["life-span"]?.ended ?? null;
    const mbUrl = `https://musicbrainz.org/artist/${data.id}`;
    if (!profile.links.some((link) => link.url === mbUrl)) profile.links.push({ label: "MusicBrainz", url: mbUrl });
    for (const relation of data.relations ?? []) {
      const url = safeUrl(relation.url?.resource);
      if (url && ["official homepage", "bandcamp", "youtube", "discogs", "wikidata", "wikipedia"].includes(relation.type ?? "") &&
          !profile.links.some((link) => link.url === url.toString())) {
        profile.links.push({ label: relation.type === "official homepage" ? "Official website" : relation.type!, url: url.toString() });
      }
    }
    publish(profile);
    try { if (Date.now() < deadline) await this.enrichWikipedia(profile, data); }
    catch { profile.metadataNote = "Biography and portrait are temporarily unavailable. Catalogue details are still available."; }
    return profile;
  }
  private async enrichWikipedia(profile: CatalogueArtistProfile, data: ArtistData) {
    const relations = (data.relations ?? []).map((relation) => safeUrl(relation.url?.resource)).filter((url): url is URL => Boolean(url));
    let wiki = relations.find((url) => url.hostname === "en.wikipedia.org" && url.pathname.startsWith("/wiki/"));
    if (!wiki) {
      const wikidata = relations.find((url) => ["www.wikidata.org", "wikidata.org"].includes(url.hostname) && /^\/wiki\/Q\d+$/.test(url.pathname));
      if (wikidata) {
        const qid = wikidata.pathname.split("/").pop()!;
        const entity = await this.download(new URL(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`), this.userAgent) as {
          entities?: Record<string, { sitelinks?: { enwiki?: { title?: string } } }> };
        const title = entity.entities?.[qid]?.sitelinks?.enwiki?.title;
        if (title) wiki = new URL("https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")));
      }
    }
    if (!wiki) return;
    const title = decodeURIComponent(wiki.pathname.slice(6));
    const url = new URL("https://en.wikipedia.org/w/api.php");
    Object.entries({ action: "query", format: "json", formatversion: "2", prop: "extracts|pageimages|info",
      titles: title, redirects: "1", exintro: "1", explaintext: "1", piprop: "thumbnail|original", pithumbsize: "1000", inprop: "url" })
      .forEach(([key, value]) => url.searchParams.set(key, value));
    const result = await this.download(url, this.userAgent) as { query?: { pages?: { missing?: boolean;
      extract?: string; fullurl?: string; thumbnail?: { source?: string }; original?: { source?: string }; pageimage?: string }[] } };
    const page = result.query?.pages?.[0];
    if (!page || page.missing) return;
    const pageUrl = safeUrl(page.fullurl);
    const source = pageUrl?.hostname === "en.wikipedia.org" ? pageUrl.toString() : wiki.toString();
    profile.biography = typeof page.extract === "string" && page.extract.trim() ? page.extract.trim() : null;
    profile.biographySourceUrl = profile.biography ? source : null;
    const image = safeUrl(page.thumbnail?.source ?? page.original?.source);
    if (image?.protocol === "https:" && image.hostname === "upload.wikimedia.org") {
      profile.imageUrl = image.toString();
      // The article's media viewer exposes the image credit and licensing details.
      profile.imageSourceUrl = page.pageimage ? `${source}#/media/File:${encodeURIComponent(page.pageimage)}` : source;
    }
    if (!profile.links.some((link) => link.url === source)) profile.links.push({ label: "Wikipedia", url: source });
  }
}

function profileJson(url: URL, userAgent: string): Promise<unknown> {
  // URLs above are constructed on fixed Wikimedia hosts; never fetch arbitrary relation URLs.
  return new Promise((resolve, reject) => {
    execFile("curl", ["-4", "--fail", "--silent", "--show-error", "--max-time", "8", "--user-agent", userAgent,
      "--header", "Accept: application/json", url.toString()], { timeout: 8500, maxBuffer: 4_000_000 }, (error, stdout) => {
      if (error) return reject(new Error("Artist enrichment is temporarily unavailable."));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Invalid artist enrichment response.")); }
    });
  });
}
