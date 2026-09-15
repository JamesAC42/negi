import * as THREE from 'three';
import { phase } from '../../record-player-state';
import { arrangements, sampleExchange, type TurntableLayout } from './choreography';

export const RECORD_RADIUS = 1.645;
export const SLEEVE_HALF = 1.79;
export type SceneRig = { deckPosition: THREE.Vector3; deckQuaternion: THREE.Quaternion; sleevePosition: THREE.Vector3; sleeveQuaternion: THREE.Quaternion };
export function layoutRig(layout: TurntableLayout): SceneRig {
  const a = arrangements[layout];
  return { deckPosition: new THREE.Vector3(...a.deck), deckQuaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(...a.deckRotation)),
    sleevePosition: new THREE.Vector3(...a.sleeve), sleeveQuaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(...a.sleeveRotation)) };
}

/** Actual geometry in world space, shared by rendering and collision regression checks. */
export function recordScenePose(rig: SceneRig, elapsed: number | undefined, progress: number, empty = false) {
  const phasePose = sampleExchange(elapsed, progress, empty);
  const { deckPosition, deckQuaternion, sleevePosition: restingSleeve, sleeveQuaternion: restingSleeveQ } = rig;
  let deckCeiling = -Infinity, sleeveBottom = Infinity;
  for (const x of [-2.475, 2.475]) for (const z of [-1.91, 1.91]) {
    deckCeiling = Math.max(deckCeiling, new THREE.Vector3(x, 1.25, z).applyQuaternion(deckQuaternion).add(deckPosition).y);
  }
  for (const x of [-SLEEVE_HALF, SLEEVE_HALF]) for (const y of [-SLEEVE_HALF, SLEEVE_HALF]) {
    sleeveBottom = Math.min(sleeveBottom, new THREE.Vector3(x, y, 0).applyQuaternion(restingSleeveQ).add(restingSleeve).y);
  }
  const t = elapsed ?? 0;
  const sleeveLift = elapsed == null ? 0 : phase(t, 300, 880) * (1 - phase(t, 3330, 3830));
  // The complete jacket clears even the parked arm before crossing the deck.
  const raisedBy = Math.max(0, deckCeiling + .25 - sleeveBottom);
  const sleevePosition = restingSleeve.clone(); sleevePosition.y += raisedBy * sleeveLift;
  sleevePosition.x += phasePose.travel * 11;
  sleevePosition.y += Math.abs(phasePose.travel) * .8;
  const sleeveQuaternion = restingSleeveQ.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, phasePose.travel * -.19, phasePose.travel * -.12)));
  const dock = new THREE.Vector3(-.57, .814 + phasePose.touchdown, .05).applyQuaternion(deckQuaternion).add(deckPosition);
  const opening = new THREE.Vector3(-3.8 * (1 - phasePose.insertion), 0, -.005).applyQuaternion(sleeveQuaternion).add(sleevePosition);
  const upright = sleeveQuaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  // First rise straight off the spindle; only then tip and travel to the opening.
  const tilt = phase(phasePose.lift, .2, 1);
  const travel = phase(phasePose.lift, .2, 1);
  const recordQuaternion = deckQuaternion.clone().slerp(upright, tilt);
  const recordPosition = dock.clone().lerp(opening, travel);
  recordPosition.y += Math.sin(phasePose.lift * Math.PI) * .55;
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(recordQuaternion);
  const verticalRadius = RECORD_RADIUS * Math.sqrt(Math.max(0, 1 - normal.y * normal.y)) + .019 * Math.abs(normal.y);
  // Support radius grows as the vinyl tips upright. Clearance grows with it,
  // instead of letting the lower edge cut through the platter or tonearm.
  const clearance = phase(phasePose.lift, 0, .2);
  const minimumCenter = THREE.MathUtils.lerp(dock.y, deckCeiling + verticalRadius + .13, clearance);
  recordPosition.y = Math.max(recordPosition.y, minimumCenter);
  if (phasePose.lift > 0 && phasePose.insertion === 0) {
    // Approach the opening from in front until the complete disc has cleared
    // the jacket's left edge. This avoids sweeping through its lower corner.
    const inverseSleeve = sleeveQuaternion.clone().invert();
    const localCenter = recordPosition.clone().sub(sleevePosition).applyQuaternion(inverseSleeve);
    const relative = inverseSleeve.clone().multiply(recordQuaternion);
    const axisX = new THREE.Vector3(1,0,0).applyQuaternion(relative);
    const axisY = new THREE.Vector3(0,1,0).applyQuaternion(relative);
    const axisZ = new THREE.Vector3(0,0,1).applyQuaternion(relative);
    const extentX = RECORD_RADIUS * (Math.abs(axisX.x) + Math.abs(axisZ.x)) + .025 * Math.abs(axisY.x);
    const extentZ = RECORD_RADIUS * (Math.abs(axisX.z) + Math.abs(axisZ.z)) + .025 * Math.abs(axisY.z);
    const leftClearance = -SLEEVE_HALF - (localCenter.x + extentX);
    const front = 1 - phase(leftClearance, .06, .3);
    localCenter.z = Math.max(localCenter.z, THREE.MathUtils.lerp(-.005, .08 + extentZ, front));
    recordPosition.copy(localCenter).applyQuaternion(sleeveQuaternion).add(sleevePosition);
  }
  return { ...phasePose, sleevePosition, sleeveQuaternion, recordPosition, recordQuaternion, deckCeiling, sleeveLift, raisedBy };
}
