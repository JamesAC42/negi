import { useEffect, useRef, useState } from "react";
import type { CataloguePage, CatalogueSection, CatalogueSort } from "@music-os/core";
import { ReleaseGrid } from "./ReleaseGrid";
import { cachedExploreApi as api, artistSnapshot } from "./artist-resource";
import { errorMessage } from "./explore-api";

export function ArtistReleaseSection({ section, label, artistId, artist, sort, query, filter }: {
  section: CatalogueSection; label: string; artistId: string; artist: string;
  sort: CatalogueSort; query: string; filter: string;
}) {
  const releaseLabel = label === "EPs & singles" ? label : label.toLocaleLowerCase();
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState<CataloguePage | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  async function load(offset = 0) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const result = await api<CataloguePage>("/explore/catalogue?" + new URLSearchParams({ artistId, artist, sort, section, offset: String(offset) }), undefined, controller.signal);
      if (!controller.signal.aborted) setPage((old) => offset && old
        ? { ...result, albums: [...old.albums, ...result.albums.filter((album) => !old.albums.some((existing) => existing.id === album.id))] }
        : result);
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    if (!sectionRef.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "250px" });
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    setPage(artistSnapshot<CataloguePage>("/explore/catalogue?" + new URLSearchParams({ artistId, artist, sort, section, offset: "0" }))); void load();
    const refresh = () => void load();
    window.addEventListener("music-library-changed", refresh);
    return () => { request.current?.abort(); window.removeEventListener("music-library-changed", refresh); };
  }, [artistId, artist, sort, section, visible]);
  const albums = (page?.albums ?? []).filter((album) => album.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
    (filter === "all" || (filter === "owned" ? album.libraryStatus !== "missing" : ["missing", "partial"].includes(album.libraryStatus))));
  if (page?.total === 0 && !busy && !error) return null;
  return <section ref={sectionRef} className="artistProfileReleaseGroup" aria-label={label} aria-busy={busy}>
    <h3>{label} {page && <span>{page.total}</span>}</h3>
    <ReleaseGrid albums={albums} artist={artist} artistId={artistId}/>
    {!busy && page && !albums.length && <p className="exploreFootnote">No loaded {releaseLabel} match these filters.</p>}
    <div className="artistProfileSectionFooter">
      {error ? <div className="exploreError" role="alert">{error} <button className="secondary" onClick={() => void load(page?.nextOffset ?? 0)}>Retry {releaseLabel}</button></div>
        : page?.nextOffset != null ? <button className="secondary" disabled={busy} onClick={() => void load(page.nextOffset!)}>{busy ? "Loading…" : `Load more ${releaseLabel}`}</button>
        : busy ? <span role="status">Loading {releaseLabel}…</span> : null}
      {page && <span>{page.albums.length} of {page.total} loaded</span>}
    </div>
  </section>;
}
