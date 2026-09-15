import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { getArtworkObjectUrl } from '../../artwork-requests';
import { createTurntableEngine, type TurntableEngine, type TurntableSceneProps as Props } from './turntable-engine';
import { hasWarmTurntable, keepTurntableWarm, takeWarmTurntable } from './turntable-cache';

/** Imperative WebGL animation keeps React out of geometry/material updates. */
export function TurntableScene(props: Props): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;
  const engine = useRef<TurntableEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [canInitialize, setCanInitialize] = useState(() => props.elapsed != null || hasWarmTurntable());
  const [fallbackCover, setFallbackCover] = useState<string>();

  useEffect(() => {
    if (!failed) return;
    setFallbackCover(undefined);
    if (!props.album.fileId || props.empty) return;
    const controller = new AbortController();
    setFallbackCover(undefined);
    void getArtworkObjectUrl(props.artworkUrl(props.album.fileId), true, controller.signal).then(setFallbackCover).catch(() => undefined);
    return () => controller.abort();
  }, [failed, props.album.fileId, props.artworkUrl]);

  useEffect(() => {
    if (canInitialize) return;
    // GPU setup must not block the first moving modal frame. Wait for the
    // browser to start its entrance, then give that motion a paint opportunity.
    // Focused record exchanges initialize immediately on their own timeline.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const entrance = host.current?.closest(".nowPlayingBackdrop")?.getAnimations() ?? [];
    void Promise.all(entrance.map(animation => animation.ready.catch(() => undefined))).then(() => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          timer = setTimeout(() => setCanInitialize(true), 0);
        });
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [canInitialize]);

  useLayoutEffect(() => {
    if (!canInitialize || !host.current) return;
    const inline = latest.current.elapsed == null;
    const scene = (inline ? takeWarmTurntable() : null) ?? createTurntableEngine(latest.current);
    if (!scene) { setFailed(true); return; }
    engine.current = scene;
    scene.attach(host.current, latest.current, state => {
      setFailed(state === 'lost');
      if (state === 'restored') setGeneration(value => value + 1);
    });
    return () => {
      engine.current = null;
      if (inline) keepTurntableWarm(scene);
      else scene.dispose();
    };
  }, [generation, canInitialize]);

  useEffect(() => { engine.current?.update(props); },
    [props.album.fileId, props.artworkUrl, props.preloadAlbum?.fileId, props.playing, props.progress, props.empty, props.elapsed, props.layout, props.reducedMotion, props.suspended]);
  return <div className={`turntableScene${failed ? ' is-fallback' : ''}`} ref={host} role="img"
    aria-label={props.empty ? 'Turntable waiting for a record' : `3D record player with ${props.album.album} by ${props.album.artist}`}>
    {failed ? <div className="turntableFallback"><div className="turntableFallbackSleeve">{fallbackCover ? <img src={fallbackCover} alt="" /> : <span>{props.album.album}</span>}</div>
      <div className="turntableFallbackDeck"><div className="turntableFallbackDisc">{fallbackCover ? <img src={fallbackCover} alt="" /> : null}</div><i /></div></div> : null}
  </div>;
}
