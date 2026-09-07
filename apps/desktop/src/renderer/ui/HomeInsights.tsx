import { useMemo, type CSSProperties } from "react";
import type { AlbumGroup, HomeListeningResponse, TasteProfileResponse } from "@music-os/core";
import { buildHomeInsights } from "./home-insights-data";
import "./home-insights.css";

export function HomeInsights({ albums, listening, taste, onOpenSettings }: {
  albums: AlbumGroup[]; listening: HomeListeningResponse; taste: TasteProfileResponse | null; onOpenSettings(): void;
}) {
  const data = useMemo(()=>buildHomeInsights(albums,listening),[albums,listening]);
  const period = listening.since ? "Selected period" : "All recorded history";
  const saved = taste?.profile;
  return <section className="hiInsights" aria-label="Taste and listening insights">
    <div className="hiIntro"><span className="eyebrow">A closer listen</span><h2>The shape of your taste.</h2><p>What you play. What you keep. What you have yet to discover.</p></div>
    <div className="hiGrid">
      <article className="hiPalette">
        <header className="hjSectionHead"><div><span className="eyebrow">From your listening / {period}</span><h2>Sound palette</h2></div><span>Genre tags</span></header>
        {data.genres.length ? <div className="hiPanelBody">
          <div className="hiStatement"><strong>{data.genres[0]!.label}</strong><span>leads your tagged listening</span></div>
          <div className="hiRibbon" role="img" aria-label={data.genres.map(row=>`${row.label}: ${Math.round(row.percent)}%`).join(', ')}>
            {data.genres.map((row,index)=><i key={row.label} style={{flex:row.percent, '--hi-tone':`${100-index*14}%`} as CSSProperties} title={`${row.label}: ${Math.round(row.percent)}%`} />)}
          </div>
          <div className="hiGenreLegend">{data.genres.map((row,index)=><div key={row.label}><i style={{'--hi-tone':`${100-index*14}%`} as CSSProperties}/><span title={row.label}>{row.label}</span><strong>{Math.round(row.percent)}%</strong></div>)}</div>
          <p className="hiNote">{data.taggedPlays} of {data.plays} plays have genre tags. Multi-genre tracks split their share equally. These are listening patterns, not saved preferences.</p>
        </div> : <p className="hjEmpty">No genre-tagged plays in this period. Add genre tags in Library to build your palette.</p>}
      </article>
      <article>
        <header className="hjSectionHead"><div><span className="eyebrow">Across the decades / {period}</span><h2>Your listening eras</h2></div><span>Tagged years</span></header>
        {data.decades.length ? <div className="hiPanelBody">
          <div className="hiStatement"><strong>{data.leadingDecade}s</strong><span>your most-played decade</span></div>
          <div className="hiDecades" role="group" aria-label="Plays by tagged decade">{data.decades.map(row=><div key={row.decade} tabIndex={0} title={`${row.decade}s: ${row.count} plays`} aria-label={`${row.decade}s: ${row.count} plays`}><strong>{row.count}</strong><i style={{height:`${Math.max(3,row.count/data.maxDecade*100)}%`}}/><span>{row.decade}s</span></div>)}</div>
          <p className="hiNote">{data.datedPlays} of {data.plays} plays have usable years. Dates come from file tags and may describe a reissue.</p>
        </div> : <p className="hjEmpty">No dated plays in this period. Tagged release years will appear here.</p>}
      </article>
      <article>
        <header className="hjSectionHead"><div><span className="eyebrow">Listening behavior</span><h2>New paths & familiar tracks</h2></div><span>{period}</span></header>
        <div className="hiPanelBody">
          <div className="hiExploration"><div className="hiDonut" role="img" aria-label={`${data.explored} of ${data.totalTracks} library tracks played at least once`}><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="none" stroke="var(--bg3)" strokeWidth="10"/><circle cx="50" cy="50" r="44" fill="none" stroke="var(--acc)" strokeWidth="10" pathLength="100" strokeDasharray={`${data.coverage} 100`} transform="rotate(-90 50 50)"/></svg><div><strong>{Math.round(data.coverage)}%</strong><span>explored</span></div></div><div><h3>Your collection, uncovered</h3><p><b>{data.explored.toLocaleString()}</b> of {data.totalTracks.toLocaleString()} tracks played at least once.</p><small>Lifetime history · album-tagged library</small></div></div>
          <div className="hiBehaviorTotals"><div><strong>{data.firsts}</strong><span>First recorded listens</span></div><div><strong>{data.repeats}</strong><span>Return plays</span></div><div><strong>{data.skips}</strong><span>Early skips</span></div></div>
          <div className="hiSplit" role="img" aria-label={`${data.firsts} first recorded listens and ${data.repeats} return plays`}><i style={{width:`${data.plays ? data.firsts/data.plays*100 : 0}%`}}/></div>
          <p className="hiNote">First listens are new to this app’s history. Every later play counts as a return. Early skips end before the play threshold; they are not dislikes.</p>
        </div>
      </article>
      <article className="hiMemory">
        <header className="hjSectionHead"><div><span className="eyebrow">Explicit preferences / all time</span><h2>Your taste, on record</h2></div><button type="button" className="secondary" onClick={onOpenSettings}>Settings ↗</button></header>
        <div className="hiPanelBody">
          <div className="hiMemoryTotals"><div><strong>{saved ? saved.favoriteAlbums.length.toLocaleString() : '—'}</strong><span>Saved album favorites</span></div><div><strong>{data.liked}</strong><span>Liked tracks</span></div><div><strong>{data.rated}</strong><span>Rated tracks</span></div></div>
          <div className="hiRatings" aria-label="Track rating distribution">{data.ratings.map(row=><div key={row.rating} title={`${row.count} tracks rated ${row.rating} stars`}><span>{row.rating} ★</span><i><b style={{width:`${data.rated ? row.count/data.rated*100 : 0}%`}}/></i><strong>{row.count}</strong></div>)}</div>
          {saved ? <div className="hiSavedGenres"><span>Saved genre preferences</span><p>{saved.preferredGenres.length ? saved.preferredGenres.join(' · ') : 'None set yet'}</p></div> : <p className="hiNote">Saved taste profile is unavailable. Refresh Home to try again.</p>}
          <p className="hiNote">The agent can use saved favorites, ratings and playback patterns. Listening does not automatically rewrite your saved taste profile.</p>
        </div>
      </article>
    </div>
  </section>;
}