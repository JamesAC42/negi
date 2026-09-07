import assert from "node:assert/strict";
import { YoutubeArtwork } from "../services/youtube-artwork.js";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  chmod,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CatalogueRelease, DiscoveryResult } from "@music-os/core";
import { createBackendApp } from "../app.js";
import { matchReleaseFiles } from "../services/album-acquisition-service.js";
import { missingReleaseTracks } from "../services/catalogue-service.js";
import { guessVideoMetadata, youtubeUrl } from "../services/youtube-service.js";

const temp = await mkdtemp(join(tmpdir(), "music-os-explore-"));
const previous = process.env.MUSIC_OS_YT_DLP_PATH;
function wav() {
  const data = Buffer.alloc(44 + 88200);
  data.write("RIFF");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(44100, 24);
  data.writeUInt32LE(88200, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(88200, 40);
  return data;
}
async function until<T>(read: () => T, ok: (v: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = read();
    if (ok(result)) return result;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out: " + JSON.stringify(read()));
}
try {
  await mkdir(join(temp, "library"));
  await mkdir(join(temp, "second"));
  await mkdir(join(temp, "downloads"));
  const source = join(temp, "downloads", "02 - Missing Song.wav");
  await writeFile(source, wav());
  const fake = join(temp, "yt-dlp-fixture");
  await writeFile(
    fake,
    [
      "#!/usr/bin/env python3",
      "import sys, pathlib, json, shutil, time",
      "args=sys.argv[1:]",
      "info={'id':'abcdefghijk','title':'Video Artist - Video Song (Official Audio)','channel':'Video Artist - Topic','acodec':'pcm_s16le','view_count':12345,'timestamp':1788048000}",
      "if '--version' in args: print('fixture'); sys.exit(0)",
      "if '--dump-single-json' in args:",
      "    with pathlib.Path(__file__).with_suffix('.search-count').open('a') as count: count.write('search\\n')",
      "    print(json.dumps({'entries':[info]})); sys.exit(0)",
      "print('negi-progress: 25.0%', flush=True)",
      "time.sleep(0.7)",
      "print('negi-progress: 75.0%', flush=True)",
      "time.sleep(0.7)",
      "out=pathlib.Path(args[args.index('-o')+1].replace('%(ext)s','wav'))",
      "out.parent.mkdir(parents=True,exist_ok=True)",
      "shutil.copyfile(" + JSON.stringify(source) + ",out)",
      "out.with_suffix('.info.json').write_text(json.dumps(info))",
    ].join("\n"),
  );
  await chmod(fake, 0o755);
  process.env.MUSIC_OS_YT_DLP_PATH = fake;
  const app = createBackendApp({
    host: "127.0.0.1",
    port: 0,
    databasePath: join(temp, "db.sqlite"),
    mpvPath: "mpv",
    musicBrainzEnabled: false,
  });
  try {
    const root = app.library.addRoot(join(temp, "library"), "library");
    const second = app.library.addRoot(join(temp, "second"), "library");
    assert.equal(
      youtubeUrl("https://youtu.be/abcdefghijk?t=4"),
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
    for (const url of [
      "https://example.com/watch?v=abcdefghijk",
      "file:///tmp/test",
      "https://youtube.com/playlist?list=x",
      "https://youtube.com.evil.test/watch?v=abcdefghijk",
    ])
      assert.throws(() => youtubeUrl(url));
    assert.deepEqual(
      guessVideoMetadata({
        id: "x",
        title: "Artist - Song (Official Audio)",
        channel: "Wrong channel",
      }),
      { artist: "Artist", title: "Song", album: "YouTube Singles", year: "" },
    );
    assert.equal(
      missingReleaseTracks(
        [
          { title: "Intro", disc: 1, number: 1, durationMs: null },
          { title: "Intro", disc: 2, number: 1, durationMs: null },
        ],
        [{ displayTags: { title: "Intro", discnumber: "1" } }],
      ).length,
      1,
      "Do not count one title twice across discs",
    );
    const result: DiscoveryResult = {
      id: "remote",
      source: "slskd",
      username: "peer",
      filename: "02 - Missing Song.wav",
      path: "Music/Correct Artist/Target Album/02 - Missing Song.wav",
      folder: "Music/Correct Artist/Target Album",
      sizeBytes: 88244,
      extension: "wav",
      bitrate: 1411,
      sampleRate: 44100,
      lengthSeconds: 1,
      isLocked: false,
      raw: {},
    };
    const track = {
      title: "Missing Song",
      disc: 1,
      number: 2,
      durationMs: 1000,
    };
    assert.equal(
      matchReleaseFiles([result], [track], "Correct Artist", "Target Album")
        .length,
      1,
    );
    assert.equal(
      matchReleaseFiles(
        [{ ...result, isLocked: true }],
        [track],
        "Correct Artist",
        "Target Album",
      ).length,
      0,
    );
    assert.equal(
      matchReleaseFiles(
        [
          {
            ...result,
            path: "Other Artist/Target Album/02 - Missing Song.wav",
          },
        ],
        [track],
        "Correct Artist",
        "Target Album",
      ).length,
      0,
    );
    assert.equal(
      matchReleaseFiles(
        [{ ...result, extension: "mp3", bitrate: 128 }],
        [track],
        "Correct Artist",
        "Target Album",
      ).length,
      0,
    );
    assert.equal(
      matchReleaseFiles(
        [result],
        [track, { ...track, title: "Absent Song", number: 3 }],
        "Correct Artist",
        "Target Album",
      ).length,
      0,
    );
    const initial = await app.imports.createFromPaths([source], root.id);
    app.imports.updateItemMetadata(initial.items[0].id, {
      artist: "Correct Artist",
      album: "Target Album",
      title: "Owned Song",
      year: "2001",
    });
    await app.imports.approveItem(initial.items[0].id, root.id);
    const owned = app.library.listAlbumGroups()[0];
    assert.equal(owned.artist, "Correct Artist");
    const release: CatalogueRelease = {
      id: "group",
      title: "Target Album",
      artistIds: ["artist"],
      date: "2001",
      releaseId: "edition",
      tracks: [{ ...track, title: "Owned Song", number: 1 }, track],
      rating: 4,
      votes: 1,
      ownedTracks: 1,
      libraryStatus: "partial",
    };
    app.catalogue.resolve = async () => ({
      artistId: "artist",
      groupId: "group",
    });
    app.catalogue.release = async () => release;
    const albumQueries: string[] = [];
    app.discovery.search = async (query, _limit, options) => {
      assert.equal(options?.waitForComplete, true, "Album agent waits for late peers");
      albumQueries.push(query);
      return { query, results: albumQueries.length === 1 ? [] : [result], total: albumQueries.length === 1 ? 0 : 1 };
    };
    app.discovery.queueDownloadResults = async (results) => results;
    app.discovery.findCompletedDownloadPaths = async () => [source];
    const job = app.albumAcquisitions.create({
      artist: owned.artist,
      album: owned.album,
      albumId: owned.id,
    });
    assert.equal(
      app.albumAcquisitions.create({
        artist: owned.artist,
        album: owned.album,
        albumId: owned.id,
      }).id,
      job.id,
      "Deduplicate active album requests",
    );
    const done = await until(
      () => app.albumAcquisitions.list().find((j) => j.id === job.id)!,
      (j) => ["succeeded", "failed"].includes(j.status),
    );
    assert.equal(done.status, "succeeded", done.error ?? "");
    const album = app.library.listAlbumGroups()[0];
    assert.equal(album.fileCount, 2);
    assert.equal(album.artist, "Correct Artist");
    assert(
      album.files.some(
        (f) =>
          f.displayTags.title === "Missing Song" &&
          f.displayTags.tracknumber === "2/2",
      ),
    );
    assert.equal(
      app.library.countFiles(),
      2,
      "Only the missing track was imported",
    );
    const repeated = app.albumAcquisitions.create({
      artist: album.artist,
      album: album.album,
      albumId: album.id,
    });
    await until(
      () => app.albumAcquisitions.list().find((j) => j.id === repeated.id)!,
      (j) => j.status === "succeeded",
    );
    assert.equal(app.library.countFiles(), 2);
    const [videos, duplicate] = await Promise.all([
      app.youtube.search("fixture"),
      app.youtube.search("fixture"),
    ]);
    assert.equal(videos.length, 1);
    assert.deepEqual(duplicate, videos);
    assert.deepEqual(await app.youtube.search(" FIXTURE "), videos);
    assert.equal(
      (await readFile(fake + ".search-count", "utf8")).trim(),
      "search",
      "Repeated and concurrent searches reuse results",
    );
    assert.equal(videos[0].viewCount, 12345);
    assert.equal(videos[0].uploadDate, "2026-08-30");
    assert.equal(videos[0].approximateDate, true);
    const video = app.youtube.create("https://youtu.be/abcdefghijk");
    const downloading = await until(
      () => app.youtube.list().find((j) => j.id === video.id)!,
      (j) => j.status === "running" && (j.progress ?? 0) > 0,
    );
    assert.equal(downloading.progress, 0.25);
    const review = await until(
      () => app.youtube.list().find((j) => j.id === video.id)!,
      (j) => ["review", "failed"].includes(j.status),
    );
    assert.equal(review.status, "review", review.error ?? "");
    assert(albumQueries.includes("Target Album"), "Album search broadens when the exact query has no usable result");
    assert.equal(app.library.countFiles(), 2, "YouTube must wait for review");
    assert.equal(review.artist, "Video Artist");
    assert.equal(review.title, "Video Song");
    const approved = await app.youtube.approve({
      jobId: video.id,
      artist: "Edited Artist",
      title: "Edited Song",
      album: "Edited Album",
      year: "2020",
      libraryRootId: second.id,
    });
    assert.equal(approved.status, "succeeded");
    const edited = app.library
      .listAlbumGroups()
      .find((a) => a.artist === "Edited Artist")!;
    assert.equal(edited.album, "Edited Album");
    assert(edited.files[0].path.startsWith(join(temp, "second")));
    assert.equal(edited.files[0].displayTags.title, "Edited Song");
    const thumbnail = {
      data: Buffer.from("youtube-thumbnail-fixture"),
      mimeType: "image/jpeg",
    };
    let thumbnailFetches = 0;
    const sourceArtwork = new YoutubeArtwork(app.db, async () => {
      thumbnailFetches++;
      return thumbnail;
    });
    const [firstArt, parallelArt] = await Promise.all([
      sourceArtwork.forFile(edited.files[0].id),
      sourceArtwork.forFile(edited.files[0].id),
    ]);
    assert.deepEqual(firstArt, thumbnail);
    assert.deepEqual(parallelArt, thumbnail);
    assert.equal(
      thumbnailFetches,
      1,
      "Concurrent artwork lookups share one download",
    );
    const offlineArtwork = new YoutubeArtwork(app.db, async () => {
      throw new Error("Offline");
    });
    assert.deepEqual(
      await offlineArtwork.forFile(edited.files[0].id),
      thumbnail,
      "Thumbnails persist across service restarts",
    );
    assert.deepEqual(
      await app.artwork.getFileArtwork(edited.files[0].id),
      thumbnail,
      "YouTube file artwork comes from its source",
    );
    assert.deepEqual(
      await app.artwork.getAlbumArtwork(edited.id),
      thumbnail,
      "Album artwork uses the YouTube thumbnail",
    );
    const overridePath = join(temp, "override.png");
    const override = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFhQAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(overridePath, override);
    await app.artwork.setAlbumArtworkFromPath(edited.id, overridePath);
    assert.deepEqual(
      (await app.artwork.getFileArtwork(edited.files[0].id))?.data,
      override,
      "Manual artwork remains the override",
    );
    assert.deepEqual(
      (await app.artwork.getAlbumArtwork(edited.id))?.data,
      override,
    );
    assert.equal(await offlineArtwork.get("invalid-id"), null);
    let misses = 0;
    const unavailable = new YoutubeArtwork(app.db, async () => {
      misses++;
      throw new Error("Unavailable");
    });
    assert.equal(await unavailable.get("missing0001"), null);
    assert.equal(await unavailable.get("missing0001"), null);
    assert.equal(
      misses,
      1,
      "Unavailable thumbnails are not repeatedly requested",
    );

    await app.youtube.approve({
      jobId: video.id,
      artist: "Edited Artist",
      title: "Edited Song",
      album: "Edited Album",
      year: "2020",
      libraryRootId: second.id,
    });
    assert.equal(
      app.library.countFiles(),
      3,
      "Repeated approval is idempotent",
    );
    console.log(
      "PASS: album completion, source matching, duplicates, canonical artist, YouTube search/download/review, metadata persistence, selected root and idempotent approval",
    );
  } finally {
    app.close();
  }
} finally {
  if (previous === undefined) delete process.env.MUSIC_OS_YT_DLP_PATH;
  else process.env.MUSIC_OS_YT_DLP_PATH = previous;
  await rm(temp, { recursive: true, force: true });
}
