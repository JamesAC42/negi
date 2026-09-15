import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { recordAlbumKey, RECORD_NEEDLE_DROP_MS, RECORD_PLAYBACK_START_MS, RECORD_RETURN_MS, type AlbumTransition, type LibraryFilesResponse,
  type PlaybackStateResponse, type RecordAlbum } from "@music-os/core";
import { getArtworkObjectUrl } from "../artwork-requests";
import { arc, clamp, createRecordAnimationClock, ease, easeIn, mix, phase, recordAlbumProgress, recordChangeLabel, recordChangeTiming as timing } from "../record-player-state";
import { TurntableScene } from "./turntable/TurntableScene";
import type { TurntableLayout } from "./turntable/choreography";
import "./record-player.css";

type File = LibraryFilesResponse["files"][number];
type Ceremony = { transition: AlbumTransition; preview: boolean; returnAt: number | null };
type Props = {
  visible?: boolean;
  controlsTarget?: HTMLElement | null;
  files: File[]; currentFile: File | null; playback: PlaybackStateResponse;
  artworkUrl(fileId: string): string;
  albumProgress: ReturnType<typeof recordAlbumProgress>;
  onPresence(clientId: string, active: boolean, reducedMotion: boolean): Promise<void>;
  onAction(id: string, action: "begin" | "complete" | "skip"): Promise<void>;
  onStop(): Promise<void>;
};
const turntableWidth = 720;
const turntableHeight = 466;
const preferenceKey = "music-os:record-ritual:v1";
const layoutPreferenceKey = "music-os:record-layout:v1";
const layouts: ReadonlyArray<{ id: TurntableLayout; label: string; description: string }> = [
  { id: "classic", label: "Classic", description: "The original listening room" },
  { id: "duet", label: "Side by side", description: "Equal space for record and sleeve" },
  { id: "gallery", label: "Gallery", description: "Artwork takes center stage" },
  { id: "float", label: "Floating", description: "A lighter, suspended arrangement" },
  { id: "stack", label: "Stacked", description: "Artwork above the instrument" },
  { id: "angle", label: "Angled", description: "A more dramatic perspective" },
];

function readLayoutPreference(): TurntableLayout {
  try {
    const saved = localStorage.getItem(layoutPreferenceKey);
    return layouts.find((layout) => layout.id === saved)?.id ?? "classic";
  } catch { return "classic"; }
}

export function RecordPlayer(props: Props): ReactElement {
  const { files, currentFile, playback, artworkUrl, albumProgress: progress, visible = true } = props;
  const anchorRef = useRef<HTMLDivElement>(null);
  const [clientId] = useState(() => crypto.randomUUID());
  const [enabled, setEnabled] = useState(() => { try { return localStorage.getItem(preferenceKey) !== "off"; } catch { return true; } });
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);
  const [layout, setLayout] = useState<TurntableLayout>(readLayoutPreference);
  const callbacks = useRef(props);
  callbacks.current = props;
  const album: RecordAlbum = { fileId: currentFile?.id ?? "", album: currentFile?.displayTags.album ?? "Your next record",
    artist: currentFile?.displayTags.albumartist || currentFile?.displayTags.artist || "Waiting on the platter" };

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReducedMotion(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);

  useEffect(() => {
    const report = () => { void callbacks.current.onPresence(clientId, enabled && visible && !document.hidden, reducedMotion).catch(() => undefined); };
    report();
    const timer = window.setInterval(report, 4_000);
    document.addEventListener("visibilitychange", report);
    window.addEventListener("pagehide", reportHidden);
    function reportHidden() { void callbacks.current.onPresence(clientId, false, reducedMotion).catch(() => undefined); }
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", report);
      window.removeEventListener("pagehide", reportHidden);
      reportHidden();
    };
  }, [clientId, enabled, reducedMotion, visible]);

  useEffect(() => {
    const transition = playback.albumTransition;
    if (transition) {
      setCeremony((current) => ({ transition, preview: false,
        returnAt: current?.transition.id === transition.id ? current.returnAt : null }));
    } else {
      setCeremony((current) => {
        if (!current || current.preview) return current;
        if (playback.status === "playing" && playback.currentFileId === current.transition.to.fileId) {
          return current.returnAt == null ? { ...current, returnAt: performance.now() } : current;
        }
        return null;
      });
    }
  }, [playback.albumTransition, playback.currentFileId, playback.status]);

  const nextAlbumFile = useMemo(() => {
    if (!currentFile) return null;
    const byId = new Map(files.map((file) => [file.id, file]));
    return playback.queue.slice((playback.queueIndex ?? -1) + 1).map((id) => byId.get(id))
      .find((file) => file && recordAlbumKey(file) !== recordAlbumKey(currentFile)) ?? null;
  }, [currentFile, files, playback.queue, playback.queueIndex]);
  const upcomingAlbum: RecordAlbum | undefined = nextAlbumFile ? {
    fileId: nextAlbumFile.id, album: nextAlbumFile.displayTags.album || "Next record",
    artist: nextAlbumFile.displayTags.albumartist || nextAlbumFile.displayTags.artist || "Unknown artist",
  } : undefined;
  const upcomingArtwork = nextAlbumFile ? artworkUrl(nextAlbumFile.id) : null;
  useEffect(() => {
    if (!upcomingArtwork) return;
    const controller = new AbortController();
    void getArtworkObjectUrl(upcomingArtwork, true, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [upcomingArtwork]);

  function preview(): void {
    const from = album;
    const upcoming = nextAlbumFile;
    const to = upcoming ? { fileId: upcoming.id, album: upcoming.displayTags.album || "Next record",
      artist: upcoming.displayTags.albumartist || upcoming.displayTags.artist || "Unknown artist" } : from;
    setCeremony({ transition: { id: crypto.randomUUID(), from, to, startedAt: Date.now(), paused: false, reducedMotion },
      preview: true, returnAt: null });
  }

  const controls = <div className="recordPlayerOptions" role="group" aria-label="Record player options">
      <RecordLayoutPicker layout={layout} disabled={!!ceremony} onChange={(nextLayout) => {
        setLayout(nextLayout);
        try { localStorage.setItem(layoutPreferenceKey, nextLayout); } catch { /* Optional preference. */ }
      }} />
      <button type="button" aria-pressed={enabled} title="Animate record changes between albums" onClick={() => {
        setEnabled(!enabled); try { localStorage.setItem(preferenceKey, enabled ? "off" : "on"); } catch { /* Optional preference. */ }
      }}>Album ritual <span>{enabled ? "On" : "Off"}</span></button>
      <button type="button" disabled={!currentFile || !!ceremony} onClick={preview} title="Preview the record change without changing playback">Preview <span aria-hidden="true">↗</span></button>
    </div>;

  return <><div className="recordPlayer" ref={anchorRef}>
    <div className={`recordPlayerObject${ceremony ? " is-away" : ""}`} style={{ aspectRatio: `${turntableWidth} / ${turntableHeight}` }}>
      <TurntableScene album={album} preloadAlbum={upcomingAlbum} artworkUrl={artworkUrl} playing={playback.status === "playing"}
        progress={progress.ratio} empty={!currentFile} layout={layout} reducedMotion={reducedMotion} suspended={!!ceremony || !visible} />
    </div>
  </div>
    {props.controlsTarget === undefined ? controls : props.controlsTarget ? createPortal(controls, props.controlsTarget) : null}
    {ceremony ? createPortal(<RecordCeremony key={ceremony.transition.id} ceremony={ceremony} anchorRef={anchorRef}
      artworkUrl={artworkUrl} progress={progress.ratio} layout={layout} onAction={(action) => callbacks.current.onAction(ceremony.transition.id, action)}
      onStop={() => callbacks.current.onStop()} onReturn={() => setCeremony((current) => current ? { ...current, returnAt: performance.now() } : null)}
      onDone={() => setCeremony(null)} />, document.body) : null}
  </>;
}

function RecordCeremony({ ceremony, anchorRef, artworkUrl, progress, layout, onAction, onStop, onReturn, onDone }: {
  ceremony: Ceremony; anchorRef: { current: HTMLDivElement | null }; artworkUrl: Props["artworkUrl"]; progress: number; layout: TurntableLayout;
  onAction(action: "begin" | "complete" | "skip"): Promise<void>; onStop(): Promise<void>; onReturn(): void; onDone(): void;
}): ReactElement {
  const { transition, preview, returnAt } = ceremony;
  const [{ now, elapsed }, setFrame] = useState(() => ({ now: performance.now(), elapsed: 0 }));
  const animationClock = useRef(createRecordAnimationClock());
  const animationRunning = useRef(false);
  animationRunning.current = (preview || transition.startedAt != null) && !transition.paused;
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onAction, onStop, onReturn, onDone });
  callbacks.current = { onAction, onStop, onReturn, onDone };
  const busy = useRef(false);
  const completed = useRef(false);
  const retryAfter = useRef(0);
  // startedAt acknowledges that the backend is holding playback. It is not a
  // renderer clock: IPC delay and Windows/WSL clock skew must not skip the entrance.
  const reduced = transition.reducedMotion;
  const exit = returnAt == null ? 0 : (reduced ? ease : easeIn)((now - returnAt) / (reduced ? 200 : RECORD_RETURN_MS));

  useEffect(() => {
    let frame = 0;
    const tick = (frameTime: number) => {
      setFrame({ now: frameTime, elapsed: animationClock.current(frameTime, animationRunning.current) });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); void skip(); }
      if (event.key === "Tab") {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        if (!buttons.length) return;
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if ((event.shiftKey && at <= 0) || (!event.shiftKey && (at < 0 || at === buttons.length - 1))) {
          event.preventDefault(); buttons[event.shiftKey ? buttons.length - 1 : 0].focus();
        }
      }
    };
    document.addEventListener("keydown", keys, true);
    return () => { document.removeEventListener("keydown", keys, true); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    if (preview || transition.startedAt != null || transition.paused) return;
    let disposed = false;
    const begin = () => { void callbacks.current.onAction("begin").catch((e: unknown) => {
      if (!disposed) setError(e instanceof Error ? e.message : "Could not start the record change");
    }); };
    begin();
    const retry = setInterval(begin, 1_500);
    return () => { disposed = true; clearInterval(retry); };
  }, [preview, transition.startedAt, transition.paused]);

  useEffect(() => {
    if (returnAt != null) {
      if (now - returnAt >= (reduced ? 200 : RECORD_RETURN_MS)) callbacks.current.onDone();
      return;
    }
    if (transition.paused || elapsed < (reduced ? 250 : RECORD_PLAYBACK_START_MS) || completed.current || busy.current || now < retryAfter.current) return;
    if (preview) { completed.current = true; callbacks.current.onReturn(); return; }
    busy.current = true;
    // An HTTP success can still be an early/no-op acknowledgement. Only the next
    // playback state confirms the handoff; retry briefly until that state arrives.
    retryAfter.current = now + 250;
    void callbacks.current.onAction("complete").catch((e: unknown) => {
      retryAfter.current = performance.now() + 1_500;
      setError(e instanceof Error ? e.message : "Could not start the next record");
    }).finally(() => { busy.current = false; });
  }, [elapsed, now, preview, reduced, returnAt, transition.paused]);

  async function skip(): Promise<void> {
    if (preview) { callbacks.current.onDone(); return; }
    try { await callbacks.current.onAction("skip"); } catch (e) { setError(e instanceof Error ? e.message : "Could not start playback"); }
  }

  const rect = anchorRef.current?.querySelector(".recordPlayerObject")?.getBoundingClientRect();
  const width = Math.min(window.innerWidth - 32, 780, Math.max(160, window.innerHeight - 235) * turntableWidth / turntableHeight);
  const height = width * turntableHeight / turntableWidth;
  const centerX = window.innerWidth / 2;
  const centerY = Math.max(height / 2 + 20, (window.innerHeight - 165) / 2);
  const enter = reduced ? 1 : phase(elapsed, 0, timing.centered);
  const weight = reduced ? 1 : enter * (1 - exit);
  const x = mix(rect ? rect.left + rect.width / 2 : centerX, centerX, weight);
  // Ease both ends of the flight: no overshoot or abrupt arc velocity at focus.
  const flight = reduced ? 0 : arc(enter) ** 2;
  const flightArc = flight * -24;
  const y = mix(rect ? rect.top + rect.height / 2 : centerY, centerY, weight) + flightArc;
  const scale = mix(rect ? rect.width / width : 1, 1, weight);
  const incoming = reduced || elapsed >= timing.swap;
  const displayed = incoming ? transition.to : transition.from;
  return <div className={`recordCeremony${reduced ? " is-reduced" : ""}`} role="dialog" aria-modal="true"
    aria-label={preview ? "Record change preview" : "Changing albums"} tabIndex={-1} ref={dialog}>
    <div className="recordCeremonyDim" style={{ opacity: reduced ? 1 - exit : clamp(weight) }} />
    <div className="recordCeremonyLight" style={{ opacity: reduced ? 1 - exit : clamp(weight) }} />
    <div className="recordCeremonyStage" style={{ width, height, left: centerX, top: centerY,
      transform: `translate3d(${x - centerX}px, ${y - centerY}px, 0) translate(-50%, -50%) scale(${scale}) rotate(${-2.5 * flight}deg)`, opacity: reduced ? 1 - exit : 1 }}>
      <TurntableScene album={displayed} preloadAlbum={incoming ? transition.from : transition.to} artworkUrl={artworkUrl}
        playing={!transition.paused && elapsed >= RECORD_NEEDLE_DROP_MS} layout={layout} reducedMotion={reduced}
        progress={incoming ? 0 : progress} elapsed={reduced ? RECORD_NEEDLE_DROP_MS : Math.min(elapsed, RECORD_NEEDLE_DROP_MS)} />
    </div>
    <div className="recordCeremonyCopy" style={{ top: centerY + height / 2 + 4, opacity: (reduced ? 1 : clamp(enter)) * (1 - exit) }}>
      <span className="recordCeremonyEyebrow">{preview ? "A LITTLE LISTENING RITUAL · PREVIEW" : "BETWEEN RECORDS"}</span>
      <h2>{transition.to.album}</h2><p>{transition.to.artist}</p>
      <span className="recordCeremonyStatus" role="status">{error || (transition.paused ? "Ready when you are" :
        returnAt ? "Enjoy the record" : reduced ? "Preparing your next album" : recordChangeLabel(elapsed))}</span>
      <div className="recordCeremonyControls">
        <button type="button" onClick={() => void skip()}>{preview ? "Close preview" : "Play now"}<kbd>Esc</kbd></button>
        {!preview ? <button type="button" onClick={() => void callbacks.current.onStop().catch(() => setError("Could not stop playback. Try again."))}>Stop</button> : null}
      </div>
    </div>
  </div>;
}

/** A portal keeps the picker clear of the listening card's scrolling boundaries. */
function RecordLayoutPicker({ layout, disabled, onChange }: {
  layout: TurntableLayout; disabled: boolean; onChange(layout: TurntableLayout): void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const selected = layouts.find((option) => option.id === layout)!;

  function close(restoreFocus: boolean): void {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const content = panel.current;
      if (!anchor || !content) return;
      const gutter = 12;
      const left = Math.max(gutter, Math.min(window.innerWidth - content.offsetWidth - gutter, anchor.right - content.offsetWidth));
      const below = anchor.bottom + 10;
      const top = below + content.offsetHeight <= window.innerHeight - gutter ? below : Math.max(gutter, anchor.top - content.offsetHeight - 10);
      setPosition({ left, top });
    };
    place();
    panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !panel.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", keys, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", keys, true);
    };
  }, [open]);

  return <>
    <button type="button" className="recordLayoutTrigger" ref={trigger} disabled={disabled} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? panelId : undefined} title="Choose your record player layout" onClick={() => setOpen(!open)}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="1.5" width="5" height="5" rx="1" /><rect x="9.5" y="1.5" width="5" height="5" rx="1" />
        <rect x="1.5" y="9.5" width="5" height="5" rx="1" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      </svg>
      Layout <span>{selected.label}</span>
    </button>
    {open ? createPortal(<div className="recordLayoutPanel" id={panelId} role="dialog" aria-label="Record player layout"
      ref={panel} style={position} onKeyDown={(event) => {
        const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 };
        const choices = [...(panel.current?.querySelectorAll<HTMLButtonElement>(".recordLayoutChoice") ?? [])];
        const current = choices.indexOf(document.activeElement as HTMLButtonElement);
        const step = steps[event.key];
        if (step == null && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        event.stopPropagation();
        const index = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (Math.max(0, current) + step + choices.length) % choices.length;
        choices[index]?.focus();
      }}>
      <div className="recordLayoutHeading"><span>MAKE ROOM FOR MUSIC</span><button type="button" aria-label="Close layout picker" onClick={() => close(true)}>×</button></div>
      <div className="recordLayoutGrid">
        {layouts.map((option) => <button key={option.id} type="button" className="recordLayoutChoice"
          aria-pressed={layout === option.id} title={option.description} onClick={() => { onChange(option.id); close(true); }}>
          <RecordLayoutThumbnail layout={option.id} />
          <span>{option.label}</span>
          {layout === option.id ? <svg className="recordLayoutCheck" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg> : null}
        </button>)}
      </div>
      <p>Six ways to set the scene.</p>
    </div>, document.body) : null}
  </>;
}

function RecordLayoutThumbnail({ layout }: { layout: TurntableLayout }): ReactElement {
  const transforms: Record<TurntableLayout, { sleeve: string; deck: string }> = {
    classic: { sleeve: "translate(66 5) rotate(-7 18 22)", deck: "translate(10 35)" },
    duet: { sleeve: "translate(82 24) scale(.82)", deck: "translate(2 31) scale(.86)" },
    gallery: { sleeve: "translate(46 3) scale(1.05)", deck: "translate(18 40)" },
    float: { sleeve: "translate(70 2) rotate(12 18 22) scale(.88)", deck: "translate(10 35) rotate(5 40 14) scale(.86)" },
    stack: { sleeve: "translate(47 0) scale(.78)", deck: "translate(22 42) scale(.88)" },
    angle: { sleeve: "translate(67 4) skewY(-12) scale(.94)", deck: "translate(8 40) rotate(-8 40 14)" },
  };
  const pose = transforms[layout];
  return <svg className="recordLayoutThumbnail" viewBox="0 0 120 76" aria-hidden="true">
    <ellipse cx="61" cy="65" rx="44" ry="5" fill="#000" opacity=".25" />
    <g transform={pose.sleeve}>
      <rect width="35" height="44" rx=".8" fill="#9d654b" stroke="#d6ab80" strokeWidth=".7" />
      <path d="M1 1h33v23H1z" fill="#31445e" /><circle cx="23" cy="11" r="6" fill="#c5bdaa" opacity=".8" />
      <path d="M1 29 11 17 21 32 29 23 34 34v9H1z" fill="#d39d71" opacity=".88" />
      <path d="M3 41h29" stroke="#edc19d" strokeWidth=".6" />
    </g>
    <g transform={pose.deck}>
      <path d="M12 2 83 2 74 29 2 29z" fill="#87634c" stroke="#b18c68" strokeWidth=".8" />
      <path d="M13 3 81 3 73 25 5 25z" fill="#111a23" stroke="#697681" strokeWidth=".6" />
      <path d="M2 29h72v3H2z" fill="#55412f" />
      <ellipse cx="36" cy="14" rx="24" ry="10" fill="#080d13" stroke="#b8bdc5" strokeWidth=".7" />
      <ellipse cx="36" cy="14" rx="20" ry="8" fill="none" stroke="#57616c" strokeWidth=".6" />
      <ellipse cx="36" cy="14" rx="16" ry="6" fill="none" stroke="#384653" strokeWidth=".5" />
      <ellipse cx="36" cy="14" rx="7" ry="3" fill="#bf8f68" />
      <circle cx="70" cy="7" r="2.5" fill="#acb7bb" />
      <path d="m70 7-3 8-11 7" fill="none" stroke="#d1d6d8" strokeWidth="1.6" />
      <circle cx="11" cy="23" r="1" fill="#dfb589" />
    </g>
  </svg>;
}
