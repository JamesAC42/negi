import assert from "node:assert/strict";
import { recordAlbumKey, RECORD_NEEDLE_DROP_MS, RECORD_PLAYBACK_START_MS, type LibraryFilesResponse, type PlaybackState } from "@music-os/core";
import { PlaybackService } from "../services/playback-service.js";
import type { MpvIpcEvent } from "../services/mpv-ipc.js";
import type { PlaybackHistoryRecorder } from "../services/playback-history-service.js";

type File = LibraryFilesResponse["files"][number];
function file(id: string, album?: string, artist = "An artist"): File {
  const path = `/isolated-record-fixture/${id}.flac`;
  return { id, libraryRootId:null,path,normalizedPath:path,filename:id+".flac",extension:"flac",sizeBytes:0,
    mtime:new Date(0).toISOString(),ctime:null,sha256:null,quickHash:null,durationMs:180000,codec:"flac",bitrate:null,
    sampleRate:96000,channels:2,scanStatus:"scanned",staged:false,missing:false,playCount:0,skipCount:0,lastPlayedAt:null,
    lastSkippedAt:null,rating:null,liked:null,disliked:null,displayTags:{title:id,artist,...(album ? {album} : {})} };
}
const a=file("a","First"), b=file("b","First"), c=file("c","Second"), d=file("d","Third");
function fixture() {
  const ended: Parameters<PlaybackHistoryRecorder["recordEnded"]>[0][]=[];
  const started: string[]=[];
  const loads: unknown[][]=[];
  const service=new PlaybackService({host:"127.0.0.1",port:0,databasePath:":memory:",mpvPath:"fixture-mpv"},
    {recordStarted(id){started.push(id);},recordEnded(input){ended.push(input);}});
  const driver=service as unknown as {ensureProcess():Promise<void>;sendMpvCommand(command:unknown[]):Promise<unknown>;
    handleMpvEvent(event:MpvIpcEvent,generation:number):void;processGeneration:number;operationChain:Promise<void>;
    state:PlaybackState;scheduleAlbumTransitionFallback(id:string,delay:number):void};
  driver.ensureProcess=async()=>{};
  driver.sendMpvCommand=async(command)=>{if(command[0]==="loadfile")loads.push(command);return null;};
  return {service,driver,loads,ended,started,
    async eof(){driver.handleMpvEvent({event:"end-file",reason:"eof"},driver.processGeneration);await driver.operationChain;},
    async start(queue:File[]=[a,c],index=0){await service.setRecordPlayerPresence("view",true,false);await service.playQueue(queue,index);},
    async drop(){const t=service.getSnapshot().albumTransition!;assert.ok(t);await service.recordPlayerAction(t.id,"begin");
      driver.state={...driver.state,albumTransition:{...driver.state.albumTransition!,startedAt:Date.now()-RECORD_PLAYBACK_START_MS-10}};
      return service.recordPlayerAction(t.id,"complete");}
  };
}
let cases=0;
async function test(name:string,run:(f:ReturnType<typeof fixture>)=>Promise<void>){const f=fixture();try{await run(f);cases++;console.log("PASS",name);}finally{f.service.close();}}
await test("natural boundary holds audio and records exactly one completed listen",async f=>{
  await f.start();await f.eof();const t=f.service.getSnapshot().albumTransition!;
  assert.equal(f.loads.length,1);assert.equal(f.service.getSnapshot().currentFileId,a.id);assert.equal(t.to.fileId,c.id);
  assert.equal(f.service.getSnapshot().status,"paused");assert.equal(f.ended.length,1);assert.equal(f.ended[0].reason,"completed");
  await f.eof();assert.equal(f.ended.length,1);assert.equal(f.loads.length,1);
  await f.service.recordPlayerAction(t.id,"complete");assert.equal(f.loads.length,1,"unbegun callback must not play");
  await f.service.recordPlayerAction(t.id,"begin");await f.service.recordPlayerAction(t.id,"complete");
  assert.equal(f.loads.length,1,"early callback must not play");
  await f.drop();assert.equal(f.loads.length,2);assert.deepEqual(f.started,[a.id,c.id]);
  await f.service.recordPlayerAction(t.id,"complete");assert.equal(f.loads.length,2,"duplicate callback must be harmless");
});
await test("needle drop retains a one-second lead-in, then releases without the fallback",async f=>{
  await f.start();await f.eof();const t=f.service.getSnapshot().albumTransition!;
  await f.service.recordPlayerAction(t.id,"begin");
  f.driver.state={...f.driver.state,albumTransition:{...f.driver.state.albumTransition!,startedAt:Date.now()-RECORD_NEEDLE_DROP_MS-500}};
  await f.service.recordPlayerAction(t.id,"complete");
  assert.equal(f.loads.length,1,"keep audio held while the newly lowered needle rides the lead-in");
  assert.ok(f.service.getSnapshot().albumTransition,"an early acknowledgement remains retryable");
  await f.drop();assert.equal(f.loads.length,2);assert.equal(f.service.getSnapshot().currentFileId,c.id);
  assert.ok(!f.service.getSnapshot().albumTransition);
});
await test("tracks within an album advance immediately",async f=>{await f.start([a,b,c]);await f.eof();assert.equal(f.service.getSnapshot().currentFileId,b.id);assert.ok(!f.service.getSnapshot().albumTransition);await f.eof();assert.ok(f.service.getSnapshot().albumTransition);});
await test("closed window has uninterrupted playback",async f=>{await f.service.playQueue([a,c],0);await f.eof();assert.equal(f.service.getSnapshot().currentFileId,c.id);assert.ok(!f.service.getSnapshot().albumTransition);});
await test("closing the last active view releases an already held record",async f=>{await f.start();await f.eof();await f.service.setRecordPlayerPresence("view",false,false);assert.equal(f.service.getSnapshot().currentFileId,c.id);});
await test("another active view retains the ceremony",async f=>{await f.start();await f.service.setRecordPlayerPresence("second",true,false);await f.eof();await f.service.setRecordPlayerPresence("view",false,false);assert.ok(f.service.getSnapshot().albumTransition);});
await test("pause holds the next album even after the window closes",async f=>{await f.start();await f.eof();const t=f.service.getSnapshot().albumTransition!;await f.service.pause();await f.service.setRecordPlayerPresence("view",false,false);await f.service.recordPlayerAction(t.id,"complete");assert.equal(f.loads.length,1);assert.equal(f.service.getSnapshot().albumTransition?.paused,true);await f.service.resume();assert.equal(f.loads.length,2);});
await test("Stop invalidates callbacks and timers",async f=>{await f.start();await f.eof();const id=f.service.getSnapshot().albumTransition!.id;await f.service.stop();await f.service.recordPlayerAction(id,"skip");assert.equal(f.service.getSnapshot().status,"stopped");assert.equal(f.loads.length,1);});
await test("manual next and direct play bypass the ritual",async f=>{await f.start();await f.service.next();assert.equal(f.loads.length,2);assert.ok(!f.service.getSnapshot().albumTransition);await f.service.playQueue([a,c],0);await f.eof();const id=f.service.getSnapshot().albumTransition!.id;await f.service.playFile(d);await f.service.recordPlayerAction(id,"skip");assert.equal(f.service.getSnapshot().currentFileId,d.id);});
await test("queue replacement invalidates an old sleeve and plays the new target",async f=>{await f.start();await f.eof();const old=f.service.getSnapshot().albumTransition!.id;await f.service.replaceUpNext([d]);const t=f.service.getSnapshot().albumTransition!;assert.notEqual(t.id,old);assert.equal(t.to.fileId,d.id);await f.service.recordPlayerAction(old,"skip");assert.equal(f.loads.length,1);await f.drop();assert.equal(f.service.getSnapshot().currentFileId,d.id);});
await test("up-next insertion changes the pending target",async f=>{await f.start();await f.eof();await f.service.enqueue([d],"up_next");assert.equal(f.service.getSnapshot().albumTransition?.to.fileId,d.id);await f.drop();assert.equal(f.service.getSnapshot().currentFileId,d.id);});
await test("clearing upcoming tracks stops the pending ceremony",async f=>{await f.start();await f.eof();await f.service.replaceUpNext([]);assert.equal(f.service.getSnapshot().status,"stopped");assert.ok(!f.service.getSnapshot().albumTransition);});
await test("repeat song has no album change; repeat queue honors last-to-first boundary",async f=>{await f.start();await f.service.setRepeatMode("song");await f.eof();assert.equal(f.service.getSnapshot().currentFileId,a.id);assert.ok(!f.service.getSnapshot().albumTransition);await f.service.setRepeatMode("queue");await f.service.next();await f.eof();assert.equal(f.service.getSnapshot().albumTransition?.to.fileId,a.id);await f.drop();assert.equal(f.service.getSnapshot().queueIndex,0);});
await test("untagged files do not invent album boundaries",async f=>{await f.start([file("unknown-a"),file("unknown-b")]);await f.eof();assert.ok(!f.service.getSnapshot().albumTransition);assert.equal(f.loads.length,2);});
await test("playback errors never begin a record change",async f=>{await f.start();f.driver.handleMpvEvent({event:"end-file",reason:"error",error:"decode failed"},f.driver.processGeneration);await f.driver.operationChain;assert.equal(f.service.getSnapshot().status,"error");assert.equal(f.ended.length,0);assert.ok(!f.service.getSnapshot().albumTransition);});
await test("reduced motion retains the acknowledgement with a short handoff",async f=>{await f.start();await f.service.setRecordPlayerPresence("view",true,true);await f.eof();assert.equal(f.service.getSnapshot().albumTransition?.reducedMotion,true);await f.drop();assert.equal(f.loads.length,2);});
await test("fallback releases audio if the renderer disappears mid-animation",async f=>{await f.start();await f.eof();const t=f.service.getSnapshot().albumTransition!;await f.service.recordPlayerAction(t.id,"begin");f.driver.scheduleAlbumTransitionFallback(t.id,20);await new Promise(resolve=>setTimeout(resolve,60));assert.equal(f.service.getSnapshot().currentFileId,c.id);});
assert.equal(recordAlbumKey(file("a","  FIRST  ","An  artist")),recordAlbumKey(a));
assert.notEqual(recordAlbumKey(a),recordAlbumKey(file("other","First","Different artist")));
console.log(JSON.stringify({ok:true,cases,liveLibraryTouched:false,realAudioStarted:false},null,2));
