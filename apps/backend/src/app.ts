import { healthResponseSchema, type HealthResponse } from "@music-os/core";
import { openMusicDatabase } from "@music-os/db";
import type Database from "better-sqlite3";
import type { BackendConfig } from "./config.js";
import { LibraryRepository } from "./services/library-repository.js";
import { LibraryScanner } from "./services/library-scanner.js";
import { PlaybackService } from "./services/playback-service.js";
import { ImportService } from "./services/import-service.js";
import { MetadataResolver } from "./services/metadata-resolver.js";
import { AcousticFingerprintService } from "./services/acoustic-fingerprint-service.js";
import { OperationService } from "./services/operation-service.js";
import { PlaylistService } from "./services/playlist-service.js";
import { AgentService } from "./services/agent-service.js";
import { AgentThreadService } from "./services/agent-thread-service.js";
import { SlskdService } from "./services/slskd-service.js";
import { DiscoveryDownloadService } from "./services/discovery-download-service.js";
import { SavedDiscoveryCandidateService } from "./services/saved-discovery-candidate-service.js";
import { SavedDiscoveryListService } from "./services/saved-discovery-list-service.js";
import { JobService } from "./services/job-service.js";
import { TasteProfileService } from "./services/taste-profile-service.js";
import { PlaybackHistoryService } from "./services/playback-history-service.js";
import { ArtworkService } from "./services/artwork-service.js";
import { WaveformService } from "./services/waveform-service.js";
import { VisualizerService } from "./services/visualizer-service.js";
import { LiveAnalyzerService } from "./services/live-analyzer-service.js";

export interface BackendApp {
  db: Database.Database;
  library: LibraryRepository;
  scanner: LibraryScanner;
  playback: PlaybackService;
  imports: ImportService;
  operations: OperationService;
  playlists: PlaylistService;
  agent: AgentService;
  agentThreads: AgentThreadService;
  discovery: SlskdService;
  discoveryDownloads: DiscoveryDownloadService;
  savedDiscoveryCandidates: SavedDiscoveryCandidateService;
  savedDiscoveryLists: SavedDiscoveryListService;
  jobs: JobService;
  tasteProfile: TasteProfileService;
  playbackHistory: PlaybackHistoryService;
  artwork: ArtworkService;
  waveforms: WaveformService;
  visualizer: VisualizerService;
  health(): HealthResponse;
  close(): void;
}

export function createBackendApp(config: BackendConfig): BackendApp {
  const db = openMusicDatabase({ path: config.databasePath });
  const library = new LibraryRepository(db);
  const scanner = new LibraryScanner(library);
  const playbackHistory = new PlaybackHistoryService(db);
  const playback = new PlaybackService(config, playbackHistory);
  const metadata = new MetadataResolver(config);
  const fingerprints = new AcousticFingerprintService(config);
  const imports = new ImportService(db, library, config, metadata, fingerprints);
  const discovery = new SlskdService(config);
  const discoveryDownloads = new DiscoveryDownloadService(db, discovery, imports);
  const savedDiscoveryCandidates = new SavedDiscoveryCandidateService(db);
  const savedDiscoveryLists = new SavedDiscoveryListService(db);
  const operations = new OperationService(db, imports, library, discoveryDownloads);
  const playlists = new PlaylistService(db, library);
  const agent = new AgentService(library, operations, playback, discovery, imports);
  const agentThreads = new AgentThreadService(db, agent);
  const jobs = new JobService(db);
  const tasteProfile = new TasteProfileService(db);
  const artwork = new ArtworkService(library, config);
  const waveforms = new WaveformService(config);
  const liveAnalyzer = new LiveAnalyzerService(config);
  const visualizer = new VisualizerService(playback, waveforms, liveAnalyzer);

  return {
    db,
    library,
    scanner,
    playback,
    imports,
    operations,
    playlists,
    agent,
    agentThreads,
    discovery,
    discoveryDownloads,
    savedDiscoveryCandidates,
    savedDiscoveryLists,
    jobs,
    tasteProfile,
    playbackHistory,
    artwork,
    waveforms,
    visualizer,
    health() {
      return healthResponseSchema.parse({
        status: "ok",
        app: "music-os-backend",
        database: {
          connected: db.open,
          path: config.databasePath
        },
        playback: {
          mpvPath: config.mpvPath
        },
        checkedAt: new Date().toISOString()
      });
    },
    close() {
      visualizer.close();
      waveforms.close();
      playback.close();
      db.close();
    }
  };
}
