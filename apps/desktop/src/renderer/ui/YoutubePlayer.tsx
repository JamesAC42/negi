import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUp, ArrowDown, GripVertical, Minimize, Check, Clock, ListVideo, LoaderCircle, Play, Pause, Headphones, Video, Volume2, Maximize, Search, X } from "lucide-react";
import type { VideoResult } from "@music-os/core";
import { exploreApi, errorMessage } from "./explore-api";
import { readYoutubeList, writeYoutubeList, useYoutubePlayback, youtubePlayback } from "./youtube-playback";
import "./youtube-player.css";
import { YoutubeCopyLink } from "./YoutubeCopyLink";

const time = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
export function YoutubePlayer() {
  const state = useYoutubePlayback();
  const [fullscreen, setFullscreen] = useState(false);
  const draggedQueueIndex = useRef<number | null>(null);
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  function reorderQueue(from: number, to: number) {
    if (to < 0 || to >= state.queue.length) return;
    const focused = document.activeElement;
    const row = dialog.current?.querySelectorAll(".ytPersistentQueue li")[from];
    const buttons = row ? Array.from(row.querySelectorAll("button")) : [];
    const focusedIndex = buttons.indexOf(focused as HTMLButtonElement);
    youtubePlayback.moveQueue(from, to);
    if (focusedIndex >= 0) requestAnimationFrame(() => dialog.current?.querySelectorAll(".ytPersistentQueue li")[to]?.querySelectorAll<HTMLButtonElement>("button")[focusedIndex]?.focus({ preventScroll: true }));
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await dialog.current?.querySelector<HTMLElement>(".ytPersistentMain")?.requestFullscreen(); }
    catch { setNotice("Fullscreen is unavailable in this window."); }
  }
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [saved, setSaved] = useState(() => readYoutubeList("saved"));
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState("");
  const [downloaded, setDownloaded] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setSaved(readYoutubeList("saved"));
    window.addEventListener("youtube-lists-changed", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("youtube-lists-changed", sync); window.removeEventListener("storage", sync); };
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (state.modalOpen && !element.open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal(); closeButton.current?.focus({ preventScroll: true });
    } else if (!state.modalOpen && element.open) {
      element.close(); previousFocus.current?.focus({ preventScroll: true });
    }
  }, [state.modalOpen]);
  useEffect(() => {
    if (state.confirmClose) confirmButton.current?.focus({ preventScroll: true });
    else if (state.modalOpen) closeButton.current?.focus({ preventScroll: true });
  }, [state.confirmClose]);
  useEffect(() => { setNotice(""); }, [state.video?.id]);
  const video = state.video;
  function save(v: VideoResult) {
    const next = saved.some(item => item.id === v.id) ? saved.filter(item => item.id !== v.id) : [v, ...saved].slice(0, 100);
    setSaved(next);
    if (!writeYoutubeList("saved", next)) setNotice("Browser storage is unavailable. Your list will last for this session only.");
  }
  async function download(v: VideoResult) {
    setDownloading(true); setNotice("");
    try {
      await exploreApi("/explore/youtube/download", { url: v.url });
      setDownloaded(previous => [...previous, v.id]);
      setNotice("Added to the audio inbox. Review its metadata before importing.");
      window.dispatchEvent(new Event("explore-jobs-changed"));
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setDownloading(false); }
  }
  return <dialog ref={dialog} className="ytPersistentDialog" aria-label={video ? "YouTube player: " + video.title : "YouTube player"}
    onCancel={event => { event.preventDefault(); if (state.confirmClose) youtubePlayback.cancelClose(); else youtubePlayback.requestClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !state.confirmClose) youtubePlayback.requestClose(); }}>
    <div className="ytPersistentHeader"><span><ListVideo size={16} /> YOUTUBE PLAYER</span><button ref={closeButton} aria-label="Close video" onClick={() => youtubePlayback.requestClose()}><X size={19} /></button></div>
    <div className="ytPersistentLayout" inert={state.confirmClose || undefined}>
      <section className="ytPersistentMain">
        <div className="ytModeToolbar"><div className="ytModeSwitch" role="group" aria-label="Playback mode" data-mode={state.mode}><span aria-hidden="true" /><button aria-pressed={state.mode === "audio"} onClick={() => youtubePlayback.setMode("audio")}><Headphones size={16} />Audio</button><button aria-pressed={state.mode === "video"} onClick={() => youtubePlayback.setMode("video")}><Video size={16} />Video</button></div><span>{state.mode === "audio" ? "Audio stream" : "Video player"}</span></div>
        <div className="ytPersistentScreen" data-mode={state.mode}>
          <video ref={youtubePlayback.attach} playsInline preload="metadata" poster={video?.thumbnail || undefined} aria-label={video?.title || "YouTube video"}
            onPlay={youtubePlayback.onPlay} onPlaying={youtubePlayback.onPlaying} onPause={youtubePlayback.onPause}
            onTimeUpdate={youtubePlayback.onTime} onDurationChange={youtubePlayback.onDuration} onVolumeChange={youtubePlayback.onVolume}
            onEnded={() => youtubePlayback.onEnded()} onError={youtubePlayback.onError} />
          <div className="ytAudioArtwork" aria-hidden="true">{video?.thumbnail && <img src={video.thumbnail} alt="" />}<span><Headphones size={18} />Audio stream</span></div>
          {state.videoUnavailable && <div className="ytVideoUnavailable" role="status"><Video size={26} /><strong>Video unavailable</strong><span>Switch to Audio to keep listening.</span></div>}
          {state.loading && <div className="ytPersistentLoading" role="status"><LoaderCircle size={24} className="youtubeSpinner" /><span>Opening video…</span></div>}
        </div>
        <div className="ytMediaControls" aria-label="Player controls">
          <input className="ytMediaSeek" aria-label="Seek player" type="range" min={0} max={state.durationMs || 1} step={1000} value={Math.min(state.positionMs, state.durationMs || 1)} disabled={!state.durationMs || state.loading} onChange={event => youtubePlayback.seek(Number(event.target.value))} />
          <div><button className="ytMediaPlay" aria-label={state.playing ? "Pause player" : "Play player"} disabled={(state.loading && !state.playing) || state.videoUnavailable} onClick={() => youtubePlayback.toggle()}>{state.playing ? <Pause size={20} /> : <Play size={20} />}</button><span className="ytMediaTime">{time(state.positionMs)} <span>/ {time(state.durationMs)}</span></span><label><Volume2 size={18} /><input aria-label="Player volume" type="range" min={0} max={100} value={state.volumePercent} onChange={event => youtubePlayback.setVolume(Number(event.target.value))} /></label>{state.mode === "video" && <button aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen video"} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}</button>}</div>
        </div>
        {video && <div className="ytPersistentInfo">
          <div className="ytPersistentEyebrow">{state.mode === "audio" ? "NOW LISTENING" : "NOW WATCHING"}{video.liveStatus === "is_live" && " · LIVE"}</div>
          <h2>{video.title}</h2><p className="ytPersistentChannel">{video.channel}</p>
          <div className="ytPersistentFacts">{video.viewCount != null && <span>{compact(video.viewCount)} views</span>}{video.uploadDate && <span>{video.approximateDate ? "Around " : "Uploaded "}{video.uploadDate}</span>}<span>Video ID: {video.id}</span></div>
          {state.error && !state.videoUnavailable && <div className="ytPersistentError" role="alert"><span>{state.error}</span><button onClick={() => youtubePlayback.retry()}>Retry playback</button></div>}
          <div className="ytPersistentActions">
            <button aria-pressed={saved.some(v => v.id === video.id)} onClick={() => save(video)}>{saved.some(v => v.id === video.id) ? <Check size={15} /> : <Clock size={15} />}{saved.some(v => v.id === video.id) ? "Saved for later" : "Watch later"}</button>
            <button disabled={downloading || downloaded.includes(video.id) || video.liveStatus === "is_live" || video.liveStatus === "is_upcoming"} onClick={() => void download(video)}>{downloading ? <LoaderCircle size={15} className="youtubeSpinner" /> : <ArrowDownToLine size={15} />}{downloaded.includes(video.id) ? "In audio inbox" : "Download audio"}</button>
            <button onClick={() => window.dispatchEvent(new CustomEvent("youtube-player-explore", { detail: video }))}><Search size={15} />Explore similar</button>
            <YoutubeCopyLink url={video.url} />
          </div>
          {notice && <p className="ytPersistentNotice" role="status">{notice}</p>}
          {video.description && <p className="ytPersistentDescription">{video.description}</p>}
        </div>}
      </section>
      <aside className="ytPersistentQueue" aria-label="YouTube queue">
        <div className="ytPersistentQueueHeading"><ListVideo size={17} /><h3>Play queue</h3><span>{Math.max(0, state.queue.length - state.queueIndex - 1)} up next</span></div>
        <p className="ytPersistentQueueHint">Add videos with Play next or Add to queue.</p>
        <ol>{state.queue.map((item, index) => <li key={index} className={index === state.queueIndex ? "is-current" : ""} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (draggedQueueIndex.current !== null) reorderQueue(draggedQueueIndex.current, index); draggedQueueIndex.current = null; }}>
          <button className="ytQueueGrip" draggable aria-label={"Reorder " + item.title} title="Drag to reorder; use arrow keys to move" onDragStart={event => { draggedQueueIndex.current = index; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index)); }} onDragEnd={() => { draggedQueueIndex.current = null; }} onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); reorderQueue(index, index + (event.key === "ArrowUp" ? -1 : 1)); } }}><GripVertical size={14} /></button>
          <button className="ytPersistentQueueItem" onClick={() => index === state.queueIndex ? youtubePlayback.reopen() : youtubePlayback.playIndex(index)} aria-current={index === state.queueIndex ? "true" : undefined}>
            <span className="ytPersistentQueueThumb">{item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <Play size={17} />}{index === state.queueIndex && <span><Play size={12} fill="currentColor" /></span>}</span>
            <span><strong>{item.title}</strong><small>{index === state.queueIndex ? "Now playing · " : ""}{item.channel}</small></span>
          </button>
          <div className="ytQueueRowActions"><button aria-label={"Move " + item.title + " up"} disabled={index === 0} onClick={() => reorderQueue(index, index - 1)}><ArrowUp size={13} /></button><button aria-label={"Move " + item.title + " down"} disabled={index === state.queue.length - 1} onClick={() => reorderQueue(index, index + 1)}><ArrowDown size={13} /></button><button className="ytPersistentQueueRemove" aria-label={"Remove " + item.title + " from queue"} onClick={() => youtubePlayback.removeQueue(index)}><X size={14} /></button></div>
        </li>)}</ol>

      </aside>
    </div>
    {state.confirmClose && <div className="ytBackgroundPrompt" role="alertdialog" aria-modal="true" aria-labelledby="yt-background-title" onKeyDown={event => {
      if (event.key !== "Tab") return;
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[1]?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons[1]) { event.preventDefault(); buttons[0]?.focus(); }
    }}><div><h3 id="yt-background-title">Keep listening in background?</h3><p>Your video will continue through the Now Playing controls.</p><div><button ref={confirmButton} onClick={() => youtubePlayback.cancelClose()}>Cancel</button><button onClick={() => youtubePlayback.keepListening()}>Yes</button></div></div></div>}
  </dialog>;
}
