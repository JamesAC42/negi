import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireAlbumRequestSchema, type CatalogueRelease } from "@music-os/core";
import { createBackendApp, type BackendApp } from "../app.js";
import { handleExplore } from "../explore-routes.js";

const mbArtist = "11111111-1111-4111-8111-111111111111";
const mbAlbum = "22222222-2222-4222-8222-222222222222";
const appleArtist = "apple:123";
const appleAlbum = "apple:456";
const calls: { provider: string; method: string; args: unknown[] }[] = [];
function provider(name: string) {
  const invoke = (method: string) => async (...args: unknown[]) => {
    calls.push({ provider: name, method, args });
    return method === "searchArtists" ? [] : { provider: name };
  };
  return { searchArtists: invoke("searchArtists"), browse: invoke("browse"), release: invoke("release") };
}
const routeApp = {
  appleCatalogue: provider("apple"),
  catalogue: provider("musicbrainz"),
  artwork: { catalogue: { get: async (id: string) => {
    calls.push({ provider: "musicbrainz", method: "cover", args: [id] });
    return null;
  } } },
} as unknown as BackendApp;
async function get(path: string) {
  let status = 0;
  const response = {
    writeHead(value: number) { status = value; },
    end() {},
  } as unknown as ServerResponse;
  assert.equal(await handleExplore(
    { method: "GET" } as IncomingMessage, response,
    new URL(path, "http://fixture.invalid"), routeApp,
    async () => { throw new Error("GET cannot read a request body"); },
    (_response, value) => { status = value; },
  ), true);
  return status;
}
async function expectRoute(path: string, expected: (typeof calls)[number], status = 200) {
  calls.length = 0;
  assert.equal(await get(path), status);
  assert.deepEqual(calls, [expected]);
}
await expectRoute("/explore/artists?q=Artist", { provider: "apple", method: "searchArtists", args: ["Artist"] });
await expectRoute("/explore/artists?q=Artist&provider=apple", { provider: "apple", method: "searchArtists", args: ["Artist"] });
await expectRoute("/explore/artists?q=Artist&provider=musicbrainz", { provider: "musicbrainz", method: "searchArtists", args: ["Artist"] });
for (const [name, artistId, albumId] of [["apple", appleArtist, appleAlbum], ["musicbrainz", mbArtist, mbAlbum]]) {
  await expectRoute(`/explore/catalogue?artistId=${artistId}&artist=Artist`, {
    provider: name, method: "browse", args: [artistId, "Artist", 0, "newest", undefined],
  });
  await expectRoute(`/explore/catalogue?artistId=${artistId}&artist=Artist&offset=40&sort=title`, {
    provider: name, method: "browse", args: [artistId, "Artist", 40, "title", undefined],
  });
  await expectRoute(`/explore/catalogue?artistId=${artistId}&artist=Artist&offset=24&section=eps-singles`, {
    provider: name, method: "browse", args: [artistId, "Artist", 24, "newest", "eps-singles"],
  });
  await expectRoute(`/explore/release?id=${albumId}&artist=Artist&albumId=local-album`, {
    provider: name, method: "release", args: [albumId, "Artist", "local-album"],
  });
}
for (const path of [
  "/explore/artists?q=Artist&provider=unknown",
  "/explore/artists?q=Artist&provider=",
  "/explore/catalogue?artistId=arbitrary&artist=Artist",
  `/explore/catalogue?artistId=${appleArtist}&artist=Artist&section=invalid`,
  "/explore/release?id=apple:nope&artist=Artist",
  "/explore/release?id=apple:0&artist=Artist",
  "/explore/release?id=123&artist=Artist",
  "/explore/cover?id=apple:123",
]) {
  calls.length = 0;
  await assert.rejects(get(path), { name: "ZodError" }, path);
  assert.equal(calls.length, 0, "Invalid requests must not contact providers");
}
await expectRoute(`/explore/cover?id=${mbAlbum}`, { provider: "musicbrainz", method: "cover", args: [mbAlbum] }, 404);
for (const [artistId, releaseGroupId] of [[appleArtist, appleAlbum], [mbArtist, mbAlbum]]) {
  assert.equal(acquireAlbumRequestSchema.safeParse({ artist: "Artist", album: "Album", artistId, releaseGroupId }).success, true);
}
for (const invalid of ["arbitrary", "123", "apple:nope", "apple:0", "apple:123/456"]) {
  for (const key of ["artistId", "releaseGroupId"])
    assert.equal(acquireAlbumRequestSchema.safeParse({ artist: "Artist", album: "Album", [key]: invalid }).success, false);
}

const temp = await mkdtemp(join(tmpdir(), "music-os-provider-routing-"));
try {
  const libraryPath = join(temp, "library");
  await mkdir(libraryPath);
  const app = createBackendApp({ host: "127.0.0.1", port: 0, databasePath: join(temp, "db.sqlite"), mpvPath: "mpv", musicBrainzEnabled: false });
  try {
    app.library.addRoot(libraryPath, "library");
    app.library.listAlbumGroups = () => [{
      id: "owned-album", artist: "Artist", album: "Album", year: "2020",
      files: [{ displayTags: { title: "Owned Song", discnumber: "1", tracknumber: "1" } }],
    }] as unknown as ReturnType<typeof app.library.listAlbumGroups>;
    let appleReleases = 0;
    let mbReleases = 0;
    let searches = 0;
    let downloads = 0;
    let releaseArtist = appleArtist;
    const release = (id: string, artistId: string): CatalogueRelease => ({
      id, title: "Album", artistIds: [artistId], date: "2020", releaseId: id,
      tracks: [{ title: "Owned Song", disc: 1, number: 1, durationMs: 1000 }],
      rating: null, votes: 0, ownedTracks: 1, libraryStatus: "complete",
    });
    app.appleCatalogue.release = async (id) => { appleReleases++; return release(id, releaseArtist); };
    app.catalogue.release = async (id) => { mbReleases++; return release(id, mbArtist); };
    app.appleCatalogue.resolve = async () => { throw new Error("Selected Apple identity must not be resolved again"); };
    app.catalogue.resolve = async () => { throw new Error("Selected MusicBrainz identity must not be resolved again"); };
    app.discovery.search = async () => { searches++; throw new Error("Fixture must never search live services"); };
    app.discoveryDownloads.createJob = () => { downloads++; throw new Error("Fixture must never download"); };
    async function finish(id: string) {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const job = app.albumAcquisitions.list().find((entry) => entry.id === id)!;
        if (["succeeded", "failed"].includes(job.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Fixture acquisition did not finish");
    }
    const base = { artist: "Artist", album: "Album" };
    const appleJob = await finish(app.albumAcquisitions.create({ ...base, artistId: appleArtist, releaseGroupId: appleAlbum }).id);
    assert.equal(appleJob.status, "succeeded", appleJob.error ?? "");
    assert.equal(appleReleases, 1);
    assert.equal(mbReleases, 0, "Selected Apple albums must never wait on MusicBrainz");
    releaseArtist = "apple:999";
    const mismatch = await finish(app.albumAcquisitions.create({ ...base, artistId: appleArtist, releaseGroupId: appleAlbum }).id);
    assert.equal(mismatch.status, "failed");
    assert.match(mismatch.error ?? "", /does not belong to the selected artist/);
    assert.equal(searches, 0, "Artist mismatch must fail before source search");
    assert.equal(downloads, 0, "Artist mismatch must fail before downloads");
    for (const [artistId, releaseGroupId] of [[appleArtist, mbAlbum], [mbArtist, appleAlbum]]) {
      assert.throws(() => app.albumAcquisitions.create({ ...base, artistId, releaseGroupId }), /same catalogue/);
    }
    const legacyJob = await finish(app.albumAcquisitions.create({ ...base, artistId: mbArtist, releaseGroupId: mbAlbum }).id);
    assert.equal(legacyJob.status, "succeeded", legacyJob.error ?? "");
    assert.equal(mbReleases, 1, "Existing UUID selections remain on MusicBrainz");
    assert.equal(appleReleases, 2);
    assert.equal(searches, 0);
    assert.equal(downloads, 0);
  } finally { app.close(); }
} finally { await rm(temp, { recursive: true, force: true }); }
console.log("PASS: default Apple search, optional MusicBrainz search, namespaced routing, strict IDs, legacy covers and acquisition provider/artist isolation");
