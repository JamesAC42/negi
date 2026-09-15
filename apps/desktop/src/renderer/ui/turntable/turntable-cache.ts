import type { TurntableEngine } from './turntable-engine';

// Keep at most one detached inline scene; focused album exchanges never enter this cache.
const warmLifetimeMs = 30_000;
let warm: TurntableEngine | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
let acceptingScenes = true;

export function hasWarmTurntable(): boolean {
  return warm?.reusable() ?? false;
}

export function takeWarmTurntable(): TurntableEngine | null {
  clearTimeout(expiry); expiry = undefined;
  const scene = warm; warm = null;
  if (scene && !scene.reusable()) { scene.dispose(); return null; }
  return scene;
}

function clearWarmTurntable(): void {
  takeWarmTurntable()?.dispose();
}

export function keepTurntableWarm(scene: TurntableEngine): void {
  scene.park();
  clearWarmTurntable();
  if (!acceptingScenes || !scene.reusable()) { scene.dispose(); return; }
  warm = scene;
  expiry = setTimeout(clearWarmTurntable, warmLifetimeMs);
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', clearWarmTurntable);
if (import.meta.hot) import.meta.hot.dispose(() => {
  acceptingScenes = false;
  clearWarmTurntable();
  window.removeEventListener('pagehide', clearWarmTurntable);
});
