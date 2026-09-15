import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { arrangements, type TurntableLayout } from '../renderer/ui/turntable/choreography.js';
import { layoutRig, recordScenePose, RECORD_RADIUS } from '../renderer/ui/turntable/scene-poses.js';
const failures: string[] = [];
const transform = (position: THREE.Vector3, rotation: THREE.Quaternion) => new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(1,1,1));
for (const layout of Object.keys(arrangements) as TurntableLayout[]) {
  const rig = layoutRig(layout);
  const body = new OBB(new THREE.Vector3(0,.385,0), new THREE.Vector3(2.475,.20,1.91)).applyMatrix4(transform(rig.deckPosition,rig.deckQuaternion));
  const inverseDeck = transform(rig.deckPosition,rig.deckQuaternion).invert();
  for (const elapsed of [undefined, ...Array.from({length:391},(_,i)=>i*10)]) {
    const pose=recordScenePose(rig,elapsed,.5);
    const sleeve=new OBB(new THREE.Vector3(),new THREE.Vector3(1.79,1.79,.04)).applyMatrix4(transform(pose.sleevePosition,pose.sleeveQuaternion));
    if(body.intersectsOBB(sleeve)) {failures.push(`${layout}@${elapsed}: sleeve intersects chassis`);break;}
    if(!pose.recordVisible) continue;
    let invalid=false;
    for(const radius of [.1,.6,1.1,RECORD_RADIUS]) for(let j=0;j<64;j++) {
      const a=j*Math.PI/32;
      const point=new THREE.Vector3(Math.cos(a)*radius,-.019,Math.sin(a)*radius).applyQuaternion(pose.recordQuaternion).add(pose.recordPosition).applyMatrix4(inverseDeck);
      const onChassis=Math.abs(point.x)<2.475 && Math.abs(point.z)<1.91;
      const onPlatter=Math.hypot(point.x+.57,point.z-.05)<1.7;
      if((onChassis && point.y<.58-.001) || (onPlatter && point.y<.779-.001)) {failures.push(`${layout}@${elapsed}: vinyl cuts through deck/platter at y=${point.y}`);invalid=true;break;}
    }
    if(invalid) break;
    const record=new OBB(new THREE.Vector3(),new THREE.Vector3(RECORD_RADIUS,.025,RECORD_RADIUS)).applyMatrix4(transform(pose.recordPosition,pose.recordQuaternion));
    if(pose.insertion === 0 && record.intersectsOBB(sleeve)) {failures.push(`${layout}@${elapsed}: unsleeved vinyl intersects jacket envelope`);break;}
  }
}
assert.deepEqual(failures, [], failures.join('\n'));
console.log('PASS all six layouts: sleeve/chassis separation, vinyl/platter clearance, spindle-first lift, jacket opening clearance at every 10ms');
