import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Disc3, ArrowUpRight } from "lucide-react";
import type { AcquisitionJob, AlbumGroup, CatalogueArtist, CatalogueArtistProfile, CatalogueProvider, CatalogueSort } from "@music-os/core";
import { ArtworkImage } from "./ArtworkImage";
import { cachedExploreApi as api, artistSnapshot, readArtistResource } from "./artist-resource";
import { SimilarArtists } from "./SimilarArtists";
import { ArtistAlbumHighlights } from "./ArtistAlbumHighlights";
import { ArtistReleaseSection } from "./ArtistReleaseSection";
import { errorMessage, identityKey, useExploreJobs } from "./explore-api";
import "./artist-explorer.css";
import "./library-artist-page.css";

interface ArtistPageProps {
  artist: string;
  albums?: AlbumGroup[];
  allAlbums?: AlbumGroup[];
  initialCatalogueArtist?: CatalogueArtist;
  context?: "Library" | "Discovery";
  onBack: () => void;
  onOpenAlbum?: (id: string) => void;
}

/** Every stop retains its catalogue identity, so following a link never repeats name matching. */
export function LibraryArtistPage({ artist, albums = [], allAlbums, initialCatalogueArtist, context = "Library", onBack, onOpenAlbum }: ArtistPageProps) {
  const [trail, setTrail] = useState<Array<{ name: string; catalogue?: CatalogueArtist }>>([{ name: artist, catalogue: initialCatalogueArtist?.requiresArtistMatch ? undefined : initialCatalogueArtist }]);
  const [library, setLibrary] = useState<AlbumGroup[]>(allAlbums ?? albums);
  const [libraryError, setLibraryError] = useState("");
  const frame = useRef<HTMLDivElement>(null);
  const canonicalIdentities = useRef(new Map<string, string>());
  const resolvedIdentities = useRef(new Map<string, CatalogueArtist>());
  useEffect(() => {
    if (allAlbums) { setLibrary(allAlbums); return; }
    const request = new AbortController();
    const refresh = () => void api<{ albums: AlbumGroup[] }>("/library/albums", undefined, request.signal)
      .then((data) => { if (!request.signal.aborted) { setLibrary(data.albums); setLibraryError(""); } })
      .catch(() => { if (!request.signal.aborted) setLibraryError("Local collection information is temporarily unavailable."); });
    refresh(); window.addEventListener("music-library-changed", refresh);
    return () => { request.abort(); window.removeEventListener("music-library-changed", refresh); };
  }, [allAlbums]);
  const current = trail[trail.length - 1];
  const goTo = (index: number) => setTrail((old) => old.slice(0, index + 1));
  const openArtist = (next: CatalogueArtist) => setTrail((old) => {
    if (next.requiresArtistMatch) {
      const namedStops = old.map((stop, index) => ({ stop, index })).filter(({ stop }) => identityKey(stop.name) === identityKey(next.name));
      if (namedStops.length === 1) return old.slice(0, namedStops[0].index + 1);
    }
    const previous = old.findIndex((stop) => (canonicalIdentities.current.get(stop.catalogue?.id ?? stop.name) ?? resolvedIdentities.current.get(stop.catalogue?.id ?? stop.name)?.id ?? stop.catalogue?.id) === next.id);
    return previous >= 0 ? old.slice(0, previous + 1) : [...old, { name: next.name, catalogue: next.requiresArtistMatch ? undefined : next }];
  });
  useEffect(() => {
    const heading = frame.current?.querySelector<HTMLHeadingElement>("h1");
    if (heading) { heading.focus({ preventScroll: true }); frame.current?.scrollIntoView({ block: "start", behavior: "instant" }); }
  }, [current]);
  const navigation = <nav className="artistTrail" aria-label="Artist breadcrumbs">
    <button className="secondary artistTrailBack" onClick={() => trail.length > 1 ? goTo(trail.length - 2) : onBack()}><ArrowLeft size={14}/>{trail.length > 1 ? "Previous artist" : context === "Library" ? "Back to album" : "Back to artist search"}</button>
    <ol><li><button onClick={onBack}>{context}</button></li>{trail.map((stop, index) => <li key={`${stop.catalogue?.id ?? stop.name}-${index}`}><span aria-hidden="true">/</span>{index === trail.length - 1 ? <span aria-current="page">{stop.name}</span> : <button onClick={() => goTo(index)}>{stop.name}</button>}</li>)}</ol>
    {trail.length > 1 && <span className="artistTrailHint">{trail.length - 1} {trail.length === 2 ? "connection" : "connections"} explored</span>}
  </nav>;
  return <div className="artistJourney" ref={frame}>
    <ArtistProfileContent key={`${current.catalogue?.id ?? current.name}-${trail.length}`} artist={current.name}
      albums={library.filter((album) => identityKey(album.artist) === identityKey(current.name))}
      initialCatalogueArtist={resolvedIdentities.current.get(current.catalogue?.id ?? current.name) ?? current.catalogue} onBack={onBack} onOpenAlbum={onOpenAlbum}
      navigation={navigation} onOpenArtist={openArtist} libraryError={libraryError} onResolvedArtist={(resolved) => resolvedIdentities.current.set(current.catalogue?.id ?? current.name, resolved)} onCanonicalArtist={(id) => canonicalIdentities.current.set(current.catalogue?.id ?? current.name, id)}/>
  </div>;
}

function ArtistProfileContent({ artist, albums = [], initialCatalogueArtist, onOpenAlbum, navigation, onOpenArtist, libraryError, onResolvedArtist, onCanonicalArtist }: ArtistPageProps & {
  navigation: ReactNode; onOpenArtist: (artist: CatalogueArtist) => void; libraryError: string; onResolvedArtist: (artist: CatalogueArtist) => void; onCanonicalArtist: (id: string) => void;
}) {
  const [provider, setProvider] = useState<CatalogueProvider>(initialCatalogueArtist?.provider ?? (initialCatalogueArtist?.id.startsWith("apple:") ? "apple" : initialCatalogueArtist ? "musicbrainz" : "apple"));
  const [matches, setMatches] = useState<CatalogueArtist[]>([]);
  const [selected, setSelected] = useState<CatalogueArtist | null>(initialCatalogueArtist ?? null);
  const [choosing, setChoosing] = useState(false);
  const [searchRetry, setSearchRetry] = useState(0);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [profile, setProfile] = useState<CatalogueArtistProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileRetry, setProfileRetry] = useState(0);
  const [sort, setSort] = useState<CatalogueSort>("newest");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const { jobs, error: jobsError } = useExploreJobs<AcquisitionJob>("/explore/albums/jobs");
  const artistJobs = jobs.filter((job) => identityKey(job.artist) === identityKey(artist));
  useEffect(() => {
    if (initialCatalogueArtist && provider === (initialCatalogueArtist.provider ?? (initialCatalogueArtist.id.startsWith("apple:") ? "apple" : "musicbrainz"))) {
      setSelected(initialCatalogueArtist); setMatches([initialCatalogueArtist]); setSearching(false); setChoosing(false); return;
    }
    const request = new AbortController();
    setSearching(true); setSearchError(""); setSelected(null); setMatches([]);
    void api<{ artists: CatalogueArtist[] }>("/explore/artists?" + new URLSearchParams({ q: artist, provider }), undefined, request.signal)
      .then(({ artists }) => {
        if (request.signal.aborted) return;
        setMatches(artists);
        const exact = artists.filter((candidate) => identityKey(candidate.name) === identityKey(artist));
        setSelected(exact.length === 1 ? exact[0] : null);
        setChoosing(exact.length !== 1);
      }).catch((e) => { if (!request.signal.aborted) setSearchError(errorMessage(e)); })
      .finally(() => { if (!request.signal.aborted) setSearching(false); });
    return () => request.abort();
  }, [artist, provider, searchRetry, initialCatalogueArtist]);
  useEffect(() => {
    setProfile(null); setProfileError("");
    if (!selected) { setProfileBusy(false); return; }
    const request = new AbortController(); setProfileBusy(true);
    const path = "/explore/artist-profile?" + new URLSearchParams({ artistId: selected.id, artist });
    const cached = artistSnapshot<CatalogueArtistProfile>(path);
    if (cached) setProfile(cached);
    void readArtistResource<CatalogueArtistProfile>(path, (value) => { setProfile(value); setProfileBusy(Boolean(value.pending)); }, request.signal)
      .catch((e) => { if (!request.signal.aborted) setProfileError(errorMessage(e)); })
      .finally(() => { if (!request.signal.aborted) setProfileBusy(false); });
    return () => request.abort();
  }, [selected?.id, artist, profileRetry]);
  useEffect(() => { if (selected) onResolvedArtist(selected); }, [selected, onResolvedArtist]);
  const details = profile?.artist ?? selected;
  const portrait = profile?.imageUrl || details?.artworkUrl;
  return <article className="libraryArtistPage discographyPage" aria-label={`${artist} artist overview`}>
    {navigation}
    <header className="artistProfileHero">
      <div className="artistProfilePortrait"><Disc3 size={64} aria-hidden="true" />{portrait && <img key={portrait} src={portrait} alt={artist} onError={(e) => { e.currentTarget.style.display = "none"; }} />}</div>
      <div><span className="exploreEyebrow">ARTIST OVERVIEW</span><h1 tabIndex={-1}>{artist}</h1><p>{details?.description || "A closer look at the artist behind your collection."}</p><div className="exploreTags">{details?.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
    </header>
    <div className="artistProfileStats"><div><strong>{albums.length}</strong><span>albums in your library</span></div><div><strong>{albums.reduce((sum, album) => sum + album.fileCount, 0)}</strong><span>local tracks</span></div><div><strong>{details?.tags.length || "—"}</strong><span>genres & tags</span></div></div>
    <nav className="artistProfileJumpLinks" aria-label="Artist page sections">
      {selected && <button onClick={() => document.getElementById("artist-highlights")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Top albums</button>}
      <button onClick={() => document.getElementById("artist-story")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Artist story</button>
      {selected && <button onClick={() => document.getElementById("artist-connections")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Similar artists ↗</button>}
      <button onClick={() => document.getElementById("artist-discography")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Discography</button>
    </nav>
    {selected && <ArtistAlbumHighlights key={selected.id} artist={selected} libraryArtist={artist}/>}
    <section id="artist-story" className="artistProfileAbout"><h2>About the artist</h2>
      <p>{profile?.biography || (searching || profileBusy ? "Loading artist background…" : "A biography is not available from the linked sources for this artist.")}</p>
      {profile?.biographySourceUrl && <a href={profile.biographySourceUrl} target="_blank" rel="noreferrer">Biography source ↗</a>}
      {profile?.imageSourceUrl && <a className="artistProfilePhotoCredit" href={profile.imageSourceUrl} target="_blank" rel="noreferrer">Image source & credits ↗</a>}
      <dl>{details?.type && <div><dt>Artist type</dt><dd>{details.type}</dd></div>}{(profile?.area || details?.country) && <div><dt>From</dt><dd>{profile?.area || details?.country}</dd></div>}{profile?.beginArea && <div><dt>Origin</dt><dd>{profile.beginArea}</dd></div>}{details?.begin && <div><dt>{details.type === "Person" ? "Born" : "Formed"}</dt><dd>{details.begin}</dd></div>}{details?.end && <div><dt>{details.type === "Person" ? "Died" : "Disbanded"}</dt><dd>{details.end}</dd></div>}</dl>
      <div className="artistProfileSources">{profile?.links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label} <ArrowUpRight size={13}/></a>)}</div>
      {profile?.metadataNote && <p className="exploreFootnote">{profile.metadataNote}</p>}
      {profileError && <p role="alert" className="exploreError">Artist background unavailable. <button onClick={() => setProfileRetry((n) => n + 1)}>Retry background</button></p>}
    </section>
    {selected && <div id="artist-connections"><SimilarArtists key={selected.id} artist={selected} onOpenArtist={onOpenArtist} onCanonicalArtist={onCanonicalArtist} onFindCatalogueMatch={() => { setProvider("musicbrainz"); document.getElementById("artist-discography")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}/></div>}
    {libraryError && <p className="exploreFootnote">{libraryError}</p>}
    {albums.length > 0 && <section className="artistProfileCollection"><div className="artistProfileSectionHeading"><h2>In your collection</h2><span>{albums.length} albums</span></div><div className="artistProfileLocalAlbums">{[...albums].sort((a,b) => (b.year ?? "").localeCompare(a.year ?? "")).map((album) => <button key={album.id} onClick={() => { if (onOpenAlbum) onOpenAlbum(album.id); else { setQuery(album.album); document.getElementById("artist-discography")?.scrollIntoView({ behavior: "smooth", block: "start" }); } }}><span className="artistProfileLocalArt"><Disc3 size={24}/><ArtworkImage src={`http://127.0.0.1:47831/artwork/album/${encodeURIComponent(album.id)}`} alt=""/></span><strong>{album.album}</strong><small>{album.year || "Undated"} · {album.fileCount} tracks</small></button>)}</div></section>}
    <section id="artist-discography"><div className="artistProfileSectionHeading"><div><span className="exploreEyebrow">KEEP EXPLORING</span><h2>Discography</h2></div>{selected && <button className="secondary" onClick={() => setChoosing(!choosing)}>Change artist match</button>}</div>
      <div className="artistProfileControls"><select aria-label="Catalogue source" value={provider} onChange={(e) => setProvider(e.target.value as CatalogueProvider)}><option value="apple">Apple catalogue</option><option value="musicbrainz">MusicBrainz catalogue</option></select><select aria-label="Release order" value={sort} onChange={(e) => setSort(e.target.value as CatalogueSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">A–Z</option></select></div>
      {searching && <p role="status">Finding catalogue matches…</p>}{searchError && <p role="alert" className="exploreError">{searchError} <button onClick={() => setSearchRetry((n) => n + 1)}>Retry artist lookup</button></p>}
      {choosing && !searching && <div className="artistProfileMatches"><p>{matches.length ? "Choose the matching artist to explore their releases." : "No artist matches found. Try the other catalogue."}</p>{matches.map((match) => <button className="secondary" key={match.id} onClick={() => { setSelected(match); setChoosing(false); }}><strong>{match.name}</strong><span>{[match.description, match.country, match.type].filter(Boolean).join(" · ") || match.id}</span></button>)}</div>}
      {selected && <><div className="artistProfileControls"><input aria-label="Filter artist releases" placeholder="Find a release…" value={query} onChange={(e) => setQuery(e.target.value)}/><select aria-label="Library ownership" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All releases</option><option value="owned">In my library</option><option value="missing">Missing or incomplete</option></select></div><p className="exploreFootnote">Catalogue: {selected.name}. Open a release for its track list, ownership details, and download agent. Imports are filed under {artist}.</p></>}
      {selected && ([
        { section: "albums", label: "Albums" },
        { section: "eps-singles", label: "EPs & singles" },
        { section: "live-compilations", label: "Live & compilations" },
        { section: "other", label: "Other releases" },
      ] as const).map(({ section, label }) => <ArtistReleaseSection key={`${selected.id}-${section}`} section={section} label={label} artistId={selected.id} artist={artist} sort={sort} query={query} filter={filter}/>)}
      {selected && <p className="exploreFootnote">Each section loads independently. Filters apply to loaded releases. Library matching uses artist and album names; “In library” means completeness has not yet been verified. Regional catalogues may omit editions.</p>}
    </section>
    {artistJobs.length > 0 && <section className="artistProfileJobs"><h2>Download agents</h2>{artistJobs.slice(0, 8).map((job) => <div key={job.id}><strong>{job.album}</strong><span>{job.status} · {job.error || job.message}</span>{["queued", "running"].includes(job.status) && <progress max={100} value={job.progress} aria-label={`${job.album} download progress`}/>}</div>)}</section>}{jobsError && <p className="exploreError">Download status unavailable: {jobsError}</p>}
  </article>;
}
