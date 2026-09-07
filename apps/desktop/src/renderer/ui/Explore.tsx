import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Disc3,
  Bird,
  History,
  Sparkles,
  Plus,
  Minus,
  Clapperboard as Youtube,
} from "lucide-react";
import type {
  AcquisitionJob,
  AlbumGroup,
  IncompleteAlbumsResponse,
} from "@music-os/core";
import {
  exploreApi as api,
  errorMessage,
  identityKey,
  useExploreJobs,
} from "./explore-api";
import { ArtistExplorer } from "./ArtistExplorer";
import { YoutubeExplorer } from "./YoutubeExplorer";
import "./explore.css";
import "./discovery-workspace.css";
export { ArtistExplorer };
export function DiscoveryModes({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState("artists");
  const [visited, setVisited] = useState(["artists"]);
  const { jobs, error } = useExploreJobs<AcquisitionJob>(
    "/explore/albums/jobs",
  );
  const active = jobs.filter((j) =>
    ["queued", "running"].includes(j.status),
  ).length;
  const changeMode = (next: string) => {
    setMode(next);
    setVisited((old) => (old.includes(next) ? old : [...old, next]));
  };
  return (
    <div className="exploreWorkspace">
      <header className="exploreModeBar">
        <h2>Discovery</h2>
        <nav className="discoverySourceNav" aria-label="Discovery sections">
          <div className="segmentedControl">
            {[
              { id: "artists", label: "Artists", icon: Disc3 },
              { id: "soulseek", label: "Soulseek", icon: Bird },
              { id: "youtube", label: "YouTube", icon: Youtube },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-current={mode === id ? "page" : undefined}
                className={mode === id ? "active" : ""}
                onClick={() => changeMode(id)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          <button
            className={
              "discoveryActivityLink" + (mode === "activity" ? " active" : "")
            }
            aria-current={mode === "activity" ? "page" : undefined}
            onClick={() => changeMode("activity")}
          >
            <History size={15} /> Album activity{" "}
            {active > 0 && <span className="discoveryCount">{active}</span>}
          </button>
        </nav>
      </header>
      <div className="discoveryModeContent">
        <div
          className="discoveryModePane soulseekModePane"
          hidden={mode !== "soulseek"}
        >
          {children}
        </div>
        {visited.includes("artists") && (
          <div className="discoveryModePane artistsModePane" hidden={mode !== "artists"}>
            <ArtistExplorer />
          </div>
        )}
        {visited.includes("youtube") && (
          <div className="discoveryModePane youtubeModePane" hidden={mode !== "youtube"}>
            <YoutubeExplorer />
          </div>
        )}
        {mode === "activity" && (
          <div className="discoveryModePane">
            <AlbumActivity jobs={jobs} error={error} />
          </div>
        )}
      </div>
    </div>
  );
}
function AlbumActivity({
  jobs,
  error,
}: {
  jobs: AcquisitionJob[];
  error: string;
}) {
  const [filter, setFilter] = useState("all");
  const [actionError, setActionError] = useState("");
  const filters = [
    { id: "all", label: "All requests", test: (_: AcquisitionJob) => true },
    {
      id: "active",
      label: "In progress",
      test: (j: AcquisitionJob) => ["queued", "running"].includes(j.status),
    },
    {
      id: "attention",
      label: "Needs attention",
      test: (j: AcquisitionJob) => j.status === "failed",
    },
    {
      id: "complete",
      label: "Imported",
      test: (j: AcquisitionJob) => j.status === "succeeded",
    },
  ];
  const shown = jobs.filter(filters.find((f) => f.id === filter)!.test);
  async function action(id: string, kind: string) {
    try {
      await api("/explore/albums/" + kind, { id });
      setActionError("");
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }
  return (
    <section className="albumActivityPage">
      <div className="discoverySectionHeading">
        <span className="exploreEyebrow">ALBUM AGENT</span>
        <h2>Album activity</h2>
        <p>
          Follow your album requests, retry a search, or revisit completed
          imports.
        </p>
      </div>
      <div className="activityFilters" aria-label="Filter album requests">
        {filters.map((f) => (
          <button
            className={filter === f.id ? "active" : ""}
            aria-pressed={filter === f.id}
            key={f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span>{jobs.filter(f.test).length}</span>
          </button>
        ))}
      </div>
      {(error || actionError) && (
        <p role="alert" className="exploreError">
          {error || actionError}
        </p>
      )}
      <div className="albumActivityList">
        {shown.map((j) => (
          <article className="exploreJob" key={j.id}>
            <div className="exploreJobTop">
              <div>
                <h3>{j.album}</h3>
                <small>{j.artist}</small>
              </div>
              <span className={"exploreBadge " + j.status}>
                {j.status === "succeeded" ? "Imported" : j.status}
              </span>
            </div>
            <p role="status">{j.error || j.message}</p>
            <div className="activityJobFooter">
              <time>{new Date(j.createdAt).toLocaleString()}</time>
              {["queued", "running"].includes(j.status) ? (
                <>
                  <progress
                    max={1}
                    value={j.progress}
                    aria-label={"Progress for " + j.album}
                  />
                  <button
                    className="secondary"
                    onClick={() => void action(j.id, "cancel")}
                  >
                    Stop request
                  </button>
                </>
              ) : ["failed", "cancelled"].includes(j.status) ? (
                <button
                  className="secondary"
                  onClick={() => void action(j.id, "retry")}
                >
                  Retry request
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {!shown.length && !error && (
        <div className="discoveryEmpty">
          <History size={28} />
          <h3>
            {jobs.length ? "No requests in this view" : "No album requests yet"}
          </h3>
          <p>
            Find an album in Artists or complete one from your library. Its
            progress will appear here.
          </p>
        </div>
      )}
    </section>
  );
}
export function AlbumJobs({
  artist,
  album,
  onTerminalChange,
}: {
  artist?: string;
  album?: string;
  onTerminalChange?: () => void;
}) {
  const { jobs, error } = useExploreJobs<AcquisitionJob>(
    "/explore/albums/jobs",
  );
  const [actionError, setActionError] = useState("");
  const shown = jobs
    .filter(
      (j) =>
        (!artist || identityKey(j.artist) === identityKey(artist)) &&
        (!album || identityKey(j.album) === identityKey(album)),
    )
    .slice(0, album ? undefined : 6);
  const terminalVersion = shown.filter((job) => ["succeeded", "failed", "cancelled"].includes(job.status))
    .map((job) => job.id + ":" + job.status).sort().join("|");
  useEffect(() => {
    if (terminalVersion) onTerminalChange?.();
  }, [terminalVersion, onTerminalChange]);
  async function action(id: string, action: string) {
    try {
      await api("/explore/albums/" + action, { id });
      setActionError("");
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }
  if (!shown.length && (album || !error)) return null;
  const content = (
    <section className="exploreJobs" aria-label="Album agent activity">
      {!album && <span className="exploreEyebrow">ALBUM AGENT</span>}
      {(error || actionError) && (
        <p role="alert" className="exploreError">
          {error || actionError}
        </p>
      )}
      {shown.map((j) => (
        <div className="exploreJob" key={j.id}>
          <div className="exploreJobTop">
            <strong>{j.album}</strong>
            <span className={"exploreBadge " + j.status}>
              {j.status === "succeeded" ? "Imported" : j.status}
            </span>
          </div>
          <small>{j.artist}</small>
          <p role="status">{j.error || j.message}</p>
          {["running", "queued"].includes(j.status) ? (
            <>
              <progress max={1} value={j.progress} />
              <button
                className="secondary"
                onClick={() => void action(j.id, "cancel")}
              >
                Stop request
              </button>
            </>
          ) : ["failed", "cancelled"].includes(j.status) ? (
            <button
              className="secondary"
              onClick={() => void action(j.id, "retry")}
            >
              Retry request
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
  if (!album) return content;
  return (
    <details className="albumAgentHistory" key={artist + "/" + album}>
      <summary>
        <span>Album agent history</span>
        <Plus className="albumAgentExpand" size={15} aria-hidden="true" />
        <Minus className="albumAgentCollapse" size={15} aria-hidden="true" />
      </summary>
      {content}
    </details>
  );
}
export function AlbumCompletion({
  album,
  compact = false,
}: {
  album: AlbumGroup;
  compact?: boolean;
}) {
  const [incomplete, setIncomplete] = useState<
    IncompleteAlbumsResponse["albums"][number] | null
  >(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [completionVersion, setCompletionVersion] = useState(0);
  const refreshCompletion = useCallback(() => setCompletionVersion((version) => version + 1), []);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setIncomplete(null);
    setNote("");
    void api<{ album: IncompleteAlbumsResponse["albums"][number] | null }>(
      "/explore/albums/completeness?albumId=" + encodeURIComponent(album.id),
      undefined, controller.signal,
    )
      .then((r) => {
        if (live) setIncomplete(r.album);
      })
      .catch((e) => {
        if (live) setNote(errorMessage(e));
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [album.id, album.fileCount, completionVersion]);
  async function acquire() {
    setBusy(true);
    try {
      await api("/explore/albums/acquire", {
        artist: album.artist,
        album: album.album,
        albumId: album.id,
        ...(incomplete?.artistId && incomplete.releaseGroupId ? {
          artistId: incomplete.artistId,
          releaseGroupId: incomplete.releaseGroupId,
        } : {}),
      });
      window.dispatchEvent(new Event("explore-jobs-changed"));
      setNote(
        "The agent is finding the missing tracks. Import will happen automatically.",
      );
    } catch (e) {
      setNote(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {incomplete && (
        <div className={"exploreCompletion" + (compact ? " compact" : "")}>
          <span className="exploreEyebrow">{incomplete.source === "catalogue" ? "FINISH THE RECORD" : "CHECK THE RECORD"}</span>
          <strong>
            {incomplete.source !== "catalogue" && "Track tags suggest "}
            {incomplete.presentTracks} / {incomplete.expectedTracks} tracks
          </strong>
          {incomplete.source === "catalogue" && incomplete.missingTracks ? (
            <ul className="exploreMissingTracks" aria-label="Missing tracks">
              {incomplete.missingTracks.map((track) => (
                <li key={track.disc + ":" + track.number}>
                  Disc {track.disc}, track {track.number}: {track.title}
                </li>
              ))}
            </ul>
          ) : (
            <>
              {incomplete.missingTrackPositions?.length ? (
                <ul className="exploreMissingTracks" aria-label="Track positions suggested by tags">
                  {incomplete.missingTrackPositions.map((track) => (
                    <li key={track.disc + ":" + track.number}>Disc {track.disc}, track {track.number}</li>
                  ))}
                </ul>
              ) : null}
              <p>Track tags suggest {incomplete.expectedTracks - incomplete.presentTracks} missing tracks. Check the official track list before finding sources.</p>
            </>
          )}
          {incomplete.source === "catalogue" && (
            <p>{incomplete.expectedTracks - incomplete.presentTracks} tracks missing from this edition. Find a high-quality source and complete this album automatically.</p>
          )}
          <button disabled={busy} onClick={() => void acquire()}>
            <Sparkles size={15} />
            {busy ? "Dispatching…" : incomplete.source === "catalogue" ? "Complete album" : "Check album"}
          </button>
        </div>
      )}
      {note && (
        <p role="status" className="exploreNote">
          {note}
        </p>
      )}
      <AlbumJobs artist={album.artist} album={album.album} onTerminalChange={refreshCompletion} />
    </>
  );
}
