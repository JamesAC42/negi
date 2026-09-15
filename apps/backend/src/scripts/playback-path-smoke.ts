import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { getBackendConfig } from "../config.js";
import { needsSafePlaybackPath, preparePlaybackPath, translatePathForPlayer } from "../services/playback-path.js";

const config = getBackendConfig();
assert.equal(translatePathForPlayer("/mnt/e/Music/song.flac", "mpv.exe"), "E:\\Music\\song.flac");
assert.equal(needsSafePlaybackPath("/mnt/e/Music/nimrod./song.flac", "mpv.exe"), true);
assert.equal(needsSafePlaybackPath("/mnt/e/Music/album /song.flac", "mpv.exe"), true);
assert.equal(needsSafePlaybackPath("/mnt/e/Music/song.flac", "mpv.exe"), false);
assert.equal(needsSafePlaybackPath("/mnt/e/Music/nimrod./song.flac", "mpv"), false);
const native = await preparePlaybackPath("/missing/native.flac", "mpv");
assert.equal(native.path, "/missing/native.flac");
await native.cleanup();

const fixtureRoot = await mkdtemp(join(tmpdir(), "music-os-path-smoke-"));
try {
  const folder = join(fixtureRoot, "nimrod.");
  await mkdir(folder);
  const source = join(folder, "song.wav");
  const samples = 4410;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  await writeFile(source, wav);
  const prepared = await preparePlaybackPath(source, config.mpvPath, config.windowsNodePath);
  try {
    assert.notEqual(prepared.path, source);
    const { stdout } = await promisify(execFile)(config.mpvPath, [
      "--no-config", "--ao=null", "--vo=null", "--length=0.05", prepared.path
    ], { timeout: 10_000 });
    assert.match(stdout, /Audio|AO:/);
    assert.deepEqual(await readFile(source), wav);
  } finally {
    await prepared.cleanup();
  }
  const alias = prepared.path.replace(/^([a-z]):[\\/]/i, (_, drive: string) => "/mnt/" + drive.toLowerCase() + "/").replaceAll("\\", "/");
  await assert.rejects(access(dirname(alias)));
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
console.log("Playback path smoke passed: unsafe path staging, silent mpv decode, source preservation, cleanup.");

if (process.argv[2]) {
  const prepared = await preparePlaybackPath(process.argv[2], config.mpvPath, config.windowsNodePath);
  try {
    const { stdout } = await promisify(execFile)(config.mpvPath, [
      "--no-config", "--ao=null", "--vo=null", "--length=0.1", prepared.path
    ], { timeout: 10_000 });
    assert.match(stdout, /Audio|AO:/);
    console.log("Requested file silently decoded through safe playback path.");
  } finally {
    await prepared.cleanup();
  }
}
