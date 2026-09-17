import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Check, Clock, Compass, History, Inbox, LoaderCircle, Play, Search, ListPlus, ListMusic, Clapperboard as Youtube } from "lucide-react";
import type { VideoJob, VideoResult, YoutubeBrowsePage, YoutubePreferences } from "@music-os/core";
import { exploreApi as api, errorMessage } from "./explore-api";
import "./youtube-browser.css";
import { youtubePlayback, useYoutubeSourceActive } from "./youtube-playback";
export type YoutubeNavigationRequest = {id: number; query: string} | null;

type BrowseRequest = { kind: "search" | "channel" | "playlist"; q: string; sort: "relevance" | "date" };
type BrowsePage = YoutubeBrowsePage;
type Place = { request: BrowseRequest; label: string; topic?: string; home?: boolean };
type Snapshot = { place: Place; data: BrowsePage | null; scroll: number };
const home: Place = { request: { kind: "search", q: "", sort: "relevance" }, label: "For you", home: true };
const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
function duration(n: number | null) {
  if (n == null) return "Video";
  const seconds = Math.max(0, Math.floor(n));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function readList(key: string): VideoResult[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(data) ? data.filter((v): v is VideoResult => !!v && typeof v === "object" && /^[\w-]{11}$/.test(v.id) && typeof v.title === "string" && v.url === "https://www.youtube.com/watch?v=" + v.id).slice(0, 100) : [];
  } catch { return []; }
}
function queryPlace(raw: string): Place {
  const q = raw.trim();
  let kind: BrowseRequest["kind"] = "search";
  if (q.startsWith("@") || /^UC[\w-]{22}$/.test(q)) kind = "channel";
  if (/^https?:\/\//i.test(q)) {
    const url = new URL(q);
    if (url.pathname === "/playlist") kind = "playlist";
    else if (/^\/(?:@|channel\/|c\/|user\/)/.test(url.pathname)) kind = "channel";
  }
  return { request: { kind, q, sort: "relevance" }, label: kind === "search" ? `Results for “${q}”` : kind === "channel" ? "Channel uploads" : "Playlist" };
}
export function YoutubeBrowser({ active, jobs, pending, onDownload, error, inbox, request }: {
  request?: YoutubeNavigationRequest; active: boolean; jobs: VideoJob[]; pending: string | null; onDownload: (v: VideoResult) => Promise<boolean>; error: string; inbox: ReactNode;
}) {
  const [tab, setTab] = useState<"browse" | "saved" | "history" | "inbox">("browse");
  const [preferences, setPreferences] = useState<YoutubePreferences | null>(null);
  const preferenceVersion = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<Place>(home);
  const [data, setData] = useState<BrowsePage | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [failure, setFailure] = useState("");
  const [health, setHealth] = useState<{available:boolean;message:string} | null>(null);
  const [saved, setSaved] = useState(() => readList("music-os:youtube:saved:v1"));
  const [recent, setRecent] = useState(() => readList("music-os:youtube:recent:v1"));
  const [storageNotice, setStorageNotice] = useState("");
  const youtubeActive = useYoutubeSourceActive();
  const [length, setLength] = useState("all");
  const [retry, setRetry] = useState(0);
  const [trail, setTrail] = useState<Snapshot[]>([]);
  const [restoring, setRestoring] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const restoreScroll = useRef<number | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void api<{available:boolean;message:string}>("/explore/youtube/health", undefined, abort.signal).then(setHealth).catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    const refresh = () => {
      void api<YoutubePreferences>("/explore/youtube/preferences", undefined, abort.signal).then(next => {
        if (abort.signal.aborted) return;
        const version = JSON.stringify(next);
        if (preferenceVersion.current !== null && preferenceVersion.current !== version && place.home) setRetry(value => value + 1);
        preferenceVersion.current = version;
        setPreferences(next);
      }).catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { abort.abort(); window.removeEventListener("focus", refresh); };
  }, [active, place.home]);
  useEffect(() => {
    if (restoring) { setRestoring(false); return; }
    const abort = new AbortController();
    controller.current?.abort(); controller.current = abort;
    const token = ++generation.current;
    setBusy(true); setMore(false); setFailure("");
    const params = new URLSearchParams({ ...place.request, page: "1" });
    void api<BrowsePage>(place.home ? "/explore/youtube/home" : "/explore/youtube/browse?" + params, undefined, abort.signal).then(result => {
      if (token === generation.current) setData(result);
    }).catch(e => { if (!abort.signal.aborted && token === generation.current) setFailure(errorMessage(e)); })
      .finally(() => { if (token === generation.current && !abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
    // restoring is consumed only by a navigation event, never a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, retry]);
  useEffect(() => {
    if (restoreScroll.current !== null && !busy) { scroll.current?.scrollTo({ top: restoreScroll.current }); restoreScroll.current = null; }
  }, [data, busy, place]);
  useEffect(() => {
    const reset = () => { setTab("browse"); navigate(home); };
    window.addEventListener("youtube-browse-home", reset);
    return () => window.removeEventListener("youtube-browse-home", reset);
  });
  useEffect(() => {
    const refreshLists = () => {
      setSaved(readList("music-os:youtube:saved:v1"));
      setRecent(readList("music-os:youtube:recent:v1"));
    };
    window.addEventListener("youtube-lists-changed", refreshLists);
    return () => window.removeEventListener("youtube-lists-changed", refreshLists);
  }, []);
  useEffect(() => {
    if (!request) return;
    setQuery(request.query);
    navigate(queryPlace(request.query));
  }, [request?.id]);
  useEffect(() => () => { controller.current?.abort(); ++generation.current; }, []);
  function persist(key: string, list: VideoResult[]) {
    try { localStorage.setItem(key, JSON.stringify(list)); setStorageNotice(""); window.dispatchEvent(new Event("youtube-lists-changed")); }
    catch { setStorageNotice("Browser storage is unavailable. Your list will last for this session only."); }
  }
  function save(video: VideoResult) {
    const next = saved.some(v => v.id === video.id) ? saved.filter(v => v.id !== video.id) : [video, ...saved].slice(0, 100);
    setSaved(next); persist("music-os:youtube:saved:v1", next);
  }
  function open(video: VideoResult) {
    void youtubePlayback.open(video);
    const next = [video, ...recent.filter(v => v.id !== video.id)].slice(0, 100);
    setRecent(next); persist("music-os:youtube:recent:v1", next);
  }
  function navigate(next: Place) {
    controller.current?.abort(); ++generation.current;
    setTrail(old => [...old, { place, data, scroll: scroll.current?.scrollTop || 0 }].slice(-30));
    setRestoring(false); setData(null); setPlace(next); setLength("all"); setTab("browse");
    scroll.current?.scrollTo({ top: 0 });
  }
  function back() {
    const previous = trail.at(-1); if (!previous) return;
    controller.current?.abort(); ++generation.current;
    setTrail(old => old.slice(0, -1)); setRestoring(!!previous.data); setBusy(false); setMore(false); setFailure("");
    setData(previous.data); setPlace(previous.place); setLength("all"); restoreScroll.current = previous.scroll;
  }
  async function loadMore() {
    if (!data?.nextPage || busy || more) return;
    const abort = new AbortController(); controller.current = abort;
    const token = generation.current; setMore(true); setFailure("");
    try {
      const next = await api<BrowsePage>(place.home ? "/explore/youtube/home?page=" + data.nextPage : "/explore/youtube/browse?" + new URLSearchParams({ ...place.request, page: String(data.nextPage) }), undefined, abort.signal);
      if (generation.current === token) setData(old => old ? { ...next, channels: old.channels, results: [...old.results, ...next.results.filter(v => !old.results.some(existing => existing.id === v.id))] } : next);
    } catch (e) { if (!abort.signal.aborted && generation.current === token) setFailure(errorMessage(e)); }
    finally { if (generation.current === token) setMore(false); }
  }
  async function download(video: VideoResult) { if (await onDownload(video)) { setTab("inbox"); } }
  const waiting = jobs.filter(j => ["queued", "running", "review"].includes(j.status)).length;
  const videos = tab === "saved" ? saved : tab === "history" ? recent : data?.results || [];
  const ordered = place.request.sort === "date" && tab === "browse" ? [...videos].sort((a, b) => (b.uploadDate || "").localeCompare(a.uploadDate || "")) : videos;
  const shown = ordered.filter(v => length === "all" || (v.duration != null && (length === "short" ? v.duration < 240 : length === "medium" ? v.duration >= 240 && v.duration <= 1200 : v.duration > 1200)));
  function channel(video: VideoResult) {
    if (video.channelId || video.channelUrl) navigate({ request: { kind: "channel", q: video.channelId || video.channelUrl!, sort: "relevance" }, label: video.channel });
    else navigate(queryPlace(video.channel));
  }
  const card = (video: VideoResult) => {
    const queued = jobs.some(j => j.url === video.url && ["queued", "running", "review"].includes(j.status));
    const isSaved = saved.some(v => v.id === video.id);
    return <article className="ytCard" key={video.id}>
      <button className="ytThumbnail" onClick={() => open(video)} aria-label={"Watch " + video.title}>
        <Youtube size={30} aria-hidden="true" />
        {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" decoding="async" onError={e => { e.currentTarget.style.visibility = "hidden"; }} />}
        <span className="ytPlay"><Play size={22} fill="currentColor" /></span>
        <span className="ytDuration">{video.liveStatus === "is_live" ? "LIVE" : duration(video.duration)}</span>
      </button>
      <div className="ytCardInfo">
        <button className="ytVideoTitle" onClick={() => open(video)} title={video.title}><span>{video.title}</span></button>
        <div className="ytCardDetails"><div className="ytCardMetadata">
        <button className="ytChannelLink" onClick={() => channel(video)} title={"Browse " + video.channel}>{video.channel || "Unknown channel"}</button>
        <div className="ytFacts">{video.viewCount != null && <span>{compact(video.viewCount)} views</span>}{video.uploadDate && <span title={video.approximateDate ? "Approximate upload date" : "Upload date"}>{video.approximateDate ? "≈ " : ""}{new Date(video.uploadDate + "T12:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>}</div>
        </div><div className="ytCardActions">
          <button disabled={!youtubeActive} aria-label={"Play next: " + video.title} title={youtubeActive ? "Play next" : "Start a YouTube video to use its queue"} onClick={() => youtubePlayback.enqueue(video, "up_next")}><ListPlus size={15} /></button>
          <button disabled={!youtubeActive} aria-label={"Add to end of queue: " + video.title} title={youtubeActive ? "Add to end of queue" : "Start a YouTube video to use its queue"} onClick={() => youtubePlayback.enqueue(video, "end")}><ListMusic size={15} /></button>
          <button aria-label={(isSaved ? "Remove from" : "Save to") + " Watch later: " + video.title} title={isSaved ? "Remove from Watch later" : "Watch later"} aria-pressed={isSaved} onClick={() => save(video)}>{isSaved ? <Check size={15} /> : <Clock size={15} />}</button>
          <button aria-label={"Download audio: " + video.title} title={queued ? "In audio inbox" : "Download audio"} disabled={pending !== null || queued || video.liveStatus === "is_live" || video.liveStatus === "is_upcoming"} onClick={() => void download(video)}>{pending === video.id ? <LoaderCircle size={15} className="youtubeSpinner" /> : queued ? <Check size={15} /> : <ArrowDownToLine size={15} />}</button>
        </div></div>
      </div>
    </article>;
  };
  return <section className="youtubeExplorer youtubeWorkspace ytBrowser">
    <header className="youtubeHeading">
      <div className="youtubeIdentity"><span className="youtubeIcon"><Youtube size={25} /></span><div><h2>YouTube</h2><p>A world of music, one rabbit hole away.</p></div></div>
      <form className="youtubeSearchForm" onSubmit={e => { e.preventDefault(); if (query.trim()) { try { navigate(queryPlace(query)); } catch { setFailure("Enter a valid YouTube link or search term."); } } }}>
        <Search size={18} /><input aria-label="Search YouTube" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search videos, @channels, or paste a link…" />
        <button disabled={!query.trim()}>Search <ArrowUpRight size={14} /></button>
      </form>
    </header>
    <nav className="youtubeTabs" aria-label="YouTube sections">
      {([{ id: "browse", label: "Browse", icon: Compass }, { id: "saved", label: "Watch later", icon: Clock }, { id: "history", label: "Recently opened", icon: History }, { id: "inbox", label: "Audio inbox", icon: Inbox }] as const).map(({id,label,icon:Icon}) => <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); }}><Icon size={15} />{label}{id === "inbox" && <span className="discoveryCount">{waiting}</span>}{id === "saved" && saved.length > 0 && <span className="discoveryCount">{saved.length}</span>}</button>)}
    </nav>
    {(error || storageNotice) && <p className="exploreError" role="alert">{error || storageNotice}</p>}
    <div className="ytInboxHost" hidden={tab !== "inbox"}>{inbox}</div>
    <div className="ytBrowseScroll" ref={scroll} hidden={tab === "inbox"}>
      {tab === "browse" && <>
        <nav className="ytTopics" aria-label="Browse your music preferences"><button aria-pressed={!!place.home} onClick={() => navigate(home)}>For you</button>{preferences?.topics.map(topic => <button key={topic.id} aria-pressed={place.topic === topic.id} onClick={() => navigate({ request: { kind: "search", q: topic.query, sort: "relevance" }, label: topic.label, topic: topic.id })}>{topic.label}</button>)}</nav>
      </>}
      <div className="ytSectionHeading">
        <div className="ytHeadingMain">{tab === "browse" && trail.length > 0 && <button className="ytBack" onClick={back} aria-label="Back to previous results"><ArrowLeft size={17} /></button>}<div><h3>{tab === "saved" ? "Watch later" : tab === "history" ? "Recently opened" : place.request.kind !== "search" && data?.title ? data.title : place.label}</h3><p>{tab === "saved" ? "Your next listening session, saved on this device." : tab === "history" ? "Videos you opened here. Your YouTube history stays separate." : place.request.kind === "channel" ? "Channel uploads · latest first" : place.request.kind === "playlist" ? "Videos in playlist order" : place.home ? preferences?.personalized ? "Based on your favorite artists and genres in Settings." : "Add favorite artists or genres in Settings to personalize this page." : "Discover performances, videos and new sounds."}</p></div></div>
        <div className="ytFilters">
          {tab === "browse" && place.request.kind === "search" && <label><span>Sort loaded</span><select aria-label="Sort YouTube results" value={place.request.sort} onChange={e => navigate({ ...place, request: { ...place.request, sort: e.target.value as "relevance" | "date" } })}><option value="relevance">Relevance</option><option value="date">Newest loaded</option></select></label>}
          <label><span>Length</span><select aria-label="Filter loaded videos by duration" title="Filters the videos loaded so far" value={length} onChange={e => setLength(e.target.value)}><option value="all">Any length</option><option value="short">Under 4 min</option><option value="medium">4–20 min</option><option value="long">Over 20 min</option></select></label>
        </div>
      </div>
      {tab === "browse" && data?.sourceUrl && !place.topic && !place.home && <a className="ytSource" href={data.sourceUrl} target="_blank" rel="noreferrer">Open {place.request.kind === "search" ? "results" : place.request.kind} on YouTube <ArrowUpRight size={12} /></a>}
      {health && !health.available && <p role="alert" className="exploreError">{health.message}</p>}
      {tab === "browse" && failure && <div role="alert" className="ytFailure"><strong>Couldn’t load videos</strong><p>{failure}</p><button onClick={() => data ? void loadMore() : setRetry(n => n + 1)}>Try again</button><a href={data?.sourceUrl || "https://www.youtube.com/results?search_query=" + encodeURIComponent(place.request.q)} target="_blank" rel="noreferrer">Browse on YouTube <ArrowUpRight size={13} /></a></div>}
      {tab === "browse" && busy && <div role="status" className="ytLoading"><LoaderCircle size={18} className="youtubeSpinner" /> Finding videos…</div>}
      {tab === "browse" && !busy && !place.home && !place.topic && place.request.kind === "search" && !!data?.channels?.length && <section aria-label="Matching YouTube channels" className="ytChannelMatches"><h4>Channels</h4><div className="ytChannels">{data.channels.map(match => <button key={match.id} className="ytChannelShortcut" onClick={() => navigate({ request: { kind: "channel", q: match.id, sort: "relevance" }, label: match.name })}><span className="ytAvatar">{match.name.slice(0, 1)}</span><span><strong>{match.name}</strong><small>{match.matchedVideos} matching {match.matchedVideos === 1 ? "video" : "videos"} in these results</small><span className="ytExploreChannel">Explore channel <ArrowUpRight size={12} /></span></span></button>)}</div></section>}
      <div className="ytVideoGrid" aria-busy={tab === "browse" && busy}>{!(tab === "browse" && busy) && shown.map(card)}</div>
      {!(tab === "browse" && (busy || failure)) && !shown.length && <div className="ytEmpty"><Youtube size={30} /><h3>{length !== "all" ? "No loaded videos match this length" : tab === "saved" ? "Keep something for later" : tab === "history" ? "Your next rabbit hole starts here" : place.home && !preferences?.personalized ? "Make this page yours" : "No videos found"}</h3><p>{length !== "all" ? "Choose another length or load more videos." : tab === "saved" ? "Use the clock on any video to save it here." : tab === "history" ? "Open a video and it will appear here." : place.home && !preferences?.personalized ? "Save your favorite artists and genres in Settings, or search YouTube above." : "Try another search, channel, or playlist link."}</p>{tab !== "browse" && <button onClick={() => setTab("browse")}>Explore music</button>}</div>}
      {tab === "browse" && data?.nextPage && !busy && <div className="ytLoadMore"><button disabled={more} onClick={() => void loadMore()}>{more ? <><LoaderCircle size={15} className="youtubeSpinner" /> Loading more…</> : "Load more videos"}</button><small>{data.results.length} videos loaded{length !== "all" ? " · length filter applies to loaded videos" : ""}</small></div>}
      {tab === "history" && recent.length > 0 && <button className="ytClearHistory" onClick={() => { setRecent([]); persist("music-os:youtube:recent:v1", []); }}>Clear local history</button>}
    </div>
    <footer className="youtubeWorkspaceFooter"><span><Check size={12} /> Explore · watch · save · collect</span><span>Local lists · review metadata before importing audio</span></footer>

  </section>;
}