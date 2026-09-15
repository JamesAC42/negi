import assert from "node:assert/strict";
import { RECORD_NEEDLE_DROP_MS, RECORD_PLAYBACK_START_MS } from "@music-os/core";
import { arrangements, sampleExchange } from "../renderer/ui/turntable/choreography.js";
import { recordChangeTiming } from "../renderer/record-player-state.js";
import { createRecordAnimationClock, recordAlbumProgress } from "../renderer/record-player-state.js";
import { shouldRefreshPlaybackHistory } from "../renderer/playback-state.js";
import type { LibraryFilesResponse, PlaybackStateResponse } from "@music-os/core";
type File=LibraryFilesResponse["files"][number];
const file=(id:string,track:string,durationMs:number|null,disc="1"): File => ({
  id, filename:id, path:`/record-fixture/${id}`, normalizedPath:`/record-fixture/${id}`, libraryRootId:null,
  extension:"flac",sizeBytes:0,mtime:new Date(0).toISOString(),ctime:null,sha256:null,quickHash:null,
  durationMs,codec:"flac",bitrate:null,sampleRate:96000,channels:2,scanStatus:"scanned",staged:false,missing:false,
  playCount:0,skipCount:0,lastPlayedAt:null,lastSkippedAt:null,rating:null,liked:null,disliked:null,
  displayTags:{album:"Record",albumartist:"Various Artists",artist:id,tracknumber:track,discnumber:disc}
});
const a=file("a","1",1000),b=file("b","2",3000),c=file("c","1",2000,"2");
const state={currentFileId:b.id,positionMs:1500,durationMs:3000,status:"playing"} as PlaybackStateResponse;
assert.equal(recordAlbumProgress([c,b,a],b,state).ratio,2500/6000);
assert.equal(recordAlbumProgress([c,b,a],b,state).track,2);
assert.equal(recordAlbumProgress([a,b,c],c,{...state,positionMs:2000,durationMs:2000}).ratio,1);
assert.equal(recordAlbumProgress([a,b,c],a,{...state,positionMs:0,durationMs:1000}).ratio,0);
assert.equal(recordAlbumProgress([a,b,{...b,id:"duplicate"},c],b,state).tracks,3);
assert.equal(recordAlbumProgress([a,b,c],b,{...state,positionMs:500}).ratio,1500/6000,"seeking must move the tonearm backwards");
const unknown=file("missing","3",null);const estimate=recordAlbumProgress([a,b,unknown],unknown,{...state,durationMs:null,positionMs:1000});assert.equal(estimate.approximate,true);assert.ok(Number.isFinite(estimate.ratio));
assert.equal(recordAlbumProgress([],null,state).ratio,0);
assert.equal(shouldRefreshPlaybackHistory(state,{...state,status:"paused",albumTransition:{id:"change",from:{fileId:"a",album:"A",artist:"Artist"},to:{fileId:"b",album:"B",artist:"Artist"},startedAt:null,paused:false,reducedMotion:false}}),true);
console.log("PASS album duration, track/disc order, compilation identity, duplicate copies, seeking, missing lengths, EOF history refresh");

const clock = createRecordAnimationClock();
assert.equal(clock(10_000, false), 0, "waiting for begin must stay at the resting player");
assert.equal(clock(15_000, false), 0);
assert.equal(clock(16_000, true), 0, "a delayed acknowledgement starts at frame zero");
assert.equal(clock(16_016, true), 16);
assert.equal(clock(16_520, true), 520);
assert.equal(clock(16_536, false), 520, "pause freezes the visible sequence");
assert.equal(clock(76_536, false), 520);
assert.equal(clock(77_000, true), 520, "resume must not count the time spent paused");
assert.equal(clock(77_016, true), 536);
const alreadyStarted = createRecordAnimationClock();
assert.equal(alreadyStarted(90_000, true), 0, "mounting an already-started transition still shows its entrance");
assert.equal(alreadyStarted(90_016, true), 16);
assert.equal(createRecordAnimationClock()(500_000, true), 0, "a new transition gets its own visual clock");
console.log("PASS local animation clock, delayed acknowledgement, already-started entry, pause/resume, new transition reset");

// Exercise the physical choreography across the whole playback handoff, rather
// than duplicating its easing formulas. A malformed pose can break every layout.
const near = (actual: number, expected: number, description: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${description}: ${actual} != ${expected}`);
const poseChannels = ["lift", "insertion", "travel", "armPark", "armLift", "groove", "touchdown"] as const;
for (const [name, arrangement] of Object.entries(arrangements)) {
  for (const value of [...arrangement.deck, ...arrangement.deckRotation, ...arrangement.sleeve, ...arrangement.sleeveRotation, arrangement.viewHeight]) {
    assert.ok(Number.isFinite(value), `${name} must have a finite camera and physical arrangement`);
  }
  assert.ok(arrangement.viewHeight > 0, `${name} must have a visible camera frustum`);
}
for (let elapsed = 0; elapsed <= RECORD_PLAYBACK_START_MS; elapsed += 5) {
  for (const progress of [0, .42, 1]) {
    const pose = sampleExchange(elapsed, progress);
    for (const channel of poseChannels) assert.ok(Number.isFinite(pose[channel]), `${channel} must be finite at ${elapsed}ms`);
    for (const channel of ["lift", "insertion", "armPark", "armLift", "groove"] as const) {
      assert.ok(pose[channel] >= 0 && pose[channel] <= 1, `${channel} must stay within its physical range at ${elapsed}ms`);
    }
    assert.ok(pose.travel >= -1.05 && pose.travel <= 1.05, "The sleeve overshoot must remain restrained");
    if (pose.lift > .001) assert.ok(pose.armLift > .99, "The needle must clear the disc before the vinyl leaves its platter");
    if (pose.insertion > 0) assert.ok(pose.lift > .99, "The vinyl must be upright before passing through the sleeve opening");
    if (!pose.recordVisible) {
      assert.ok(pose.insertion >= .997 && pose.lift > .99, "A record may disappear only when fully inside its upright sleeve");
    }
    const empty = sampleExchange(elapsed, progress, true);
    assert.equal(empty.recordVisible, false, "An empty player must not create a record during a transition");
    assert.equal(empty.visible, false);
    assert.equal(empty.armPark, 1, "An empty player keeps the tonearm parked");
  }
}
// Adjacent phases must join smoothly. The only intentional travel cut is the
// offstage sleeve swap, where both outgoing and incoming vinyls are hidden.
for (const boundary of [0, 180, 290, 360, 600, recordChangeTiming.armParked, 1060, recordChangeTiming.vinylRaised,
  1400, recordChangeTiming.sleeved, recordChangeTiming.swap, 2220, recordChangeTiming.sleeveArrived, 2680,
  recordChangeTiming.vinylOut, 3270, 3290, recordChangeTiming.vinylDown, 3520, recordChangeTiming.armIn, RECORD_NEEDLE_DROP_MS]) {
  const before = sampleExchange(Math.max(0, boundary - .01), .42);
  const after = sampleExchange(boundary + .01, .42);
  for (const channel of poseChannels) {
    if (boundary === recordChangeTiming.swap && channel === "travel") continue;
    assert.ok(Math.abs(before[channel] - after[channel]) < .001, `${channel} must not jump across ${boundary}ms`);
  }
}
const beforeSwap = sampleExchange(recordChangeTiming.swap - .01, .42);
const afterSwap = sampleExchange(recordChangeTiming.swap, 0);
assert.equal(beforeSwap.recordVisible, false);
assert.equal(afterSwap.recordVisible, false);
assert.ok(beforeSwap.travel < -.99 && afterSwap.travel > .99, "Album identity changes only after sleeves leave the stage");

for (const elapsed of [undefined, RECORD_NEEDLE_DROP_MS, RECORD_PLAYBACK_START_MS, RECORD_PLAYBACK_START_MS + 10_000]) {
  const pose = sampleExchange(elapsed, .42);
  for (const channel of ["lift", "insertion", "travel", "armPark", "armLift", "touchdown"] as const) near(pose[channel], 0, `${channel} returns to the resting pose at ${elapsed}ms`);
  assert.equal(pose.recordVisible, true, "The incoming record must be visible on the platter when playback starts");
}
near(sampleExchange(undefined, -1).groove, 0, "Negative progress is clamped");
near(sampleExchange(undefined, 2).groove, 1, "Past-end progress is clamped");
console.log("PASS 3D choreography: finite physical poses, needle clearance, upright insertion, hidden swap, smooth phase joins, empty player, exact 3.9s resting endpoint");

import './record-player-geometry-smoke.js';
