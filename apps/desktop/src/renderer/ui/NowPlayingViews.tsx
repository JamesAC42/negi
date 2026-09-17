import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { AudioLines, ListMusic, Music2, RefreshCw, TextQuote } from "lucide-react";
import type { LyricsResponse, VisualizerFrameResponse } from "@music-os/core";
import { useLyrics } from "../lyrics-resource";
import { activeLyricIndex, lyricsPositionMs, plainLyricsScrollTop } from "../lyrics-state";
import { RecordPlayer } from "./RecordPlayer";
import "./transitions-tokens.css";
import "./lyrics-transitions.css";
import "./lyrics.css";

type View = "record" | "lyrics";
type Props = Omit<ComponentProps<typeof RecordPlayer>, "visible" | "controlsTarget"> & {
  frameRef: MutableRefObject<VisualizerFrameResponse | null>;
  getFrameAgeMs(frame: VisualizerFrameResponse, now: number): number;
  onSeek(ratio: number): Promise<void>;
  playbackBusy: boolean;
};
const preferenceKey = "music-os:now-playing-view:v1";
function preferredView(): View {
  try { return localStorage.getItem(preferenceKey) === "lyrics" ? "lyrics" : "record"; }
  catch { return "record"; }
}

export function NowPlayingViews(props: Props) {
  const [view, setView] = useState<View>(preferredView);
  const id = useId();
  const [recordControls, setRecordControls] = useState<HTMLDivElement | null>(null);
  const [lyricsControls, setLyricsControls] = useState<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const recordPanel = useRef<HTMLDivElement>(null);
  const lyricsPanel = useRef<HTMLDivElement>(null);
  const file = props.currentFile;
  const key = JSON.stringify([file?.id, file?.displayTags.title, file?.displayTags.artist,
    file?.displayTags.albumartist, file?.displayTags.album, file?.durationMs]);
  const resource = useLyrics(key, file?.id ?? null, view === "lyrics");

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    // Both dimensions matter: a wide, short card must leave room for its controls.
    const fit = () => element.style.setProperty("--record-fit-width",
      `${Math.min(element.clientWidth, element.clientHeight * 720 / 466)}px`);
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(element);
    return () => resize.disconnect();
  }, []);

  useLayoutEffect(() => {
    recordPanel.current?.toggleAttribute("inert", view !== "record");
    lyricsPanel.current?.toggleAttribute("inert", view !== "lyrics");
  }, [view]);

  function select(next: View) {
    setView(next);
    try { localStorage.setItem(preferenceKey, next); } catch { /* Optional preference. */ }
  }

  return <div className="nowPlayingViews" data-view={view}>
    <div className="nowPlayingViewStage" ref={stage}>
      <div className="nowPlayingRecordPane t-panel-slide" data-open={view === "record"} ref={recordPanel}
        role="region" id={`${id}-record`} aria-label="Record player" aria-hidden={view !== "record"}>
        <RecordPlayer {...props} visible={view === "record"} controlsTarget={recordControls} />
      </div>
      <div className="nowPlayingLyricsPane t-panel-slide" data-open={view === "lyrics"} ref={lyricsPanel}
        role="region" id={`${id}-lyrics`} aria-label="Lyrics view" aria-hidden={view !== "lyrics"}>
        <LyricsPanel key={key} {...props} resource={resource} visible={view === "lyrics"} footerTarget={lyricsControls} />
      </div>
    </div>
    <div className="nowPlayingViewControls" role="group" aria-label="Now playing view controls">
      <div className="nowPlayingModeControls">
        <div className="nowPlayingRecordControls" ref={setRecordControls} hidden={view !== "record"} />
        <div className="nowPlayingLyricsControls" ref={setLyricsControls} hidden={view !== "lyrics"} />
      </div>
      <button className="nowPlayingViewToggle" type="button" aria-pressed={view === "lyrics"}
        aria-controls={`${id}-record ${id}-lyrics`} title={view === "lyrics" ? "Show record player" : "Show lyrics"}
        onClick={() => select(view === "record" ? "lyrics" : "record")}>
        <TextQuote aria-hidden="true" /> Lyrics
      </button>
    </div>
  </div>;
}

function LyricsPanel({ currentFile, playback, frameRef, getFrameAgeMs, onSeek, playbackBusy, resource, visible, footerTarget }: Props & {
  resource: ReturnType<typeof useLyrics>; visible: boolean; footerTarget: HTMLElement | null;
}) {
  const { result, failed, failure, retry, retrySeconds } = resource;
  const [following, setFollowing] = useState(true);
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const [seekError, setSeekError] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const clock = useRef({ playback, observedAt: performance.now() });
  const reducedMotion = useRef(matchMedia("(prefers-reduced-motion: reduce)").matches);
  const lastScroll = useRef<{ index: number; result: LyricsResponse | null }>({ index: -1, result: null });
  useLayoutEffect(() => { clock.current = { playback, observedAt: performance.now() }; }, [playback]);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => { reducedMotion.current = query.matches; };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    if (!visible || (result?.status !== "synced" && result?.status !== "plain")) return;
    if (result.status === "plain" && (!following || !playback.durationMs)) return;
    let frameId = 0;
    const viewport = scroller.current;
    let scrollHeight = 0;
    let clientHeight = 0;
    let lastScrollTop = NaN;
    const measure = () => {
      if (!viewport || result.status !== "plain") return;
      scrollHeight = viewport.scrollHeight;
      clientHeight = viewport.clientHeight;
      lastScrollTop = NaN;
    };
    measure();
    const sync = (now: number) => {
      const snapshot = clock.current;
      const frame = frameRef.current;
      const position = lyricsPositionMs(snapshot.playback, now - snapshot.observedAt, frame,
        frame ? getFrameAgeMs(frame, now) : Infinity);
      if (result.status === "synced") {
        const next = activeLyricIndex(result.lines, position);
        // Dispatch only at a lyric boundary, rather than entering React every frame.
        if (next !== activeRef.current) {
          activeRef.current = next;
          setActive(next);
        }
      } else if (viewport) {
        const top = plainLyricsScrollTop(position, snapshot.playback.durationMs, scrollHeight, clientHeight);
        if (top !== lastScrollTop) {
          viewport.scrollTop = top;
          lastScrollTop = top;
        }
      }
    };
    const update = (now: number) => {
      sync(now);
      if (clock.current.playback.status === "playing") frameId = requestAnimationFrame(update);
    };
    update(performance.now());
    // Wrapping and font changes alter the distance an untimed song must travel.
    // Keep layout reads outside the animation loop; resize also covers font reflow.
    const resize = new ResizeObserver(() => { measure(); sync(performance.now()); });
    if (result.status === "plain" && scroller.current) {
      resize.observe(scroller.current);
      if (scroller.current.firstElementChild) resize.observe(scroller.current.firstElementChild);
    }
    return () => { cancelAnimationFrame(frameId); resize.disconnect(); };
  }, [result, visible, following, playback.status, playback.positionMs, playback.durationMs, frameRef, getFrameAgeMs]);

  useLayoutEffect(() => {
    if (!visible || !following || result?.status !== "synced") return;
    const viewport = scroller.current;
    const line = viewport?.querySelector<HTMLElement>(`[data-line="${Math.max(0, active)}"]`);
    if (!viewport || !line) return;
    const previous = lastScroll.current;
    const instant = reducedMotion.current || previous.result !== result || Math.abs(active - previous.index) > 2;
    const center = (smooth: boolean) => {
      // Give the first and last lines the same centered resting position.
      viewport.style.setProperty("--lyrics-focus-space", `${viewport.clientHeight / 2}px`);
      viewport.scrollTo({
        top: line.offsetTop - viewport.clientHeight / 2 + line.offsetHeight / 2,
        behavior: smooth ? "smooth" : "instant",
      });
    };
    center(!instant);
    lastScroll.current = { index: active, result };
    const resize = new ResizeObserver(() => center(false));
    resize.observe(viewport);
    return () => resize.disconnect();
  }, [active, following, result, visible]);

  const synced = result?.status === "synced";
  const waiting = synced && active < 0;
  const empty = !currentFile || failed || !result || result.status === "not_found" || result.status === "instrumental";
  const heading = !currentFile ? "Your words, in time" : failure === "backend_outdated" ? "Lyrics needs a restart" : failed ? "Couldn't load lyrics" : !result ? "Finding lyrics" :
    result.status === "instrumental" ? "Just the music" : "No lyrics found";
  const detail = !currentFile ? "Play a song to see its lyrics here." : failure === "backend_outdated" ? "Restart Music OS to finish loading lyrics support, then try again." :
    failure === "file_missing" ? "This song is no longer available in your library." :
    failure === "provider" ? "The lyrics provider is temporarily unavailable. Try again shortly." :
    failed ? "Couldn't reach the music service. Try again shortly." : !result ?
    "Looking for the words to this song…" : result.status === "instrumental" ? "This track is instrumental." :
    "No lyrics are available for this song yet.";
  const loading = !!currentFile && !failed && !result;
  async function seek(timeMs: number) {
    if (playbackBusy || !playback.durationMs) return;
    setSeekError(false);
    try { await onSeek(Math.max(0, Math.min(1, timeMs / playback.durationMs))); setFollowing(true); }
    catch { setSeekError(true); }
  }
  const estimated = result?.status === "plain" && !!playback.durationMs;
  function browse() { if (synced || estimated) setFollowing(false); }

  return <div className="lyricsPanel" data-state={loading ? "loading" : result?.status ?? "empty"}>
    {empty ? <div className="lyricsEmpty" role="status">
      <span className={`lyricsEmptyIcon${loading ? " is-loading" : ""}`} aria-hidden="true">
        {loading ? <AudioLines /> : result?.status === "instrumental" ? <Music2 /> : <TextQuote />}
      </span>
      <strong>{heading}</strong><p>{detail}</p>
      {failed ? <button className="lyricsRetry" type="button" disabled={retrySeconds > 0} onClick={retry}>
        <RefreshCw aria-hidden="true" />{retrySeconds > 0 ? `Try again in ${retrySeconds}s` : "Try again"}
      </button> : null}
    </div> : <>
      <div className="lyricsEyebrow"><span className={synced ? "lyricsSyncDot" : "lyricsPlainDot"} />
        {synced ? waiting ? "Waiting for vocals" : "Live lyrics" : "Lyrics"}
      </div>
      <div className={`lyricsScroll${synced ? " is-synced" : " is-plain"}`} ref={scroller} tabIndex={0}
        role="region" aria-label={synced ? "Song lyrics. Select a line to seek." : "Song lyrics"}
        onWheel={browse} onTouchStart={browse} onPointerDown={browse}
        onFocusCapture={event => { if ((event.target as HTMLElement).closest(".lyricsLine")) browse(); }}
        onKeyDown={event => { if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) browse(); }}>
        {synced ? <div className="lyricsLines">
          {result.lines.map((line, index) => <button key={`${line.timeMs}-${index}`} type="button" data-line={index}
            className={`lyricsLine${index === active ? " is-current" : ""}${index < active ? " is-past" : ""}`}
            aria-current={index === active ? "true" : undefined} disabled={playbackBusy || !playback.durationMs || playback.status === "stopped"}
            onClick={() => void seek(line.timeMs)} title="Play from this line">
            {line.text || <span className="lyricsBreak"><Music2 aria-hidden="true" /> Instrumental</span>}
          </button>)}
        </div> : <p className="lyricsPlainText">{result.plainLyrics}</p>}
      </div>
      {footerTarget ? createPortal(<div className="lyricsFooter">
        {!following && (synced || estimated) ? <button type="button" className="lyricsFollow" onClick={() => setFollowing(true)}>
          <ListMusic aria-hidden="true" />{synced ? "Back to current line" : "Resume scrolling"}
        </button> : <span title={estimated ? "No lyric timestamps. Scrolling follows the song's elapsed time." : undefined}>
          {synced ? "Synced" : estimated ? "Estimated scroll" : "Timing unavailable"}<i>·</i>LRCLIB
        </span>}
      </div>, footerTarget) : null}
      {seekError ? <span className="lyricsSeekError" role="status">Couldn't seek. Try again.</span> : null}
    </>}
  </div>;
}
