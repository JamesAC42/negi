import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import type { AgentCatalogChoice, AgentCatalogItem, AgentCatalogPlan, AgentMessageResponse, CatalogueArtist, CatalogueAlbum, DiscoveryResult, TasteProfile } from "@music-os/core";
import type { CatalogueService } from "./catalogue-service.js";
import type { SimilarArtistsService } from "./similar-artists-service.js";
import type { AlbumAcquisitionService } from "./album-acquisition-service.js";
import type { SlskdService } from "./slskd-service.js";
import type { OperationService } from "./operation-service.js";
import type { TasteProfileService } from "./taste-profile-service.js";
import { rankDiscoveryResultsByAvailability } from "./discovery-availability.js";

type Action = AgentCatalogChoice["action"];
type Catalog = Pick<CatalogueService, "searchArtists" | "browse" | "release">;
export const agentCapabilities = [
  { id: "track", title: "Find a song", description: "Find one exact song and review its available files.", prompt: "Find the song " },
  { id: "album", title: "Download an album", description: "Match the artist and release before downloading.", prompt: "Download the album " },
  { id: "discography", title: "Collect an artist", description: "Review an artist’s albums or complete release catalog.", prompt: "Download the discography of " },
  { id: "missing", title: "Fill the gaps", description: "Find missing releases from an artist you collect.", prompt: "Find missing albums by " },
  { id: "complete", title: "Complete an album", description: "Find the missing tracks in a partial album.", prompt: "Complete the album " },
  { id: "similar", title: "Explore similar artists", description: "Follow real catalog connections to new artists.", prompt: "Find artists similar to " },
  { id: "taste", title: "Find something new", description: "Start with your saved preferences and listening history.", prompt: "Recommend albums based on my taste" },
  { id: "playlist", title: "Make a playlist", description: "Research a mix for a mood, occasion, genre, or era.", prompt: "Make a playlist for " },
  { id: "latest", title: "Find the latest release", description: "Check an artist’s newest catalog release.", prompt: "Find the latest album by " },
  { id: "singles", title: "Explore EPs & singles", description: "Collect releases beyond an artist’s studio albums.", prompt: "Find EPs and singles by " },
] as const;

export class AgentCatalogService {
  constructor(
    private readonly db: Database.Database,
    private readonly apple: Catalog,
    private readonly musicbrainz: Catalog,
    private readonly similar: Pick<SimilarArtistsService, "getComplete">,
    private readonly acquisitions: Pick<AlbumAcquisitionService, "create" | "list">,
    private readonly discovery: Pick<SlskdService, "search">,
    private readonly operations: Pick<OperationService, "createQueueDownloadBatch">,
    private readonly taste: Pick<TasteProfileService, "getEffectiveProfile">,
  ) {
    // Persist acceptance separately from the conversation: retries and old buttons
    // cannot start the same reviewed action twice, including across restarts.
    db.exec("CREATE TABLE IF NOT EXISTS agent_catalog_acceptances (key TEXT PRIMARY KEY, response_json TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS agent_catalog_sources (id TEXT PRIMARY KEY, result_json TEXT NOT NULL)");
  }

  async handle(message: string, planned?: { capability: string; query: string }): Promise<AgentMessageResponse | null> {
    const request = planned ?? parseCatalogRequest(message);
    if (!request) return null;
    if (request.capability === "taste") return this.tasteSeeds();
    if (request.capability === "track") return this.track(request.query);
    if (!request.query) return response(plan(request.capability, "Tell me the music target",
      "Include an artist name. For a specific album, use “album title by artist”.", "clarification"));
    if (["album", "complete"].includes(request.capability)) {
      const split = splitMusicTarget(request.query);
      if (!split && (request.query.match(/\s+by\s+/gi)?.length ?? 0) > 1) {
        return response(plan(request.capability, "Clarify the album and artist", 'Put quotes around the album title so names containing “by” are unambiguous: download the album "title" by artist.', "clarification"));
      }
      if (!split) {
        const p = plan(request.capability, "Which artist made this album?",
          "Send the album title followed by “by” and the artist name, so I can verify the correct catalog entry.", "clarification");
        p.notes.push(`Album requested: ${request.query}`);
        return response(p);
      }
      return this.artists({ kind: "artists", capability: request.capability, query: split.artist, album: split.title });
    }
    return this.artists({ kind: "artists", capability: request.capability, query: request.query });
  }

  async choose(previous: AgentMessageResponse, choiceId: string, acceptanceKey: string): Promise<AgentMessageResponse> {
    const source = previous.catalogPlan;
    if (!source) throw new Error("This response has no catalog choices.");
    const choice = source.choices.find((entry) => entry.id === choiceId);
    if (!choice) throw new Error("This catalog choice is no longer available.");
    const action = choice.action;
    if (action.kind === "queue") {
      const saved = this.db.prepare("SELECT response_json FROM agent_catalog_acceptances WHERE key = ?").get(acceptanceKey) as { response_json: string } | undefined;
      if (saved) return JSON.parse(saved.response_json) as AgentMessageResponse;
      // All queue side effects and the acceptance receipt share SQLite's transaction.
      return this.db.transaction(() => {
        const again = this.db.prepare("SELECT response_json FROM agent_catalog_acceptances WHERE key = ?").get(acceptanceKey) as { response_json: string } | undefined;
        if (again) return JSON.parse(again.response_json) as AgentMessageResponse;
        const result = this.queue(source, action.itemId);
        this.db.prepare("INSERT INTO agent_catalog_acceptances (key, response_json) VALUES (?, ?)").run(acceptanceKey, JSON.stringify(result));
        return result;
      })();
    }
    if (action.kind === "cancel") return response(plan(source.capability, "Plan dismissed", "No downloads were started.", "complete"));
    if (action.kind === "artists") return this.artists(action);
    if (action.kind === "scope") return this.scope(action);
    if (action.kind === "similar") return this.related(action);
    if (action.kind === "releases") return this.releases(action);
    if (action.kind === "track") return this.track(action.query ?? "");
    if (action.kind === "review") {
      const item = source.items.find((entry) => entry.id === action.itemId);
      if (!item) throw new Error("That release is no longer part of this plan.");
      return this.review(source.capability, [item], source.notes);
    }
    throw new Error("Unknown catalog action.");
  }

  private async artists(action: Action): Promise<AgentMessageResponse> {
    const query = action.query?.trim() ?? "";
    if (!query) return response(plan(action.capability, "Name an artist", "Tell me which artist to look up.", "clarification"));
    const provider = action.provider ?? "apple";
    let artists: CatalogueArtist[];
    let fallback = false;
    try { artists = await this.catalog(provider).searchArtists(query); }
    catch (error) {
      if (provider === "musicbrainz") throw error;
      artists = await this.musicbrainz.searchArtists(query);
      fallback = true;
    }
    if (!artists.length && provider === "apple" && !fallback) {
      artists = await this.musicbrainz.searchArtists(query);
      fallback = true;
    }
    const profile = this.taste.getEffectiveProfile();
    const p = plan(action.capability, "Choose the right artist",
      `I found ${artists.length} catalog match${artists.length === 1 ? "" : "es"} for “${query}”.`, "clarification");
    p.choices = artists.slice(0, 10).map((artist) => choice(artist.name,
      [artist.description, artist.country, ...artist.tags.slice(0, 3), artist.id.startsWith("apple:") ? "Apple Music" : "MusicBrainz"].filter(Boolean).join(" · "),
      { ...action, kind: action.capability === "similar" ? "similar" : action.capability === "discography" ? "scope" : "releases", artist: artist.name, artistId: artist.id }));
    if (artists.some((artist) => profile.blockedArtists.some((name) => key(name) === key(artist.name))))
      p.notes.push("One or more matches are in your blocked artists. Your explicit choice overrides that recommendation filter for this request.");
    if (provider === "apple" && !fallback) p.choices.push(choice("Search MusicBrainz", "Try the expanded catalog without mixing provider identities.", { ...action, kind: "artists", provider: "musicbrainz" }));
    if (!artists.length) p.notes.push("Try the artist’s full name or a different spelling.");
    return response(p);
  }

  private scope(action: Action): AgentMessageResponse {
    const p = plan(action.capability, `What should I collect by ${action.artist}?`,
      "Choose the release scope before I build a download plan.", "clarification");
    p.choices = [
      choice("Studio albums", "Album catalog; skips releases already known to be complete.", { ...action, kind: "releases", section: "albums" }),
      choice("EPs and singles", "Explore shorter releases.", { ...action, kind: "releases", section: "eps-singles" }),
      choice("Whole catalog", "Albums, EPs, singles, live releases, compilations, and other releases.", { ...action, kind: "releases", section: undefined }),
    ];
    return response(p);
  }

  private async releases(action: Action): Promise<AgentMessageResponse> {
    if (!action.artistId || !action.artist) throw new Error("Choose a verified artist first.");
    const provider = action.artistId.startsWith("apple:") ? "apple" : "musicbrainz";
    const section = action.section ?? (action.capability === "singles" ? "eps-singles" :
      ["missing", "latest", "album", "complete"].includes(action.capability) ? "albums" : undefined);
    const catalog = this.catalog(provider);
    const albums: CatalogueAlbum[] = [];
    let offset: number | null = 0;
    let truncated = false;
    // Walk every provider page; never silently claim one page is a discography.
    while (offset !== null && albums.length < 1000) {
      const page = await catalog.browse(action.artistId, action.artist, offset, "newest", section);
      albums.push(...page.albums);
      truncated ||= page.truncated === true;
      if (page.nextOffset !== null && page.nextOffset <= offset) throw new Error("Catalog pagination did not advance.");
      offset = page.nextOffset;
    }
    truncated ||= offset !== null;
    let selected = [...new Map(albums.map((album) => [album.id, album])).values()];
    if (action.album) {
      const exact = selected.filter((album) => key(album.title) === key(action.album!));
      selected = exact.length ? exact : selected.filter((album) => key(album.title).includes(key(action.album!)));
    }
    if (action.capability === "latest") selected = selected.slice(0, 1);
    const completeCount = selected.filter((album) => album.libraryStatus === "complete").length;
    selected = selected.filter((album) => album.libraryStatus !== "complete");
    const items: AgentCatalogItem[] = selected.map((album) => ({
      id: album.id, kind: "album", artist: action.artist!, artistId: action.artistId!, title: album.title,
      provider, artworkUrl: album.artworkUrl, date: album.date, ownedTracks: album.ownedTracks,
      libraryStatus: album.libraryStatus, libraryAlbumId: album.libraryAlbumId,
      detail: [album.type, album.date?.slice(0, 4)].filter(Boolean).join(" · "),
    }));
    const notes = [`Verified against ${provider === "apple" ? "Apple Music" : "MusicBrainz"}; ${completeCount} complete owned release${completeCount === 1 ? "" : "s"} omitted.`,
      "The acquisition worker verifies track lists, keeps owned tracks, and imports only missing tracks. Unverified or partial provider listings cannot authorize a full-album acquisition."];
    if (truncated) notes.push("This provider returned a limited catalog. The plan covers only the releases shown; use the expanded MusicBrainz catalog for broader coverage.");
    if (!items.length) return response({ ...plan(action.capability, "No missing matches", action.album ? `No missing release matched “${action.album}” by ${action.artist}.` : `No missing releases found for ${action.artist} in this scope.`, "complete"), notes });
    if (action.album && items.length > 1) {
      const p = plan(action.capability, "Choose an edition", "Several releases match. Choose the edition you want to review.", "clarification");
      p.items = items;
      p.notes = notes;
      p.choices = items.map((item) => choice(item.title, item.detail ?? "", { kind: "review", capability: action.capability, itemId: item.id }));
      return response(p);
    }
    return this.review(action.capability, items, notes);
  }

  private review(capability: string, items: AgentCatalogItem[], notes: string[]): AgentMessageResponse {
    const p = plan(capability, "Review your download plan", `${items.length} ${items[0]?.kind === "track" ? "song" : "release"}${items.length === 1 ? "" : "s"} ready to review. No playlist is required.`, "review");
    p.items = items;
    p.notes = [...notes, this.qualityNote()];
    p.choices = [
      choice(`Download ${items.length === 1 ? "this " + items[0]!.kind : "all " + items.length + " releases"}`, "Start exactly the items shown in this plan.", { kind: "queue", capability }),
      ...(items.length > 1 ? items.map((item) => choice(`Only ${item.title}`, item.artist, { kind: "review", capability, itemId: item.id })) : []),
      choice("Cancel", "Keep your library as it is.", { kind: "cancel", capability }),
    ];
    return response(p);
  }

  private queue(source: AgentCatalogPlan, itemId?: string): AgentMessageResponse {
    const items = itemId ? source.items.filter((item) => item.id === itemId) : source.items;
    if (!items.length) throw new Error("This plan has no items to download.");
    const p: AgentCatalogPlan = { ...source, title: "Downloads started", summary: `Started ${items.length} reviewed release${items.length === 1 ? "" : "s"}.`, status: "queued" as const, choices: [], items, jobIds: [] as string[] };
    const tracks = items.filter((item) => item.kind === "track");
    if (tracks.length) {
      const results = tracks.map((item) => {
        const row = this.db.prepare("SELECT result_json FROM agent_catalog_sources WHERE id = ?").get(item.discoveryId) as { result_json: string } | undefined;
        if (!row) throw new Error("The song source is no longer available. Search again.");
        const result = JSON.parse(row.result_json) as DiscoveryResult;
        if (!sourceMeetsQuality(result, this.taste.getEffectiveProfile())) throw new Error("Your quality preferences changed. Search again to review sources that meet the current settings.");
        return result;
      });
      const batch = this.operations.createQueueDownloadBatch(results, tracks.map((item) => item.artist + " " + item.title).join(", "), "agent");
      p.title = "Song ready in Operations";
      p.summary = "Review and apply the download operation. The downloaded file will enter the import inbox.";
      p.status = "review";
      return { ...response(p), operationBatch: batch };
    }
    const { qualityPreferences, preferredFormats } = this.taste.getEffectiveProfile();
    for (const item of items) {
      const job = this.acquisitions.create({ artist: item.artist, album: item.title, artistId: item.artistId, releaseGroupId: item.id, albumId: item.libraryAlbumId ?? undefined, sourcePreferences: { qualityPreferences, preferredFormats } });
      p.jobIds.push(job.id);
    }
    return response(p);
  }

  private async related(action: Action): Promise<AgentMessageResponse> {
    if (!action.artistId || !action.artist) throw new Error("Choose a verified artist first.");
    const result = await this.similar.getComplete(action.artistId, action.artist);
    const profile = this.taste.getEffectiveProfile();
    const candidates = result.artists.filter(({ artist }) => !profile.blockedArtists.some((name) => key(name) === key(artist.name)) &&
      !artist.tags.some((tag) => profile.blockedGenres.some((genre) => key(genre) === key(tag))));
    const p = plan(action.capability, `Explore beyond ${action.artist}`, `Choose an artist from ${candidates.length} related matches to explore their releases.`, "clarification");
    p.choices = candidates.slice(0, 10).map(({ artist, reasons }) => choice(artist.name, reasons.join(" · "), artist.requiresArtistMatch ?
      { kind: "artists", capability: "recommendation", query: artist.name } :
      { kind: "releases", capability: "recommendation", artist: artist.name, artistId: artist.id, section: "albums" }));
    if (result.note) p.notes.push(result.note);
    p.notes.push("Blocked artists and genres were removed. Related artists come from the configured catalog and listener-similarity integrations.");
    return response(p);
  }

  private tasteSeeds(): AgentMessageResponse {
    const profile = this.taste.getEffectiveProfile();
    const names = profile.favoriteArtists.filter((name) => !profile.blockedArtists.some((blocked) => key(blocked) === key(name))).slice(0, 8);
    const p = plan("taste", "Start with your taste", names.length ? "Choose a favorite as the seed for related artists and albums." : "I need a little more listening history or a favorite artist in Settings. You can also ask for artists similar to a name.", "clarification");
    p.choices = names.map((name) => choice(name, "Find related artists and review their albums.", { kind: "artists", capability: "similar", query: name }));
    p.notes = [`Preferences used: ${profile.preferredGenres.slice(0, 5).join(", ") || "no genre preference yet"}.`, "Saved choices take priority over inferred listening signals.", this.qualityNote()];
    return response(p);
  }

  private async track(query: string): Promise<AgentMessageResponse> {
    if (!query) return response(plan("track", "Which song?", "Send “find the song title by artist”.", "clarification"));
    const parts = splitMusicTarget(query);
    if (!parts && (query.match(/\s+by\s+/gi)?.length ?? 0) > 1) {
      return response(plan("track", "Clarify the song and artist", 'This title or artist contains “by”. Put quotes around the title, for example: find the song "Stand by Me" by Ben E. King.', "clarification"));
    }
    if (!parts) {
      const p = plan("track", "Who performs this song?", "Send the artist name, or the song title followed by “by” and the artist name.", "clarification");
      p.notes.push("Song requested: " + query);
      return response(p);
    }
    const title = parts.title;
    const artist = parts.artist;
    const found = await this.discovery.search(`${artist} ${title}`, 50);
    const profile = this.taste.getEffectiveProfile();

    const candidates = rankDiscoveryResultsByAvailability(found.results).filter((item) => {
      return !item.isLocked && sourceMeetsQuality(item, profile) &&
        matchesSongFilename(item.filename, title, artist) && matchesSongArtist(item, artist);
    }).sort((a, b) => {
      const score = (item: typeof a) => {
        const ext = (item.extension ?? item.filename.split(".").at(-1) ?? "").toLowerCase();
        return (profile.qualityPreferences.preferLossless && ["flac", "alac", "wav", "aiff", "ape"].includes(ext) ? 100 : 0) +
          (profile.preferredFormats.map((format) => format.toLowerCase()).includes(ext) ? 20 - profile.preferredFormats.map((format) => format.toLowerCase()).indexOf(ext) : 0);
      };
      return score(b) - score(a);
    }).slice(0, 8);
    for (const item of candidates) this.db.prepare("INSERT OR REPLACE INTO agent_catalog_sources (id, result_json) VALUES (?, ?)").run(item.id, JSON.stringify(item));
    const p = plan("track", "Choose a song source", candidates.length ? `Found ${candidates.length} sources matching “${title}” by ${artist}. Check the recording and format.` : "No available files met the artist, title, and quality constraints. Try an alternate title or artist spelling.", "clarification");
    p.items = candidates.map((item) => ({ id: item.id, kind: "track", artist, title, discoveryId: item.id,
      detail: [item.path, item.extension?.toUpperCase(), item.username].filter(Boolean).join(" · ") }));
    p.choices = p.items.map((item) => choice(item.title, item.detail ?? "", { kind: "review", capability: "track", itemId: item.id }));
    p.notes = [this.qualityNote(), "Source filenames are candidates, not verified catalog identities. Review the recording before accepting."];
    return response(p);
  }

  private qualityNote(): string {
    const profile = this.taste.getEffectiveProfile();
    return `Quality preference: ${profile.qualityPreferences.preferLossless ? "lossless first" : profile.preferredFormats.join(", ") || "available formats"}${profile.qualityPreferences.minimumBitrateKbps ? ", minimum " + profile.qualityPreferences.minimumBitrateKbps + " kbps for lossy files" : ""}.`;
  }
  private catalog(provider: "apple" | "musicbrainz"): Catalog { return provider === "apple" ? this.apple : this.musicbrainz; }
}

export function parseCatalogRequest(message: string): { capability: string; query: string } | null {
  const text = message.trim().replace(/[.!?]+$/, "");
  if (/\b(playlist|mix)\b/i.test(text)) return null;
  if (/\b(recommend|find|download|discover)\b.*\b(my taste|my preferences|my listening|something new|music I.*like)\b/i.test(text)) return { capability: "taste", query: "" };
  const possessive = text.match(/\b(?:download|find|get|collect)\s+(.+?)[’']s\s+(?:(?:entire|whole)\s+)?(?:discography|catalog(?:ue)?|library)$/i);
  if (possessive) return { capability: "discography", query: clean(possessive[1]!) };
  const allArtistAlbums = text.match(/\b(?:download|find|get|collect)\s+(?:all|every)\s+(.+?)\s+(?:albums?|releases?)$/i);
  if (allArtistAlbums) return { capability: "discography", query: clean(allArtistAlbums[1]!) };
  const patterns: [string, RegExp][] = [
    ["similar", /\b(?:artists?|music)\s+(?:similar to|like)\s*(.*)$/i],
    ["discography", /\b(?:discography|whole (?:artist )?(?:library|catalog(?:ue)?)|entire (?:catalog(?:ue)?|discography))\s*(?:of|by|for)?\s*(.*)$/i],
    ["discography", /\b(?:all|every)\s+(?:albums?|releases?|music)\s+(?:by|from)\s*(.*)$/i],
    ["missing", /\bmissing\s+(?:albums?|releases?)\s+(?:by|from|for)\s*(.*)$/i],
    ["singles", /\b(?:EPs? and singles?|singles? and EPs?|EPs?|singles?)\s+(?:by|from)\s*(.*)$/i],
    ["latest", /\b(?:latest|newest|most recent)\s+(?:album|release)\s+(?:by|from)\s*(.*)$/i],
    ["complete", /\b(?:complete|finish|fill (?:in )?the gaps in)\s+(?:the\s+)?(?:album\s+)?(.*)$/i],
    ["album", /\b(?:find|download|get|fetch|collect|grab)\s+(?:me\s+)?(?:the\s+)?album\s*(.*)$/i],
    ["track", /\b(?:find|download|get|fetch|grab)\s+(?:me\s+)?(?:the\s+)?(?:song|track)\s*(.*)$/i],
  ];
  for (const [capability, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) return { capability, query: (match[1] ?? "").trim() };
  }
  return null;
}

function plan(capability: string, title: string, summary: string, status: AgentCatalogPlan["status"]): AgentCatalogPlan {
  return { capability, title, summary, status, choices: [], items: [], notes: [], jobIds: [] };
}
function response(catalogPlan: AgentCatalogPlan): AgentMessageResponse {
  return { reply: catalogPlan.summary, intent: "catalog", searchQuery: "", results: [], discoveryResults: [], parsedListItems: [], importResults: [], operationBatch: null, playback: null, catalogPlan };
}
function choice(label: string, description: string, action: Action): AgentCatalogChoice { return { id: nanoid(), label, description, action }; }
function key(value: string): string { return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function clean(value: string): string { return value.trim().replace(/^["“”]+|["“”]+$/g, "").trim(); }


function matchesSongFilename(filename: string, title: string, artist: string): boolean {
  const base = key(filename.replace(/\.[^.]+$/, "").replace(/^\s*(?:\d{1,3}[-._\s]+)+/, ""));
  const artistKey = key(artist);
  return base === key(title) || (base.startsWith(artistKey + " ") && base.slice(artistKey.length + 1) === key(title));
}
function splitMusicTarget(value: string): { title: string; artist: string } | null {
  // Quoting makes titles and artist names containing "by" unambiguous.
  const quotedTitle = value.match(/^["“](.+?)["”]\s+by\s+(.+)$/i);
  const quotedArtist = value.match(/^(.+?)\s+by\s+["“](.+?)["”]$/i);
  const match = quotedTitle ?? quotedArtist ??
    ((value.match(/\s+by\s+/gi)?.length ?? 0) === 1 ? value.match(/^(.+)\s+by\s+(.+)$/i) : null);
  return match ? { title: clean(match[1]!), artist: clean(match[2]!) } : null;
}
function matchesSongArtist(result: DiscoveryResult, artist: string): boolean {
  const expected = key(artist);
  const directories = result.path.split(/[\\/]/).slice(0, -1);
  return directories.some((directory) => key(directory) === expected ||
    directory.split(/\s+[-–—]\s+/).some((credit) => key(credit) === expected)) ||
    key(result.filename).startsWith(expected + " ");
}
function sourceMeetsQuality(result: DiscoveryResult, profile: TasteProfile): boolean {
  const ext = (result.extension ?? result.filename.split(".").at(-1) ?? "").toLowerCase();
  if (!/^(flac|alac|wav|aiff|aif|ape|wv|mp3|m4a|aac|ogg|opus)$/.test(ext)) return false;
  if (["flac", "alac", "wav", "aiff", "aif", "ape", "wv"].includes(ext)) return true;
  if (ext === "mp3" && !profile.qualityPreferences.allowMp3IfRare) return false;
  const minimum = profile.qualityPreferences.minimumBitrateKbps;
  const bitrate = result.bitrate ? (result.bitrate > 10000 ? result.bitrate / 1000 : result.bitrate) :
    result.sizeBytes && result.lengthSeconds ? result.sizeBytes * 8 / result.lengthSeconds / 1000 : 0;
  return minimum === null || bitrate >= minimum;
}