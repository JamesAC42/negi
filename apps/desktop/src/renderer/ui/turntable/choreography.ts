import { clamp, ease, easeIn, easeOut, phase, settle, recordChangeTiming as timing } from '../../record-player-state';

export type TurntableLayout = 'classic' | 'duet' | 'gallery' | 'float' | 'stack' | 'angle';
export type Vec3 = [number, number, number];
export type Arrangement = { deck: Vec3; deckRotation: Vec3; sleeve: Vec3; sleeveRotation: Vec3; viewHeight: number };
export const arrangements: Record<TurntableLayout, Arrangement> = {
  classic: { deck: [-.55, 0, .45], deckRotation: [0, .05, 0], sleeve: [1.45, 1.92, -2.85], sleeveRotation: [0, .5, 0], viewHeight: 6.35 },
  duet: { deck: [-1.55, 0, .2], deckRotation: [0, -.05, 0], sleeve: [3.05, 1.85, .1], sleeveRotation: [0, .2, 0], viewHeight: 6.6 },
  gallery: { deck: [0, 0, .6], deckRotation: [0, -.04, 0], sleeve: [0, 2.15, -1.8], sleeveRotation: [0, .16, 0], viewHeight: 6.35 },
  float: { deck: [-.65, .45, .4], deckRotation: [.04, -.12, -.045], sleeve: [1.45, 2.65, -2.6], sleeveRotation: [.04, -.12, -.12], viewHeight: 6.7 },
  stack: { deck: [0, -.15, 1.25], deckRotation: [0, -.05, 0], sleeve: [.05, 2.85, -1.85], sleeveRotation: [0, .16, 0], viewHeight: 7.2 },
  angle: { deck: [-.4, 0, .65], deckRotation: [0, -.4, 0], sleeve: [1.65, 2.35, -3.0], sleeveRotation: [0, -.22, -.025], viewHeight: 6.6 }
};

/** Continuous physical poses; the record keeps its original diameter throughout. */
export function sampleExchange(elapsed: number | undefined, progress: number, empty = false) {
  const changing = elapsed != null;
  const t = Math.max(0, elapsed ?? 0);
  const incoming = t >= timing.swap;
  const lift = !changing ? 0 : incoming
    ? 1 - phase(t, 2680, timing.vinylDown, easeIn)
    : phase(t, 600, timing.vinylRaised, easeOut);
  const insertion = !changing ? 0 : incoming
    ? 1 - phase(t, 2220, timing.vinylOut, easeOut)
    : phase(t, 1060, timing.sleeved, easeIn);
  const travel = !changing ? 0 : incoming
    ? 1 - phase(t, timing.swap, timing.sleeveArrived, settle)
    : -phase(t, 1400, timing.swap, easeIn);
  const armPark = empty ? 1 : !changing ? 0 : incoming
    ? 1 - phase(t, 3290, timing.armIn, easeOut)
    : phase(t, 290, timing.armParked, easeOut);
  const armLift = changing ? phase(t, 180, 360, easeOut) * (1 - phase(t, timing.armIn, timing.needleDrop, easeIn)) : 0;
  return { changing, incoming, lift, insertion, travel, armPark, armLift, groove: clamp(progress),
    // Tiny touchdown compression settles before the needle reaches the groove.
    touchdown: changing && incoming ? Math.sin(phase(t, 3270, 3520, ease) * Math.PI) * .028 : 0,
    visible: !empty, recordVisible: !empty && insertion < .997 };
}
