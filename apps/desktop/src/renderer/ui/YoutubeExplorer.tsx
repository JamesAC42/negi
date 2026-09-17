import { useEffect, useState } from "react";
import { ArrowUpRight, Check, X, Inbox, Clapperboard as Youtube } from "lucide-react";
import type { LibraryRoot, VideoJob, VideoResult } from "@music-os/core";
import { exploreApi as api, errorMessage, libraryChanged, useExploreJobs } from "./explore-api";
import { YoutubeBrowser, type YoutubeNavigationRequest } from "./YoutubeBrowser";
import "./discovery-workspace.css";
const isActive = (job: VideoJob) => ["queued", "running"].includes(job.status);
const stateLabel = { queued: "Queued", running: "Downloading", review: "Ready to review", succeeded: "Imported", failed: "Needs attention", cancelled: "Cancelled" };
export function YoutubeExplorer({ active = true, request }: { active?: boolean; request?: YoutubeNavigationRequest }) {
  const [inboxFilter, setInboxFilter] = useState("all");
  const [error, setError] = useState("");
  const { jobs, error: jobsError } = useExploreJobs<VideoJob>("/explore/youtube/jobs", active);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  async function download(video: VideoResult) {
    setPending(video.id); setError("");
    try {
      await api("/explore/youtube/download", { url: video.url });
      setNotice("Download queued. Review the metadata here when the audio is ready.");
      setInboxFilter("all"); window.dispatchEvent(new Event("explore-jobs-changed")); return true;
    } catch (e) { setError(errorMessage(e)); return false; }
    finally { setPending(null); }
  }
  async function action(id: string, kind: string) {
    try { await api("/explore/youtube/" + kind, { id }); setError(""); window.dispatchEvent(new Event("explore-jobs-changed")); }
    catch (e) { setError(errorMessage(e)); }
  }
  const inboxFilters = [
    { id: "all", label: "All audio", test: (_: VideoJob) => true },
    { id: "review", label: "Ready to review", test: (j: VideoJob) => j.status === "review" },
    { id: "active", label: "Downloading", test: isActive },
    { id: "history", label: "History", test: (j: VideoJob) => ["succeeded", "failed", "cancelled"].includes(j.status) },
  ];
  const rank = (j: VideoJob) => j.status === "review" ? 0 : isActive(j) ? 1 : j.status === "failed" ? 2 : 3;
  const shown = [...jobs].filter(inboxFilters.find((f) => f.id === inboxFilter)!.test).sort((a,b) => rank(a)-rank(b));
  return <YoutubeBrowser active={active} request={request} jobs={jobs} pending={pending} onDownload={download} error={error || jobsError} inbox={
      <section
        className="exploreVideoInbox youtubeInbox"

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
            <button className="secondary" onClick={() => window.dispatchEvent(new Event("youtube-browse-home"))}>
              Find a recording <ArrowUpRight size={14} />
            </button>
          </div>
        )}
      </section>

  } />;
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
