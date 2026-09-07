import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Search,
  X,
  Inbox,
  LoaderCircle,
  Clapperboard as Youtube,
} from "lucide-react";
import type { LibraryRoot, VideoJob, VideoResult } from "@music-os/core";
import {
  exploreApi as api,
  errorMessage,
  libraryChanged,
  useExploreJobs,
} from "./explore-api";
import "./discovery-workspace.css";

const isActive = (job: VideoJob) => ["queued", "running"].includes(job.status);
const stateLabel = {
  queued: "Queued",
  running: "Downloading",
  review: "Ready to review",
  succeeded: "Imported",
  failed: "Needs attention",
  cancelled: "Cancelled",
};
const views = (n: number) =>
  new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
function published(video: VideoResult) {
  if (!video.uploadDate) return "Date unavailable";
  const date = new Date(video.uploadDate + "T12:00:00");
  return (
    (video.approximateDate ? "≈ " : "") +
    date.toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
      ...(video.approximateDate ? {} : { day: "numeric" as const }),
    })
  );
}
export function YoutubeExplorer() {
  const [tab, setTab] = useState("search");
  const [inboxFilter, setInboxFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [loadingQuery, setLoadingQuery] = useState("");
  const [results, setResults] = useState<VideoResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [health, setHealth] = useState<{
    available: boolean;
    message: string;
    version: string | null;
  } | null>(null);
  const { jobs, error: jobsError } = useExploreJobs<VideoJob>(
    "/explore/youtube/jobs",
  );
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const reviewCount = jobs.filter((j) => j.status === "review").length;
  const activeCount = jobs.filter(isActive).length;
  useEffect(() => {
    void api<{ available: boolean; message: string; version: string | null }>(
      "/explore/youtube/health",
    )
      .then(setHealth)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  async function search() {
    if (busy) return;
    const term = query.trim();
    setBusy(true);
    setError("");
    setLoadingQuery(term);
    setNotice("");
    try {
      const data = await api<{ results: VideoResult[] }>(
        "/explore/youtube/search?q=" + encodeURIComponent(term),
      );
      setResults(data.results);
      setSearchedQuery(term);
      setSearched(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function download(video: VideoResult) {
    setPending(video.id);
    setError("");
    try {
      await api("/explore/youtube/download", { url: video.url });
      setNotice(
        "Download queued. You can review the metadata here when the audio is ready.",
      );
      setInboxFilter("all");
      setTab("inbox");
      window.dispatchEvent(new Event("explore-jobs-changed"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  }
  async function action(id: string, kind: string) {
    try {
      await api("/explore/youtube/" + kind, { id });
      setError("");
      window.dispatchEvent(new Event("explore-jobs-changed"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const inboxFilters = [
    { id: "all", label: "All audio", test: (_: VideoJob) => true },
    {
      id: "review",
      label: "Ready to review",
      test: (j: VideoJob) => j.status === "review",
    },
    { id: "active", label: "Downloading", test: isActive },
    {
      id: "history",
      label: "History",
      test: (j: VideoJob) =>
        ["succeeded", "failed", "cancelled"].includes(j.status),
    },
  ];
  const rank = (j: VideoJob) =>
    j.status === "review" ? 0 : isActive(j) ? 1 : j.status === "failed" ? 2 : 3;
  const shown = [...jobs]
    .filter(inboxFilters.find((f) => f.id === inboxFilter)!.test)
    .sort((a, b) => rank(a) - rank(b));
  return (
    <section className="youtubeExplorer youtubeWorkspace">
      <header className="youtubeHeading">
        <div className="youtubeIdentity">
          <span className="youtubeIcon">
            <Youtube size={26} />
          </span>
          <div>
            <h2>YouTube audio downloads</h2>
            <p>
              Download the best available audio with yt-dlp.
            </p>
          </div>
        </div>
        <form
          className="youtubeSearchForm"
          onSubmit={(e) => {
            e.preventDefault();
            setTab("search");
            void search();
          }}
        >
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="YouTube search or video link"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search music or paste a YouTube link…"
          />
          <button
            disabled={busy || !query.trim() || health?.available === false}
          >
            {busy ? (
              <>
                <LoaderCircle size={14} className="youtubeSpinner" /> Searching…
              </>
            ) : (
              <>
                Find audio <ArrowUpRight size={14} />
              </>
            )}
          </button>
        </form>
      </header>
      <nav className="youtubeTabs" aria-label="YouTube sections">
        <button
          className={tab === "search" ? "active" : ""}
          aria-current={tab === "search" ? "page" : undefined}
          onClick={() => setTab("search")}
        >
          <Search size={16} /> Search
        </button>
        <button
          className={tab === "inbox" ? "active" : ""}
          aria-current={tab === "inbox" ? "page" : undefined}
          onClick={() => setTab("inbox")}
        >
          <Inbox size={16} /> Audio inbox{" "}
          <span className="discoveryCount">{reviewCount + activeCount}</span>
        </button>
        <span className="youtubeInboxHint">
          {reviewCount > 0
            ? reviewCount + " ready to review"
            : activeCount > 0
              ? activeCount + " downloading"
              : "Review metadata before importing"}
        </span>
      </nav>
      {health && !health.available && (
        <p role="alert" className="exploreError">
          {health.message}
        </p>
      )}
      {(error || jobsError) && (
        <p role="alert" className="exploreError">
          {error || jobsError}
        </p>
      )}
      <div className="youtubeSearchPage" hidden={tab !== "search"}>
        {busy ? (
          <div className="youtubeSearchLoading" role="status">
            <LoaderCircle size={18} className="youtubeSpinner" />
            <div>
              <strong>Searching YouTube…</strong>
              <p>
                Looking for “{loadingQuery}”. You can check your audio inbox
                while this loads.
              </p>
            </div>
          </div>
        ) : searched ? (
          <div className="youtubeResultsHeading">
            <h3>{results.length} recordings</h3>
            <span>Results for “{searchedQuery}”</span>
          </div>
        ) : (
          <div className="discoveryEmpty youtubeSearchEmpty">
            <Youtube size={32} />
            <h3>Search YouTube audio</h3>
            <p>
              Search by artist and title, or paste a video link to find its
              audio.
            </p>
            <span>Search → Download → Review & import</span>
          </div>
        )}
        {!busy && (
          <div className="exploreVideoGrid youtubeResults">
            {results.map((video, index) => {
              const queued = jobs.some(
                (j) =>
                  j.url === video.url &&
                  ["queued", "running", "review"].includes(j.status),
              );
              return (
                <article className="exploreVideo youtubeVideo" key={video.id}>
                  <a
                    className="exploreVideoArt"
                    href={video.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={"Watch " + video.title + " on YouTube"}
                  >
                    <Youtube size={32} aria-hidden="true" />
                    {video.thumbnail && (
                      <img
                        src={video.thumbnail}
                        alt=""
                        loading={index < 4 ? "eager" : "lazy"}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                    <span>
                      {video.liveStatus === "is_live"
                        ? "LIVE"
                        : video.duration != null
                          ? Math.floor(video.duration / 60) +
                            ":" +
                            String(Math.floor(video.duration % 60)).padStart(
                              2,
                              "0",
                            )
                          : "Audio"}
                    </span>
                  </a>
                  <div className="youtubeVideoBody">
                    <h3 title={video.title}>{video.title}</h3>
                    <p className="youtubeChannel" title={video.channel}>
                      {video.channel || "Unknown channel"}
                    </p>
                    <div className="youtubeVideoFacts">
                      <span
                        title={
                          video.viewCount != null
                            ? video.viewCount.toLocaleString() + " views"
                            : undefined
                        }
                      >
                        {video.viewCount != null
                          ? views(video.viewCount) + " views"
                          : "Views unavailable"}
                      </span>
                      <time
                        title={
                          video.approximateDate
                            ? "Approximate upload date from YouTube search"
                            : undefined
                        }
                      >
                        {published(video)}
                      </time>
                    </div>
                    <div className="youtubeVideoActions">
                      <button
                        disabled={
                          pending !== null ||
                          queued ||
                          video.liveStatus === "is_live" ||
                          video.liveStatus === "is_upcoming"
                        }
                        onClick={() => void download(video)}
                      >
                        {pending === video.id ? (
                          <LoaderCircle size={15} className="youtubeSpinner" />
                        ) : queued ? (
                          <Check size={15} />
                        ) : (
                          <ArrowDownToLine size={15} />
                        )}{" "}
                        {pending === video.id
                          ? "Queuing…"
                          : queued
                            ? "In audio inbox"
                            : "Download audio"}
                      </button>
                      <a
                        href={video.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={"Open " + video.title + " on YouTube"}
                        title="Watch on YouTube"
                      >
                        <ArrowUpRight size={17} />
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {searched && !results.length && !busy && (
          <div className="discoveryEmpty">
            <Search size={26} />
            <h3>No recordings found</h3>
            <p>Try an artist and song title, or paste a direct video link.</p>
          </div>
        )}
      </div>
      <section
        className="exploreVideoInbox youtubeInbox"
        hidden={tab !== "inbox"}
        aria-label="Audio inbox"
      >
        <div className="discoverySectionHeading">
          <h2>Audio inbox</h2>
          <p>
            Follow downloads and check artist, title, and album before
            importing.
          </p>
        </div>
        <div className="activityFilters" aria-label="Filter audio inbox">
          {inboxFilters.map((f) => (
            <button
              key={f.id}
              aria-pressed={inboxFilter === f.id}
              className={inboxFilter === f.id ? "active" : ""}
              onClick={() => setInboxFilter(f.id)}
            >
              {f.label}
              <span>{jobs.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        {notice && (
          <p className="youtubeNotice" role="status">
            {notice}
          </p>
        )}
        {shown.map((job) =>
          job.status === "review" ? (
            <VideoReview
              key={job.id}
              job={job}
              onDiscard={() => void action(job.id, "cancel")}
            />
          ) : (
            <article className="exploreJob youtubeInboxJob" key={job.id}>
              <div className="exploreJobTop">
                <div>
                  <h3>{job.title || "YouTube audio"}</h3>
                  <small>
                    {job.artist || new Date(job.createdAt).toLocaleString()}
                  </small>
                </div>
                <span className={"exploreBadge " + job.status}>
                  {stateLabel[job.status]}
                </span>
              </div>
              <p role="status">{job.error || job.message}</p>
              {isActive(job) && (
                <div className="youtubeDownloadProgress">
                  <progress
                    max={1}
                    value={
                      job.progress && job.progress > 0
                        ? job.progress
                        : undefined
                    }
                    aria-label={
                      "Download progress for " + (job.title || "audio")
                    }
                  />
                  <span>
                    {job.progress && job.progress > 0
                      ? Math.round(job.progress * 100) + "%"
                      : "Connecting…"}
                  </span>
                </div>
              )}
              <div className="youtubeJobActions">
                <a href={job.url} target="_blank" rel="noreferrer">
                  View source <ArrowUpRight size={13} />
                </a>
                {isActive(job) ? (
                  <button
                    className="secondary"
                    onClick={() => void action(job.id, "cancel")}
                  >
                    Cancel download
                  </button>
                ) : ["failed", "cancelled"].includes(job.status) ? (
                  <button
                    className="secondary"
                    onClick={() => void action(job.id, "retry")}
                  >
                    Retry download
                  </button>
                ) : null}
              </div>
            </article>
          ),
        )}
        {!shown.length && (
          <div className="discoveryEmpty">
            <Inbox size={30} />
            <h3>
              {jobs.length
                ? "Nothing in this view"
                : "Your audio inbox is empty"}
            </h3>
            <p>
              Download a recording from Search. Its progress and metadata review
              will appear here.
            </p>
            <button className="secondary" onClick={() => setTab("search")}>
              Find a recording <ArrowUpRight size={14} />
            </button>
          </div>
        )}
      </section>
      <footer className="youtubeWorkspaceFooter">
        <span><Check size={12} /> Best available audio</span>
        <span>Metadata review required before import</span>
      </footer>
    </section>
  );
}
function VideoReview({
  job,
  onDiscard,
}: {
  job: VideoJob;
  onDiscard: () => void;
}) {
  const [fields, setFields] = useState({
    artist: job.artist ?? "",
    title: job.title ?? "",
    album: job.album ?? "",
    year: job.year ?? "",
  });
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [root, setRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    void api<{ roots: LibraryRoot[] }>("/library/roots")
      .then((r) => {
        setRoots(r.roots);
        setRoot(r.roots[0]?.id ?? "");
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  async function approve() {
    setBusy(true);
    try {
      await api("/explore/youtube/import", {
        jobId: job.id,
        ...fields,
        libraryRootId: root,
      });
      setDone(true);
      libraryChanged();
      window.dispatchEvent(new Event("explore-jobs-changed"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <p className="exploreNote" role="status">
        Imported {fields.title} into your library.
      </p>
    );
  return (
    <form
      className="exploreReview"
      onSubmit={(e) => {
        e.preventDefault();
        void approve();
      }}
    >
      <div className="exploreJobTop">
        <div className="youtubeReviewIdentity">
          <div
            className="youtubeReviewArtwork"
            title="YouTube thumbnail · library artwork"
          >
            <Youtube size={24} aria-hidden="true" />
            <img
              src={
                "http://127.0.0.1:47831/explore/youtube/artwork?id=" +
                encodeURIComponent(job.id)
              }
              alt="YouTube thumbnail used as artwork"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </div>
          <div>
            <span className="exploreEyebrow">
              READY TO REVIEW / {job.codec ?? "AUDIO"}
            </span>
            <h3>{job.title}</h3>
            <small>
              YouTube thumbnail used as library artwork when available.
            </small>
          </div>
        </div>
        <button
          type="button"
          className="secondary"
          aria-label="Discard download"
          disabled={busy}
          onClick={onDiscard}
        >
          <X size={16} />
        </button>
      </div>
      <div className="exploreReviewFields">
        {(["artist", "title", "album", "year"] as const).map((field) => (
          <label key={field}>
            {field}
            <input
              required={field !== "year"}
              maxLength={field === "year" ? 4 : 500}
              pattern={field === "year" ? "[12][0-9]{3}" : undefined}
              value={fields[field]}
              onChange={(e) =>
                setFields({ ...fields, [field]: e.target.value })
              }
            />
          </label>
        ))}
      </div>
      <div className="exploreReviewBottom">
        <label>
          Library folder
          <select
            required
            value={root}
            onChange={(e) => setRoot(e.target.value)}
          >
            <option value="" disabled>
              Choose a folder
            </option>
            {roots.map((r) => (
              <option value={r.id} key={r.id}>
                {r.path}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy || !root}>
          <Check size={15} />
          {busy ? "Importing…" : "Import into library"}
        </button>
      </div>
      {!roots.length && (
        <p>Add a library folder in Settings to import this recording.</p>
      )}
      <small>
        Suggested metadata · edit any field before importing.{" "}
        <a href={job.url} target="_blank" rel="noreferrer">
          Check source ↗
        </a>
      </small>
      {error && (
        <p role="alert" className="exploreError">
          {error}
        </p>
      )}
    </form>
  );
}
