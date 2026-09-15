import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RECORD_PLAYBACK_START_MS, type LibraryFilesResponse } from "@music-os/core";
import { PlaybackService } from "../services/playback-service.js";
type LibraryFile = LibraryFilesResponse["files"][number];
const trackDurationSeconds = 2;
// Linux mpv owns a separate socket/process; this never stops the desktop's Windows player.
const fixtureDir=await mkdtemp(join(tmpdir(),"music-os-record-player-"));
const playerPath=join(fixtureDir,"mpv-null");
// The null audio device runs the real demuxer, playback clock, EOF and IPC without a sound device.
await writeFile(playerPath,'#!/bin/sh\nexec /usr/bin/mpv --ao=null "$@"\n',{mode:0o755});
const playback = new PlaybackService({host:"127.0.0.1",port:0,databasePath:":memory:",mpvPath:playerPath},null);
try {
  const files=[];
  for (const id of ["a","b","c"]) {
    const path=join(fixtureDir,id+".wav");await writeFile(path,createSilentWav(trackDurationSeconds));
    files.push(createLibraryFile(id,path,id));
  }
  await playback.setRecordPlayerPresence("live-smoke",true,false);
  await playback.playQueue(files,0);
  const second=await waitFor(async()=>{const state=await playback.getState();return state.currentFileId==="b"?state:null;},10000,"same-album advance");
  assert.equal(second.albumTransition,undefined);
  const held=await waitFor(async()=>{const state=await playback.getState();return state.albumTransition?state:null;},10000,"album boundary");
  assert.equal(held.currentFileId,"b");
  const id=held.albumTransition!.id;
  const begun=await playback.recordPlayerAction(id,"begin");
  await delay(800);
  assert.equal((await playback.getState()).currentFileId,"b");
  await playback.recordPlayerAction(id,"complete");
  assert.equal(playback.getSnapshot().currentFileId,"b","early acknowledgement cannot play real audio");
  const releaseAt=begun.albumTransition!.startedAt!+RECORD_PLAYBACK_START_MS;
  await delay(Math.max(0,releaseAt-Date.now()));
  const started=await playback.recordPlayerAction(id,"complete");
  assert.equal(started.currentFileId,"c");assert.equal(started.status,"playing");
  const playing=await waitFor(async()=>{const s=await playback.getState();return s.currentFileId==="c"&&s.positionMs>100?s:null;},5000,"new record position");
  assert.ok(playing.positionMs>0);
  await waitFor(async()=>{const s=await playback.getState();return s.status==="stopped"?s:null;},10000,"queue completion");
  console.log(JSON.stringify({ok:true,realMpv:true,silentFixtures:true,sameAlbumImmediate:true,heldThroughLeadIn:true,finalStatus:playback.getSnapshot().status},null,2));
} finally {
  await playback.stop();playback.close();await rm(fixtureDir,{recursive:true,force:true});
}

async function waitFor<T>(check: () => Promise<T | null>, timeoutMs: number, label: string): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await check();
    if (result != null) {
      return result;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(playback.getSnapshot())}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function createLibraryFile(id: string, path: string, title: string): LibraryFile {
  const now = new Date().toISOString();
  return {
    id,
    libraryRootId: null,
    path,
    normalizedPath: path.toLowerCase(),
    filename: path.split(/[\\/]/).at(-1) ?? path,
    extension: "wav",
    sizeBytes: 0,
    mtime: now,
    ctime: null,
    sha256: null,
    quickHash: null,
    durationMs: trackDurationSeconds * 1000,
    codec: "pcm_s16le",
    bitrate: null,
    sampleRate: 8000,
    channels: 1,
    scanStatus: "scanned",
    staged: false,
    missing: false,
    playCount: 0,
    skipCount: 0,
    lastPlayedAt: null,
    lastSkippedAt: null,
    rating: null,
    liked: null,
    disliked: null,
    displayTags: { title, artist: "Playback Smoke", album: id.endsWith("c") ? "Second record" : "First record" }
  };
}

function createSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 8000;
  const sampleCount = sampleRate * durationSeconds;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
