import { ArtworkImage } from "./ArtworkImage";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Disc3, Search } from "lucide-react";
import type { AlbumGroup, CatalogueProvider } from "@music-os/core";
import { exploreApi as api } from "./explore-api";
import "./artist-search-landing.css";

export function ArtistSearchLanding({
  provider,
  providerControls,
  query,
  onQueryChange,
  onSearch,
}: {
  provider: CatalogueProvider;
  providerControls: ReactNode;
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
}) {
  const [albums, setAlbums] = useState<AlbumGroup[]>([]);
  useEffect(() => {
    let live = true;
    void api<{ albums: AlbumGroup[] }>("/library/albums?limit=24&sort=recent")
      .then(({ albums: recent }) => {
        const names = new Set<string>();
        if (live) setAlbums(recent.filter((album) => {
          const key = album.artist.trim().toLocaleLowerCase();
          if (!key || key === "unknown artist" || names.has(key)) return false;
          names.add(key);
          return true;
        }).slice(0, 4));
      })
      .catch(() => { /* Library shortcuts are optional; search stays available. */ });
    return () => { live = false; };
  }, []);
  return (
    <section className="artistSearchLanding" aria-label="Browse artists">
      <div className="artistLandingMasthead">
        <span>DISCOVERY / ARTISTS</span>
        {providerControls}
      </div>
      <div className="artistLandingStage">
        <div className="artistLandingSearch">
          <Disc3 className="artistLandingEmblem" size={36} strokeWidth={1.25} aria-hidden="true" />
          <span className="exploreEyebrow">ARTIST SEARCH</span>
          <h2>Browse artists.</h2>
          <p>Search a name. Explore their releases.<br />See what’s already in your library.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) onSearch(query); }}>
            <Search size={22} aria-hidden="true" />
            <input
              aria-label="Find an artist"
              placeholder="Search for an artist or band…"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" disabled={!query.trim()}>
              Find artist <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </form>
          <span className="artistLandingSearchHint">{provider === "apple" ? "Fast Apple catalogue · More releases available in MusicBrainz" : "Expanded releases and editions · First visits can take longer"}</span>
        </div>
        <aside className="artistLandingLibrary" aria-label="Artists from your library">
          <span className="exploreEyebrow">FROM YOUR LIBRARY</span>
          <p>A starting point</p>
          {albums.length > 0 ? (
            <div className="artistLandingShortcuts">
              {albums.map((album) => (
                <button key={album.id} onClick={() => onSearch(album.artist)} title={"Find " + album.artist}>
                  <span className="artistLandingCover" aria-hidden="true">
                    {album.artist.slice(0, 1)}
                    <ArtworkImage
                      src={"http://127.0.0.1:47831/artwork/album/" + encodeURIComponent(album.id)}
                      alt=""
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  </span>
                  <span><strong>{album.artist}</strong><small>{album.album}</small></span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <p className="artistLandingLibraryEmpty">Search any artist to compare their catalogue with your collection.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
