import type { AlbumGroup, HomeListeningResponse } from "@music-os/core";

export function buildHomeInsights(albums: AlbumGroup[], listening: HomeListeningResponse) {
  const files = new Map(albums.flatMap(album => album.files.map(file => [file.id, file] as const)));
  const genres = new Map<string, { label: string; weight: number }>();
  const decades = new Map<number, number>();
  let taggedPlays = 0, datedPlays = 0, plays = 0, skips = 0, firsts = 0;
  for (const row of listening.files) {
    plays += row.plays;
    skips += row.skips;
    if (row.plays > 0 && row.firstPlayedAt && (!listening.since || Date.parse(row.firstPlayedAt) >= Date.parse(listening.since))) firsts++;
    const file = files.get(row.fileId);
    if (!file || row.plays === 0) continue;
    const labels = new Map((file.displayTags.genre ?? "").split(/[,;]/).map(value => value.trim()).filter(Boolean).map(value => [value.toLocaleLowerCase(), value]));
    if (labels.size) taggedPlays += row.plays;
    for (const [key, label] of labels) {
      const previous = genres.get(key) ?? { label, weight: 0 };
      previous.weight += row.plays / labels.size;
      genres.set(key, previous);
    }
    const match = (file.displayTags.year ?? file.displayTags.date ?? "").match(/\b(19\d{2}|20\d{2})\b/);
    if (match && Number(match[1]) <= new Date(listening.until).getUTCFullYear() + 1) {
      const decade = Math.floor(Number(match[1]) / 10) * 10;
      decades.set(decade, (decades.get(decade) ?? 0) + row.plays);
      datedPlays += row.plays;
    }
  }
  const palette = [...genres.values()].sort((a,b) => b.weight-a.weight || a.label.localeCompare(b.label));
  const visible = palette.slice(0, 5);
  const other = palette.slice(5).reduce((sum,row) => sum+row.weight,0);
  if (other) visible.push({label:"Other tags",weight:other});
  const tracks = [...files.values()];
  const explored = tracks.filter(file => file.playCount > 0).length;
  const decadeRows = [...decades].sort((a,b)=>a[0]-b[0]).map(([decade,count])=>({decade,count}));
  return {
    plays, skips, firsts, repeats: Math.max(0, plays-firsts), taggedPlays, datedPlays,
    genres: visible.map(row=>({...row, percent:taggedPlays ? row.weight/taggedPlays*100 : 0})),
    decades: decadeRows, maxDecade: Math.max(1,...decadeRows.map(row=>row.count)),
    leadingDecade: [...decadeRows].sort((a,b)=>b.count-a.count)[0]?.decade,
    explored, totalTracks:tracks.length, coverage: tracks.length ? explored/tracks.length*100 : 0,
    liked:tracks.filter(file=>file.liked === true).length,
    disliked:tracks.filter(file=>file.disliked === true).length,
    rated:tracks.filter(file=>file.rating != null).length,
    ratings: [1,2,3,4,5].map(rating=>({rating,count:tracks.filter(file=>file.rating===rating).length}))
  };
}