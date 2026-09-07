import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Compass, GitBranch, Headphones, Library, RefreshCw } from "lucide-react";
import type { CatalogueArtist, CatalogueArtistProfile, SimilarArtist, SimilarArtistsResponse } from "@music-os/core";
import { ArtworkImage } from "./ArtworkImage";
import { cachedExploreApi as exploreApi, artistSnapshot, readArtistResource } from "./artist-resource";
import { errorMessage } from "./explore-api";
import "./similar-artists.css";

type ConnectionFilter = "all" | "new" | "listeners" | "shared-tags";
const sourceLabels = { musicmap: "Music-Map", listenbrainz: "ListenBrainz", musicbrainz: "MusicBrainz" };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => Array.from(word)[0]).join("");
const artistHue = (name: string) => Array.from(name).reduce((hash, char) => (hash * 31 + char.codePointAt(0)!) % 360, 0);

export function SimilarArtists({ artist, onOpenArtist, onFindCatalogueMatch, onCanonicalArtist }: {
  artist: CatalogueArtist;
  onOpenArtist: (artist: CatalogueArtist) => void;
  onFindCatalogueMatch?: () => void;
  onCanonicalArtist?: (id: string) => void;
}) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const canonicalCallback = useRef(onCanonicalArtist);
  useEffect(() => { canonicalCallback.current = onCanonicalArtist; }, [onCanonicalArtist]);
  const [inView, setInView] = useState(false);
  const [portraits, setPortraits] = useState<Record<string, { url: string; credit: string | null }>>({});
  const [data, setData] = useState<SimilarArtistsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState<ConnectionFilter>("all");
  const [limit, setLimit] = useState(9);
  useEffect(() => {
    const request = new AbortController();
    const path = "/explore/similar-artists?" + new URLSearchParams({ artistId: artist.id, artist: artist.name });
    setData(artistSnapshot<SimilarArtistsResponse>(path)); setLoading(true); setError("");
    void readArtistResource<SimilarArtistsResponse>(path, (result) => { setData(result); setLoading(Boolean(result.pending) && !result.artists.length); }, request.signal)
      .catch((reason) => { if (!request.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [artist.id, artist.name, retry]);
  useEffect(() => { setFilter("all"); setLimit(9); }, [artist.id]);
  useEffect(() => {
    const refresh = () => setRetry((value) => value + 1);
    window.addEventListener("music-library-changed", refresh);
    return () => window.removeEventListener("music-library-changed", refresh);
  }, []);
  useEffect(() => {
    if (!sectionRef.current || typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const observer = new IntersectionObserver((observed) => {
      if (observed.some((entry) => entry.isIntersecting)) { setInView(true); observer.disconnect(); }
    }, { rootMargin: "150px" });
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);
  const warmed = useRef(new Set<string>());
  function warmArtist(connected: CatalogueArtist) {
    if (warmed.current.has(connected.id)) return;
    warmed.current.add(connected.id);
    if (connected.requiresArtistMatch) {
      void exploreApi("/explore/artists?" + new URLSearchParams({ q: connected.name, provider: "apple" })).catch(() => {});
      return;
    }
    void exploreApi<CatalogueArtistProfile>("/explore/artist-profile?" + new URLSearchParams({ artistId: connected.id, artist: connected.name }))
      .then((profile) => { if (profile.imageUrl) setPortraits((current) => ({ ...current, [connected.id]: { url: profile.imageUrl!, credit: profile.imageSourceUrl } })); })
      .catch(() => {});
  }
  useEffect(() => {
    if (data?.artistId === artist.id && data.resolvedArtistId) canonicalCallback.current?.(data.resolvedArtistId);
  }, [artist.id, data]);
  const entries = data?.artists ?? [];
  const matches = (entry: SimilarArtist, key: ConnectionFilter) => key === "all" || (key === "new" ? entry.libraryAlbumCount === 0 : key === "listeners" ? (entry.sources.includes("listenbrainz") || entry.sources.includes("musicmap")) : entry.sharedTags.length > 0);
  const filtered = entries.filter((entry) => matches(entry, filter));
  const visible = filtered.slice(0, limit);
  const filters: { key: ConnectionFilter; label: string }[] = [
    { key: "all", label: "All connections" }, { key: "new", label: "New to your library" },
    { key: "listeners", label: "Listener connections" }, { key: "shared-tags", label: "Shared genres & tags" },
  ];
  const renderCard = (entry: SimilarArtist, featured: boolean) => {
    const connected = entry.artist;
    const portrait = portraits[connected.id];
    return <article className={`similarArtistCard${featured ? " isFeatured" : ""}`} key={connected.id} style={{ "--connection-hue": artistHue(connected.name) } as CSSProperties}>
      <button className="similarArtistOpen" onMouseEnter={() => warmArtist(connected)} onFocus={() => warmArtist(connected)} onClick={() => onOpenArtist(connected)} aria-label={`Explore ${connected.name}`}>
        <span className="similarArtistPortrait" aria-hidden="true"><span>{initials(connected.name)}</span>{portrait ? <img key={portrait.url} src={portrait.url} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : connected.artworkUrl && <ArtworkImage src={connected.artworkUrl} alt="" />}</span>
        <span className="similarArtistIdentity"><span className="similarArtistConnection">{entry.sources.length > 1 ? <><GitBranch size={12} /> Multiple sources</> : entry.sources.includes("musicmap") ? <><Compass size={12} /> Music-Map connection</> : entry.sources.includes("listenbrainz") ? <><Headphones size={12} /> Listener connection</> : <><Compass size={12} /> {entry.connection === "related" ? "Artist connection" : "Shared musical territory"}</>}</span><strong>{connected.name}</strong><span className="similarArtistDescription">{connected.description || [connected.type, connected.country].filter(Boolean).join(" · ") || "Explore their releases and connections"}</span></span>
        <ArrowUpRight className="similarArtistArrow" size={18} aria-hidden="true" />
      </button>
      <div className="similarArtistEvidence"><p>{entry.reasons.join(" · ") || "Related artist returned by the linked music sources."}</p>{entry.sharedTags.length > 0 && <div className="similarArtistTags" aria-label="Shared tags">{entry.sharedTags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}</div>
      <footer><span className={entry.libraryAlbumCount ? "similarArtistOwned" : "similarArtistNew"}>{entry.libraryAlbumCount ? <><Library size={12} /> {entry.libraryAlbumCount} {entry.libraryAlbumCount === 1 ? "album" : "albums"} in library</> : "New to your library"}</span><span className="similarArtistSources">{entry.sources.map((source) => <a key={source} href={source === "musicmap" ? (connected.sourceUrl || `https://www.music-map.com/${encodeURIComponent(connected.name.toLowerCase()).replace(/%20/g, "+")}`) : source === "musicbrainz" ? `https://musicbrainz.org/artist/${encodeURIComponent(connected.id)}` : `https://listenbrainz.org/artist/${encodeURIComponent(connected.id)}/`} target="_blank" rel="noreferrer" aria-label={`${connected.name} on ${sourceLabels[source]}`}>{sourceLabels[source]}</a>)}{portrait?.credit && <a href={portrait.credit} target="_blank" rel="noreferrer" aria-label={`${connected.name} image source and credits`}>Photo credit</a>}</span></footer>
    </article>;
  };
  return <section ref={sectionRef} className="similarArtists" aria-labelledby={headingId} aria-busy={loading}>
    <header className="similarArtistsHeading"><div><span className="similarArtistsEyebrow"><GitBranch size={13} /> FOLLOW THE CONNECTIONS</span><h2 id={headingId}>Where to next?</h2><p>Start with {artist.name}. Follow a familiar sound into something new.</p></div>{entries.length > 0 && <div className="similarArtistsHeadingActions"><span className="similarArtistsCount">{entries.length} connections</span><button className="secondary" title="Explore a connected artist, favoring artists new to your library" onClick={() => { const unheard = entries.filter((entry) => entry.libraryAlbumCount === 0); const choices = unheard.length ? unheard : entries; onOpenArtist(choices[Math.floor(Math.random() * choices.length)].artist); }}><Compass size={14}/> Surprise me</button></div>}</header>
    <a className="similarArtistsExternalMap" href={`https://www.music-map.com/${encodeURIComponent(artist.name.toLowerCase()).replace(/%20/g, "+")}`} target="_blank" rel="noreferrer">Open the interactive Music-Map ↗</a>
    {loading && !entries.length && <div className="similarArtistsLoading" role="status"><Compass size={22} /><div><strong>Finding the next connection</strong><p>Loading Music-Map first; other sources follow in the background…</p></div><div className="similarArtistsSkeleton" aria-hidden="true"><span /><span /><span /></div></div>}
    {error && <div className="similarArtistsMessage" role="alert"><p>Artist connections could not be loaded. {error}</p><button className="secondary" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={13} /> Try again</button></div>}
    {data && (!loading || entries.length > 0) && <>
      {entries.length > 0 ? <>
        <div className="similarArtistsFilters" aria-label="Filter similar artists">{filters.map(({ key, label }) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setLimit(9); }}>{label}<span>{entries.filter((entry) => matches(entry, key)).length}</span></button>)}</div>
        {visible.length > 0 ? <><div className="similarArtistsBranch" aria-hidden="true"><span />{filter === "new" ? "A new branch for your collection" : filter === "listeners" ? "Connected through listening" : filter === "shared-tags" ? "Explore shared musical territory" : "Choose a path and keep exploring"}<span /></div><div className="similarArtistsFeatured">{visible.slice(0, 3).map((entry) => renderCard(entry, true))}</div>{visible.length > 3 && <div className="similarArtistsMore">{visible.slice(3).map((entry) => renderCard(entry, false))}</div>}{filtered.length > limit && <button className="secondary similarArtistsLoadMore" onClick={() => setLimit((value) => value + 9)}>Explore more connections <span>({filtered.length - limit} more)</span></button>}</> : <div className="similarArtistsMessage"><p>No connections in this view yet.</p><button className="secondary" onClick={() => setFilter("all")}>Show all connections</button></div>}
      </> : <div className="similarArtistsMessage"><Compass size={24} /><p>{data.pending ? "Connections are still arriving. You can keep exploring the artist while sources respond." : "No artist connections were returned for this artist yet."}</p>{data.sources.length === 0 && onFindCatalogueMatch ? <button className="secondary" onClick={onFindCatalogueMatch}>Find a MusicBrainz match <ArrowUpRight size={13} /></button> : <button className="secondary" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={13} /> Check again</button>}</div>}
      {data.pending && <p className="similarArtistsNote" role="status">More connections are arriving in the background…</p>}
      <div className="similarArtistsProvenance">{data.sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span className={`similarSourceStatus is-${source.status}`} />{source.label}<span>{source.status === "ok" ? "connected" : source.status === "empty" ? "no matches" : "unavailable"}</span><ArrowUpRight size={11} /></a>)}</div>
      {(data.note || entries.some((entry) => entry.libraryAlbumCount > 0)) && <p className="similarArtistsNote">{data.note}{entries.some((entry) => entry.libraryAlbumCount > 0) && " Library matches use artist names."}</p>}
      {data.sources.some((source) => source.status === "unavailable") && entries.length > 0 && <button className="similarArtistsRetry" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={12} /> Retry unavailable sources</button>}
    </>}
  </section>;
}
