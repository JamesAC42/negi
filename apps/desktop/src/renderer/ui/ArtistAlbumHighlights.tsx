import { useEffect, useState } from "react";
import type { AlbumHighlightsResponse, CatalogueArtist } from "@music-os/core";
import { artistSnapshot, readArtistResource } from "./artist-resource";
import { errorMessage } from "./explore-api";
import { ReleaseGrid } from "./ReleaseGrid";

export function ArtistAlbumHighlights({ artist, libraryArtist }: { artist: CatalogueArtist; libraryArtist: string }) {
  const path = "/explore/album-highlights?" + new URLSearchParams({ artistId: artist.id, artist: libraryArtist });
  const [data, setData] = useState<AlbumHighlightsResponse | null>(() => artistSnapshot(path));
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const request = new AbortController(); setError("");
    void readArtistResource<AlbumHighlightsResponse>(path, setData, request.signal)
      .catch((e) => { if (!request.signal.aborted) setError(errorMessage(e)); });
    return () => request.abort();
  }, [path, retry]);
  return <section className="artistAlbumHighlights" id="artist-highlights" aria-label="Artist top albums">
    <div className="artistProfileSectionHeading"><div><span className="exploreEyebrow">FIND YOUR STARTING POINT</span><h2>Community favorites</h2></div><a href={`https://rateyourmusic.com/search?searchtype=a&searchterm=${encodeURIComponent(artist.name)}`} target="_blank" rel="noreferrer">Explore ratings on RYM ↗</a></div>
    <p>Albums ranked by MusicBrainz community score, with at least 3 ratings. Popularity and critical acclaim can differ.</p>
    {data?.albums.length ? <ReleaseGrid albums={data.albums} artist={libraryArtist} artistId={data.resolvedArtistId || artist.id}/> : <div className="artistHighlightsStatus">
      {error ? <p role="alert">Album ratings could not be loaded. <button className="secondary" onClick={() => setRetry((value) => value + 1)}>Retry ratings</button></p>
        : !data || data.pending ? <p role="status">Finding rated albums in the background. You can browse releases below right away.</p>
        : <p>No albums with enough community ratings are available yet. Browse the discography or explore RYM.</p>}
    </div>}
    {data?.sourceUrl && <a className="artistHighlightsSource" href={data.sourceUrl} target="_blank" rel="noreferrer">MusicBrainz ratings ↗</a>}
    {data?.note && <p className="exploreFootnote">{data.note}</p>}
  </section>;
}
