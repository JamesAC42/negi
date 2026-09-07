import { getArtworkObjectUrl } from "../artwork-requests";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  Disc3,
  LoaderCircle,
  X,
} from "lucide-react";
import type { CatalogueAlbum, CatalogueRelease } from "@music-os/core";
import { cachedExploreApi as api } from "./artist-resource";
import { errorMessage } from "./explore-api";

const labels = {
  missing: "Not in library",
  partial: "Partially owned",
  complete: "Complete",
  unverified: "In library",
};
const duration = (ms: number | null) =>
  ms === null
    ? "—"
    : Math.floor(ms / 60000) +
      ":" +
      String(Math.floor(ms / 1000) % 60).padStart(2, "0");
export function ReleaseGrid({
  albums,
  artist,
  artistId,
}: {
  albums: CatalogueAlbum[];
  artist: string;
  artistId: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [columns, setColumns] = useState(1);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!grid.current) return;
    const observer = new ResizeObserver(() => {
      if (grid.current)
        setColumns(
          getComputedStyle(grid.current).gridTemplateColumns.split(" ").length,
        );
    });
    observer.observe(grid.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={grid} className="exploreAlbumGrid discographyReleases">
      {albums.map((album, index) => (
        <ReleaseCard
          key={album.id}
          album={album}
          artist={artist}
          artistId={artistId}
          eagerArtwork={index < 6}
          order={index * 2}
          panelOrder={(Math.floor(index / columns) + 1) * columns * 2 - 1}
          open={expanded === album.id}
          onToggle={() => setExpanded(expanded === album.id ? null : album.id)}
        />
      ))}
    </div>
  );
}
function Cover({
  album,
  eager = false,
}: {
  album: CatalogueAlbum;
  eager?: boolean;
}) {
  const remote = album.artworkUrl || (album.id.startsWith("apple:")
    ? null
    : "http://127.0.0.1:47831/explore/cover?id=" + encodeURIComponent(album.id));
  const local = album.libraryAlbumId
    ? "http://127.0.0.1:47831/artwork/album/" +
      encodeURIComponent(album.libraryAlbumId)
    : null;
  const [src, setSrc] = useState(local || remote);
  const [status, setStatus] = useState("loading");
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(eager);
  const frame = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (visible) return;
    if (eager || !frame.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px" });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [eager, visible]);
  useEffect(() => {
    setDisplaySrc(null);
    if (!visible) return;
    if (!src) { setStatus("missing"); return; }
    const controller = new AbortController();
    setStatus("loading");
    void getArtworkObjectUrl(src, eager, controller.signal).then((url) => {
      if (!controller.signal.aborted) setDisplaySrc(url);
    }).catch(() => {
      if (controller.signal.aborted) return;
      if (remote && src !== remote) setSrc(remote);
      else setStatus("missing");
    });
    return () => controller.abort();
  }, [src, remote, eager, visible]);
  useEffect(() => {
    setSrc(local || remote);
    setStatus("loading");
  }, [local, remote]);
  return (
    <span ref={frame} className={"releaseArtwork " + status}>
      <Disc3 size={40} aria-hidden="true" />
      {status !== "missing" && displaySrc && (
        <img
          src={displaySrc}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setStatus("ready")}
          onError={() => {
            if (remote && src !== remote) setSrc(remote);
            else setStatus("missing");
          }}
        />
      )}
      {status === "missing" && <small>No cover available</small>}
    </span>
  );
}
function ReleaseCard({
  album,
  artist,
  artistId,
  eagerArtwork,
  order,
  panelOrder,
  open,
  onToggle,
}: {
  album: CatalogueAlbum;
  artist: string;
  artistId: string;
  eagerArtwork: boolean;
  order: number;
  panelOrder: number;
  open: boolean;
  onToggle: () => void;
}) {
  const [release, setRelease] = useState<CatalogueRelease | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [actionError, setActionError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = "release-details-" + album.id;
  const discs = release ? new Set(release.tracks.map((t) => t.disc)).size : 0;
  useEffect(() => {
    setRelease(null);
    setSent(false);
  }, [album.ownedTracks, album.libraryStatus]);
  useEffect(() => {
    if (!open || release) return;
    let live = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api<CatalogueRelease>(
      "/explore/release?" +
        new URLSearchParams({
          id: album.id,
          artist,
          ...(album.libraryAlbumId ? { albumId: album.libraryAlbumId } : {}),
        }),
      undefined, controller.signal,
    )
      .then((value) => {
        if (live) setRelease(value);
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [open, release, retry, album.id, album.libraryAlbumId, artist]);
  async function acquire() {
    if (release?.trackListingComplete === false) return;
    setSending(true);
    setActionError("");
    try {
      await api("/explore/albums/acquire", {
        artist,
        album: album.title,
        artistId,
        releaseGroupId: album.id,
        albumId: album.libraryAlbumId ?? undefined,
      });
      setSent(true);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }
  const partialListing = release?.trackListingComplete === false;
  const state = partialListing ? "unverified" : release?.libraryStatus ?? album.libraryStatus;
  const stateLabel = partialListing ? "Partial track listing" : labels[state];
  const owned = release?.ownedTracks ?? album.ownedTracks;
  const total = release?.tracks.length;
  const missing = release && !partialListing ? release.tracks.length - release.ownedTracks : null;
  const totalDuration =
    release?.tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0) ?? 0;
  const incompleteDuration = release?.tracks.some((t) => t.durationMs === null);
  const close = () => {
    onToggle();
    trigger.current?.focus();
  };
  const actionLabel = partialListing
    ? "Full track list needed"
    : sent
    ? "Agent dispatched"
    : state === "complete"
      ? "In your library"
      : sending
        ? "Dispatching…"
        : state === "partial"
          ? "Find missing tracks"
          : "Find & import album";
  return (
    <Fragment>
      <article
        className={"exploreRelease releaseTile" + (open ? " selected" : "")}
        style={{ order }}
      >
        <button
          className="releaseCoverButton"
          aria-label={"Inspect " + album.title}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={onToggle}
        >
          <Cover album={album} eager={eagerArtwork} />
          <span className="releaseYear">
            {album.date?.slice(0, 4) || "Undated"}
          </span>
        </button>
        <div className="exploreReleaseBody">
          <span className={"exploreBadge " + state}>
            {state === "complete" && <Check size={12} />} {stateLabel}
          </span>
          <h3 title={album.title}>{album.title}</h3>
          {album.rating != null && <p className="releaseCommunityRating" aria-label={`${album.rating.toFixed(1)} out of 5 from ${album.votes ?? 0} MusicBrainz ratings`}>★ {album.rating.toFixed(1)} <span>/ 5 · {album.votes ?? 0} ratings</span></p>}
          <p
            className="releaseTileMeta"
            title={[album.type, ...album.secondaryTypes].join(" · ")}
          >
            {[album.type, ...album.secondaryTypes].join(" · ")}
          </p>
          <div className="releaseTileFeedback releaseTileOwned">
            {actionError && !open ? (
              <p className="exploreError" role="alert" title={actionError}>{actionError}</p>
            ) : sent && !open ? (
              <p className="exploreNote" role="status">Agent dispatched</p>
            ) : (
              <p>{total !== undefined
                ? owned + " of " + total + (partialListing ? " listed tracks owned" : " tracks owned")
                : owned
                  ? owned + " tracks in library"
                  : "Ready to discover"}</p>
            )}
          </div>
          {album.sourceUrl && album.id.startsWith("apple:") && (
            <a className="releaseAppleLink" href={album.sourceUrl} target="_blank" rel="noreferrer" aria-label={"View " + album.title + " on Apple Music"}>Apple Music <ArrowUpRight size={12} aria-hidden="true" /></a>
          )}
          <div className="exploreReleaseActions">
            <button
              ref={trigger}
              className="secondary"
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              onClick={onToggle}
            >
              {open ? "Close details" : "Explore album"}{" "}
              <ChevronDown size={13} className={open ? "rotated" : ""} />
            </button>
            <button
              title={actionLabel}
              aria-label={"Find and import " + album.title}
              disabled={sending || sent || state === "complete" || partialListing}
              onClick={() => void acquire()}
            >
              {sent ? <Check size={15} /> : <ArrowDownToLine size={15} />}
            </button>
          </div>

        </div>
      </article>
      {open && (
        <section
          id={panelId}
          aria-label={album.title + " details"}
          className="releasePanel"
          style={{ order: panelOrder }}
        >
          <div className="releasePanelHeading">
            <div className="releasePanelIdentity">
              <div className="releasePanelCover" aria-hidden="true">
                <Cover album={album} eager />
              </div>
              <div className="releasePanelTitle">
                <span className="exploreEyebrow">ALBUM DETAILS</span>
                <h3>{album.title}</h3>
                <p>
                  {artist} ·{" "}
                  {[album.type, ...album.secondaryTypes, album.date]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
            <button
              className="secondary releasePanelClose"
              aria-label="Close album details"
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          <div className="releasePanelLayout">
            <aside className="releaseOverview">
              <span className={"exploreBadge " + state}>{stateLabel}</span>
              <div className="releaseOwnership">
                <strong>
                  {owned}
                  <span> / {total ?? "—"}</span>
                </strong>
                <span>{partialListing ? "listed tracks in your library" : "tracks in your library"}</span>
              </div>
              {release && !partialListing && (
                <>
                  <progress
                    max={total}
                    value={owned}
                    aria-label="Album ownership"
                  />
                  <p>
                    {missing === 0
                      ? "You own all tracks in this edition."
                      : missing + " tracks to complete this edition."}
                  </p>
                </>
              )}
              <dl className="releaseStats">
                <div>
                  <dt>{partialListing ? "Listed duration" : "Duration"}</dt>
                  <dd>
                    {totalDuration
                      ? duration(totalDuration) +
                        (incompleteDuration ? " +" : "")
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{partialListing ? "Listed discs" : "Discs"}</dt>
                  <dd>{release ? discs : "—"}</dd>
                </div>
                {!album.id.startsWith("apple:") && <div>
                  <dt>Community rating</dt>
                  <dd>
                    {release?.rating != null ? (
                      <>
                        {release.rating.toFixed(1)} <span>/ 5</span>
                      </>
                    ) : (
                      "Not rated"
                    )}
                  </dd>
                  <small>
                    {release ? release.votes + " ratings" : "Loading…"}
                  </small>
                </div>}
              </dl>
              <button
                className="releaseAcquire"
                disabled={sending || sent || state === "complete" || loading || partialListing}
                onClick={() => void acquire()}
              >
                {sent || state === "complete" ? (
                  <Check size={15} />
                ) : (
                  <ArrowDownToLine size={15} />
                )}{" "}
                {actionLabel}
              </button>
              <p className="releaseImportNote">
                {partialListing ? "A full track list is needed to download the complete album." : <>Import as <strong>{artist}</strong></>}
              </p>
              {sent && (
                <p role="status" className="exploreNote">
                  The agent will find and import the audio automatically.
                </p>
              )}
              {actionError && (
                <p role="alert" className="exploreError">
                  {actionError}
                </p>
              )}
              {release && (
                <a
                  className="releaseEdition"
                  href={release.sourceUrl || album.sourceUrl || (album.id.startsWith("apple:") ? "https://music.apple.com" : "https://musicbrainz.org/release/" + release.releaseId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {album.id.startsWith("apple:") ? "View on Apple Music" : "Edition"} · {release.date || "Date unknown"}{" "}
                  <ArrowUpRight size={13} />
                </a>
              )}
            </aside>
            <div className="releaseTrackArea" aria-busy={loading}>
              <div className="releaseTrackHeading">
                <h4>Track list</h4>
                {release && <span>{total} {partialListing ? "tracks returned" : "tracks"}</span>}
              </div>
              {loading && !release && (
                <div className="releaseTrackLoading" role="status">
                  <LoaderCircle size={17} /> Loading track list and album
                  details…
                </div>
              )}
              {error && (
                <div className="exploreError" role="alert">
                  <p>{error}</p>
                  <button
                    className="secondary"
                    onClick={() => setRetry((v) => v + 1)}
                  >
                    Retry details
                  </button>
                </div>
              )}
              {partialListing && (
                <div className="releaseListingNotice" role="status">
                  <strong>{release.expectedTrackCount != null
                    ? (album.id.startsWith("apple:") ? "Apple" : "The catalogue") + " returned " + total
                      + (release.tracks.length > release.expectedTrackCount
                        ? " tracks; the album lists " + release.expectedTrackCount + "."
                        : " of " + release.expectedTrackCount + " tracks")
                    : "Partial track listing"}</strong>
                  <p>You can browse the available tracks. Album ownership cannot be confirmed from this listing.</p>
                </div>
              )}
              {release && release.tracks.length === 0 && (
                <p className="releaseListingNotice" role="status">No tracks returned.</p>
              )}
              {release && (
                <ol className="releaseTracks">
                  {release.tracks.map((t) => (
                    <li key={t.disc + "-" + t.number}>
                      <span className="releaseTrackNumber">
                        {new Set(release.tracks.map((track) => track.disc))
                          .size > 1
                          ? t.disc + "."
                          : ""}
                        {String(t.number).padStart(2, "0")}
                      </span>
                      <span className="releaseTrackTitle">{t.title}</span>
                      <span
                        className={
                          "releaseTrackStatus " + (t.owned ? "owned" : "")
                        }
                      >
                        {t.owned ? (
                          <>
                            <Check size={12} /> Owned
                          </>
                        ) : t.owned === false ? (
                          "Missing"
                        ) : (
                          "Unverified"
                        )}
                      </span>
                      <time>{duration(t.durationMs)}</time>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </section>
      )}
    </Fragment>
  );
}
