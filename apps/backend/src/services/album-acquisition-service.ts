import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { stat } from "node:fs/promises";
import type {
  AcquireAlbumRequest,
  AcquisitionJob,
  CatalogueTrack,
} from "@music-os/core";
import type { LibraryRepository } from "./library-repository.js";
import type { ImportService } from "./import-service.js";
import type { DiscoveryDownloadService } from "./discovery-download-service.js";
import type { SlskdService } from "./slskd-service.js";
import { compareDiscoveryResultAvailability } from "./discovery-availability.js";
import {
  CatalogueService,
  musicKey,
  missingReleaseTracks,
} from "./catalogue-service.js";

import {
  inspectReleaseFiles,
  albumSearchQueries,
  albumMatchFailure,
  type AlbumFilePick,
} from "./album-source-matching.js";
export { matchReleaseFiles } from "./album-source-matching.js";
type Payload = AcquireAlbumRequest & {
  downloadJobId?: string;
  picks?: AlbumFilePick[];
  tracks?: CatalogueTrack[];
  year?: string;
  message?: string;
  sourceRetries?: number;
  avoidedSources?: string[];
  previousDownloadJobIds?: string[];
};
type Row = {
  id: string;
  status: AcquisitionJob["status"];
  progress: number;
  payload_json: string;
  error_json: string | null;
  created_at: string;
};

export class AlbumAcquisitionService {
  private active = new Set<string>();
  private researching = new Set<string>();
  private timer: NodeJS.Timeout;
  private closed = false;
  constructor(
    private db: Database.Database,
    private library: LibraryRepository,
    private imports: ImportService,
    private downloads: DiscoveryDownloadService,
    private discovery: SlskdService,
    private catalogue: CatalogueService,
    private appleCatalogue?: Pick<CatalogueService, "release" | "resolve">,
  ) {
    this.timer = setInterval(() => this.tick(), 2000);
    this.timer.unref();
    this.tick();
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
  list(): AcquisitionJob[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM jobs WHERE type = 'album_acquisition' ORDER BY created_at DESC LIMIT 100",
        )
        .all() as Row[]
    ).map((r) => {
      const p = JSON.parse(r.payload_json) as Payload;
      return {
        id: r.id,
        status: r.status,
        progress: r.progress,
        artist: p.artist,
        album: p.album,
        albumId: p.albumId,
        releaseGroupId: p.releaseGroupId,
        downloadJobId: p.downloadJobId,
        message: p.message ?? "Queued",
        error: r.error_json ? JSON.parse(r.error_json).message : null,
        createdAt: r.created_at,
      };
    });
  }
  create(request: AcquireAlbumRequest): AcquisitionJob {
    if (request.artistId && request.releaseGroupId &&
      request.artistId.startsWith("apple:") !== request.releaseGroupId.startsWith("apple:"))
      throw new Error("Choose an artist and album from the same catalogue.");
    const root = request.libraryRootId
      ? this.library.getRoot(request.libraryRootId)
      : this.library.listRoots()[0];
    if (!root)
      throw new Error(
        "Add a library folder in Settings before downloading an album.",
      );
    if (request.albumId) {
      const album = this.library
        .listAlbumGroups()
        .find((a) => a.id === request.albumId);
      if (!album)
        throw new Error("The selected library album no longer exists.");
      request = { ...request, artist: album.artist, album: album.album };
    }
    const existing = this.list().find(
      (j) =>
        ["running", "queued"].includes(j.status) &&
        musicKey(j.artist) === musicKey(request.artist) &&
        musicKey(j.album) === musicKey(request.album),
    );
    if (existing) return existing;
    const id = nanoid();
    this.db
      .prepare(
        "INSERT INTO jobs (id,type,status,progress,payload_json) VALUES (?, 'album_acquisition','queued',0,?)",
      )
      .run(
        id,
        JSON.stringify({
          ...request,
          libraryRootId: root.id,
          message: "Queued for album research",
        }),
      );
    this.tick();
    return this.list().find((j) => j.id === id)!;
  }
  cancel(id: string) {
    const row = this.row(id);
    if (!["queued", "running"].includes(row.status)) return;
    const p = JSON.parse(row.payload_json) as Payload;
    if (p.downloadJobId) this.downloads.cancelJob(p.downloadJobId);
    this.db
      .prepare(
        "UPDATE jobs SET status='cancelled', cancel_requested=1, completed_at=datetime('now') WHERE id=?",
      )
      .run(id);
  }
  retry(id: string) {
    const row = this.row(id);
    if (!["failed", "cancelled"].includes(row.status))
      throw new Error("Only stopped requests can be retried.");
    const p = JSON.parse(row.payload_json) as Payload;
    // Keep the old download/import links so retry cannot duplicate already imported files.
    if (p.downloadJobId) {
      const job = this.downloads.getJob(p.downloadJobId);
      if (job.status === "failed") {
        this.retireSources(p);
        p.sourceRetries = 0;
      } else if (job.status === "cancelled") {
        this.downloads.retryJob(job.id);
      }
    }
    // A successful partial child may still have staged items awaiting metadata
    // or approval. Replay that batch before choosing sources for the remainder.
    this.db
      .prepare(
        "UPDATE jobs SET status='queued', payload_json=?, error_json=NULL, cancel_requested=0, completed_at=NULL WHERE id=?",
      )
      .run(JSON.stringify(p), id);
    this.tick();
  }
  private row(id: string): Row {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE id=? AND type='album_acquisition'")
      .get(id) as Row | undefined;
    if (!row) throw new Error("Album request not found.");
    return row;
  }
  private alive(id: string) {
    return !this.closed && ["queued", "running"].includes(this.row(id).status);
  }
  private save(id: string, p: Payload, message: string, progress: number) {
    if (!this.alive(id)) return;
    p.message = message;
    this.db
      .prepare(
        "UPDATE jobs SET status='running', payload_json=?, progress=?, started_at=COALESCE(started_at,datetime('now')) WHERE id=?",
      )
      .run(JSON.stringify(p), progress, id);
  }
  private tick() {
    if (this.closed) return;
    const rows = this.db
      .prepare(
        "SELECT id,payload_json FROM jobs WHERE type='album_acquisition' AND status IN ('queued','running') ORDER BY created_at,id",
      )
      .all() as { id: string; payload_json: string }[];
    for (const { id, payload_json } of rows)
      if (!this.active.has(id)) {
        const research = !(JSON.parse(payload_json) as Payload).downloadJobId;
        // Bound expensive research, while continuing to monitor every transfer.
        if (research && this.researching.size >= 2) continue;
        this.active.add(id);
        if (research) this.researching.add(id);
        void this.advance(id)
          .catch((error) => {
            if (this.alive(id))
              this.db
                .prepare(
                  "UPDATE jobs SET status='failed', error_json=?, completed_at=datetime('now') WHERE id=?",
                )
                .run(
                  JSON.stringify({
                    message:
                      error instanceof Error ? error.message : String(error),
                  }),
                  id,
                );
          })
          .finally(() => { this.active.delete(id); this.researching.delete(id); });
      }
  }
  private async advance(id: string) {
    const p = JSON.parse(this.row(id).payload_json) as Payload;
    if (!p.downloadJobId) {
      this.save(
        id,
        p,
        "Identifying the artist and matching an official track listing",
        0.05,
      );
      // Library completion must use the same verified edition as its missing-
      // track badge, even if a provider would now choose another release.
      if (p.albumId && !p.tracks?.length) {
        const local = this.library.listAlbumGroups().find((album) => album.id === p.albumId);
        const known = local && this.library.getAlbumCatalogue(local);
        if (known && (!p.artistId || p.artistId === known.artistId)
          && (!p.releaseGroupId || p.releaseGroupId === known.releaseGroupId)) {
          p.artistId = known.artistId;
          p.releaseGroupId = known.releaseGroupId;
          p.tracks = known.tracks;
          p.year = known.year ?? p.year;
        }
      }
      // Only internally persisted tracks paired with their already known IDs
      // have passed artist validation. Newly resolved identities still require
      // the provider's release lookup before any source search.
      const cachedTracks = p.artistId && p.releaseGroupId && p.tracks?.length ? p.tracks : undefined;
      if (!p.artistId || !p.releaseGroupId) {
        // A later, explicitly selected successful job can resolve an older
        // ambiguous request for the exact same artist/album without guessing.
        const previous = (this.db.prepare("SELECT payload_json FROM jobs WHERE type='album_acquisition' AND status='succeeded'").all() as { payload_json: string }[])
          .map((row) => JSON.parse(row.payload_json) as Payload)
          .filter((job) => job.artistId && job.releaseGroupId &&
            musicKey(job.artist) === musicKey(p.artist) && musicKey(job.album) === musicKey(p.album) &&
            (!p.artistId || p.artistId === job.artistId) && (!p.releaseGroupId || p.releaseGroupId === job.releaseGroupId));
        const identities = new Map(previous.map((job) => [job.artistId + ":" + job.releaseGroupId, job]));
        if (identities.size === 1) {
          const identity = [...identities.values()][0];
          p.artistId = identity.artistId;
          p.releaseGroupId = identity.releaseGroupId;
        }
      }
      const useApple = (p.releaseGroupId ?? p.artistId)?.startsWith("apple:");
      const catalogue = useApple ? this.appleCatalogue : this.catalogue;
      if (!catalogue && !cachedTracks) throw new Error("Apple catalogue is unavailable.");
      if (p.artistId && p.releaseGroupId &&
        p.artistId.startsWith("apple:") !== p.releaseGroupId.startsWith("apple:"))
        throw new Error("The artist and album belong to different catalogues.");
      let releaseTracks = cachedTracks;
      let releaseYear = p.year;
      if (!releaseTracks) {
        const load = async (provider: Pick<CatalogueService, "resolve" | "release">) => {
          const match = p.artistId && p.releaseGroupId
            ? { artistId: p.artistId, groupId: p.releaseGroupId }
            : await provider.resolve(p.artist, p.album);
          if ((p.artistId && match.artistId !== p.artistId) ||
            (p.releaseGroupId && match.groupId !== p.releaseGroupId))
            throw new Error("This release does not match the selected artist and album.");
          const release = await provider.release(match.groupId, p.artist, p.albumId);
          if (!release.artistIds.includes(match.artistId))
            throw new Error("This release does not belong to the selected artist.");
          if (release.trackListingComplete === false || !release.tracks.length)
            throw new Error("This track listing is partial. You can browse the available tracks, but a full album download needs a complete track list.");
          return { match, release };
        };
        // Unidentified library albums can use either catalogue. Try Apple's
        // faster lookup first, but keep selected and persisted editions pinned.
        let result;
        if (!p.artistId && !p.releaseGroupId && this.appleCatalogue) {
          try { result = await load(this.appleCatalogue); }
          catch (appleError) {
            this.save(id, p, "Checking MusicBrainz for a complete matching track listing", 0.07);
            try { result = await load(this.catalogue); }
            catch (musicBrainzError) {
              const message = (error: unknown) => error instanceof Error ? error.message : String(error);
              throw new Error("Could not verify this album with either catalogue. Apple: "
                + message(appleError) + " MusicBrainz: " + message(musicBrainzError));
            }
          }
        } else {
          result = await load(catalogue!);
        }
        p.artistId = result.match.artistId;
        p.releaseGroupId = result.match.groupId;
        releaseTracks = result.release.tracks;
        releaseYear = result.release.date?.slice(0, 4);
      }
      const local = this.library
        .listAlbumGroups()
        .find((a) =>
          p.albumId
            ? a.id === p.albumId
            : musicKey(a.artist) === musicKey(p.artist) &&
              musicKey(a.album) === musicKey(p.album),
        );
      p.year = local?.year ?? releaseYear;
      p.tracks = releaseTracks;
      const missing = missingReleaseTracks(releaseTracks, local?.files ?? []);
      if (!this.alive(id)) return;
      if (!missing.length) {
        this.finish(id, p, "All tracks are already in your library");
        return;
      }
      this.save(
        id,
        p,
        "Searching Soulseek for " +
          missing.length +
          " missing tracks; preferring lossless sources",
        0.12,
      );
      const results = new Map<string, AlbumFilePick["result"]>();
      let report = inspectReleaseFiles([], missing, p.artist, p.album, releaseTracks);
      const queries = albumSearchQueries(p.artist, p.album);
      const searched = new Set<string>();
      const browsedFolders = new Set<string>();
      let targeted = false;
      while (queries.length) {
        const query = queries.shift()!;
        if (searched.has(query.toLocaleLowerCase())) continue;
        searched.add(query.toLocaleLowerCase());
        if (!this.alive(id)) return;
        this.save(id, p,
          "Searching Soulseek: " + query + " · " + report.picks.length + "/" + missing.length
          + " tracks matched; waiting for peer responses", 0.12);
        const search = await this.discovery.search(query, 500, { waitForComplete: true, attempts: 1 });
        if (!this.alive(id)) return;
        const avoided = new Set(p.avoidedSources ?? []);
        for (const result of search.results) {
          const key = result.username + "\0" + result.path;
          if (!avoided.has(key)) results.set(key, result);
        }
        report = inspectReleaseFiles([...results.values()], missing, p.artist, p.album, releaseTracks);
        if (!report.missing.length) break;
        // A title search exposes only matching filenames, even when the peer
        // shares the entire album. Expand a few verified track anchors before
        // trying another query, then run the same strict release matcher.
        const folderKey = (result: AlbumFilePick["result"]) => result.username + "\0"
          + (result.folder ?? result.path.replace(/[\\/][^\\/]+$/, "")).replaceAll("/", "\\");
        const isLossless = (result: AlbumFilePick["result"]) =>
          /^(flac|alac|wav|aiff|ape)$/i.test(result.extension || result.filename.split(".").at(-1) || "");
        const anchors = [...results.values()]
          .filter((result) => !browsedFolders.has(folderKey(result))
            && inspectReleaseFiles([result], missing, p.artist, p.album, releaseTracks).picks.length > 0)
          .sort((a, b) => Number(isLossless(b)) - Number(isLossless(a)) || compareDiscoveryResultAvailability(a, b));
        for (const anchor of anchors) {
          if (browsedFolders.size >= 3 || !report.missing.length) break;
          const key = folderKey(anchor);
          if (browsedFolders.has(key)) continue;
          if (!this.alive(id)) return;
          browsedFolders.add(key);
          this.save(id, p, "Found a matching track; checking the peer's album folder · "
            + report.picks.length + "/" + missing.length + " tracks matched", 0.15);
          let expanded: AlbumFilePick["result"][];
          try { expanded = await this.discovery.browseResultFolder(anchor); }
          catch { continue; } // Offline or private folders must not block other peers/queries.
          if (!this.alive(id)) return;
          for (const result of expanded) {
            const source = result.username + "\0" + result.path;
            if (!avoided.has(source)) results.set(source, result);
          }
          report = inspectReleaseFiles([...results.values()], missing, p.artist, p.album, releaseTracks);
        }
        if (!report.missing.length) break;
        // Album queries may miss punctuation or files shared outside the expected
        // folder. Try a bounded set of missing titles, keeping artist/album checks.
        if (!queries.length && !targeted) {
          targeted = true;
          queries.push(...report.missing.slice(0, 2).map((track) =>
            (p.artist + " " + track.title).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()));
        }
      }
      if (report.missing.length)
        throw new Error(albumMatchFailure(report, results.size, searched.size));
      p.picks = report.picks;
      const download = this.downloads.createJob(
        p.picks.map((pick) => pick.result),
        p.libraryRootId,
        { queuedTimeoutMs: 120_000 },
      );
      p.downloadJobId = download.id;
      this.save(
        id,
        p,
        "Matched " + p.picks.length + " tracks from " + new Set(p.picks.map((pick) => pick.result.username)).size
          + " peer(s). Downloading automatically",
        0.2,
      );
      return;
    }
    const download = this.downloads.getJob(p.downloadJobId);
    if (download.status === "failed") {
      if (this.researchAnotherSource(id, p, "The selected peer failed")) return;
      throw new Error(download.error ?? "Available download sources failed after alternate-source retries.");
    }
    if (download.status === "cancelled")
      throw new Error(download.error ?? "The download was stopped.");
    if (download.status !== "succeeded" || !download.imported) {
      this.save(
        id,
        p,
        download.message ?? "Downloading from Soulseek",
        0.2 + download.progress * 0.6,
      );
      return;
    }
    this.save(
      id,
      p,
      "Applying the selected artist and importing completed tracks",
      0.85,
    );
    const batch = this.imports.getImport(download.imported.id);
    for (const item of batch.items) {
      if (!this.alive(id)) return;
      if (item.status === "imported" || item.status === "rejected") continue;
      const stagedSize = (await stat(item.stagingPath)).size;
      const matches = p.picks?.filter((pick) =>
        item.stagingPath.toLowerCase().endsWith("-" + pick.result.filename.toLowerCase())
          && (pick.result.sizeBytes == null || pick.result.sizeBytes === stagedSize),
      ) ?? [];
      const pick = matches.length === 1 ? matches[0] : undefined;
      if (!pick)
        throw new Error(
          "A downloaded file could not be matched to the requested track. It remains in Imports for review.",
        );
      const owned = this.library
        .listAlbumGroups()
        .filter(
          (a) =>
            musicKey(a.artist) === musicKey(p.artist) &&
            musicKey(a.album) === musicKey(p.album),
        )
        .flatMap((a) => a.files);
      if (missingReleaseTracks([pick.track], owned, p.tracks).length === 0) {
        this.imports.rejectItem(item.id);
        continue;
      }
      this.imports.updateItemMetadata(item.id, {
        artist: p.artist,
        album: p.album,
        title: pick.track.title,
        year: p.year ?? null,
      });
      if (item.fileId)
        this.library.setFileMetadataOverrides(item.fileId, {
          artist: p.artist,
          albumartist: p.artist,
          album: p.album,
          title: pick.track.title,
          year: p.year ?? null,
          tracknumber:
            String(pick.track.number) +
            "/" +
            (p.tracks?.filter((t) => t.disc === pick.track.disc).length ??
              pick.track.number),
          discnumber: String(pick.track.disc),
        });
      await this.imports.approveItem(item.id, p.libraryRootId!);
    }
    if (!this.alive(id)) return;
    if (download.completedCount < download.selectedCount) {
      if (this.researchAnotherSource(id, p, "Completed tracks were imported; finding the remaining tracks")) return;
      throw new Error(
        "Completed tracks were imported, but alternate sources could not complete the album. Retry to search again.",
      );
    }
    this.finish(id, p, "Album imported under " + p.artist);
  }
  private retireSources(p: Payload) {
    p.avoidedSources = [...new Set([...(p.avoidedSources ?? []),
      ...(p.picks ?? []).map((pick) => pick.result.username + "\0" + pick.result.path)])];
    if (p.downloadJobId)
      p.previousDownloadJobIds = [...new Set([...(p.previousDownloadJobIds ?? []), p.downloadJobId])];
    delete p.downloadJobId;
    delete p.picks;
  }
  private researchAnotherSource(id: string, p: Payload, reason: string): boolean {
    if (!this.alive(id) || (p.sourceRetries ?? 0) >= 2) return false;
    p.sourceRetries = (p.sourceRetries ?? 0) + 1;
    this.retireSources(p);
    this.save(id, p, reason + "; trying alternate sources (" + p.sourceRetries + "/2)", 0.1);
    return true;
  }
  private finish(id: string, p: Payload, message: string) {
    this.save(id, p, message, 1);
    this.db
      .prepare(
        "UPDATE jobs SET status='succeeded',completed_at=datetime('now') WHERE id=? AND status='running'",
      )
      .run(id);
  }
}
