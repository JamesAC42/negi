import type { TasteProfile, VideoResult, YoutubeBrowsePage, YoutubeBrowseRequest, YoutubePreferences } from "@music-os/core";

// Malformed library genre tags sometimes contain codec/sample-rate metadata. Filter only obvious format labels here; never mutate Settings.
const audioFormatTag = /^(?:flac|alac|mp3|aac|wav|aiff|opus|ogg|pcm|dsd)(?:[\s_-]+[\d.\s/_-]+(?:bits?|k?hz|kbps)?)?$/i;
const key = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase();
function clean(values: string[], excluded: string[]): string[] {
  const blocked = new Set(excluded.map(key));
  const seen = new Set<string>();
  return values.map(value => value.trim()).filter(value => value && !blocked.has(key(value)) && !seen.has(key(value)) && !!seen.add(key(value)));
}
/** Accept the effective Settings profile: explicit values take precedence over learned tastes. */
export function youtubePreferences(profile: TasteProfile): YoutubePreferences {
  const artists = clean(profile.favoriteArtists.length ? profile.favoriteArtists : [...profile.favoriteAlbums, ...profile.favoriteTracks].flatMap(value => value.includes(" — ") ? [value.split(" — ")[0]] : []), profile.blockedArtists);
  const genres = clean(profile.preferredGenres, profile.blockedGenres).filter(value => !audioFormatTag.test(value));
  const seeds = [...artists.map(name => `${name} music`), ...genres.map(name => `${name} music`)];
  return {
    personalized: seeds.length > 0,
    topics: genres.slice(0, 16).map(label => ({ id: `genre:${key(label)}`, label, query: `${label} music` })),
    homeQueries: seeds.slice(0, 60),
  };
}

export async function youtubeHome(profile: TasteProfile, browse: (request: YoutubeBrowseRequest) => Promise<YoutubeBrowsePage>, page = 1): Promise<YoutubeBrowsePage> {
  if (!Number.isInteger(page) || page < 1 || page > 20) throw new Error("Invalid YouTube home page.");
  const prefs = youtubePreferences(profile);
  const sourceUrl = "https://www.youtube.com/";
  if (!prefs.homeQueries.length) return { results: [], title: "Your music on YouTube", sourceUrl, nextPage: null };
  // Rotate through every saved seed before asking YouTube for subsequent pages.
  const groups = Math.ceil(prefs.homeQueries.length / 3);
  const offset = ((page - 1) % groups) * 3;
  const sourcePage = Math.floor((page - 1) / groups) + 1;
  const queries = prefs.homeQueries.slice(offset, offset + 3);
  const settled = await Promise.allSettled(queries.map(q => browse({ kind: "search", q, sort: "relevance", page: sourcePage })));
  const pages = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (!pages.length) throw (settled[0] as PromiseRejectedResult).reason;
  const results: VideoResult[] = [];
  const seen = new Set<string>();
  const blockedArtists = clean(profile.blockedArtists, []);
  for (let index = 0; index < Math.max(...pages.map(result => result.results.length)); index++) {
    for (const result of pages) {
      const video = result.results[index];
      if (!video || seen.has(video.id) || blockedArtists.some(artist => key(video.channel).replace(/ - topic$/, "") === key(artist))) continue;
      seen.add(video.id); results.push(video);
    }
  }
  return { results, title: "For you", sourceUrl, nextPage: page < 20 && (page % groups !== 0 || pages.some(result => result.nextPage !== null)) ? page + 1 : null };
}
