import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Search, Disc3 } from "lucide-react";
import type { CatalogueArtist, CatalogueProvider } from "@music-os/core";
import { cachedExploreApi as api } from "./artist-resource";
import { errorMessage, identityKey } from "./explore-api";
import { ArtistSearchLanding } from "./ArtistSearchLanding";
import { ArtworkImage } from "./ArtworkImage";
import { LibraryArtistPage } from "./LibraryArtistPage";
import "./artist-explorer.css";

export function ArtistExplorer({ initialArtist, onBack }: { initialArtist?: string; onBack?: () => void }) {
  const [provider, setProvider] = useState<CatalogueProvider>("apple");
  const [query, setQuery] = useState(initialArtist ?? "");
  const [searchedQuery, setSearchedQuery] = useState(initialArtist ?? "");
  const [artists, setArtists] = useState<CatalogueArtist[]>([]);
  const [selected, setSelected] = useState<CatalogueArtist | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  async function search(term = query, source = provider) {
    if (!term.trim()) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setQuery(term); setSearchedQuery(term.trim()); setBusy(true); setError(""); setArtists([]); setSelected(null);
    try {
      const data = await api<{ artists: CatalogueArtist[] }>("/explore/artists?" + new URLSearchParams({ q: term, provider: source }), undefined, controller.signal);
      if (!controller.signal.aborted) {
        setArtists(data.artists);
        if (!data.artists.length) setError("No artists found. Try another spelling or catalogue.");
      }
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    setSelected(null);
    if (initialArtist) void search(initialArtist);
    return () => request.current?.abort();
  }, [initialArtist]);
  function changeProvider(source: CatalogueProvider) {
    if (source === provider) return;
    request.current?.abort(); setProvider(source); setSelected(null); setArtists([]); setError(""); setBusy(false);
    if (query.trim()) void search(query, source);
  }
  const providerControls = <div className="catalogueProviderControls" aria-label="Catalogue source">
    <button type="button" className={provider === "apple" ? "secondary active" : "secondary"} aria-pressed={provider === "apple"} onClick={() => changeProvider("apple")}>Apple catalogue</button>
    <button type="button" className={provider === "musicbrainz" ? "secondary active" : "secondary"} aria-pressed={provider === "musicbrainz"} onClick={() => changeProvider("musicbrainz")}>Expanded catalogue (MusicBrainz)</button>
  </div>;
  if (selected) return <LibraryArtistPage key={selected.id} artist={initialArtist || selected.name} initialCatalogueArtist={selected} context="Discovery" onBack={() => setSelected(null)}/>;
  if (!initialArtist && !searchedQuery && !busy) return <ArtistSearchLanding provider={provider} providerControls={providerControls} query={query} onQueryChange={setQuery} onSearch={(term) => void search(term)}/>;
  const exact = artists.filter((artist) => identityKey(artist.name) === identityKey(searchedQuery));
  const nameMatch = exact.length === 1 ? exact[0] : null;
  function renderMatch(artist: CatalogueArtist, featured = false) {
    return <button type="button" key={artist.id} className={"discographyMatch" + (featured ? " featured" : "")} onClick={() => setSelected(artist)}>
      <span className="discographyMatchAvatar" aria-hidden="true">{artist.name.trim().slice(0, 1).toLocaleUpperCase()}{artist.libraryAlbumId && <ArtworkImage src={"http://127.0.0.1:47831/artwork/album/" + encodeURIComponent(artist.libraryAlbumId)} alt="" loading="lazy"/>}</span>
      <span className="discographyMatchCopy">{featured && <span className="discographyMatchLabel">Name match</span>}<strong>{artist.name}</strong>{artist.description && <span className="discographyMatchDescription">{artist.description}</span>}<small>{[artist.type, artist.country, artist.begin?.slice(0,4)].filter(Boolean).join(" · ") || "Artist"}</small></span>
      <span className="discographyMatchAction">{featured && <span>Explore artist</span>}<ArrowUpRight size={16} aria-hidden="true"/></span>
    </button>;
  }
  return <section className="artistExplorer discographyPage" aria-label="Browse artists" aria-busy={busy}>
    <nav className="discographyNav" aria-label="Artist navigation"><button type="button" className="secondary discographyBack" onClick={onBack ?? (() => { request.current?.abort(); setBusy(false); setArtists([]); setError(""); setSearchedQuery(""); })}><ArrowLeft size={14}/>{onBack ? "Back to artist" : "Artist search"}</button>{providerControls}</nav>
    <header className="discographyHeader"><div className="discographyIdentity"><span className="discographyIdentityIcon" aria-hidden="true"><Disc3 size={26}/></span><div><span className="exploreEyebrow">FOLLOW YOUR CURIOSITY</span><h2>{initialArtist || "Explore artists"}</h2><p>Find an artist, explore their music, and follow the connections to your next discovery.</p></div></div></header>
    <form className="discographySearch" onSubmit={(event) => { event.preventDefault(); void search(); }}><Search size={16}/><input aria-label="Find an artist" placeholder="Search artist name…" value={query} onChange={(event) => setQuery(event.target.value)}/><button type="submit" disabled={busy || !query.trim()}>{busy ? "Searching…" : "Find artist"}</button></form>
    {error && <p role="alert" className="exploreError">{error}</p>}
    {busy && <div className="discographyLoading"><p role="status"><span className="discographyLoadingDot"/>Finding artist matches…</p></div>}
    {!busy && artists.length > 0 && <section className="discographyMatches" aria-label="Artist matches"><div className="discographySectionHeading"><div><h3>Select an artist</h3><p>Open their profile, discography, and musical connections.</p></div><span>{artists.length} results</span></div>{nameMatch && renderMatch(nameMatch, true)}<div className="discographyMatchGrid">{artists.filter((artist) => artist.id !== nameMatch?.id).map((artist) => renderMatch(artist))}</div></section>}
  </section>;
}
