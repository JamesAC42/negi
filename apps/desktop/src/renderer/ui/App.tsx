import { Fragment, memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode
} from "react";
import {
  clusterDiscoveryGroups,
  createDiscoveryLibraryIndex,
  filterDiscoveryGroups,
  getDiscoveryFolderLabel,
  groupDiscoveryResults,
  isAudioDiscoveryResult,
  sortDiscoveryGroups,
  summarizeDiscoveryLibraryMatch,
  type DiscoveryAvailabilityFilter,
  type DiscoveryCluster,
  type DiscoveryFormatFilter,
  type DiscoveryGroup,
  type DiscoveryLibraryFile,
  type DiscoveryLibraryFilter,
  type DiscoveryLibraryMatch,
  type DiscoverySort
} from "../discovery-candidates.js";
import {
  albumGroupsResponseSchema,
  albumMergeSuggestionsResponseSchema,
  agentMessageResponseSchema,
  agentRunResponseSchema,
  agentThreadResponseSchema,
  agentThreadsResponseSchema,
  alternateEditionGroupsResponseSchema,
  discoveryDownloadJobResponseSchema,
  discoveryDownloadJobsResponseSchema,
  discoveryDownloadResponseSchema,
  discoveryHealthResponseSchema,
  savedDiscoveryCandidateResponseSchema,
  savedDiscoveryCandidatesResponseSchema,
  savedDiscoveryListResponseSchema,
  savedDiscoveryListsResponseSchema,
  discoverySearchResponseSchema,
  duplicateGroupsResponseSchema,
  healthResponseSchema,
  importBatchResponseSchema,
  importItemResponseSchema,
  incompleteAlbumsResponseSchema,
  importsInboxResponseSchema,
  jobResponseSchema,
  jobsResponseSchema,
  libraryFilesResponseSchema,
  libraryRootResponseSchema,
  libraryRootsResponseSchema,
  libraryScanResultSchema,
  metadataDiagnosticsResponseSchema,
  metadataGapsResponseSchema,
  operationBatchResponseSchema,
  operationBatchesResponseSchema,
  playbackStateSchema,
  visualizerCapabilitiesSchema,
  visualizerFrameSchema,
  waveformResponseSchema,
  playlistsResponseSchema,
  qualityUpgradeSuggestionsResponseSchema,
  tasteProfileResponseSchema,
  watchedLibraryScanResultSchema,
  type AgentRun,
  type AgentMessageResponse,
  type AgentParsedListItem,
  type AgentThreadResponse,
  type AgentThreadsResponse,
  type AlbumGroupsResponse,
  type AlbumMergeSuggestionsResponse,
  type AlternateEditionGroupsResponse,
  type DiscoveryDownloadJob,
  type DiscoveryDownloadResponse,
  type DiscoveryHealthResponse,
  type DiscoveryResult,
  type DiscoverySearchResponse,
  type DiscoverySource,
  type SaveDiscoveryCandidateRequest,
  type SavedDiscoveryCandidate,
  type SavedDiscoveryCandidatesResponse,
  type SaveDiscoveryListRequest,
  type SavedDiscoveryList,
  type SavedDiscoveryListsResponse,
  type HealthResponse,
  type ImportBatch,
  type ImportItem,
  type IncompleteAlbumsResponse,
  type JobEvent,
  type JobResponse,
  type JobSummary,
  type DuplicateGroupsResponse,
  type EditableFileMetadata,
  type LibraryFilesResponse,
  type LibraryRoot,
  type LibraryScanResult,
  type WatchedLibraryScanResult,
  type MetadataCandidate,
  type MetadataDiagnosticsResponse,
  type MetadataGapsResponse,
  type OperationBatch,
  type PlaybackStateResponse,
  type Playlist,
  type QualityUpgradeSuggestionsResponse,
  type TasteProfile,
  type TasteProfileResponse,
  type VisualizerCapabilitiesResponse,
  type VisualizerFrameResponse,
  type VisualizerStreamMode,
  type WaveformResponse,
  type WaveformSummaryResponse
} from "@music-os/core";

type HealthState =
  | { status: "loading" }
  | { status: "ready"; health: HealthResponse }
  | { status: "error"; message: string };

type LibraryState =
  | { status: "loading" }
  | { status: "ready"; roots: LibraryRoot[]; files: LibraryFilesResponse["files"]; total: number }
  | { status: "error"; message: string; roots: LibraryRoot[]; files: LibraryFilesResponse["files"]; total: number };

type QueueInsertPosition = "up_next" | "end";
type PlaybackRepeatMode = PlaybackStateResponse["repeatMode"];
type VisualizerMode = VisualizerStreamMode;
type WaveformState =
  | { status: "idle"; waveform: null; message: null }
  | { status: WaveformResponse["status"]; waveform: WaveformSummaryResponse | null; message: string | null };

type ImportsState =
  | { status: "loading" }
  | { status: "ready"; imports: ImportBatch[] }
  | { status: "error"; message: string; imports: ImportBatch[] };

type DuplicatesState =
  | { status: "loading" }
  | { status: "ready"; duplicates: DuplicateGroupsResponse }
  | { status: "error"; message: string; duplicates: DuplicateGroupsResponse };

type MetadataGapsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; gaps: MetadataGapsResponse }
  | { status: "error"; message: string; gaps: MetadataGapsResponse };

type QualityUpgradesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; upgrades: QualityUpgradeSuggestionsResponse }
  | { status: "error"; message: string; upgrades: QualityUpgradeSuggestionsResponse };

type IncompleteAlbumsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; albums: IncompleteAlbumsResponse }
  | { status: "error"; message: string; albums: IncompleteAlbumsResponse };

type AlbumMergeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; suggestions: AlbumMergeSuggestionsResponse }
  | { status: "error"; message: string; suggestions: AlbumMergeSuggestionsResponse };

type AlternateEditionsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; editions: AlternateEditionGroupsResponse }
  | { status: "error"; message: string; editions: AlternateEditionGroupsResponse };

type OperationsState =
  | { status: "loading" }
  | { status: "ready"; batches: OperationBatch[] }
  | { status: "error"; message: string; batches: OperationBatch[] };

type PlaylistsState =
  | { status: "loading" }
  | { status: "ready"; playlists: Playlist[] }
  | { status: "error"; message: string; playlists: Playlist[] };

type AlbumsState =
  | { status: "loading" }
  | { status: "ready"; albums: AlbumGroupsResponse }
  | { status: "error"; message: string; albums: AlbumGroupsResponse };

type JobsState =
  | { status: "loading"; jobs: JobSummary[] }
  | { status: "ready"; jobs: JobSummary[] }
  | { status: "error"; message: string; jobs: JobSummary[] };

type DiscoveryState =
  | { status: "idle"; health: DiscoveryHealthResponse | null; results: DiscoveryResult[]; query: string }
  | { status: "searching"; health: DiscoveryHealthResponse | null; results: DiscoveryResult[]; query: string }
  | { status: "ready"; health: DiscoveryHealthResponse | null; results: DiscoveryResult[]; query: string }
  | { status: "error"; health: DiscoveryHealthResponse | null; results: DiscoveryResult[]; query: string; message: string };

type DiscoveryReleaseFilter = "recommended" | "all" | "albums" | "singles" | "collections" | "upgrades";

type TasteProfileState =
  | { status: "loading" }
  | { status: "ready"; profile: TasteProfileResponse }
  | { status: "saving"; profile: TasteProfileResponse }
  | { status: "error"; message: string; profile: TasteProfileResponse };

type LibraryFile = LibraryFilesResponse["files"][number];
type LibraryDuplicateGroup = DuplicateGroupsResponse["groups"][number];
type LibraryAlbumMergeSuggestion = AlbumMergeSuggestionsResponse["suggestions"][number];
type LibraryAlbumGroup = {
  key: string;
  artist: string;
  album: string;
  year: string | null;
  formats: string[];
  files: LibraryFile[];
};
type AlbumGroupItem = AlbumGroupsResponse["albums"][number];

type AgentMessage =
  | { id: string; role: "user"; text: string; response?: null }
  | { id: string; role: "agent"; text: string; response: AgentMessageResponse | null; run?: AgentRun | null };

type DiagnosticsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; diagnostics: MetadataDiagnosticsResponse }
  | { status: "error"; message: string };

type ParsedDiscoveryListState =
  | { status: "idle"; items: AgentParsedListItem[]; message: string | null }
  | { status: "parsing"; items: AgentParsedListItem[]; message: string | null }
  | { status: "ready"; items: AgentParsedListItem[]; message: string | null }
  | { status: "error"; items: AgentParsedListItem[]; message: string };

type LibraryFormatFilter = "all" | "lossless" | "compressed";
type LibraryMissingFilter = "all" | "present" | "missing";
type LibraryFavoriteFilter = "all" | "liked" | "disliked" | "unrated";
type LibrarySortMode = "artistAlbum" | "recent" | "listens" | "likes" | "rating";
type AlbumSortMode = "artistAlbum" | "recent" | "listens" | "likes" | "rating";
type ArtistSortMode = "artist" | "recent" | "listens" | "likes" | "rating";
type AlbumGroupMode = "all" | "artist" | "genre" | "decade";
type AlbumFacetFilter = { genre: string; decade: string };
type ArtistViewTarget = { key: number; artist: string };
type AlbumViewTarget = { key: number; albumId: string };
type ArtistSongSortMode = "listens" | "ranking" | "albumYear";
type AppearanceMode = "dark" | "light";
type AccentColorId = "lime" | "cyan" | "amber" | "rose" | "violet";
type DisplayFontId = "space" | "mono" | "system" | "wide";
type SelectedBackgroundImage = { path: string; url: string };
type SavedBackgroundImage = { id: string; name: string; path: string; url: string; addedAt: string };
type AppearanceBackgrounds = Record<AppearanceMode, SelectedBackgroundImage | null>;
type AppearanceSettings = {
  accent: AccentColorId;
  backgroundImagePath: string | null;
  backgroundImageUrl: string | null;
  backgroundDefaults: AppearanceBackgrounds;
  backgroundImages: SavedBackgroundImage[];
  displayFont: DisplayFontId;
  mode: AppearanceMode;
};

const emptyDuplicates: DuplicateGroupsResponse = { groups: [], totalGroups: 0, totalFiles: 0 };
const emptyMetadataGaps: MetadataGapsResponse = { items: [], total: 0 };
const emptyQualityUpgrades: QualityUpgradeSuggestionsResponse = { suggestions: [], total: 0 };
const emptyIncompleteAlbums: IncompleteAlbumsResponse = { albums: [], total: 0 };
const emptyAlbumMergeSuggestions: AlbumMergeSuggestionsResponse = { suggestions: [], total: 0 };
const emptyAlternateEditions: AlternateEditionGroupsResponse = { groups: [], total: 0 };
const emptyAlbums: AlbumGroupsResponse = { albums: [], total: 0 };
const libraryPageSize = 700;
const albumPageSize = 180;
const backendOrigin = "http://127.0.0.1:47831";
const emptyTasteProfile: TasteProfileResponse = {
  profile: {
    favoriteArtists: [],
    favoriteAlbums: [],
    favoriteTracks: [],
    preferredGenres: [],
    preferredEras: [],
    preferredCountries: [],
    preferredLabels: [],
    blockedArtists: [],
    blockedGenres: [],
    overplayedTracks: [],
    preferredFormats: [],
    qualityPreferences: {
      preferLossless: true,
      allowMp3IfRare: true,
      minimumBitrateKbps: null
    },
    taggingPreferences: "",
    folderOrganizationPreferences: "",
    playlistStylePreferences: "",
    notes: ""
  },
  entries: [],
  updatedAt: null
};

const navSections = [
  { label: "Browse", items: ["Home", "Library", "Artists", "Albums", "Playlists"] },
  { label: "Manage", items: ["Discovery", "Imports", "Duplicates", "Operations", "Jobs"] },
  { label: "System", items: ["Agent", "Settings"] }
];
const appearanceStorageKey = "music-os:appearance:v1";
const visualizerModeStorageKey = "music-os:visualizer-mode:v1";
const defaultAppearanceSettings: AppearanceSettings = {
  accent: "lime",
  backgroundImagePath: null,
  backgroundImageUrl: null,
  backgroundDefaults: { dark: null, light: null },
  backgroundImages: [],
  displayFont: "space",
  mode: "dark"
};
const appearanceModes: AppearanceMode[] = ["dark", "light"];
const accentPalettes: Record<AccentColorId, { label: string; dark: AccentPalette; light: AccentPalette }> = {
  lime: {
    label: "Lime",
    dark: { acc: "#c3f53c", accDim: "rgba(195, 245, 60, 0.12)", accInk: "#10130a", accLine: "rgba(195, 245, 60, 0.38)", okLine: "#4c5f2c" },
    light: { acc: "#6e9f00", accDim: "rgba(110, 159, 0, 0.14)", accInk: "#f8fbf0", accLine: "rgba(110, 159, 0, 0.36)", okLine: "#b8cc86" }
  },
  cyan: {
    label: "Cyan",
    dark: { acc: "#62d7f4", accDim: "rgba(98, 215, 244, 0.13)", accInk: "#061014", accLine: "rgba(98, 215, 244, 0.4)", okLine: "#2d5965" },
    light: { acc: "#007b95", accDim: "rgba(0, 123, 149, 0.13)", accInk: "#effcff", accLine: "rgba(0, 123, 149, 0.34)", okLine: "#8fc3cf" }
  },
  amber: {
    label: "Amber",
    dark: { acc: "#f2b84b", accDim: "rgba(242, 184, 75, 0.14)", accInk: "#160f04", accLine: "rgba(242, 184, 75, 0.38)", okLine: "#6b5528" },
    light: { acc: "#a86600", accDim: "rgba(168, 102, 0, 0.13)", accInk: "#fff8ec", accLine: "rgba(168, 102, 0, 0.34)", okLine: "#d8b983" }
  },
  rose: {
    label: "Rose",
    dark: { acc: "#ff7aa7", accDim: "rgba(255, 122, 167, 0.13)", accInk: "#17070d", accLine: "rgba(255, 122, 167, 0.38)", okLine: "#6a3348" },
    light: { acc: "#b83d68", accDim: "rgba(184, 61, 104, 0.12)", accInk: "#fff3f7", accLine: "rgba(184, 61, 104, 0.34)", okLine: "#dda0b5" }
  },
  violet: {
    label: "Violet",
    dark: { acc: "#a994ff", accDim: "rgba(169, 148, 255, 0.13)", accInk: "#0d091d", accLine: "rgba(169, 148, 255, 0.38)", okLine: "#514778" },
    light: { acc: "#6954bb", accDim: "rgba(105, 84, 187, 0.12)", accInk: "#f7f4ff", accLine: "rgba(105, 84, 187, 0.34)", okLine: "#b1a8db" }
  }
};
const displayFonts: Record<DisplayFontId, { label: string; value: string }> = {
  space: { label: "Space Grotesk", value: "\"Space Grotesk Variable\", \"Space Grotesk\", \"JetBrains Mono Variable\", sans-serif" },
  mono: { label: "JetBrains Mono", value: "\"JetBrains Mono Variable\", \"JetBrains Mono\", ui-monospace, monospace" },
  system: { label: "System Sans", value: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif" },
  wide: { label: "Wide System", value: "\"Arial Black\", \"Arial\", ui-sans-serif, system-ui, sans-serif" }
};

type AccentPalette = { acc: string; accDim: string; accInk: string; accLine: string; okLine: string };

export function App(): ReactElement {
  const discoverySearchRequestId = useRef(0);
  const pageTargetRequestId = useRef(0);
  const selectedJobIdRef = useRef<string | null>(null);
  const playbackRef = useRef<PlaybackStateResponse | null>(null);
  const [activeView, setActiveView] = useState("Home");
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [library, setLibrary] = useState<LibraryState>({
    status: "loading"
  });
  const [importsState, setImportsState] = useState<ImportsState>({ status: "loading" });
  const [duplicatesState, setDuplicatesState] = useState<DuplicatesState>({ status: "loading" });
  const [metadataGapsState, setMetadataGapsState] = useState<MetadataGapsState>({ status: "idle" });
  const [qualityUpgradesState, setQualityUpgradesState] = useState<QualityUpgradesState>({ status: "idle" });
  const [incompleteAlbumsState, setIncompleteAlbumsState] = useState<IncompleteAlbumsState>({ status: "idle" });
  const [albumMergeState, setAlbumMergeState] = useState<AlbumMergeState>({ status: "idle" });
  const [alternateEditionsState, setAlternateEditionsState] = useState<AlternateEditionsState>({ status: "idle" });
  const [operationsState, setOperationsState] = useState<OperationsState>({ status: "loading" });
  const [albumsState, setAlbumsState] = useState<AlbumsState>({ status: "loading" });
  const [playlistsState, setPlaylistsState] = useState<PlaylistsState>({ status: "loading" });
  const [jobsState, setJobsState] = useState<JobsState>({ status: "loading", jobs: [] });
  const [tasteProfileState, setTasteProfileState] = useState<TasteProfileState>({ status: "loading" });
  const [tasteProfileDraft, setTasteProfileDraft] = useState<TasteProfile>(emptyTasteProfile.profile);
  const [selectedJobDetail, setSelectedJobDetail] = useState<JobResponse | null>(null);
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>({
    status: "idle",
    health: null,
    results: [],
    query: ""
  });
  const [rootPath, setRootPath] = useState("");
  const [rootWatchEnabled, setRootWatchEnabled] = useState(false);
  const [importPaths, setImportPaths] = useState("");
  const [busyImportBatchId, setBusyImportBatchId] = useState<string | null>(null);
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [discoverySource, setDiscoverySource] = useState<DiscoverySource>("slskd");
  const [pastedDiscoveryList, setPastedDiscoveryList] = useState("");
  const [parsedDiscoveryList, setParsedDiscoveryList] = useState<ParsedDiscoveryListState>({
    status: "idle",
    items: [],
    message: null
  });
  const [expandedDiscoveryGroups, setExpandedDiscoveryGroups] = useState<Set<string>>(new Set());
  const [expandedDiscoveryClusters, setExpandedDiscoveryClusters] = useState<Set<string>>(new Set());
  const [inspectedDiscoveryGroupId, setInspectedDiscoveryGroupId] = useState<string | null>(null);
  const [selectedDiscoveryGroups, setSelectedDiscoveryGroups] = useState<Set<string>>(new Set());
  const [selectedDiscoveryFiles, setSelectedDiscoveryFiles] = useState<Set<string>>(new Set());
  const [discoverySort, setDiscoverySort] = useState<DiscoverySort>("best");
  const [discoveryFormatFilter, setDiscoveryFormatFilter] = useState<DiscoveryFormatFilter>("all");
  const [discoveryAvailabilityFilter, setDiscoveryAvailabilityFilter] = useState<DiscoveryAvailabilityFilter>("available");
  const [discoveryLibraryFilter, setDiscoveryLibraryFilter] = useState<DiscoveryLibraryFilter>("actionable");
  const [discoveryDownloadState, setDiscoveryDownloadState] = useState<{ status: "idle" | "working"; message: string | null }>({
    status: "idle",
    message: null
  });
  const [discoveryDownloadJobs, setDiscoveryDownloadJobs] = useState<DiscoveryDownloadJob[]>([]);
  const [savedDiscoveryCandidates, setSavedDiscoveryCandidates] = useState<SavedDiscoveryCandidate[]>([]);
  const [savedDiscoveryLists, setSavedDiscoveryLists] = useState<SavedDiscoveryList[]>([]);
  const [agentInput, setAgentInput] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      id: "agent-welcome",
      role: "agent",
      text: "Ask me to find tracks, play matching tracks, or propose a playlist from the indexed library.",
      response: null
    }
  ]);
  const [agentThreadId, setAgentThreadId] = useState<string | null>(null);
  const [agentThreads, setAgentThreads] = useState<AgentThreadsResponse["threads"]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [loadedLibraryQuery, setLoadedLibraryQuery] = useState("");
  const [bulkRenamePattern, setBulkRenamePattern] = useState("{artist} - {title}.{ext}");
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [playlistNameInput, setPlaylistNameInput] = useState("");
  const [playlistDescriptionInput, setPlaylistDescriptionInput] = useState("");
  const [playlistAddTargetId, setPlaylistAddTargetId] = useState("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [selectedLibraryFileIds, setSelectedLibraryFileIds] = useState<Set<string>>(new Set());
  const [scanResult, setScanResult] = useState<LibraryScanResult | null>(null);
  const [watchedScanResult, setWatchedScanResult] = useState<WatchedLibraryScanResult | null>(null);
  const [busyRootId, setBusyRootId] = useState<string | null>(null);
  const [playbackBusy, setPlaybackBusy] = useState(false);
  const [libraryLoadingMore, setLibraryLoadingMore] = useState(false);
  const [albumsLoadingMore, setAlbumsLoadingMore] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>(() => loadVisualizerMode());
  const [visualizerCapabilities, setVisualizerCapabilities] = useState<VisualizerCapabilitiesResponse | null>(null);
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearanceSettings());
  const [artistsViewResetKey, setArtistsViewResetKey] = useState(0);
  const [albumsViewResetKey, setAlbumsViewResetKey] = useState(0);
  const [artistViewTarget, setArtistViewTarget] = useState<ArtistViewTarget | null>(null);
  const [albumViewTarget, setAlbumViewTarget] = useState<AlbumViewTarget | null>(null);
  const [editingFile, setEditingFile] = useState<LibraryFile | null>(null);
  const [diagnosticsState, setDiagnosticsState] = useState<DiagnosticsState>({ status: "idle" });
  const [playback, setPlayback] = useState<PlaybackStateResponse>({
    status: "stopped",
    currentFileId: null,
    currentPath: null,
    currentDisplayName: null,
    positionMs: 0,
    durationMs: null,
    queue: [],
    queueIndex: null,
    repeatMode: "none",
    volumePercent: 100,
    error: null
  });
  const playbackTickFileIdRef = useRef<string | null>(null);
  const documentVisible = useDocumentVisible();
  const reducedMotion = useReducedMotion();
  const effectiveVisualizerMode = getEffectiveVisualizerMode(visualizerMode, visualizerCapabilities, reducedMotion);
  const liveVisualizersEnabled = documentVisible && !reducedMotion;
  const nowPlayingStreamMode: VisualizerMode = visualizerCapabilities?.spectrogram === "available" && !reducedMotion
    ? "spectrogram"
    : effectiveVisualizerMode;
  const barVisualizer = useVisualizerStream(liveVisualizersEnabled && playback.status !== "stopped", "spectrum", playback.currentFileId);
  const modalVisualizer = useVisualizerStream(
    liveVisualizersEnabled && nowPlayingOpen && playback.status !== "stopped",
    nowPlayingStreamMode,
    playback.currentFileId
  );
  const currentWaveform = useWaveform(playback.currentFileId, documentVisible && playback.status !== "stopped");

  useEffect(() => {
    window.localStorage.setItem(appearanceStorageKey, JSON.stringify(appearance));
  }, [appearance]);

  useEffect(() => {
    window.localStorage.setItem(visualizerModeStorageKey, visualizerMode);
  }, [visualizerMode]);

  useEffect(() => {
    void getVisualizerCapabilities()
      .then(setVisualizerCapabilities)
      .catch(() => setVisualizerCapabilities(null));
  }, []);

  useEffect(() => {
    const nextMode = getEffectiveVisualizerMode(visualizerMode, visualizerCapabilities, reducedMotion);
    if (nextMode !== visualizerMode) {
      setVisualizerMode(nextMode);
    }
  }, [reducedMotion, visualizerCapabilities, visualizerMode]);

  async function refreshLibrary(query = search): Promise<void> {
    try {
      const [rootsResult, filesResult] = await Promise.all([listRoots(), listFiles(query, 0, libraryPageSize)]);
      setLibrary({
        status: "ready",
        roots: rootsResult.roots,
        files: filesResult.files,
        total: filesResult.total
      });
      setLoadedLibraryQuery(query);
    } catch (error) {
      setLibrary((current) => ({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        roots: "roots" in current ? current.roots : [],
        files: "files" in current ? current.files : [],
        total: "total" in current ? current.total : 0
      }));
    }
  }

  async function loadMoreLibrary(): Promise<void> {
    if (libraryLoadingMore || library.status !== "ready" || library.files.length >= library.total) {
      return;
    }

    setLibraryLoadingMore(true);
    try {
      const result = await listFiles(loadedLibraryQuery, library.files.length, libraryPageSize);
      setLibrary((current) => {
        if (current.status !== "ready") {
          return current;
        }
        return {
          ...current,
          files: mergeFilesById(current.files, result.files),
          total: result.total
        };
      });
    } catch (error) {
      setLibrary((current) => ({
        status: "error",
        message: getErrorMessage(error),
        roots: "roots" in current ? current.roots : [],
        files: "files" in current ? current.files : [],
        total: "total" in current ? current.total : 0
      }));
    } finally {
      setLibraryLoadingMore(false);
    }
  }

  async function refreshImports(): Promise<void> {
    try {
      const result = await listImportInbox();
      setImportsState({ status: "ready", imports: result.imports });
    } catch (error) {
      setImportsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        imports: "imports" in current ? current.imports : []
      }));
    }
  }

  async function refreshDuplicates(): Promise<void> {
    try {
      const result = await listDuplicates();
      setDuplicatesState({ status: "ready", duplicates: result });
    } catch (error) {
      setDuplicatesState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        duplicates: "duplicates" in current ? current.duplicates : emptyDuplicates
      }));
    }
  }

  async function refreshMetadataGaps(): Promise<void> {
    setMetadataGapsState((current) => ({ status: "loading", gaps: "gaps" in current ? current.gaps : emptyMetadataGaps }));
    try {
      const result = await listMetadataGaps();
      setMetadataGapsState({ status: "ready", gaps: result });
    } catch (error) {
      setMetadataGapsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        gaps: "gaps" in current ? current.gaps : emptyMetadataGaps
      }));
    }
  }

  async function refreshQualityUpgrades(): Promise<void> {
    setQualityUpgradesState((current) => ({ status: "loading", upgrades: "upgrades" in current ? current.upgrades : emptyQualityUpgrades }));
    try {
      const result = await listQualityUpgrades();
      setQualityUpgradesState({ status: "ready", upgrades: result });
    } catch (error) {
      setQualityUpgradesState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        upgrades: "upgrades" in current ? current.upgrades : emptyQualityUpgrades
      }));
    }
  }

  async function refreshIncompleteAlbums(): Promise<void> {
    setIncompleteAlbumsState((current) => ({ status: "loading", albums: "albums" in current ? current.albums : emptyIncompleteAlbums }));
    try {
      const result = await listIncompleteAlbums();
      setIncompleteAlbumsState({ status: "ready", albums: result });
    } catch (error) {
      setIncompleteAlbumsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        albums: "albums" in current ? current.albums : emptyIncompleteAlbums
      }));
    }
  }

  async function refreshAlbumMergeSuggestions(): Promise<void> {
    setAlbumMergeState((current) => ({ status: "loading", suggestions: "suggestions" in current ? current.suggestions : emptyAlbumMergeSuggestions }));
    try {
      const result = await listAlbumMergeSuggestions();
      setAlbumMergeState({ status: "ready", suggestions: result });
    } catch (error) {
      setAlbumMergeState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        suggestions: "suggestions" in current ? current.suggestions : emptyAlbumMergeSuggestions
      }));
    }
  }

  async function refreshAlternateEditions(): Promise<void> {
    setAlternateEditionsState((current) => ({ status: "loading", editions: "editions" in current ? current.editions : emptyAlternateEditions }));
    try {
      const result = await listAlternateEditions();
      setAlternateEditionsState({ status: "ready", editions: result });
    } catch (error) {
      setAlternateEditionsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        editions: "editions" in current ? current.editions : emptyAlternateEditions
      }));
    }
  }

  function resetOptionalDuplicateDiagnostics(): void {
    setMetadataGapsState({ status: "idle" });
    setQualityUpgradesState({ status: "idle" });
    setIncompleteAlbumsState({ status: "idle" });
    setAlbumMergeState({ status: "idle" });
    setAlternateEditionsState({ status: "idle" });
  }

  async function refreshOperations(): Promise<void> {
    try {
      const result = await listOperationBatches();
      setOperationsState({ status: "ready", batches: result.batches });
    } catch (error) {
      setOperationsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        batches: "batches" in current ? current.batches : []
      }));
    }
  }

  async function refreshAlbums(): Promise<void> {
    try {
      const result = await listAlbums(0, albumPageSize);
      setAlbumsState({ status: "ready", albums: result });
    } catch (error) {
      setAlbumsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        albums: "albums" in current ? current.albums : emptyAlbums
      }));
    }
  }

  async function loadMoreAlbums(): Promise<void> {
    if (albumsLoadingMore || albumsState.status !== "ready" || albumsState.albums.albums.length >= albumsState.albums.total) {
      return;
    }

    setAlbumsLoadingMore(true);
    try {
      const result = await listAlbums(albumsState.albums.albums.length, albumPageSize);
      setAlbumsState((current) => {
        if (current.status !== "ready") {
          return current;
        }
        return {
          status: "ready",
          albums: {
            albums: mergeAlbumsById(current.albums.albums, result.albums),
            total: result.total
          }
        };
      });
    } catch (error) {
      setAlbumsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        albums: "albums" in current ? current.albums : emptyAlbums
      }));
    } finally {
      setAlbumsLoadingMore(false);
    }
  }

  async function refreshPlaylists(): Promise<void> {
    try {
      const result = await listPlaylists();
      setPlaylistsState({ status: "ready", playlists: result.playlists });
    } catch (error) {
      setPlaylistsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        playlists: "playlists" in current ? current.playlists : []
      }));
    }
  }

  async function refreshJobs(): Promise<void> {
    try {
      const result = await listJobs();
      setJobsState({ status: "ready", jobs: result.jobs });
      const selectedJobId = selectedJobIdRef.current;
      if (selectedJobId) {
        const detail = await getJob(selectedJobId);
        if (selectedJobIdRef.current === selectedJobId) {
          setSelectedJobDetail(detail);
        }
      }
    } catch (error) {
      setJobsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        jobs: current.jobs
      }));
    }
  }

  async function refreshTasteProfile(): Promise<void> {
    try {
      const result = await getTasteProfile();
      setTasteProfileState({ status: "ready", profile: result });
      setTasteProfileDraft(result.profile);
    } catch (error) {
      setTasteProfileState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        profile: "profile" in current ? current.profile : emptyTasteProfile
      }));
    }
  }

  async function handleSaveTasteProfile(): Promise<void> {
    const current = "profile" in tasteProfileState ? tasteProfileState.profile : emptyTasteProfile;
    setTasteProfileState({ status: "saving", profile: current });
    try {
      const result = await updateTasteProfile(tasteProfileDraft);
      setTasteProfileState({ status: "ready", profile: result });
      setTasteProfileDraft(result.profile);
    } catch (error) {
      setTasteProfileState({
        status: "error",
        message: getErrorMessage(error),
        profile: current
      });
    }
  }

  async function refreshDiscoveryHealth(): Promise<void> {
    try {
      const health = await getDiscoveryHealth();
      setDiscoveryState((current) => ({ ...current, health }));
    } catch (error) {
      setDiscoveryState((current) => ({
        ...current,
        status: "error",
        message: getErrorMessage(error)
      }));
    }
  }

  async function refreshDiscoveryDownloads(): Promise<void> {
    try {
      const result = await listDiscoveryDownloads();
      setDiscoveryDownloadJobs(result.jobs);
      void refreshJobs();
      if (result.jobs.some((job) => job.imported)) {
        await refreshImports();
      }
    } catch (error) {
      setDiscoveryDownloadState((current) => ({ ...current, message: getErrorMessage(error) }));
    }
  }

  async function refreshSavedDiscoveryCandidates(): Promise<void> {
    try {
      const result = await listSavedDiscoveryCandidates();
      setSavedDiscoveryCandidates(result.candidates);
    } catch (error) {
      setDiscoveryDownloadState((current) => ({ ...current, message: getErrorMessage(error) }));
    }
  }

  async function refreshSavedDiscoveryLists(): Promise<void> {
    try {
      const result = await listSavedDiscoveryLists();
      setSavedDiscoveryLists(result.lists);
    } catch (error) {
      setDiscoveryDownloadState((current) => ({ ...current, message: getErrorMessage(error) }));
    }
  }

  async function refreshAgentThread(): Promise<void> {
    try {
      const result = await getActiveAgentThread();
      setAgentThreadId(result.thread.id);
      setAgentMessages(messagesFromAgentThread(result));
      await refreshAgentThreads();
    } catch (error) {
      setAgentMessages([
        {
          id: "agent-thread-error",
          role: "agent",
          text: getErrorMessage(error),
          response: null
        }
      ]);
    }
  }

  async function refreshAgentThreads(): Promise<void> {
    const result = await listAgentThreads();
    setAgentThreads(result.threads);
  }

  async function handleSelectAgentThread(threadId: string): Promise<void> {
    if (agentBusy || threadId === agentThreadId) {
      return;
    }
    const result = await getAgentThread(threadId);
    setAgentThreadId(result.thread.id);
    setAgentMessages(messagesFromAgentThread(result));
    await refreshAgentThreads();
  }

  async function handleOpenAgentThread(threadId: string): Promise<void> {
    try {
      const result = await getAgentThread(threadId);
      setAgentThreadId(result.thread.id);
      setAgentMessages(messagesFromAgentThread(result));
      await refreshAgentThreads();
      setActiveView("Agent");
    } catch (error) {
      setOperationsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        batches: "batches" in current ? current.batches : []
      }));
    }
  }

  async function handleNewAgentThread(): Promise<void> {
    if (agentBusy) {
      return;
    }
    const result = await createAgentThread();
    setAgentThreadId(result.thread.id);
    setAgentMessages(messagesFromAgentThread(result));
    await refreshAgentThreads();
  }

  function replaceOperationBatch(batch: OperationBatch): void {
    setOperationsState((current) => {
      const batches = "batches" in current ? current.batches : [];
      const existingIndex = batches.findIndex((item) => item.id === batch.id);
      const nextBatches =
        existingIndex >= 0
          ? batches.map((item) => (item.id === batch.id ? batch : item))
          : [batch, ...batches];
      return { status: "ready", batches: nextBatches };
    });
  }

  function markOperationBatchStatus(batchId: string, status: OperationBatch["status"]): void {
    setOperationsState((current) => {
      if (!("batches" in current)) {
        return current;
      }

      return {
        status: "ready",
        batches: current.batches.map((batch) =>
          batch.id === batchId
            ? {
                ...batch,
                status,
                operations: batch.operations.map((operation) => ({
                  ...operation,
                  status:
                    status === "approved" && operation.status === "proposed"
                      ? "approved"
                      : status === "applying" && operation.status === "approved"
                        ? "applying"
                        : status === "rejected" && operation.status !== "applied"
                          ? "rejected"
                          : operation.status
                }))
              }
            : batch
        )
      };
    });
  }

  function setOperationsError(error: unknown): void {
    setOperationsState((current) => ({
      status: "error",
      message: getErrorMessage(error),
      batches: "batches" in current ? current.batches : []
    }));
  }

  function replaceImportItem(item: ImportItem): void {
    setImportsState((current) => {
      if (!("imports" in current)) {
        return current;
      }

      return {
        status: "ready",
        imports: current.imports.map((batch) =>
          batch.id === item.importId
            ? {
                ...batch,
                items: batch.items.map((existing) => (existing.id === item.id ? item : existing))
              }
            : batch
        )
      };
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function loadHealth(): Promise<void> {
      try {
        const result = window.musicOs ? await window.musicOs.health() : await fetchBackendHealth();
        if (!cancelled) {
          setHealth({ status: "ready", health: result });
        }
      } catch (error) {
        if (!cancelled) {
          setHealth({ status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    void loadHealth();
    void refreshPlayback();
    void refreshLibrary("");
    void refreshPlaylists();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeView === "Duplicates") {
      if (duplicatesState.status === "loading") {
        void refreshDuplicates();
      }
      return;
    }
    if ((activeView === "Home" || activeView === "Albums" || activeView === "Artists") && albumsState.status === "loading") {
      void refreshAlbums();
      return;
    }
    if (activeView === "Imports" && importsState.status === "loading") {
      void refreshImports();
      return;
    }
    if (activeView === "Operations" && operationsState.status === "loading") {
      void refreshOperations();
      return;
    }
    if (activeView === "Jobs" && jobsState.status === "loading") {
      void refreshJobs();
      return;
    }
    if (activeView === "Settings" && tasteProfileState.status === "loading") {
      void refreshTasteProfile();
      return;
    }
    if (activeView === "Discovery") {
      void refreshDiscoveryHealth();
      void refreshDiscoveryDownloads();
      void refreshSavedDiscoveryCandidates();
      void refreshSavedDiscoveryLists();
      return;
    }
    if (activeView === "Agent" && agentThreadId == null) {
      void refreshAgentThread();
    }
  }, [activeView]);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    if (playback.status === "stopped") {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshPlayback();
    }, 1000);

    return () => window.clearInterval(interval);
  }, [playback.status]);

  useEffect(() => {
    if (playback.status !== "playing" || !playback.currentFileId) {
      playbackTickFileIdRef.current = null;
      return;
    }

    playbackTickFileIdRef.current = playback.currentFileId;
    let lastTick = Date.now();
    const interval = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTick;
      lastTick = now;

      setPlayback((current) => {
        if (
          current.status !== "playing" ||
          !current.currentFileId ||
          current.currentFileId !== playbackTickFileIdRef.current
        ) {
          return current;
        }

        const nextPosition = current.positionMs + elapsed;
        return {
          ...current,
          positionMs: current.durationMs == null ? nextPosition : Math.min(nextPosition, current.durationMs)
        };
      });
    }, 250);

    return () => {
      window.clearInterval(interval);
      if (playbackTickFileIdRef.current === playback.currentFileId) {
        playbackTickFileIdRef.current = null;
      }
    };
  }, [playback.status, playback.currentFileId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.code !== "Space" || event.repeat) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement ||
        target?.isContentEditable
      ) {
        return;
      }
      if (playback.status === "stopped") {
        return;
      }
      event.preventDefault();
      void handlePauseResume();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playback.status]);

  useEffect(() => {
    if (!discoveryDownloadJobs.some((job) => job.status === "queued" || job.status === "running")) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshDiscoveryDownloads();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [discoveryDownloadJobs]);

  useEffect(() => {
    if (!jobsState.jobs.some((job) => job.status === "queued" || job.status === "running")) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshJobs();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [jobsState.jobs]);

  async function handleInspectJob(jobId: string): Promise<void> {
    selectedJobIdRef.current = jobId;
    try {
      const detail = await getJob(jobId);
      if (selectedJobIdRef.current === jobId) {
        setSelectedJobDetail(detail);
      }
    } catch (error) {
      setJobsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        jobs: current.jobs
      }));
    }
  }

  async function handleAddRoot(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const path = normalizeClientPath(rootPath.trim());
    if (!path) {
      return;
    }

    const result = await addRoot(path, rootWatchEnabled);
    setRootPath("");
    setRootWatchEnabled(false);
    await refreshLibrary();
    await handleScanRoot(result.root.id);
  }

  async function handleToggleRootWatch(root: LibraryRoot): Promise<void> {
    try {
      await updateRootWatch(root.id, !root.watchEnabled);
      await refreshLibrary();
    } catch (error) {
      setLibrary((current) => ({
        status: "error",
        message: getErrorMessage(error),
        roots: "roots" in current ? current.roots : [],
        files: "files" in current ? current.files : [],
        total: "total" in current ? current.total : 0
      }));
    }
  }

  async function handleScanRoot(rootId: string): Promise<void> {
    setBusyRootId(rootId);
    setScanResult(null);
    setWatchedScanResult(null);
    try {
      const result = await scanRoot(rootId);
      setScanResult(result);
      await Promise.all([refreshLibrary(), refreshAlbums()]);
      resetOptionalDuplicateDiagnostics();
    } finally {
      setBusyRootId(null);
    }
  }

  async function handleScanWatchedRoots(): Promise<void> {
    setBusyRootId("__watched__");
    setScanResult(null);
    setWatchedScanResult(null);
    try {
      const result = await scanWatchedRoots();
      setWatchedScanResult(result);
      await Promise.all([refreshLibrary(), refreshAlbums()]);
      resetOptionalDuplicateDiagnostics();
    } finally {
      setBusyRootId(null);
    }
  }

  async function handleRemoveRoot(root: LibraryRoot): Promise<void> {
    const confirmed = window.confirm(
      `Remove "${root.name}" from the library index?\n\nThis only removes indexed database rows. It will not delete music files.`
    );
    if (!confirmed) {
      return;
    }

    setBusyRootId(root.id);
    try {
      await removeRoot(root.id);
      setScanResult(null);
      await Promise.all([refreshLibrary(), refreshAlbums()]);
      resetOptionalDuplicateDiagnostics();
    } finally {
      setBusyRootId(null);
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await refreshLibrary(search);
  }

  async function handleCreateImport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const paths = importPaths
      .split(/\r?\n/)
      .map((path) => normalizeClientPath(path.trim()))
      .filter(Boolean);
    if (paths.length === 0) {
      return;
    }

    const root = roots[0];
    await createImportFromPaths(paths, root?.id);
    setImportPaths("");
    await refreshImports();
    setActiveView("Imports");
  }

  async function handleSelectRootFolder(): Promise<void> {
    if (!window.musicOs?.selectLibraryFolder) {
      window.alert("Native folder selection is only available in the Electron app. Rebuild and restart Electron if this window is already Electron.");
      return;
    }
    const path = await window.musicOs.selectLibraryFolder();
    if (path) {
      setRootPath(path);
    }
  }

  async function handleSelectImportFiles(): Promise<void> {
    if (!window.musicOs?.selectImportFiles) {
      window.alert("Native file selection is only available in the Electron app. Rebuild and restart Electron if this window is already Electron.");
      return;
    }
    appendImportPaths(await window.musicOs.selectImportFiles());
  }

  async function handleSelectImportFolder(): Promise<void> {
    if (!window.musicOs?.selectImportFolder) {
      window.alert("Native folder selection is only available in the Electron app. Rebuild and restart Electron if this window is already Electron.");
      return;
    }
    appendImportPaths(await window.musicOs.selectImportFolder());
  }

  function appendImportPaths(paths: string[]): void {
    const normalized = paths.map(normalizeClientPath).filter(Boolean);
    if (normalized.length === 0) {
      return;
    }

    setImportPaths((current) => {
      const existing = current
        .split(/\r?\n/)
        .map((path) => path.trim())
        .filter(Boolean);
      return [...existing, ...normalized].join("\n");
    });
  }

  async function handleProposeImportApproval(importItemId: string): Promise<void> {
    const root = roots[0];
    if (!root) {
      setImportsState((current) => ({
        status: "error",
        message: "Add a library root before approving imports.",
        imports: "imports" in current ? current.imports : []
      }));
      return;
    }

    const result = await proposeImportApproval(importItemId, root.id);
    replaceOperationBatch(result.batch);
    setActiveView("Operations");
  }

  async function handleProposeImportBatchApproval(importBatch: ImportBatch): Promise<void> {
    const root = roots[0];
    if (!root) {
      setImportsState((current) => ({
        status: "error",
        message: "Add a library root before approving imports.",
        imports: "imports" in current ? current.imports : []
      }));
      return;
    }

    const reviewableItemIds = getReviewableImportItems(importBatch).map((item) => item.id);
    if (reviewableItemIds.length === 0) {
      return;
    }

    setBusyImportBatchId(importBatch.id);
    try {
      const batches = await proposeImportApprovals(reviewableItemIds, root.id);
      for (const batch of batches) {
        replaceOperationBatch(batch);
      }
      setActiveView("Operations");
    } catch (error) {
      setImportsState((current) => ({
        status: "error",
        message: error instanceof Error ? error.message : "Could not create album import batch.",
        imports: "imports" in current ? current.imports : []
      }));
    } finally {
      setBusyImportBatchId(null);
    }
  }

  async function handleApplyImportBatch(importBatch: ImportBatch): Promise<void> {
    const root = roots[0];
    if (!root) {
      setImportsState((current) => ({
        status: "error",
        message: "Add a library root before importing albums.",
        imports: "imports" in current ? current.imports : []
      }));
      return;
    }

    const reviewableItemIds = getReviewableImportItems(importBatch).map((item) => item.id);
    if (reviewableItemIds.length === 0) {
      return;
    }

    setBusyImportBatchId(importBatch.id);
    try {
      const proposedBatches = await proposeImportApprovals(reviewableItemIds, root.id);
      for (const proposed of proposedBatches) {
        replaceOperationBatch(proposed);
        const approved = await approveOperationBatch(proposed.id);
        replaceOperationBatch(approved.batch);
        const applied = await applyOperationBatch(approved.batch.id);
        replaceOperationBatch(applied.batch);
      }
      await Promise.all([
        refreshImports(),
        refreshLibrary(),
        refreshAlbums(),
        refreshPlaylists(),
        refreshJobs(),
        refreshDiscoveryDownloads()
      ]);
      resetOptionalDuplicateDiagnostics();
    } catch (error) {
      setImportsState((current) => ({
        status: "error",
        message: error instanceof Error ? error.message : "Could not import album.",
        imports: "imports" in current ? current.imports : []
      }));
      void refreshOperations();
    } finally {
      setBusyImportBatchId(null);
    }
  }

  async function handleRejectImport(importItemId: string): Promise<void> {
    await rejectImportItem(importItemId);
    await refreshImports();
  }

  async function handleApproveBatch(batchId: string): Promise<void> {
    markOperationBatchStatus(batchId, "approved");
    try {
      const result = await approveOperationBatch(batchId);
      replaceOperationBatch(result.batch);
    } catch (error) {
      setOperationsError(error);
      void refreshOperations();
    }
  }

  async function handleRejectBatch(batchId: string): Promise<void> {
    markOperationBatchStatus(batchId, "rejected");
    try {
      const result = await rejectOperationBatch(batchId);
      replaceOperationBatch(result.batch);
    } catch (error) {
      setOperationsError(error);
      void refreshOperations();
    }
  }

  async function handleApplyBatch(batchId: string): Promise<void> {
    markOperationBatchStatus(batchId, "applying");
    try {
      const result = await applyOperationBatch(batchId);
      replaceOperationBatch(result.batch);
      await Promise.all([
        refreshImports(),
        refreshLibrary(),
        refreshAlbums(),
        refreshPlaylists(),
        refreshJobs(),
        refreshDiscoveryDownloads()
      ]);
      resetOptionalDuplicateDiagnostics();
    } catch (error) {
      setOperationsError(error);
      void refreshOperations();
    }
  }

  async function handleRevertBatch(batchId: string): Promise<void> {
    try {
      const result = await revertOperationBatch(batchId);
      replaceOperationBatch(result.batch);
      void Promise.all([refreshLibrary(), refreshAlbums(), refreshPlaylists(), refreshJobs()]);
      resetOptionalDuplicateDiagnostics();
    } catch (error) {
      setOperationsError(error);
      void refreshOperations();
    }
  }

  async function handleProposeMetadataEdit(fileId: string, metadata: EditableFileMetadata): Promise<void> {
    const result = await proposeFileMetadata(fileId, metadata);
    replaceOperationBatch(result.batch);
    setEditingFile(null);
    setActiveView("Operations");
  }

  async function handleProposeBulkMetadataEdit(fileIds: string[], metadata: EditableFileMetadata): Promise<void> {
    const uniqueFileIds = [...new Set(fileIds)];
    if (uniqueFileIds.length === 0 || Object.keys(metadata).length === 0) {
      return;
    }
    const result = await proposeBulkFileMetadata(uniqueFileIds, metadata);
    replaceOperationBatch(result.batch);
    setSelectedLibraryFileIds(new Set());
    setActiveView("Operations");
  }

  async function handleProposeRating(fileId: string, rating: number | null): Promise<void> {
    replaceLoadedFile(await updateFileRating(fileId, rating));
  }

  async function handleProposeFavoriteStatus(fileId: string, status: "liked" | "disliked" | "neutral"): Promise<void> {
    replaceLoadedFile(await updateFileFavoriteStatus(fileId, {
      liked: status === "neutral" ? null : status === "liked",
      disliked: status === "neutral" ? null : status === "disliked"
    }));
  }

  async function handleProposePlaybackRating(fileId: string, rating: number | null): Promise<void> {
    replaceLoadedFile(await updateFileRating(fileId, rating));
  }

  async function handleProposePlaybackFavoriteStatus(fileId: string, status: "liked" | "disliked" | "neutral"): Promise<void> {
    replaceLoadedFile(await updateFileFavoriteStatus(fileId, {
      liked: status === "neutral" ? null : status === "liked",
      disliked: status === "neutral" ? null : status === "disliked"
    }));
  }

  async function handleProposeRemoveFile(file: LibraryFile): Promise<void> {
    const title = file.displayTags.title ?? file.filename;
    const confirmed = window.confirm(
      `Remove "${title}" from the library index?\n\nThis will not delete the audio file from disk.`
    );
    if (!confirmed) {
      return;
    }

    const result = await proposeRemoveFile(file.id);
    replaceOperationBatch(result.batch);
    setActiveView("Operations");
  }

  async function handleProposeRemoveSelectedFiles(fileIds: string[], label: string): Promise<void> {
    const uniqueFileIds = [...new Set(fileIds)];
    if (uniqueFileIds.length === 0) {
      return;
    }
    const confirmed = window.confirm(
      `Remove ${uniqueFileIds.length.toLocaleString()} indexed file${
        uniqueFileIds.length === 1 ? "" : "s"
      } from "${label}"?\n\nThis will not delete audio files from disk.`
    );
    if (!confirmed) {
      return;
    }

    const result = await proposeRemoveFiles(uniqueFileIds, label);
    replaceOperationBatch(result.batch);
    setSelectedLibraryFileIds(new Set());
    setActiveView("Operations");
  }

  async function handleProposeDuplicateCleanup(group: LibraryDuplicateGroup): Promise<void> {
    const keepFile = chooseDuplicateKeepFile(group.files);
    const removeFileIds = group.files.filter((file) => file.id !== keepFile.id).map((file) => file.id);
    const confirmed = window.confirm(
      `Keep "${keepFile.displayTags.title ?? keepFile.filename}" and remove ${
        removeFileIds.length
      } exact duplicate index entr${removeFileIds.length === 1 ? "y" : "ies"}?\n\nThis will not delete audio files from disk.`
    );
    if (!confirmed) {
      return;
    }

    const result = await proposeDuplicateCleanup(keepFile.id, removeFileIds);
    replaceOperationBatch(result.batch);
    setActiveView("Operations");
  }

  async function handleProposeBulkDuplicateCleanup(groups: LibraryDuplicateGroup[]): Promise<void> {
    const cleanupGroups = groups
      .map((group) => {
        const keepFile = chooseDuplicateKeepFile(group.files);
        return {
          keepFileId: keepFile.id,
          removeFileIds: group.files.filter((file) => file.id !== keepFile.id).map((file) => file.id)
        };
      })
      .filter((group) => group.removeFileIds.length > 0);
    const removeCount = cleanupGroups.reduce((total, group) => total + group.removeFileIds.length, 0);
    if (removeCount === 0) {
      return;
    }
    const confirmed = window.confirm(
      `Remove ${removeCount.toLocaleString()} exact duplicate index entr${
        removeCount === 1 ? "y" : "ies"
      } across ${cleanupGroups.length.toLocaleString()} group${
        cleanupGroups.length === 1 ? "" : "s"
      }?\n\nThis will not delete audio files from disk.`
    );
    if (!confirmed) {
      return;
    }

    const result = await proposeBulkDuplicateCleanup(cleanupGroups);
    replaceOperationBatch(result.batch);
    setActiveView("Operations");
  }

  async function handleProposeBulkAlbumMerge(merges: Array<{ canonicalAlbum: string; fileIds: string[] }>): Promise<void> {
    const actionableMerges = merges.filter((merge) => merge.fileIds.length > 0);
    const fileCount = actionableMerges.reduce((total, merge) => total + merge.fileIds.length, 0);
    if (fileCount === 0) {
      return;
    }
    const confirmed = window.confirm(
      `Propose album metadata merges for ${fileCount.toLocaleString()} file${fileCount === 1 ? "" : "s"} across ${
        actionableMerges.length
      } suggestion${actionableMerges.length === 1 ? "" : "s"}?`
    );
    if (!confirmed) {
      return;
    }

    const result = await proposeBulkAlbumMerge(actionableMerges);
    replaceOperationBatch(result.batch);
    setActiveView("Operations");
  }

  function toggleLibraryFileSelection(fileId: string): void {
    setSelectedLibraryFileIds((current) => toggleSetValue(current, fileId));
  }

  function toggleLibraryAlbumSelection(fileIds: string[]): void {
    if (fileIds.length === 0) {
      return;
    }
    setSelectedLibraryFileIds((current) => {
      const next = new Set(current);
      const allSelected = fileIds.every((fileId) => current.has(fileId));
      for (const fileId of fileIds) {
        if (allSelected) {
          next.delete(fileId);
        } else {
          next.add(fileId);
        }
      }
      return next;
    });
  }

  function clearLibrarySelection(): void {
    setSelectedLibraryFileIds(new Set());
  }

  async function handleProposeBulkTags(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await handleProposeBulkTagsForFiles([...selectedLibraryFileIds], bulkTagInput);
    setBulkTagInput("");
  }

  async function handleProposeBulkTagsForFiles(fileIds: string[], tagText: string): Promise<void> {
    const tags = parseTagInput(tagText);
    const uniqueFileIds = [...new Set(fileIds)];
    if (uniqueFileIds.length === 0 || tags.length === 0) {
      return;
    }

    const result = await proposeBulkInternalTags(uniqueFileIds, tags);
    replaceOperationBatch(result.batch);
    setSelectedLibraryFileIds(new Set());
    setActiveView("Operations");
  }

  async function handleProposeBulkRename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await handleProposeBulkRenameForFiles([...selectedLibraryFileIds], bulkRenamePattern);
  }

  async function handleProposeBulkRenameForFiles(fileIds: string[], patternInput: string): Promise<void> {
    const uniqueFileIds = [...new Set(fileIds)];
    const pattern = patternInput.trim();
    if (uniqueFileIds.length === 0 || !pattern) {
      return;
    }

    const result = await proposeBulkRenameFiles(uniqueFileIds, pattern);
    replaceOperationBatch(result.batch);
    setSelectedLibraryFileIds(new Set());
    setActiveView("Operations");
  }

  async function handleProposeSelectedPlaylist(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const fileIds = [...selectedLibraryFileIds];
    const name = playlistNameInput.trim();
    const description = playlistDescriptionInput.trim();
    if (fileIds.length === 0 || !name) {
      return;
    }

    const result = await proposePlaylist(name, description || undefined, fileIds);
    replaceOperationBatch(result.batch);
    setPlaylistNameInput("");
    setPlaylistDescriptionInput("");
    setSelectedLibraryFileIds(new Set());
    setActiveView("Operations");
  }

  async function handleProposeAddSelectedToPlaylist(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const fileIds = [...selectedLibraryFileIds];
    if (fileIds.length === 0 || !playlistAddTargetId) {
      return;
    }

    const result = await proposeAddTracksToPlaylist(playlistAddTargetId, fileIds);
    replaceOperationBatch(result.batch);
    setSelectedLibraryFileIds(new Set());
    setActiveView("Operations");
  }

  async function handleProposeUpdatePlaylist(
    playlistId: string,
    updates: { name: string; description: string | null }
  ): Promise<void> {
    const result = await proposeUpdatePlaylist(playlistId, updates);
    replaceOperationBatch(result.batch);
    setActiveView("Operations");
  }

  async function handleProposeDeletePlaylist(playlist: Playlist): Promise<void> {
    const confirmed = window.confirm(
      `Delete playlist "${playlist.name}"?\n\nThis will create a reviewable operation batch and will not delete any audio files.`
    );
    if (!confirmed) {
      return;
    }

    const result = await proposeDeletePlaylist(playlist.id);
    replaceOperationBatch(result.batch);
    setSelectedPlaylistId(null);
    setActiveView("Operations");
  }

  async function handleProposeRemovePlaylistItem(playlistId: string, itemId: string): Promise<void> {
    const result = await proposeRemoveTracksFromPlaylist(playlistId, [itemId]);
    replaceOperationBatch(result.batch);
    setActiveView("Operations");
  }

  async function handleProposeAlbumMerge(canonicalAlbum: string, fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) {
      return;
    }
    const result = await proposeAlbumMerge(canonicalAlbum, fileIds);
    replaceOperationBatch(result.batch);
    setActiveView("Operations");
  }

  async function handleInspectLibraryFile(fileId: string): Promise<void> {
    setDiagnosticsState({ status: "loading" });
    try {
      setDiagnosticsState({ status: "ready", diagnostics: await getLibraryFileDiagnostics(fileId) });
    } catch (error) {
      setDiagnosticsState({ status: "error", message: getErrorMessage(error) });
    }
  }

  async function handleInspectImportItem(importItemId: string): Promise<void> {
    setDiagnosticsState({ status: "loading" });
    try {
      setDiagnosticsState({ status: "ready", diagnostics: await getImportItemDiagnostics(importItemId) });
    } catch (error) {
      setDiagnosticsState({ status: "error", message: getErrorMessage(error) });
    }
  }

  async function handleUpdateImportMetadata(
    importItemId: string,
    metadata: { artist: string; album: string; title: string; year: string }
  ): Promise<void> {
    const result = await updateImportItemMetadata(importItemId, metadata);
    replaceImportItem(result.item);
    setDiagnosticsState({ status: "ready", diagnostics: await getImportItemDiagnostics(importItemId) });
  }

  async function refreshPlayback(): Promise<void> {
    const next = await getPlaybackState();
    const current = playbackRef.current;
    setPlayback((current) => mergePlaybackState(current, next));
    if (
      current &&
      ((current.currentFileId != null && current.currentFileId !== next.currentFileId) ||
        (current.status !== "stopped" && next.status === "stopped"))
    ) {
      void refreshLibrary();
    }
  }

  async function handlePlayFile(fileId: string, queueFileIds?: string[]): Promise<void> {
    if (playbackBusy) {
      return;
    }

    setPlaybackBusy(true);
    try {
      if (playback.currentFileId === fileId) {
        setPlayback(playback.status === "playing" ? await pausePlayback() : await resumePlayback());
        return;
      }

      const fileIds = queueFileIds && queueFileIds.length > 0 ? queueFileIds : files.map((file) => file.id);
      const startIndex = Math.max(0, fileIds.indexOf(fileId));
      const next = await playQueue(fileIds, startIndex);
      setPlayback(next);
      if (playback.currentFileId && playback.currentFileId !== next.currentFileId) {
        void refreshLibrary();
      }
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    } finally {
      setPlaybackBusy(false);
    }
  }

  async function handleEnqueuePlayback(fileIds: string[], position: QueueInsertPosition): Promise<void> {
    if (playbackBusy || fileIds.length === 0) {
      return;
    }

    setPlaybackBusy(true);
    try {
      const next = await enqueuePlayback(fileIds, position);
      setPlayback(next);
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    } finally {
      setPlaybackBusy(false);
    }
  }

  async function handlePlayFileIdsShuffled(fileIds: string[]): Promise<void> {
    if (playbackBusy || fileIds.length === 0) {
      return;
    }

    setPlaybackBusy(true);
    try {
      setPlayback(await playQueue(shuffleFileIds(fileIds), 0));
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    } finally {
      setPlaybackBusy(false);
    }
  }

  async function handleSetRepeatMode(repeatMode: PlaybackRepeatMode): Promise<void> {
    if (playbackBusy) {
      return;
    }

    setPlaybackBusy(true);
    try {
      setPlayback(await setPlaybackRepeatMode(repeatMode));
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    } finally {
      setPlaybackBusy(false);
    }
  }

  async function handlePauseResume(): Promise<void> {
    if (playbackBusy) {
      return;
    }

    setPlaybackBusy(true);
    try {
      if (playback.status === "playing") {
        setPlayback(await pausePlayback());
        return;
      }

      setPlayback(await resumePlayback());
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    } finally {
      setPlaybackBusy(false);
    }
  }

  async function handleStop(): Promise<void> {
    if (playbackBusy) {
      return;
    }

    setPlaybackBusy(true);
    try {
      setPlayback(await stopPlayback());
      void refreshLibrary();
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    } finally {
      setPlaybackBusy(false);
    }
  }

  async function handlePrevious(): Promise<void> {
    if (playbackBusy) {
      return;
    }

    setPlaybackBusy(true);
    try {
      setPlayback(await previousPlayback());
      void refreshLibrary();
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    } finally {
      setPlaybackBusy(false);
    }
  }

  async function handleNext(): Promise<void> {
    if (playbackBusy) {
      return;
    }

    setPlaybackBusy(true);
    try {
      setPlayback(await nextPlayback());
      void refreshLibrary();
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    } finally {
      setPlaybackBusy(false);
    }
  }

  async function handleSeekPlayback(event: MouseEvent<HTMLElement>): Promise<void> {
    if (playbackBusy || playback.status === "stopped" || !playback.durationMs || playback.durationMs <= 0) {
      return;
    }

    await seekPlaybackFromRatio(getPointerRatio(event.currentTarget, event.clientX));
  }

  async function seekPlaybackFromRatio(ratio: number): Promise<void> {
    if (playbackBusy || playback.status === "stopped" || !playback.durationMs || playback.durationMs <= 0) {
      return;
    }

    const positionMs = Math.round(Math.max(0, Math.min(1, ratio)) * playback.durationMs);
    setPlaybackBusy(true);
    try {
      setPlayback(await seekPlayback(positionMs));
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    } finally {
      setPlaybackBusy(false);
    }
  }

  async function handleVolumeChange(value: string): Promise<void> {
    const volumePercent = Math.max(0, Math.min(100, Math.round(Number(value))));
    if (!Number.isFinite(volumePercent)) {
      return;
    }
    setPlayback((current) => ({ ...current, volumePercent }));
    try {
      setPlayback(await setPlaybackVolume(volumePercent));
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    }
  }

  async function handlePlayPlaylist(playlistId: string): Promise<void> {
    if (playbackBusy) {
      return;
    }

    setPlaybackBusy(true);
    try {
      setPlayback(await playPlaylist(playlistId));
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    } finally {
      setPlaybackBusy(false);
    }
  }

  async function handlePlayAlbum(albumId: string): Promise<void> {
    if (playbackBusy) {
      return;
    }

    setPlaybackBusy(true);
    try {
      setPlayback(await playAlbum(albumId));
    } catch (error) {
      setPlayback((current) => ({ ...current, status: "error", error: getErrorMessage(error) }));
    } finally {
      setPlaybackBusy(false);
    }
  }

  function openArtistPage(artist: string): void {
    setArtistViewTarget({ key: pageTargetRequestId.current++, artist });
    setActiveView("Artists");
  }

  function openAlbumDetailPage(album: AlbumGroupItem): void {
    setAlbumViewTarget({ key: pageTargetRequestId.current++, albumId: album.id });
    setActiveView("Albums");
  }

  async function openAlbumPage(group: Pick<LibraryAlbumGroup, "artist" | "album" | "year">): Promise<void> {
    let albumGroups = "albums" in albumsState ? albumsState.albums.albums : [];
    if (albumGroups.length === 0) {
      try {
        const result = await listAlbums();
        setAlbumsState({ status: "ready", albums: result });
        albumGroups = result.albums;
      } catch (error) {
        setAlbumsState({
          status: "error",
          message: getErrorMessage(error),
          albums: emptyAlbums
        });
        return;
      }
    }
    let matchingAlbum =
      albumGroups.find(
        (album) =>
          album.artist === group.artist &&
          album.album === group.album &&
          (album.year ?? null) === (group.year ?? null)
      ) ??
      albumGroups.find((album) => album.artist === group.artist && album.album === group.album);

    if (!matchingAlbum) {
      try {
        const result = await listAlbums(0, Number.MAX_SAFE_INTEGER);
        setAlbumsState({ status: "ready", albums: result });
        albumGroups = result.albums;
        matchingAlbum =
          albumGroups.find(
            (album) =>
              album.artist === group.artist &&
              album.album === group.album &&
              (album.year ?? null) === (group.year ?? null)
          ) ??
          albumGroups.find((album) => album.artist === group.artist && album.album === group.album);
      } catch (error) {
        setAlbumsState((current) => ({
          status: "error",
          message: getErrorMessage(error),
          albums: "albums" in current ? current.albums : emptyAlbums
        }));
        return;
      }
    }

    if (!matchingAlbum) {
      return;
    }

    setAlbumViewTarget({ key: pageTargetRequestId.current++, albumId: matchingAlbum.id });
    setActiveView("Albums");
  }

  async function handleSelectBackgroundImage(mode: AppearanceMode): Promise<void> {
    const image = (await window.musicOs?.selectBackgroundImage()) as SelectedBackgroundImage | null | undefined;
    if (!image) {
      return;
    }

    setAppearance((current) => {
      const existing = current.backgroundImages.filter((item) => item.path !== image.path);
      const nextImage: SavedBackgroundImage = {
        id: crypto.randomUUID(),
        name: basenameFromPath(image.path),
        path: image.path,
        url: image.url,
        addedAt: new Date().toISOString()
      };
      return {
        ...current,
        backgroundDefaults: {
          ...current.backgroundDefaults,
          [mode]: image
        },
        backgroundImagePath: image.path,
        backgroundImageUrl: image.url,
        backgroundImages: [nextImage, ...existing].slice(0, 12)
      };
    });
  }

  async function handleAgentSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const message = agentInput.trim();
    if (!message || agentBusy) {
      return;
    }

    setAgentInput("");
    setAgentBusy(true);
    setAgentMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    try {
      const agentRun = await sendAgentMessage(message, agentThreadId ?? undefined);
      const response = agentRun.response;
      if (response.threadId) {
        setAgentThreadId(response.threadId);
      }
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: response.reply, response, run: agentRun.run }
      ]);
      if (response.operationBatch) {
        replaceOperationBatch(response.operationBatch);
      }
      if (response.playback) {
        setPlayback(response.playback);
      }
      void refreshAgentThreads();
    } catch (error) {
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: getErrorMessage(error), response: null }
      ]);
    } finally {
      setAgentBusy(false);
    }
  }

  async function handleDiscoverySearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const query = discoveryQuery.trim();
    if (!query) {
      return;
    }

    await runDiscoverySearch(query);
  }

  async function runDiscoverySearch(query: string): Promise<void> {
    const requestId = discoverySearchRequestId.current + 1;
    discoverySearchRequestId.current = requestId;
    setDiscoveryState((current) => ({
      status: "searching",
      health: current.health,
      results: [],
      query
    }));
    try {
      const result = await searchDiscovery(query, discoverySource);
      if (discoverySearchRequestId.current !== requestId) {
        return;
      }
      setExpandedDiscoveryClusters(new Set());
      setExpandedDiscoveryGroups(new Set());
      setInspectedDiscoveryGroupId(null);
      setSelectedDiscoveryGroups(new Set());
      setSelectedDiscoveryFiles(new Set());
      setDiscoveryState((current) => ({
        status: "ready",
        health: current.health,
        results: result.results,
        query: result.query
      }));
    } catch (error) {
      if (discoverySearchRequestId.current !== requestId) {
        return;
      }
      setDiscoveryState((current) => ({
        status: "error",
        health: current.health,
        results: current.results,
        query,
        message: getErrorMessage(error)
      }));
    }
  }

  async function handleParseDiscoveryList(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const text = pastedDiscoveryList.trim();
    if (!text || agentBusy || parsedDiscoveryList.status === "parsing") {
      return;
    }

    const message = `parse this chart list:\n${text}`;
    setParsedDiscoveryList((current) => ({ status: "parsing", items: current.items, message: "Parsing pasted list." }));
    setAgentBusy(true);
    setAgentMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    try {
      const agentRun = await sendAgentMessage(message, agentThreadId ?? undefined);
      const response = agentRun.response;
      if (response.threadId) {
        setAgentThreadId(response.threadId);
      }
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: response.reply, response, run: agentRun.run }
      ]);
      setParsedDiscoveryList({
        status: "ready",
        items: response.parsedListItems,
        message: response.reply
      });
      void refreshAgentThreads();
    } catch (error) {
      const messageText = getErrorMessage(error);
      setParsedDiscoveryList((current) => ({ status: "error", items: current.items, message: messageText }));
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: messageText, response: null }
      ]);
    } finally {
      setAgentBusy(false);
    }
  }

  async function handleSearchParsedDiscoveryItem(item: AgentParsedListItem): Promise<void> {
    setDiscoveryQuery(item.query);
    await runDiscoverySearch(item.query);
  }

  async function handleSaveParsedDiscoveryList(): Promise<void> {
    if (parsedDiscoveryList.items.length === 0) {
      setDiscoveryDownloadState({ status: "idle", message: "Parse a list before saving it as a Discovery source." });
      return;
    }

    try {
      const result = await saveDiscoveryList({
        name: deriveParsedListName(parsedDiscoveryList.items),
        originalText: pastedDiscoveryList,
        items: parsedDiscoveryList.items
      });
      setSavedDiscoveryLists((current) => [result.list, ...current.filter((list) => list.id !== result.list.id)]);
      setDiscoveryDownloadState({ status: "idle", message: `Saved parsed list: ${result.list.name}.` });
    } catch (error) {
      setDiscoveryDownloadState({ status: "idle", message: getErrorMessage(error) });
    }
  }

  function handleLoadSavedDiscoveryList(list: SavedDiscoveryList): void {
    setPastedDiscoveryList(list.originalText);
    setParsedDiscoveryList({
      status: "ready",
      items: list.items,
      message: `Loaded saved list "${list.name}".`
    });
    setDiscoveryDownloadState({
      status: "idle",
      message: `Loaded ${list.itemCount.toLocaleString()} parsed item${list.itemCount === 1 ? "" : "s"} from ${list.name}.`
    });
  }

  async function handleSearchSavedDiscoveryListMissing(list: SavedDiscoveryList): Promise<void> {
    const missingItem = list.items.find((item) => item.ownedMatchCount === 0) ?? list.items[0];
    if (!missingItem) {
      setDiscoveryDownloadState({ status: "idle", message: `${list.name} has no parsed rows to search.` });
      return;
    }
    handleLoadSavedDiscoveryList(list);
    await handleSearchParsedDiscoveryItem(missingItem);
  }

  async function handleRemoveSavedDiscoveryList(listId: string): Promise<void> {
    try {
      await removeSavedDiscoveryList(listId);
      setSavedDiscoveryLists((current) => current.filter((list) => list.id !== listId));
      setDiscoveryDownloadState({ status: "idle", message: "Removed saved parsed list." });
    } catch (error) {
      setDiscoveryDownloadState({ status: "idle", message: getErrorMessage(error) });
    }
  }

  function toggleDiscoveryGroup(groupId: string): void {
    setExpandedDiscoveryGroups((current) => toggleSetValue(current, groupId));
  }

  function toggleDiscoveryCluster(clusterId: string): void {
    setExpandedDiscoveryClusters((current) => toggleSetValue(current, clusterId));
  }

  function toggleDiscoveryFileSelection(fileId: string): void {
    const file = discoveryState.results.find((result) => result.id === fileId);
    if (file && !isAudioDiscoveryResult(file)) {
      return;
    }
    setSelectedDiscoveryGroups(new Set());
    setSelectedDiscoveryFiles((current) => toggleSetValue(current, fileId));
  }

  function toggleDiscoveryGroupSelection(group: DiscoveryGroup): void {
    const selected = selectedDiscoveryGroups.has(group.id);
    setSelectedDiscoveryGroups((current) => toggleSetValue(current, group.id));
    setSelectedDiscoveryFiles((current) => {
      const next = new Set(current);
      for (const file of group.files) {
        if (file.isLocked || !isAudioDiscoveryResult(file)) {
          continue;
        }
        if (selected) {
          next.delete(file.id);
        } else {
          next.add(file.id);
        }
      }
      return next;
    });
  }

  async function handleProposeDiscoveryDownload(): Promise<void> {
    const selected = discoveryState.results.filter((result) => selectedDiscoveryFiles.has(result.id) && !result.isLocked && isAudioDiscoveryResult(result));
    if (selected.length === 0) {
      setDiscoveryDownloadState({ status: "idle", message: "Select at least one unlocked audio file before staging downloads." });
      return;
    }

    setDiscoveryDownloadState({ status: "working", message: `Creating a reviewable download batch for ${selected.length.toLocaleString()} selected file${selected.length === 1 ? "" : "s"}.` });
    try {
      const result = await proposeQueueDownload(selected, discoveryState.query || discoveryQuery.trim() || "Discovery selection", selectedRoot?.id);
      replaceOperationBatch(result.batch);
      setDiscoveryDownloadState({
        status: "idle",
        message: `Created operation batch: ${result.batch.summary}. Approve and apply it to queue the download.`
      });
      setActiveView("Operations");
    } catch (error) {
      setDiscoveryDownloadState({ status: "idle", message: getErrorMessage(error) });
    }
  }

  async function handleSaveDiscoveryCandidate(group: DiscoveryGroup): Promise<void> {
    try {
      const result = await saveDiscoveryCandidate(discoveryGroupToSaveRequest(group, discoveryState.query || discoveryQuery.trim()));
      setSavedDiscoveryCandidates((current) =>
        current.some((candidate) => candidate.id === result.candidate.id)
          ? current.map((candidate) => (candidate.id === result.candidate.id ? result.candidate : candidate))
          : [result.candidate, ...current]
      );
      setDiscoveryDownloadState({ status: "idle", message: `Saved ${result.candidate.releaseTitle}.` });
    } catch (error) {
      setDiscoveryDownloadState({ status: "idle", message: getErrorMessage(error) });
    }
  }

  async function handleSendDiscoveryCandidateToAgent(group: DiscoveryGroup): Promise<void> {
    if (agentBusy) {
      return;
    }

    const message = discoveryAgentPrompt(group);
    setAgentBusy(true);
    setAgentMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    setActiveView("Agent");
    try {
      const agentRun = await sendAgentMessage(message, agentThreadId ?? undefined);
      const response = agentRun.response;
      if (response.threadId) {
        setAgentThreadId(response.threadId);
      }
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: response.reply, response, run: agentRun.run }
      ]);
      if (response.operationBatch) {
        replaceOperationBatch(response.operationBatch);
      }
      if (response.playback) {
        setPlayback(response.playback);
      }
      void refreshAgentThreads();
    } catch (error) {
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: getErrorMessage(error), response: null }
      ]);
    } finally {
      setAgentBusy(false);
    }
  }

  async function handleProposeSavedDiscoveryCandidateDownload(candidate: SavedDiscoveryCandidate): Promise<void> {
    const selected = candidate.results.filter((result) => !result.isLocked && isAudioDiscoveryResult(result));
    if (selected.length === 0) {
      setDiscoveryDownloadState({ status: "idle", message: "Saved candidate has no unlocked audio files to stage." });
      return;
    }

    setDiscoveryDownloadState({
      status: "working",
      message: `Creating a reviewable download batch for ${selected.length.toLocaleString()} saved file${selected.length === 1 ? "" : "s"}.`
    });
    try {
      const result = await proposeQueueDownload(selected, candidate.query || savedCandidateQuery(candidate), selectedRoot?.id);
      replaceOperationBatch(result.batch);
      setDiscoveryDownloadState({
        status: "idle",
        message: `Created operation batch: ${result.batch.summary}. Approve and apply it to queue the download.`
      });
      setActiveView("Operations");
    } catch (error) {
      setDiscoveryDownloadState({ status: "idle", message: getErrorMessage(error) });
    }
  }

  async function handleSendSavedDiscoveryCandidateToAgent(candidate: SavedDiscoveryCandidate): Promise<void> {
    if (agentBusy) {
      return;
    }

    const message = savedDiscoveryAgentPrompt(candidate);
    setAgentBusy(true);
    setAgentMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    setActiveView("Agent");
    try {
      const agentRun = await sendAgentMessage(message, agentThreadId ?? undefined);
      const response = agentRun.response;
      if (response.threadId) {
        setAgentThreadId(response.threadId);
      }
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: response.reply, response, run: agentRun.run }
      ]);
      if (response.operationBatch) {
        replaceOperationBatch(response.operationBatch);
      }
      if (response.playback) {
        setPlayback(response.playback);
      }
      void refreshAgentThreads();
    } catch (error) {
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: getErrorMessage(error), response: null }
      ]);
    } finally {
      setAgentBusy(false);
    }
  }

  async function handleRemoveSavedDiscoveryCandidate(candidateId: string): Promise<void> {
    try {
      await removeSavedDiscoveryCandidate(candidateId);
      setSavedDiscoveryCandidates((current) => current.filter((candidate) => candidate.id !== candidateId));
    } catch (error) {
      setDiscoveryDownloadState({ status: "idle", message: getErrorMessage(error) });
    }
  }

  async function handleRetryDiscoveryDownload(jobId: string): Promise<void> {
    const result = await retryDiscoveryDownload(jobId);
    replaceDiscoveryDownloadJob(result.job);
  }

  async function handleCancelDiscoveryDownload(jobId: string): Promise<void> {
    const result = await cancelDiscoveryDownload(jobId);
    replaceDiscoveryDownloadJob(result.job);
  }

  function replaceDiscoveryDownloadJob(job: DiscoveryDownloadJob): void {
    setDiscoveryDownloadJobs((current) =>
      current.some((item) => item.id === job.id)
        ? current.map((item) => (item.id === job.id ? job : item))
        : [job, ...current]
    );
  }

  function replaceLoadedFile(file: LibraryFile): void {
    setLibrary((current) => {
      if (!("files" in current)) {
        return current;
      }
      return {
        ...current,
        files: current.files.map((item) => (item.id === file.id ? file : item))
      };
    });
    setAlbumsState((current) => {
      if (!("albums" in current)) {
        return current;
      }
      return {
        ...current,
        albums: {
          ...current.albums,
          albums: current.albums.albums.map((album) =>
            album.files.some((item) => item.id === file.id)
              ? {
                  ...album,
                  files: album.files.map((item) => (item.id === file.id ? file : item))
                }
              : album
          )
        }
      };
    });
    setPlaylistsState((current) => {
      if (!("playlists" in current)) {
        return current;
      }
      return {
        ...current,
        playlists: current.playlists.map((playlist) =>
          playlist.items.some((item) => item.file.id === file.id)
            ? {
                ...playlist,
                items: playlist.items.map((item) => (item.file.id === file.id ? { ...item, file } : item))
              }
            : playlist
        )
      };
    });
  }

  const roots = "roots" in library ? library.roots : [];
  const files = "files" in library ? library.files : [];
  const total = "total" in library ? library.total : 0;
  const duplicates = "duplicates" in duplicatesState ? duplicatesState.duplicates : emptyDuplicates;
  const metadataGaps = "gaps" in metadataGapsState ? metadataGapsState.gaps : emptyMetadataGaps;
  const qualityUpgrades = "upgrades" in qualityUpgradesState ? qualityUpgradesState.upgrades : emptyQualityUpgrades;
  const incompleteAlbums = "albums" in incompleteAlbumsState ? incompleteAlbumsState.albums : emptyIncompleteAlbums;
  const albumMergeSuggestions = "suggestions" in albumMergeState ? albumMergeState.suggestions : emptyAlbumMergeSuggestions;
  const alternateEditions = "editions" in alternateEditionsState ? alternateEditionsState.editions : emptyAlternateEditions;
  const albums = "albums" in albumsState ? albumsState.albums : emptyAlbums;
  const operationBatches = "batches" in operationsState ? operationsState.batches : [];
  const playlists = "playlists" in playlistsState ? playlistsState.playlists : [];
  const selectedPlaylist = selectedPlaylistId ? playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null : null;
  const selectedRoot = roots[0] ?? null;
  const playbackFiles = useMemo(() => {
    const fileMap = new Map<string, LibraryFile>();
    for (const file of files) {
      fileMap.set(file.id, file);
    }
    for (const album of albums.albums) {
      for (const file of album.files) {
        fileMap.set(file.id, file);
      }
    }
    for (const playlist of playlists) {
      for (const item of playlist.items) {
        fileMap.set(item.file.id, item.file);
      }
    }
    return [...fileMap.values()];
  }, [albums.albums, files, playlists]);
  const currentPlaybackFile = useMemo(
    () => (playback.currentFileId ? playbackFiles.find((file) => file.id === playback.currentFileId) ?? null : null),
    [playback.currentFileId, playbackFiles]
  );
  const appearanceStyle = useMemo(() => getAppearanceStyle(appearance), [appearance]);
  const appShellClassName = `appShell ${inspectorCollapsed ? "inspectorCollapsed " : ""}theme-${appearance.mode}`.trim();
  const subtitle = useMemo(() => {
    if (total === 0) {
      return "Add a folder and scan local audio files.";
    }
    return `${total.toLocaleString()} indexed file${total === 1 ? "" : "s"}`;
  }, [total]);

  return (
    <main className={appShellClassName} style={appearanceStyle}>
      <aside className="sidebar">
        <div className="brand">
          <img alt="" className="brandMark" src="./negi.png" />
          <span>negi</span>
        </div>
        <nav className="navList" aria-label="Primary">
          {navSections.map((section) => (
            <div className="navSection" key={section.label}>
              <span className="navSectionLabel">{section.label}</span>
              {section.items.map((item) => (
                <button
                  className={item === activeView ? "navItem active" : "navItem"}
                  key={item}
                  type="button"
                  onClick={() => {
                    if (item === "Artists" && activeView === "Artists") {
                      setArtistViewTarget(null);
                      setArtistsViewResetKey((current) => current + 1);
                    }
                    if (item === "Artists") {
                      setArtistViewTarget(null);
                    }
                    if (item === "Albums") {
                      setAlbumViewTarget(null);
                      setAlbumsViewResetKey((current) => current + 1);
                    }
                    if (item === "Playlists") {
                      setSelectedPlaylistId(null);
                    }
                    setActiveView(item);
                  }}
                >
                  <NavIcon view={item} />
                  {item}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="appBackground" aria-hidden="true" />

      <section className="centerPane">
        <header className="toolbar">
          <div>
            <h1>{activeView}</h1>
            <p>{activeView === "Library" ? subtitle : getViewSubtitle(activeView)}</p>
          </div>
          <BackendHealth state={health} />
        </header>

        {activeView === "Home" ? (
          <HomeView
            albumsState={albumsState}
            currentPlaybackFile={currentPlaybackFile}
            currentWaveform={currentWaveform.waveform}
            libraryTotal={library.status === "ready" ? library.total : total}
            playback={playback}
            playbackBusy={playbackBusy}
            playlists={playlists}
            visualizerFrameRef={barVisualizer.frameRef}
            onOpenAlbum={openAlbumDetailPage}
            onOpenArtistPage={openArtistPage}
            onPlayAlbum={handlePlayAlbum}
            onPlayFile={handlePlayFile}
          />
        ) : activeView === "Library" ? (
          <LibraryView
            bulkRenamePattern={bulkRenamePattern}
            bulkTagInput={bulkTagInput}
            busyRootId={busyRootId}
            currentWaveform={currentWaveform.waveform}
            files={files}
            libraryLoadingMore={libraryLoadingMore}
            libraryTotal={library.status === "ready" ? library.total : files.length}
            playback={playback}
            playbackBusy={playbackBusy}
            playlistAddTargetId={playlistAddTargetId}
            playlistDescriptionInput={playlistDescriptionInput}
            playlistNameInput={playlistNameInput}
            playlists={playlists}
            rootPath={rootPath}
            rootWatchEnabled={rootWatchEnabled}
            roots={roots}
            scanResult={scanResult}
            search={search}
            selectedFileIds={selectedLibraryFileIds}
            selectedRoot={selectedRoot}
            watchedScanResult={watchedScanResult}
            setBulkRenamePattern={setBulkRenamePattern}
            setBulkTagInput={setBulkTagInput}
            setPlaylistAddTargetId={setPlaylistAddTargetId}
            setPlaylistDescriptionInput={setPlaylistDescriptionInput}
            setPlaylistNameInput={setPlaylistNameInput}
            setRootPath={setRootPath}
            setRootWatchEnabled={setRootWatchEnabled}
            setSearch={setSearch}
            onAddRoot={handleAddRoot}
            onClearSelection={clearLibrarySelection}
            onSelectRootFolder={handleSelectRootFolder}
            onEditFile={setEditingFile}
            onEnqueuePlayback={handleEnqueuePlayback}
            onInspectFile={handleInspectLibraryFile}
            onLoadMore={loadMoreLibrary}
            onOpenAlbumPage={openAlbumPage}
            onOpenArtistPage={openArtistPage}
            onPlayFile={handlePlayFile}
            onProposeAddToPlaylist={handleProposeAddSelectedToPlaylist}
            onProposeBulkMetadata={handleProposeBulkMetadataEdit}
            onProposeBulkRename={handleProposeBulkRename}
            onProposeBulkRenameForFiles={handleProposeBulkRenameForFiles}
            onProposeBulkTags={handleProposeBulkTags}
            onProposeBulkTagsForFiles={handleProposeBulkTagsForFiles}
            onProposePlaylist={handleProposeSelectedPlaylist}
            onProposeFavoriteStatus={handleProposeFavoriteStatus}
            onProposeRating={handleProposeRating}
            onRemoveFiles={handleProposeRemoveSelectedFiles}
            onRemoveFile={handleProposeRemoveFile}
            onRemoveRoot={handleRemoveRoot}
            onScanRoot={handleScanRoot}
            onScanWatchedRoots={handleScanWatchedRoots}
            onSearch={handleSearch}
            onToggleAlbumSelection={toggleLibraryAlbumSelection}
            onToggleFileSelection={toggleLibraryFileSelection}
            onToggleRootWatch={handleToggleRootWatch}
          />
        ) : activeView === "Artists" ? (
        <ArtistsView
          albumsState={albumsState}
          currentWaveform={currentWaveform.waveform}
          initialTarget={artistViewTarget}
          playback={playback}
          playbackBusy={playbackBusy}
          loadingMore={albumsLoadingMore}
            resetKey={artistsViewResetKey}
            onEnqueuePlayback={handleEnqueuePlayback}
            onLoadMore={loadMoreAlbums}
            onPlayAlbum={handlePlayAlbum}
            onPlayFile={handlePlayFile}
          />
        ) : activeView === "Albums" ? (
        <AlbumsView
          albumsState={albumsState}
          currentWaveform={currentWaveform.waveform}
          initialTarget={albumViewTarget}
          playback={playback}
          playbackBusy={playbackBusy}
          loadingMore={albumsLoadingMore}
            resetKey={albumsViewResetKey}
            onEnqueuePlayback={handleEnqueuePlayback}
            onLoadMore={loadMoreAlbums}
            onPlayAlbum={handlePlayAlbum}
            onPlayFile={handlePlayFile}
          />
        ) : activeView === "Imports" ? (
          <ImportsView
            importPaths={importPaths}
            importsState={importsState}
            roots={roots}
            setImportPaths={setImportPaths}
            onApprove={handleProposeImportApproval}
            onApproveBatch={handleProposeImportBatchApproval}
            onApplyBatch={handleApplyImportBatch}
            onCreateImport={handleCreateImport}
            onInspect={handleInspectImportItem}
            onReject={handleRejectImport}
            onSelectImportFiles={handleSelectImportFiles}
            onSelectImportFolder={handleSelectImportFolder}
            busyImportBatchId={busyImportBatchId}
          />
        ) : activeView === "Duplicates" ? (
          <DuplicatesView
            albumMergeState={albumMergeState}
            alternateEditionsState={alternateEditionsState}
            duplicatesState={duplicatesState}
            incompleteAlbumsState={incompleteAlbumsState}
            metadataGapsState={metadataGapsState}
            qualityUpgradesState={qualityUpgradesState}
            onEditMetadata={setEditingFile}
            onProposeAlbumMerge={handleProposeAlbumMerge}
            onProposeBulkAlbumMerge={handleProposeBulkAlbumMerge}
            onProposeBulkCleanup={handleProposeBulkDuplicateCleanup}
            onProposeCleanup={handleProposeDuplicateCleanup}
            onRefreshAlbumMerges={refreshAlbumMergeSuggestions}
            onRefreshAlternateEditions={refreshAlternateEditions}
            onRefreshIncompleteAlbums={refreshIncompleteAlbums}
            onRefreshMetadataGaps={refreshMetadataGaps}
            onRefreshQualityUpgrades={refreshQualityUpgrades}
          />
        ) : activeView === "Operations" ? (
          <OperationsView
            operationsState={operationsState}
            onApply={handleApplyBatch}
            onApprove={handleApproveBatch}
            onOpenAgentThread={handleOpenAgentThread}
            onReject={handleRejectBatch}
            onRevert={handleRevertBatch}
          />
        ) : activeView === "Discovery" ? (
          <DiscoveryView
            discoveryQuery={discoveryQuery}
            downloadState={discoveryDownloadState}
            downloadJobs={discoveryDownloadJobs}
            discoveryState={discoveryState}
            discoverySource={discoverySource}
            formatFilter={discoveryFormatFilter}
            expandedClusterIds={expandedDiscoveryClusters}
            expandedGroupIds={expandedDiscoveryGroups}
            inspectedGroupId={inspectedDiscoveryGroupId}
            availabilityFilter={discoveryAvailabilityFilter}
            libraryFiles={files}
            libraryFilter={discoveryLibraryFilter}
            parsedListState={parsedDiscoveryList}
            pastedListText={pastedDiscoveryList}
            savedCandidates={savedDiscoveryCandidates}
            savedLists={savedDiscoveryLists}
            selectedFileIds={selectedDiscoveryFiles}
            selectedGroupIds={selectedDiscoveryGroups}
            setDiscoveryQuery={setDiscoveryQuery}
            setDiscoverySource={setDiscoverySource}
            setPastedListText={setPastedDiscoveryList}
            sortMode={discoverySort}
            setAvailabilityFilter={setDiscoveryAvailabilityFilter}
            setFormatFilter={setDiscoveryFormatFilter}
            setLibraryFilter={setDiscoveryLibraryFilter}
            setSortMode={setDiscoverySort}
            onGroupSelect={toggleDiscoveryGroupSelection}
            onDownloadSelection={handleProposeDiscoveryDownload}
            onInspectGroup={setInspectedDiscoveryGroupId}
            onOpenJobs={() => setActiveView("Jobs")}
            onRefreshHealth={refreshDiscoveryHealth}
            onProposeSavedCandidateDownload={handleProposeSavedDiscoveryCandidateDownload}
            onRemoveSavedCandidate={handleRemoveSavedDiscoveryCandidate}
            onSaveCandidate={handleSaveDiscoveryCandidate}
            onSaveParsedList={handleSaveParsedDiscoveryList}
            onSearchParsedItem={handleSearchParsedDiscoveryItem}
            onLoadSavedList={handleLoadSavedDiscoveryList}
            onSearchSavedListMissing={handleSearchSavedDiscoveryListMissing}
            onParseList={handleParseDiscoveryList}
            onRemoveSavedList={handleRemoveSavedDiscoveryList}
            onSearch={handleDiscoverySearch}
            onToggleFileSelect={toggleDiscoveryFileSelection}
            onToggleCluster={toggleDiscoveryCluster}
            onToggleGroup={toggleDiscoveryGroup}
          />
        ) : activeView === "Playlists" ? (
          <PlaylistsView
            playbackBusy={playbackBusy}
            selectedPlaylist={selectedPlaylist}
            playlistsState={playlistsState}
            onBack={() => setSelectedPlaylistId(null)}
            onEnqueuePlayback={handleEnqueuePlayback}
            onOpenAlbumPage={openAlbumPage}
            onOpenArtistPage={openArtistPage}
            onOpenPlaylist={setSelectedPlaylistId}
            currentWaveform={currentWaveform.waveform}
            playback={playback}
            onPlayFile={handlePlayFile}
            onPlayFileIdsShuffled={handlePlayFileIdsShuffled}
            onPlayPlaylist={handlePlayPlaylist}
            onProposeDeletePlaylist={handleProposeDeletePlaylist}
            onProposeUpdatePlaylist={handleProposeUpdatePlaylist}
            onProposeRemoveItem={handleProposeRemovePlaylistItem}
          />
        ) : activeView === "Agent" ? (
          <AgentView
            agentBusy={agentBusy}
            agentInput={agentInput}
            activeThreadId={agentThreadId}
            messages={agentMessages}
            threads={agentThreads}
            setAgentInput={setAgentInput}
            onNewThread={handleNewAgentThread}
            onSelectThread={handleSelectAgentThread}
            onSubmit={handleAgentSubmit}
          />
        ) : activeView === "Jobs" ? (
          <JobsView jobsState={jobsState} selectedJob={selectedJobDetail} onInspect={handleInspectJob} onRefresh={refreshJobs} />
        ) : activeView === "Settings" ? (
          <SettingsView
            appearance={appearance}
            draft={tasteProfileDraft}
            state={tasteProfileState}
            setAppearance={setAppearance}
            setDraft={setTasteProfileDraft}
            onSelectBackgroundImage={handleSelectBackgroundImage}
            onSave={handleSaveTasteProfile}
          />
        ) : (
          <section className="placeholderView">
            <strong>{activeView} is not implemented yet.</strong>
          </section>
        )}
      </section>

      <aside className={inspectorCollapsed ? "inspector collapsed" : "inspector"}>
        <div className="inspectorHeader">
          <h2 aria-hidden={inspectorCollapsed}>Library State</h2>
          <button
            aria-expanded={!inspectorCollapsed}
            aria-label={inspectorCollapsed ? "Show library state sidebar" : "Hide library state sidebar"}
            className="secondary inspectorToggle"
            type="button"
            onClick={() => setInspectorCollapsed((current) => !current)}
          >
            {inspectorCollapsed ? <StateIcon /> : "Hide"}
          </button>
        </div>
        <div className="agentPanel" aria-hidden={inspectorCollapsed}>
          <div className="metric">
            <span>Roots</span>
            <strong>{roots.length}</strong>
          </div>
          <div className="metric">
            <span>Indexed files</span>
            <strong>{total}</strong>
          </div>
          <div className="metric">
            <span>Duplicate groups</span>
            <strong>{duplicates.totalGroups}</strong>
          </div>
          <div className="metric">
            <span>Metadata gaps</span>
            <strong>{metadataGaps.total}</strong>
          </div>
          <div className="metric">
            <span>Quality upgrades</span>
            <strong>{qualityUpgrades.total}</strong>
          </div>
          <div className="metric">
            <span>Incomplete albums</span>
            <strong>{incompleteAlbums.total}</strong>
          </div>
          <div className="metric">
            <span>Album merges</span>
            <strong>{albumMergeSuggestions.total}</strong>
          </div>
          <div className="metric">
            <span>Alternate editions</span>
            <strong>{alternateEditions.total}</strong>
          </div>
          <div className="metric">
            <span>Albums</span>
            <strong>{albums.total}</strong>
          </div>
          <div className="metric">
            <span>Operation batches</span>
            <strong>{operationBatches.length}</strong>
          </div>
          <div className="metric">
            <span>Playlists</span>
            <strong>{playlists.length}</strong>
          </div>
          <div className="operationPreview">
            <span>Phase 6</span>
            <strong>{playlistsState.status === "error" ? playlistsState.message : "Agent tools active"}</strong>
          </div>
        </div>
      </aside>

      <footer className="playerBar">
        <button
          aria-label="Seek playback"
          className="progressSeek"
          disabled={playbackBusy || playback.status === "stopped" || !playback.durationMs || playback.durationMs <= 0}
          title="Seek playback"
          type="button"
          onClick={(event) => void handleSeekPlayback(event)}
        >
          <div className="progressTrack">
            <WaveformCanvas
              className="playerWaveformCanvas"
              playback={playback}
              variant="rail"
              waveform={currentWaveform.waveform}
            />
            <div className="progressFill" key={playback.currentFileId ?? "stopped"} style={{ width: `${getProgressPercent(playback)}%` }} />
          </div>
        </button>
        <div className="playerBody">
          <div className="nowPlaying">
            <button
              aria-label="Open now playing view"
              className="nowPlayingOpen"
              disabled={!playback.currentFileId}
              type="button"
              onClick={() => setNowPlayingOpen(true)}
            >
              <span className={playback.status === "playing" ? "playerGlyph live" : "playerGlyph"}>
              {playback.currentFileId ? (
                <Artwork className="playerArt" src={artworkFileUrl(playback.currentFileId)} />
              ) : null}
                <SpectrumCanvas
                  className="playerMeterCanvas"
                  frameRef={barVisualizer.frameRef}
                  mode="spectrum"
                  playing={playback.status === "playing"}
                />
              </span>
            </button>
            <div className="nowPlayingText">
              <button
                className="nowPlayingTitleButton"
                disabled={!playback.currentFileId}
                title={playback.currentDisplayName ?? "Nothing queued"}
                type="button"
                onClick={() => setNowPlayingOpen(true)}
              >
                {currentPlaybackFile?.displayTags.title ?? playback.currentDisplayName ?? "Nothing queued"}
              </button>
              <span className="npMeta">
                <span className={`npStatusDot ${playback.status}`} aria-hidden="true" />
                <span>{playback.status}</span>
                {currentPlaybackFile?.displayTags.artist ? (
                  <button className="npLink" type="button" onClick={() => openArtistPage(currentPlaybackFile.displayTags.artist!)}>
                    {currentPlaybackFile.displayTags.artist}
                  </button>
                ) : null}
                {currentPlaybackFile?.displayTags.artist && currentPlaybackFile && getFileAlbumTarget(currentPlaybackFile) ? (
                  <span className="npMetaSeparator" aria-hidden="true">/</span>
                ) : null}
                {currentPlaybackFile && getFileAlbumTarget(currentPlaybackFile) ? (
                  <button className="npLink" type="button" onClick={() => void openAlbumPage(getFileAlbumTarget(currentPlaybackFile)!)}>
                    {currentPlaybackFile.displayTags.album}
                  </button>
                ) : null}
                {playback.queueIndex != null && playback.queue.length > 0 ? (
                  <span className="queueBadge">
                    {playback.queueIndex + 1} / {playback.queue.length}
                  </span>
                ) : null}
                {playback.error ? <span className="playerError" title={playback.error}>{playback.error}</span> : null}
              </span>
            </div>
          </div>
          <div className="transport">
            <button
              aria-label="Previous track"
              disabled={playbackBusy || playback.status === "stopped"}
              title="Previous"
              type="button"
              onClick={() => void handlePrevious()}
            >
              <TransportIcon shape="previous" />
            </button>
            <button
              aria-label={playback.status === "playing" ? "Pause" : "Resume"}
              className="tPlay"
              disabled={playbackBusy || playback.status === "stopped"}
              title={playback.status === "playing" ? "Pause (Space)" : "Resume (Space)"}
              type="button"
              onClick={() => void handlePauseResume()}
            >
              <TransportIcon shape={playback.status === "playing" ? "pause" : "play"} />
            </button>
            <button
              aria-label="Next track"
              disabled={playbackBusy || playback.status === "stopped"}
              title="Next"
              type="button"
              onClick={() => void handleNext()}
            >
              <TransportIcon shape="next" />
            </button>
            <RepeatControls
              disabled={playbackBusy || playback.status === "stopped"}
              repeatMode={playback.repeatMode}
              variant="bar"
              onRepeatMode={handleSetRepeatMode}
            />
            <button
              aria-label="Stop playback"
              disabled={playbackBusy || playback.status === "stopped"}
              title="Stop"
              type="button"
              onClick={() => void handleStop()}
            >
              <TransportIcon shape="stop" />
            </button>
          </div>
          <div className="playerAuxControls">
            {currentPlaybackFile ? (
              <NowPlayingActions
                file={currentPlaybackFile}
                variant="bar"
                onFavoriteStatus={handleProposePlaybackFavoriteStatus}
                onRating={handleProposePlaybackRating}
              />
            ) : null}
            <label className="volumeControl">
              <span className="volumeIcon" aria-hidden="true">
                <UiIcon name="volume" />
              </span>
              <input
                aria-label="Playback volume"
                max={100}
                min={0}
                type="range"
                value={playback.volumePercent}
                onChange={(event) => void handleVolumeChange(event.target.value)}
              />
              <strong>{playback.volumePercent}</strong>
            </label>
            <div className="playerTime">
              <span>{formatTime(playback.positionMs)}</span>
              <span className="timeSep">/</span>
              <span>{formatTime(playback.durationMs)}</span>
            </div>
          </div>
        </div>
      </footer>

      {editingFile ? (
        <MetadataEditor
          file={editingFile}
          onCancel={() => setEditingFile(null)}
          onSubmit={handleProposeMetadataEdit}
        />
      ) : null}

      {diagnosticsState.status !== "idle" ? (
        <DiagnosticsModal
          state={diagnosticsState}
          onClose={() => setDiagnosticsState({ status: "idle" })}
          onUpdateImportMetadata={handleUpdateImportMetadata}
        />
      ) : null}

      {nowPlayingOpen ? (
        <NowPlayingModal
          appearanceMode={appearance.mode}
          files={playbackFiles}
          playback={playback}
          playbackBusy={playbackBusy}
          onClose={() => setNowPlayingOpen(false)}
          onFavoriteStatus={handleProposePlaybackFavoriteStatus}
          onNext={handleNext}
          onPauseResume={handlePauseResume}
          onPlayFile={handlePlayFile}
          onPrevious={handlePrevious}
          onRating={handleProposePlaybackRating}
          onRepeatMode={handleSetRepeatMode}
          onSeek={seekPlaybackFromRatio}
          onOpenAlbumPage={openAlbumPage}
          onOpenArtistPage={openArtistPage}
          onVolumeChange={handleVolumeChange}
          visualizerFrameRef={modalVisualizer.frameRef}
          waveformState={currentWaveform}
        />
      ) : null}
    </main>
  );
}

async function fetchBackendHealth(): Promise<HealthResponse> {
  return getJson("/health", healthResponseSchema);
}

function artworkFileUrl(fileId: string): string {
  return `${backendOrigin}/artwork/file/${encodeURIComponent(fileId)}`;
}

function artworkAlbumUrl(albumId: string): string {
  return `${backendOrigin}/artwork/album/${encodeURIComponent(albumId)}`;
}

function artistImageUrl(artist: string): string {
  return `${backendOrigin}/artist-image/${encodeURIComponent(artist)}`;
}

const loadedArtworkSrcs = new Set<string>();
const failedArtworkSrcs = new Map<string, number>();
const artworkObjectUrls = new Map<string, string>();
const pendingArtworkObjectUrls = new Map<string, Promise<string>>();
const FAILED_ARTWORK_RETRY_MS = 30_000;

function Artwork({ src, className, eager }: { src: string | null; className: string; eager?: boolean }): ReactElement {
  const frameRef = useRef<HTMLSpanElement | HTMLImageElement | null>(null);
  const setFrameRef = (node: HTMLSpanElement | HTMLImageElement | null) => {
    frameRef.current = node;
  };
  const [displaySrc, setDisplaySrc] = useState<string | null>(() => (src ? (artworkObjectUrls.get(src) ?? null) : null));
  const [shouldLoad, setShouldLoad] = useState(() => Boolean(eager || (src && artworkObjectUrls.has(src))));
  const [status, setStatus] = useState<"pending" | "ready" | "failed">(() =>
    src && artworkObjectUrls.has(src) ? "ready" : !src || artworkFailedRecently(src) ? "failed" : "pending"
  );

  useEffect(() => {
    if (!src || artworkFailedRecently(src)) {
      setDisplaySrc(null);
      setStatus("failed");
      return;
    }
    const cachedObjectUrl = artworkObjectUrls.get(src);
    if (cachedObjectUrl) {
      setDisplaySrc(cachedObjectUrl);
      setShouldLoad(true);
      setStatus("ready");
      return;
    }
    setDisplaySrc(null);
    setShouldLoad(Boolean(eager));
    setStatus("pending");
  }, [eager, src]);

  useEffect(() => {
    if (!src || shouldLoad || eager || artworkObjectUrls.has(src) || artworkFailedRecently(src)) {
      return;
    }
    const node = frameRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "640px" }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [eager, shouldLoad, src]);

  useEffect(() => {
    if (!src || artworkFailedRecently(src)) {
      setDisplaySrc(null);
      setStatus("failed");
      return;
    }
    const cachedObjectUrl = artworkObjectUrls.get(src);
    if (cachedObjectUrl) {
      setDisplaySrc(cachedObjectUrl);
      setStatus("ready");
      return;
    }
    if (!shouldLoad) {
      setDisplaySrc(null);
      setStatus("pending");
      return;
    }

    let cancelled = false;
    setDisplaySrc(null);
    setStatus("pending");
    void getArtworkObjectUrl(src)
      .then((objectUrl) => {
        if (cancelled) {
          return;
        }
        setDisplaySrc(objectUrl);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        failedArtworkSrcs.set(src, Date.now());
        setDisplaySrc(null);
        setStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [shouldLoad, src]);

  if (!src || status === "failed" || !displaySrc) {
    return (
      <span aria-hidden="true" className={`${className} artFallback`} ref={setFrameRef}>
        <svg viewBox="0 0 16 16">
          <path d="M13 2 6 3.5v7.2a2.6 2.6 0 1 0 1.2 2.2V6.5L11.8 5v4.2A2.6 2.6 0 1 0 13 11.3z" />
        </svg>
      </span>
    );
  }
  return (
    <img
      alt=""
      className={`${className}${status === "ready" ? " artLoaded" : " artLoading"}`}
      decoding="async"
      loading={eager || loadedArtworkSrcs.has(src) ? "eager" : "lazy"}
      ref={setFrameRef}
      src={displaySrc}
      onLoad={() => {
        loadedArtworkSrcs.add(src);
        setStatus("ready");
      }}
      onError={() => {
        failedArtworkSrcs.set(src, Date.now());
        setStatus("failed");
      }}
    />
  );
}

function getArtworkObjectUrl(src: string): Promise<string> {
  const cachedObjectUrl = artworkObjectUrls.get(src);
  if (cachedObjectUrl) {
    return Promise.resolve(cachedObjectUrl);
  }
  const pendingObjectUrl = pendingArtworkObjectUrls.get(src);
  if (pendingObjectUrl) {
    return pendingObjectUrl;
  }

  const request = fetch(src)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Artwork request failed with ${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      artworkObjectUrls.set(src, objectUrl);
      loadedArtworkSrcs.add(src);
      failedArtworkSrcs.delete(src);
      return objectUrl;
    })
    .finally(() => {
      pendingArtworkObjectUrls.delete(src);
    });

  pendingArtworkObjectUrls.set(src, request);
  return request;
}

function artworkFailedRecently(src: string): boolean {
  const failedAt = failedArtworkSrcs.get(src);
  if (failedAt == null) {
    return false;
  }
  if (Date.now() - failedAt < FAILED_ARTWORK_RETRY_MS) {
    return true;
  }
  failedArtworkSrcs.delete(src);
  return false;
}

type VisualizerPalette = { acc: string; accDim: string; accInk: string; accLine: string };

const artworkVisualizerPaletteCache = new Map<string, VisualizerPalette | null>();

function useArtworkVisualizerPalette(src: string | null, mode: AppearanceMode): VisualizerPalette | null {
  const cacheKey = src ? `${mode}:${src}` : "";
  const [palette, setPalette] = useState<VisualizerPalette | null>(() => (
    cacheKey ? artworkVisualizerPaletteCache.get(cacheKey) ?? null : null
  ));

  useEffect(() => {
    if (!src) {
      setPalette(null);
      return;
    }
    const cached = artworkVisualizerPaletteCache.get(cacheKey);
    if (cached !== undefined) {
      setPalette(cached);
      return;
    }

    let cancelled = false;
    setPalette(null);
    void getArtworkObjectUrl(src)
      .then((objectUrl) => extractArtworkVisualizerPalette(objectUrl, mode))
      .then((nextPalette) => {
        artworkVisualizerPaletteCache.set(cacheKey, nextPalette);
        if (!cancelled) {
          setPalette(nextPalette);
        }
      })
      .catch(() => {
        artworkVisualizerPaletteCache.set(cacheKey, null);
        if (!cancelled) {
          setPalette(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, mode, src]);

  return palette;
}

async function extractArtworkVisualizerPalette(src: string, mode: AppearanceMode): Promise<VisualizerPalette | null> {
  const image = new Image();
  image.decoding = "async";
  const loadPromise = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Artwork image failed to load"));
  });
  image.src = src;
  try {
    await image.decode();
  } catch {
    await loadPromise;
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    return null;
  }

  const canvas = document.createElement("canvas");
  const size = 32;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const buckets = new Map<string, { count: number; r: number; g: number; b: number; saturation: number; lightness: number }>();

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 255;
    if (alpha < 160) {
      continue;
    }
    const color = {
      r: pixels[index] ?? 0,
      g: pixels[index + 1] ?? 0,
      b: pixels[index + 2] ?? 0
    };
    const hsl = rgbToHsl(color);
    if (hsl.s < 0.16 || hsl.l < 0.1 || hsl.l > 0.92) {
      continue;
    }
    const key = `${Math.round(color.r / 24)}:${Math.round(color.g / 24)}:${Math.round(color.b / 24)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += color.r;
      bucket.g += color.g;
      bucket.b += color.b;
      bucket.saturation += hsl.s;
      bucket.lightness += hsl.l;
    } else {
      buckets.set(key, {
        count: 1,
        r: color.r,
        g: color.g,
        b: color.b,
        saturation: hsl.s,
        lightness: hsl.l
      });
    }
  }

  let best: RgbColor | null = null;
  let bestScore = 0;
  for (const bucket of buckets.values()) {
    const color = {
      r: bucket.r / bucket.count,
      g: bucket.g / bucket.count,
      b: bucket.b / bucket.count
    };
    const saturation = bucket.saturation / bucket.count;
    const lightness = bucket.lightness / bucket.count;
    const themeVisibility = mode === "dark" ? 1 - Math.abs(lightness - 0.58) : 1 - Math.abs(lightness - 0.36);
    const score = Math.pow(bucket.count, 0.42) * (0.5 + saturation) * Math.max(0.35, themeVisibility);
    if (score > bestScore) {
      best = color;
      bestScore = score;
    }
  }
  if (!best) {
    return null;
  }

  const accent = normalizeVisualizerAccent(best, mode);
  const accentInk = mode === "dark"
    ? mixRgb(accent, { r: 0, g: 0, b: 0 }, 0.78)
    : mixRgb(accent, { r: 255, g: 255, b: 255 }, 0.86);
  return {
    acc: rgbToCss(accent),
    accDim: rgba(accent, mode === "dark" ? 0.16 : 0.13),
    accInk: rgbToCss(accentInk),
    accLine: rgba(accent, mode === "dark" ? 0.46 : 0.38)
  };
}

function normalizeVisualizerAccent(color: RgbColor, mode: AppearanceMode): RgbColor {
  const hsl = rgbToHsl(color);
  return hslToRgb({
    h: hsl.h,
    s: Math.max(mode === "dark" ? 0.62 : 0.5, Math.min(0.92, hsl.s * 1.18)),
    l: mode === "dark"
      ? Math.max(0.56, Math.min(0.72, hsl.l < 0.42 ? hsl.l + 0.24 : hsl.l))
      : Math.max(0.28, Math.min(0.42, hsl.l > 0.5 ? hsl.l - 0.22 : hsl.l))
  });
}

function ArtistHeroAlbumArtwork({
  album,
  index,
  total
}: {
  album: AlbumGroupItem;
  index: number;
  total: number;
}): ReactElement {
  const handlePointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const cover = event.currentTarget;
    const rect = cover.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    cover.style.setProperty("--tilt-x", `${(y * 18).toFixed(2)}deg`);
    cover.style.setProperty("--tilt-y", `${(-x * 20).toFixed(2)}deg`);
    cover.style.setProperty("--lift", "-0.18rem");
  };
  const handlePointerLeave = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const cover = event.currentTarget;
    cover.style.removeProperty("--tilt-x");
    cover.style.removeProperty("--tilt-y");
    cover.style.removeProperty("--lift");
  };

  return (
    <span
      className="artistHeroAlbumShell"
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      style={{ zIndex: total + index } as CSSProperties}
    >
      <Artwork className="artistHeroAlbumArt" src={artworkAlbumUrl(album.id)} />
    </span>
  );
}

function ActionIcon({ shape }: { shape: "like" | "dislike" | "tags" | "edit" | "remove" }): ReactElement {
  if (shape === "like") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="M8 13.6 2.7 8.3a3.3 3.3 0 0 1 4.6-4.6l.7.7.7-.7a3.3 3.3 0 0 1 4.6 4.6z" />
      </svg>
    );
  }
  if (shape === "dislike") {
    return (
      <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 16 16">
        <path d="M8 12.9 3.4 8.3a2.9 2.9 0 0 1 4-4.1l.6.6.6-.6a2.9 2.9 0 0 1 4 4.1z" />
        <path d="m2.5 13.5 11-11" />
      </svg>
    );
  }
  if (shape === "tags") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="M2 2h5.2L14 8.8 8.8 14 2 7.2zm3.4 2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z" fillRule="evenodd" />
      </svg>
    );
  }
  if (shape === "edit") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="M2 11.6V14h2.4l8.2-8.2-2.4-2.4zM13.7 4.7l-2.4-2.4 1-1L14.7 3.7z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 16 16">
      <path d="m3.5 3.5 9 9m0-9-9 9" />
    </svg>
  );
}

function TransportIcon({ shape }: { shape: "play" | "pause" | "stop" | "next" | "previous" | "shuffle" }): ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      {shape === "play" ? (
        <path d="M4 2.5v11l9-5.5z" />
      ) : shape === "pause" ? (
        <path d="M4 2.5h3v11H4zm5 0h3v11H9z" />
      ) : shape === "stop" ? (
        <path d="M3.5 3.5h9v9h-9z" />
      ) : shape === "next" ? (
        <path d="M3 2.5v11l7-5.5zm8 0h2v11h-2z" />
      ) : shape === "previous" ? (
        <path d="M13 2.5v11l-7-5.5zm-8 0H3v11h2z" />
      ) : (
        <path d="M3 4.5h2.2c1.4 0 2.2 1.1 3 2.5l.6 1c.8 1.4 1.6 2.5 3 2.5H13M11 2.8 13.2 5 11 7.2M3 11.5h2.2c.9 0 1.5-.5 2-1.2M9.3 5.7c.7-.8 1.4-1.2 2.5-1.2H13M11 8.8l2.2 2.2-2.2 2.2" />
      )}
    </svg>
  );
}

function RepeatIcon({ mode }: { mode: Exclude<PlaybackRepeatMode, "none"> }): ReactElement {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16">
      <path d="M4.5 4h6.2L12.5 5.8" />
      <path d="M11.5 2.2 13.5 4l-2 1.8" />
      <path d="M11.5 12H5.3L3.5 10.2" />
      <path d="M4.5 13.8 2.5 12l2-1.8" />
      {mode === "song" ? <path d="M8 6.2v3.6" /> : null}
    </svg>
  );
}

function QueueIcon(): ReactElement {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 16 16">
      <path d="M3 4h6" />
      <path d="M3 8h6" />
      <path d="M3 12h4" />
      <path d="M12 6v6" />
      <path d="M9.5 9h5" />
    </svg>
  );
}

function QueueMenuButton({
  disabled,
  fileIds,
  label,
  onEnqueue
}: {
  disabled?: boolean;
  fileIds: string[];
  label: string;
  onEnqueue(fileIds: string[], position: QueueInsertPosition): Promise<void>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const canQueue = !disabled && fileIds.length > 0;

  function updateMenuPosition(): void {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const bounds = trigger.getBoundingClientRect();
    const menuWidth = 144;
    const menuHeight = 68;
    const gap = 6;
    const rightAlignedLeft = bounds.right + gap;
    const left =
      rightAlignedLeft + menuWidth > window.innerWidth - gap
        ? Math.max(gap, bounds.left - menuWidth - gap)
        : rightAlignedLeft;
    const top = Math.max(gap, Math.min(window.innerHeight - menuHeight - gap, bounds.top + bounds.height / 2 - menuHeight / 2));
    setMenuPosition({ left, top });
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    updateMenuPosition();
    const handleWindowChange = () => updateMenuPosition();
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target)) {
        return;
      }
      const menu = document.getElementById(menuId);
      if (menu?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuId, open]);

  async function handleSelect(position: QueueInsertPosition): Promise<void> {
    setOpen(false);
    await onEnqueue(fileIds, position);
  }

  return (
    <span className="queueMenuShell" onClick={(event) => event.stopPropagation()}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Queue options for ${label}`}
        aria-controls={open ? menuId : undefined}
        className="queueMenuTrigger"
        disabled={!canQueue}
        ref={triggerRef}
        title="Queue options"
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          window.requestAnimationFrame(updateMenuPosition);
        }}
      >
        <QueueIcon />
      </button>
      {open && menuPosition
        ? createPortal(
            <div className="queueMenu" id={menuId} role="menu" style={{ left: menuPosition.left, top: menuPosition.top }}>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => void handleSelect("up_next")}>
                Add Up Next
              </button>
              <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => void handleSelect("end")}>
                Add to End
              </button>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

function RepeatControls({
  disabled,
  repeatMode,
  onRepeatMode,
  variant
}: {
  disabled: boolean;
  repeatMode: PlaybackRepeatMode;
  onRepeatMode(repeatMode: PlaybackRepeatMode): Promise<void>;
  variant: "bar" | "modal";
}): ReactElement {
  return (
    <div className={`repeatControls ${variant}`} aria-label="Loop controls">
      <button
        aria-pressed={repeatMode === "song"}
        className={repeatMode === "song" ? "active" : ""}
        disabled={disabled}
        title={repeatMode === "song" ? "Disable song loop" : "Loop current song"}
        type="button"
        onClick={() => void onRepeatMode(repeatMode === "song" ? "none" : "song")}
      >
        <RepeatIcon mode="song" />
      </button>
      <button
        aria-pressed={repeatMode === "queue"}
        className={repeatMode === "queue" ? "active" : ""}
        disabled={disabled}
        title={repeatMode === "queue" ? "Disable queue loop" : "Loop queue"}
        type="button"
        onClick={() => void onRepeatMode(repeatMode === "queue" ? "none" : "queue")}
      >
        <RepeatIcon mode="queue" />
      </button>
    </div>
  );
}

function FolderIcon(): ReactElement {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
      <path d="M1.8 4.2h4.4l1.2 1.5h6.8v6.1a1.5 1.5 0 0 1-1.5 1.5H3.3a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M1.8 6.2h12.4" />
    </svg>
  );
}

function StarIcon(): ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m8 1.9 1.8 3.7 4.1.6-3 2.9.7 4.1L8 11.3l-3.6 1.9.7-4.1-3-2.9 4.1-.6z" />
    </svg>
  );
}

function DownloadIcon(): ReactElement {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 16 16">
      <path d="M8 2.5v7" />
      <path d="m4.8 7.2 3.2 3.3 3.2-3.3" />
      <path d="M3 12.8h10" />
    </svg>
  );
}

function DiscoveryLoadingState({ query }: { query: string }): ReactElement {
  return (
    <div className="discoveryLoadingState" role="status" aria-live="polite">
      <div className="discoveryLoadingMark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <strong>Searching slskd</strong>
        <span>{query ? `Waiting for sources matching "${query}".` : "Waiting for source responses."}</span>
      </div>
    </div>
  );
}

function NowPlayingActions({
  file,
  variant,
  onFavoriteStatus,
  onRating
}: {
  file: LibraryFile;
  variant: "bar" | "modal";
  onFavoriteStatus(fileId: string, status: "liked" | "disliked" | "neutral"): Promise<void>;
  onRating(fileId: string, rating: number | null): Promise<void>;
}): ReactElement {
  const title = file.displayTags.title ?? file.filename;
  return (
    <div className={`nowPlayingActions ${variant}`} aria-label={`Preferences for ${title}`}>
      <div className="favoriteControls" aria-label="Preference">
        <button
          aria-label={file.liked ? `Unlike ${title}` : `Like ${title}`}
          className={file.liked ? "active" : ""}
          title={file.liked ? "Unlike" : "Like"}
          type="button"
          onClick={() => void onFavoriteStatus(file.id, file.liked ? "neutral" : "liked")}
        >
          <ActionIcon shape="like" />
        </button>
        <button
          aria-label={file.disliked ? `Remove dislike for ${title}` : `Dislike ${title}`}
          className={file.disliked ? "active" : ""}
          title={file.disliked ? "Remove dislike" : "Dislike"}
          type="button"
          onClick={() => void onFavoriteStatus(file.id, file.disliked ? "neutral" : "disliked")}
        >
          <ActionIcon shape="dislike" />
        </button>
      </div>
      <div className="starControls" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            aria-label={`Rate ${title} ${rating} star${rating === 1 ? "" : "s"}`}
            className={(file.rating ?? 0) >= rating ? "active" : ""}
            key={rating}
            title={`${rating}/5`}
            type="button"
            onClick={() => void onRating(file.id, rating)}
          >
            <StarIcon />
          </button>
        ))}
      </div>
    </div>
  );
}

function PagedScrollSection({
  children,
  className,
  hasMore,
  loading,
  onLoadMore
}: {
  children: ReactNode;
  className: string;
  hasMore: boolean;
  loading: boolean;
  onLoadMore(): Promise<void>;
}): ReactElement {
  const sectionRef = useRef<HTMLElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const section = sectionRef.current;
    if (!sentinel || !hasMore || loading) {
      return;
    }
    const scroller = section && section.scrollHeight > section.clientHeight + 1 ? section : null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void onLoadMore();
        }
      },
      { root: scroller, rootMargin: "720px 0px", threshold: 0.01 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [className, hasMore, loading, onLoadMore]);

  return (
    <section className={className} ref={sectionRef}>
      {children}
      <div className="loadMoreSentinel" ref={sentinelRef} aria-hidden="true" />
    </section>
  );
}

function LoadMoreRow({
  loaded,
  loading,
  total,
  onLoadMore
}: {
  loaded: number;
  loading: boolean;
  total: number;
  onLoadMore(): Promise<void>;
}): ReactElement {
  return (
    <div className="loadMoreRow">
      <span>
        {Math.min(loaded, total).toLocaleString()} of {total.toLocaleString()} loaded
      </span>
      <button disabled={loading || loaded >= total} type="button" onClick={() => void onLoadMore()}>
        {loading ? "Loading" : "Load More"}
      </button>
    </div>
  );
}

function StateIcon(): ReactElement {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16">
      <path d="M3 13V8" />
      <path d="M8 13V3" />
      <path d="M13 13V6" />
      <path d="M2 13.2h12" />
    </svg>
  );
}

function NavIcon({ view }: { view: string }): ReactElement {
  const name =
    view === "Home"
      ? "home"
      : view === "Library"
      ? "library"
      : view === "Artists"
        ? "artist"
        : view === "Albums"
          ? "album"
          : view === "Duplicates"
            ? "duplicate"
            : view === "Imports"
              ? "import"
              : view === "Operations"
                ? "operations"
                : view === "Discovery"
                  ? "search"
                  : view === "Playlists"
                    ? "playlist"
                    : view === "Agent"
                      ? "agent"
                      : view === "Jobs"
                        ? "jobs"
                        : "settings";
  return <UiIcon name={name} />;
}

function UiIcon({ name }: { name: string }): ReactElement {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" viewBox="0 0 16 16">
      {name === "home" ? (
        <path d="M2.8 7.3 8 3l5.2 4.3M4.2 6.4v6h7.6v-6M6.5 12.4V9h3v3.4" />
      ) : name === "library" ? (
        <path d="M2.5 3.5h3v9h-3zm4 0h3v9h-3zm4 0h3v9h-3z" />
      ) : name === "artist" ? (
        <path d="M8 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3.5 13c.8-2 2.3-3 4.5-3s3.7 1 4.5 3" />
      ) : name === "album" ? (
        <path d="M8 13.5A5.5 5.5 0 1 0 8 2.5a5.5 5.5 0 0 0 0 11zM8 9.5A1.5 1.5 0 1 0 8 6.5a1.5 1.5 0 0 0 0 3z" />
      ) : name === "duplicate" ? (
        <path d="M5.5 5.5h7v7h-7zM3.5 10.5v-7h7" />
      ) : name === "import" ? (
        <path d="M8 2.5v7m0 0 2.5-2.5M8 9.5 5.5 7M3 12.5h10" />
      ) : name === "operations" ? (
        <path d="M3 4h10M3 8h10M3 12h10M5 2.8v2.4M11 6.8v2.4M7 10.8v2.4" />
      ) : name === "search" ? (
        <path d="M7 11.5A4.5 4.5 0 1 0 7 2.5a4.5 4.5 0 0 0 0 9zM10.5 10.5 13.5 13.5" />
      ) : name === "playlist" ? (
        <path d="M3 4h6M3 8h6M3 12h4M11 5v5.5a1.5 1.5 0 1 0 1.5 1.5V6.5L14 6" />
      ) : name === "agent" ? (
        <path d="M4 6.5h8v5H4zM6 6.5V4h4v2.5M6.5 9h.1M9.4 9h.1M7 12.5h2" />
      ) : name === "jobs" ? (
        <path d="M3 4.5h10M3 8h10M3 11.5h10M3 4.5l1.3-2h7.4l1.3 2" />
      ) : name === "settings" ? (
        <path d="M8 10.2A2.2 2.2 0 1 0 8 5.8a2.2 2.2 0 0 0 0 4.4zM8 2.5v1.3m0 8.4v1.3M3.2 4.4l.9.9m7.8 5.4.9.9m0-7.2-.9.9m-7.8 5.4-.9.9M2.5 8h1.3m8.4 0h1.3" />
      ) : name === "volume" ? (
        <path d="M2.5 6.5h2.2L8 3.8v8.4L4.7 9.5H2.5zM10.2 5.6a3.2 3.2 0 0 1 0 4.8M12 4a5.6 5.6 0 0 1 0 8" />
      ) : name === "format" ? (
        <path d="M3 3.5h10v9H3zM5 6h6M5 9h4" />
      ) : name === "status" ? (
        <path d="M8 13.5A5.5 5.5 0 1 0 8 2.5a5.5 5.5 0 0 0 0 11zM5.8 8.1l1.4 1.4 3-3" />
      ) : name === "preference" ? (
        <path d="M8 13 3.6 8.6a3 3 0 0 1 4.2-4.2l.2.2.2-.2a3 3 0 0 1 4.2 4.2z" />
      ) : name === "rating" ? (
        <path d="m8 2.7 1.5 3 3.3.5-2.4 2.3.6 3.3L8 10.2l-3 1.6.6-3.3-2.4-2.3 3.3-.5z" />
      ) : name === "plays" ? (
        <path d="M4.5 3.5v9l7-4.5z" />
      ) : name === "sort" ? (
        <path d="M3 4h7M3 8h5M3 12h3M12 3v9m0 0-2-2m2 2 2-2" />
      ) : (
        <path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h9" />
      )}
    </svg>
  );
}

type StyledSelectOption<T extends string> = { value: T; label: string };

function SelectChevronIcon(): ReactElement {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 16 16">
      <path d="m4.5 6.5 3.5 3 3.5-3" />
    </svg>
  );
}

function StyledSelect<T extends string>({
  ariaLabel,
  className,
  disabled = false,
  options,
  title,
  value,
  onChange
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  options: Array<StyledSelectOption<T>>;
  title?: string;
  value: T;
  onChange(value: T): void;
}): ReactElement {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }
    const syncMenuPosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setMenuStyle({
        left: rect.left,
        minWidth: rect.width,
        top: rect.bottom + 4,
        maxHeight: Math.max(120, window.innerHeight - rect.bottom - 16)
      });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    syncMenuPosition();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", syncMenuPosition);
    window.addEventListener("scroll", syncMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", syncMenuPosition);
      window.removeEventListener("scroll", syncMenuPosition, true);
    };
  }, [open]);

  return (
    <div className={className ? `styledSelect ${className}` : "styledSelect"} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="styledSelectButton"
        disabled={disabled}
        title={title}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selectedOption?.label ?? ""}</span>
        <SelectChevronIcon />
      </button>
      {open
        ? createPortal(
        <div className="styledSelectMenu" id={id} ref={menuRef} role="listbox" aria-label={ariaLabel} style={menuStyle}>
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={option.value === value ? "styledSelectOption active" : "styledSelectOption"}
              key={option.value}
              role="option"
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>,
        document.body
          )
        : null}
    </div>
  );
}

function IndeterminateCheckbox({
  ariaLabel,
  checked,
  indeterminate,
  title,
  onChange
}: {
  ariaLabel: string;
  checked: boolean;
  indeterminate: boolean;
  title?: string;
  onChange(): void;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      aria-label={ariaLabel}
      checked={checked}
      ref={inputRef}
      title={title}
      type="checkbox"
      onChange={onChange}
    />
  );
}

function LibraryView({
  bulkRenamePattern,
  bulkTagInput,
  busyRootId,
  currentWaveform,
  files,
  libraryLoadingMore,
  libraryTotal,
  playback,
  playbackBusy,
  playlistAddTargetId,
  playlistDescriptionInput,
  playlistNameInput,
  playlists,
  rootPath,
  rootWatchEnabled,
  roots,
  scanResult,
  search,
  selectedFileIds,
  selectedRoot,
  watchedScanResult,
  setBulkRenamePattern,
  setBulkTagInput,
  setPlaylistAddTargetId,
  setPlaylistDescriptionInput,
  setPlaylistNameInput,
  setRootPath,
  setRootWatchEnabled,
  setSearch,
  onAddRoot,
  onClearSelection,
  onSelectRootFolder,
  onEditFile,
  onEnqueuePlayback,
  onInspectFile,
  onLoadMore,
  onOpenAlbumPage,
  onOpenArtistPage,
  onPlayFile,
  onProposeAddToPlaylist,
  onProposeBulkMetadata,
  onProposeBulkRename,
  onProposeBulkRenameForFiles,
  onProposeBulkTags,
  onProposeBulkTagsForFiles,
  onProposePlaylist,
  onProposeFavoriteStatus,
  onProposeRating,
  onRemoveFiles,
  onRemoveFile,
  onRemoveRoot,
  onScanRoot,
  onScanWatchedRoots,
  onSearch,
  onToggleAlbumSelection,
  onToggleFileSelection,
  onToggleRootWatch
}: {
  bulkRenamePattern: string;
  bulkTagInput: string;
  busyRootId: string | null;
  currentWaveform: WaveformSummaryResponse | null;
  files: LibraryFile[];
  libraryLoadingMore: boolean;
  libraryTotal: number;
  playback: PlaybackStateResponse;
  playbackBusy: boolean;
  playlistAddTargetId: string;
  playlistDescriptionInput: string;
  playlistNameInput: string;
  playlists: Playlist[];
  rootPath: string;
  rootWatchEnabled: boolean;
  roots: LibraryRoot[];
  scanResult: LibraryScanResult | null;
  search: string;
  selectedFileIds: Set<string>;
  selectedRoot: LibraryRoot | null;
  watchedScanResult: WatchedLibraryScanResult | null;
  setBulkRenamePattern(value: string): void;
  setBulkTagInput(value: string): void;
  setPlaylistAddTargetId(value: string): void;
  setPlaylistDescriptionInput(value: string): void;
  setPlaylistNameInput(value: string): void;
  setRootPath(value: string): void;
  setRootWatchEnabled(value: boolean): void;
  setSearch(value: string): void;
  onAddRoot(event: FormEvent<HTMLFormElement>): Promise<void>;
  onClearSelection(): void;
  onSelectRootFolder(): Promise<void>;
  onEditFile(file: LibraryFile): void;
  onEnqueuePlayback(fileIds: string[], position: QueueInsertPosition): Promise<void>;
  onInspectFile(fileId: string): Promise<void>;
  onLoadMore(): Promise<void>;
  onOpenAlbumPage(group: Pick<LibraryAlbumGroup, "artist" | "album" | "year">): void | Promise<void>;
  onOpenArtistPage(artist: string): void;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
  onProposeAddToPlaylist(event: FormEvent<HTMLFormElement>): Promise<void>;
  onProposeBulkMetadata(fileIds: string[], metadata: EditableFileMetadata): Promise<void>;
  onProposeBulkRename(event: FormEvent<HTMLFormElement>): Promise<void>;
  onProposeBulkRenameForFiles(fileIds: string[], pattern: string): Promise<void>;
  onProposeBulkTags(event: FormEvent<HTMLFormElement>): Promise<void>;
  onProposeBulkTagsForFiles(fileIds: string[], tagText: string): Promise<void>;
  onProposePlaylist(event: FormEvent<HTMLFormElement>): Promise<void>;
  onProposeFavoriteStatus(fileId: string, status: "liked" | "disliked" | "neutral"): Promise<void>;
  onProposeRating(fileId: string, rating: number | null): Promise<void>;
  onRemoveFiles(fileIds: string[], label: string): Promise<void>;
  onRemoveFile(file: LibraryFile): Promise<void>;
  onRemoveRoot(root: LibraryRoot): Promise<void>;
  onScanRoot(rootId: string): Promise<void>;
  onScanWatchedRoots(): Promise<void>;
  onSearch(event: FormEvent<HTMLFormElement>): Promise<void>;
  onToggleAlbumSelection(fileIds: string[]): void;
  onToggleFileSelection(fileId: string): void;
  onToggleRootWatch(root: LibraryRoot): Promise<void>;
}): ReactElement {
  const selectedCount = selectedFileIds.size;
  const watchedRootCount = roots.filter((root) => root.watchEnabled).length;
  const [formatFilter, setFormatFilter] = useState<LibraryFormatFilter>("all");
  const [missingFilter, setMissingFilter] = useState<LibraryMissingFilter>("present");
  const [favoriteFilter, setFavoriteFilter] = useState<LibraryFavoriteFilter>("all");
  const [sortMode, setSortMode] = useState<LibrarySortMode>("artistAlbum");
  const [minimumRating, setMinimumRating] = useState("");
  const [minimumPlays, setMinimumPlays] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showRoots, setShowRoots] = useState(false);
  const [selectionActionsOpen, setSelectionActionsOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const albumLibraryRef = useRef<HTMLElement | null>(null);
  const visibleAlbumFrameRef = useRef<number | null>(null);
  const [visibleAlbumRange, setVisibleAlbumRange] = useState({ start: 0, end: 16 });
  const activeFilterCount =
    (formatFilter !== "all" ? 1 : 0) +
    (missingFilter !== "present" ? 1 : 0) +
    (favoriteFilter !== "all" ? 1 : 0) +
    (minimumRating.trim() !== "" ? 1 : 0) +
    (minimumPlays.trim() !== "" ? 1 : 0) +
    (tagFilter.trim() !== "" ? 1 : 0);
  const rootsPanelOpen = showRoots || roots.length === 0;
  const filteredFiles = useMemo(
    () =>
      filterLibraryFiles(files, {
        format: formatFilter,
        missing: missingFilter,
        favorite: favoriteFilter,
        minimumRating,
        minimumPlays,
        tagText: tagFilter
      }),
    [favoriteFilter, files, formatFilter, minimumPlays, minimumRating, missingFilter, tagFilter]
  );
  const albumGroups = useMemo(() => groupLibraryFilesByAlbum(filteredFiles, sortMode), [filteredFiles, sortMode]);
  const visibleQueueFileIds = useMemo(() => albumGroups.flatMap((group) => group.files.map((file) => file.id)), [albumGroups]);
  const albumGroupHeights = useMemo(
    () => albumGroups.map((group) => getEstimatedLibraryAlbumGroupHeight(group)),
    [albumGroups]
  );
  const albumGroupOffsets = useMemo(() => getVirtualOffsets(albumGroupHeights), [albumGroupHeights]);
  const albumGroupTotalHeight = albumGroupOffsets[albumGroupOffsets.length - 1] ?? 0;
  const boundedVisibleAlbumRange = useMemo(
    () => ({
      start: Math.min(visibleAlbumRange.start, albumGroups.length),
      end: Math.min(Math.max(visibleAlbumRange.end, visibleAlbumRange.start + 1), albumGroups.length)
    }),
    [albumGroups.length, visibleAlbumRange.end, visibleAlbumRange.start]
  );
  const virtualAlbumGroups = useMemo(
    () => albumGroups.slice(boundedVisibleAlbumRange.start, boundedVisibleAlbumRange.end),
    [albumGroups, boundedVisibleAlbumRange.end, boundedVisibleAlbumRange.start]
  );
  const virtualTopPadding = albumGroupOffsets[boundedVisibleAlbumRange.start] ?? 0;
  const virtualBottomPadding = Math.max(0, albumGroupTotalHeight - (albumGroupOffsets[boundedVisibleAlbumRange.end] ?? albumGroupTotalHeight));
  const selectedFileIdList = useMemo(() => [...selectedFileIds], [selectedFileIds]);
  const libraryHasMore = files.length < libraryTotal;

  useEffect(() => {
    if (selectedCount === 0) {
      setSelectionActionsOpen(false);
      setBulkEditOpen(false);
    }
  }, [selectedCount]);

  useEffect(() => {
    const list = albumLibraryRef.current;
    const scroller = list?.closest(".centerPane") as HTMLElement | null;
    if (!list || !scroller || albumGroups.length === 0) {
      setVisibleAlbumRange({ start: 0, end: Math.min(albumGroups.length, 16) });
      return;
    }

    const updateVisibleRange = () => {
      const listTop = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const overscan = 520;
      const viewportTop = Math.max(0, scroller.scrollTop - listTop - overscan);
      const viewportBottom = Math.min(albumGroupTotalHeight, scroller.scrollTop - listTop + scroller.clientHeight + overscan);
      const start = Math.max(0, getVirtualIndexBeforeOffset(albumGroupOffsets, viewportTop) - 1);
      const end = Math.min(albumGroups.length, getVirtualIndexAfterOffset(albumGroupOffsets, viewportBottom) + 2);
      setVisibleAlbumRange((current) => (current.start === start && current.end === end ? current : { start, end }));
      if (libraryHasMore && !libraryLoadingMore && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 900) {
        void onLoadMore();
      }
    };
    const scheduleVisibleRangeUpdate = () => {
      if (visibleAlbumFrameRef.current != null) {
        return;
      }
      visibleAlbumFrameRef.current = window.requestAnimationFrame(() => {
        visibleAlbumFrameRef.current = null;
        updateVisibleRange();
      });
    };

    updateVisibleRange();
    scroller.addEventListener("scroll", scheduleVisibleRangeUpdate, { passive: true });
    window.addEventListener("resize", scheduleVisibleRangeUpdate);
    return () => {
      scroller.removeEventListener("scroll", scheduleVisibleRangeUpdate);
      window.removeEventListener("resize", scheduleVisibleRangeUpdate);
      if (visibleAlbumFrameRef.current != null) {
        window.cancelAnimationFrame(visibleAlbumFrameRef.current);
        visibleAlbumFrameRef.current = null;
      }
    };
  }, [albumGroupOffsets, albumGroupTotalHeight, albumGroups.length, libraryHasMore, libraryLoadingMore, onLoadMore]);

  return (
    <>
      <section className="libraryCommandBar" aria-label="Library controls">
        <form className="searchForm" onSubmit={(event) => void onSearch(event)}>
          <input
            aria-label="Search library"
            placeholder="Search titles, artists, albums, tags…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit">Search</button>
        </form>
        <div className="commandBarToggles">
          <button
            className={showFilters || activeFilterCount > 0 ? "toggleChip active" : "toggleChip"}
            type="button"
            onClick={() => setShowFilters((current) => !current)}
          >
            Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
          </button>
          <button
            className={rootsPanelOpen ? "toggleChip active" : "toggleChip"}
            type="button"
            onClick={() => setShowRoots((current) => !current)}
          >
            Roots · {roots.length.toLocaleString()}
          </button>
        </div>
      </section>

      {rootsPanelOpen ? (
        <section className="collapsePanel rootPanel" aria-label="Library roots">
          <div className="rootStripHeader">
            <div>
              <strong>Library Roots</strong>
              <span>
                {watchedRootCount.toLocaleString()} watched · {roots.length.toLocaleString()} total
              </span>
            </div>
            <button
              className="secondary"
              disabled={watchedRootCount === 0 || busyRootId === "__watched__"}
              type="button"
              onClick={() => void onScanWatchedRoots()}
            >
              {busyRootId === "__watched__" ? "Scanning Watched" : "Scan Watched"}
            </button>
          </div>
          <form className="pathForm" onSubmit={(event) => void onAddRoot(event)}>
            <input
              aria-label="Library folder path"
              placeholder="/path/to/music"
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
            />
            <button title="Open native folder picker in Electron" type="button" onClick={() => void onSelectRootFolder()}>
              Browse
            </button>
            <label className="watchRootToggle">
              <input
                checked={rootWatchEnabled}
                type="checkbox"
                onChange={(event) => setRootWatchEnabled(event.target.checked)}
              />
              <span>Watch</span>
            </label>
            <button type="submit">Add Root</button>
          </form>
          {roots.length === 0 ? (
            <span className="muted">No library roots configured.</span>
          ) : (
            <div className="rootList">
              {roots.map((root) => (
                <div className="rootItem" key={root.id}>
                  <span className={root.watchEnabled ? "rootIcon watched" : "rootIcon"} aria-hidden="true">
                    <FolderIcon />
                  </span>
                  <div className="rootItemMain">
                    <div>
                      <strong>{root.name}</strong>
                      <span className={root.watchEnabled ? "rootStatus watched" : "rootStatus"}>
                        {root.watchEnabled ? "Watched" : "Manual"}
                      </span>
                    </div>
                    <span title={root.path}>{root.path}</span>
                  </div>
                  <div className="rootActions">
                    <button className={root.watchEnabled ? "active" : "secondary"} type="button" onClick={() => void onToggleRootWatch(root)}>
                      {root.watchEnabled ? "Watched" : "Watch"}
                    </button>
                    <button disabled={busyRootId === root.id} type="button" onClick={() => void onScanRoot(root.id)}>
                      {busyRootId === root.id ? "Scanning" : "Rescan"}
                    </button>
                    <button
                      className="secondary"
                      disabled={busyRootId === root.id}
                      type="button"
                      onClick={() => void onRemoveRoot(root)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {scanResult ? (
            <div className="scanSummary" aria-label="Last scan summary">
              <strong>Last scan</strong>
              <span>{scanResult.scanned} scanned</span>
              <span>{scanResult.inserted} new</span>
              <span>{scanResult.updated} updated</span>
              <span>{scanResult.missingMarked} missing</span>
              {scanResult.errors.length > 0 ? <span>{scanResult.errors.length} errors</span> : null}
            </div>
          ) : null}
          {watchedScanResult ? (
            <div className="scanSummary" aria-label="Last watched scan summary">
              <strong>Watched scan</strong>
              <span>{watchedScanResult.rootsScanned} roots</span>
              <span>{watchedScanResult.totals.scanned} scanned</span>
              <span>{watchedScanResult.totals.inserted} new</span>
              <span>{watchedScanResult.totals.updated} updated</span>
              <span>{watchedScanResult.totals.missingMarked} missing</span>
              {watchedScanResult.totals.errors > 0 ? <span>{watchedScanResult.totals.errors} errors</span> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {showFilters ? (
        <section className="libraryRefiners collapsePanel" aria-label="Library filters and sorting">
          <div className="libraryRefinerStats">
            <div className="libraryRefinerSummary">
              <strong>
                {filteredFiles.length.toLocaleString()} of {libraryTotal.toLocaleString()} shown
              </strong>
              <span>Current result set</span>
            </div>
            <div className="libraryRefinerSummary">
              <strong>{albumGroups.length.toLocaleString()} album group{albumGroups.length === 1 ? "" : "s"}</strong>
              <span>Artist and album sort</span>
            </div>
          </div>
          <div className="libraryFilterGrid">
            <label>
              <span><UiIcon name="sort" />Sort</span>
              <StyledSelect<LibrarySortMode>
                ariaLabel="Library sort"
                options={[
                  { value: "artistAlbum", label: "Artist / album" },
                  { value: "recent", label: "Recently added" },
                  { value: "listens", label: "Most listens" },
                  { value: "likes", label: "Most likes" },
                  { value: "rating", label: "Highest rating" }
                ]}
                value={sortMode}
                onChange={setSortMode}
              />
            </label>
            <label>
              <span><UiIcon name="format" />Format</span>
              <StyledSelect<LibraryFormatFilter>
                ariaLabel="Format"
                options={[
                  { value: "all", label: "All" },
                  { value: "lossless", label: "Lossless" },
                  { value: "compressed", label: "Compressed" }
                ]}
                value={formatFilter}
                onChange={setFormatFilter}
              />
            </label>
            <label>
              <span><UiIcon name="status" />Status</span>
              <StyledSelect<LibraryMissingFilter>
                ariaLabel="Status"
                options={[
                  { value: "present", label: "Present" },
                  { value: "missing", label: "Missing" },
                  { value: "all", label: "All" }
                ]}
                value={missingFilter}
                onChange={setMissingFilter}
              />
            </label>
            <label>
              <span><UiIcon name="preference" />Preference</span>
              <StyledSelect<LibraryFavoriteFilter>
                ariaLabel="Preference"
                options={[
                  { value: "all", label: "All" },
                  { value: "liked", label: "Liked" },
                  { value: "disliked", label: "Disliked" },
                  { value: "unrated", label: "Unrated" }
                ]}
                value={favoriteFilter}
                onChange={setFavoriteFilter}
              />
            </label>
            <label>
              <span><UiIcon name="rating" />Min rating</span>
              <input
                max={5}
                min={0}
                placeholder="any"
                type="number"
                value={minimumRating}
                onChange={(event) => setMinimumRating(event.target.value)}
              />
            </label>
            <label>
              <span><UiIcon name="plays" />Min plays</span>
              <input
                min={0}
                placeholder="any"
                type="number"
                value={minimumPlays}
                onChange={(event) => setMinimumPlays(event.target.value)}
              />
            </label>
            <label>
              <span><UiIcon name="filters" />Tag text</span>
              <input
                placeholder="genre, year, artist, tag"
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
              />
            </label>
          </div>
        </section>
      ) : null}

      {selectedCount > 0 ? (
      <section className="bulkActionBar" aria-label="Bulk library actions">
        <div>
          <strong>{selectedCount.toLocaleString()} selected</strong>
          <span>Create playlists, tags, and renames through reviewable operation batches.</span>
          <div className="bulkSummaryActions">
            <button
              className="dangerButton"
              disabled={selectedCount === 0}
              type="button"
              onClick={() => void onRemoveFiles([...selectedFileIds], "selected files")}
            >
              Remove Selected
            </button>
            <button className="secondary" disabled={selectedCount === 0} type="button" onClick={onClearSelection}>
              Clear
            </button>
          </div>
        </div>
        <form className="bulkPlaylistForm" onSubmit={(event) => void onProposePlaylist(event)}>
          <input
            aria-label="Playlist name"
            disabled={selectedCount === 0}
            placeholder="Playlist name"
            value={playlistNameInput}
            onChange={(event) => setPlaylistNameInput(event.target.value)}
          />
          <input
            aria-label="Playlist description"
            disabled={selectedCount === 0}
            placeholder="Description"
            value={playlistDescriptionInput}
            onChange={(event) => setPlaylistDescriptionInput(event.target.value)}
          />
          <button disabled={selectedCount === 0 || playlistNameInput.trim().length === 0} type="submit">
            Propose Playlist
          </button>
        </form>
        <form className="bulkPlaylistForm" onSubmit={(event) => void onProposeAddToPlaylist(event)}>
          <StyledSelect
            ariaLabel="Existing playlist"
            disabled={selectedCount === 0 || playlists.length === 0}
            options={[
              { value: "", label: "Choose playlist" },
              ...playlists.map((playlist) => ({ value: playlist.id, label: playlist.name }))
            ]}
            value={playlistAddTargetId}
            onChange={setPlaylistAddTargetId}
          />
          <button disabled={selectedCount === 0 || !playlistAddTargetId} type="submit">
            Add to Playlist
          </button>
        </form>
        <form className="bulkTagForm" onSubmit={(event) => void onProposeBulkTags(event)}>
          <input
            aria-label="Bulk internal tags"
            disabled={selectedCount === 0}
            placeholder="favorite, reviewed, vinyl-rip"
            value={bulkTagInput}
            onChange={(event) => setBulkTagInput(event.target.value)}
          />
          <button disabled={selectedCount === 0 || parseTagInput(bulkTagInput).length === 0} type="submit">
            Propose Tags
          </button>
        </form>
        <form className="bulkTagForm" onSubmit={(event) => void onProposeBulkRename(event)}>
          <input
            aria-label="Bulk rename pattern"
            disabled={selectedCount === 0}
            placeholder="{artist} - {title}.{ext}"
            value={bulkRenamePattern}
            onChange={(event) => setBulkRenamePattern(event.target.value)}
          />
          <button disabled={selectedCount === 0 || bulkRenamePattern.trim().length === 0} type="submit">
            Propose Rename
          </button>
          <span className="bulkHint">{`Tokens: {artist}, {album}, {year}, {title}, {filename}, {ext}`}</span>
        </form>
      </section>
      ) : null}

      <section className="albumLibrary" ref={albumLibraryRef} aria-label="Library albums">
        {files.length === 0 ? (
          <div className="emptyState">
            {selectedRoot ? "No audio files indexed for this search." : "Add a library root to begin indexing local music."}
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="emptyState">No indexed files match the current Library filters.</div>
        ) : (
          <>
            {virtualTopPadding > 0 ? <div className="virtualAlbumSpacer" style={{ height: `${virtualTopPadding}px` }} /> : null}
            {virtualAlbumGroups.map((group) => {
              const albumFileIds = group.files.map((file) => file.id);
              const selectedAlbumFileCount = albumFileIds.filter((fileId) => selectedFileIds.has(fileId)).length;
              const albumSelected = selectedAlbumFileCount === albumFileIds.length;
              const albumPartiallySelected = selectedAlbumFileCount > 0 && !albumSelected;
              return (
              <section className="libraryAlbumGroup" key={group.key} aria-label={`${group.artist} - ${group.album}`}>
                <div className="libraryAlbumArt">
                  <Artwork className="albumGroupArt" src={artworkAlbumUrl(group.key)} />
                </div>
                <div className="libraryAlbumContent">
                  <div className="libraryAlbumHeader">
                    <div>
                      <button className="libraryAlbumTitleButton" type="button" onClick={() => void onOpenAlbumPage(group)}>
                        <strong>{group.album}</strong>
                      </button>
                      <span>
                        <button className="libraryAlbumArtistButton" type="button" onClick={() => onOpenArtistPage(group.artist)}>
                          {group.artist}
                        </button>
                        {group.year ? ` · ${group.year}` : ""} · {group.files.length} track{group.files.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="libraryAlbumHeaderActions">
                      <span>{group.formats.join("/")}</span>
                      <button
                        className="dangerButton compactButton"
                        type="button"
                        onClick={() => void onRemoveFiles(group.files.map((file) => file.id), `${group.artist} - ${group.album}`)}
                      >
                        Remove Album
                      </button>
                    </div>
                  </div>
                  <div className="albumTrackHeader">
                    <label className="rowSelect albumSelectHeader" title="Select album">
                      <IndeterminateCheckbox
                        ariaLabel={`Select ${group.album}`}
                        checked={albumSelected}
                        indeterminate={albumPartiallySelected}
                        onChange={() => onToggleAlbumSelection(albumFileIds)}
                      />
                    </label>
                    <span>Play</span>
                    <span>#</span>
                    <span>Title</span>
                    <span>Duration</span>
                    <span>Size</span>
                    <span>Format</span>
                    <span>Listens</span>
                    <span>Status</span>
                    <span>Actions</span>
                  </div>
                  <div className="albumTrackRows">
                    {group.files.map((file) => {
                      const tags = file.displayTags;
                      const isCurrent = playback.currentFileId === file.id;
                      const trackArtist = tags.artist ?? tags.albumartist ?? group.artist;
                      const trackAlbum = tags.album ?? group.album;
                      const trackYear = tags.year ?? tags.date ?? group.year;
                      return (
                        <div className={isCurrent ? "albumTrackRow active" : "albumTrackRow"} key={file.id}>
                          <label className="rowSelect" title="Select for bulk actions">
                            <input
                              checked={selectedFileIds.has(file.id)}
                              type="checkbox"
                              onChange={() => onToggleFileSelection(file.id)}
                            />
                          </label>
                          <span className="rowPlayActions">
                            <button
                              aria-label={
                                isCurrent && playback.status === "playing"
                                  ? `Pause ${tags.title ?? file.filename}`
                                  : `Play ${tags.title ?? file.filename}`
                              }
                              className={isCurrent ? "rowPlay active" : "rowPlay"}
                              disabled={playbackBusy}
                              type="button"
                              onClick={() => void onPlayFile(file.id, visibleQueueFileIds)}
                            >
                              <TransportIcon shape={isCurrent && playback.status === "playing" ? "pause" : "play"} />
                            </button>
                            <QueueMenuButton
                              disabled={playbackBusy}
                              fileIds={[file.id]}
                              label={tags.title ?? file.filename}
                              onEnqueue={onEnqueuePlayback}
                            />
                          </span>
                          <span>{formatTrackNumber(file)}</span>
                          <span className="trackTitleCell" title={file.path}>
                            <strong>{tags.title ?? file.filename}</strong>
                            {isCurrent ? <MiniTrackWaveform playback={playback} waveform={currentWaveform} /> : null}
                            <small>
                              {trackArtist ? (
                                <button type="button" onClick={() => onOpenArtistPage(trackArtist)}>
                                  {trackArtist}
                                </button>
                              ) : (
                                <span>Unknown Artist</span>
                              )}
                              <span aria-hidden="true">·</span>
                              {trackAlbum ? (
                                <button
                                  type="button"
                                  onClick={() => void onOpenAlbumPage({ artist: trackArtist || group.artist, album: trackAlbum, year: trackYear ?? null })}
                                >
                                  {trackAlbum}
                                </button>
                              ) : (
                                <span>Unknown Album</span>
                              )}
                            </small>
                          </span>
                          <span>{file.durationMs == null ? "-" : formatTime(file.durationMs)}</span>
                          <span>{formatBytes(file.sizeBytes)}</span>
                          <span>{formatFileFormat(file)}</span>
                          <span title={formatListenTooltip(file)}>{formatListenStats(file)}</span>
                          <span className={file.missing ? "statusPill warning" : "statusPill"}>{file.scanStatus}</span>
                          <span className="rowActions">
                            <StyledSelect
                              ariaLabel={`Rating for ${tags.title ?? file.filename}`}
                              className="ratingSelect"
                              options={[
                                { value: "", label: "No rating" },
                                { value: "5", label: "5 stars" },
                                { value: "4", label: "4 stars" },
                                { value: "3", label: "3 stars" },
                                { value: "2", label: "2 stars" },
                                { value: "1", label: "1 star" },
                                { value: "0", label: "0 stars" }
                              ]}
                              title="Rating"
                              value={file.rating == null ? "" : String(file.rating)}
                              onChange={(value) => void onProposeRating(file.id, value === "" ? null : Number(value))}
                            />
                            <button
                              aria-label="Like"
                              className={file.liked ? "iconBtn active" : "iconBtn"}
                              title={file.liked ? "Unlike" : "Like"}
                              type="button"
                              onClick={() => void onProposeFavoriteStatus(file.id, file.liked ? "neutral" : "liked")}
                            >
                              <ActionIcon shape="like" />
                            </button>
                            <button
                              aria-label="Dislike"
                              className={file.disliked ? "iconBtn active" : "iconBtn"}
                              title={file.disliked ? "Remove dislike" : "Dislike"}
                              type="button"
                              onClick={() => void onProposeFavoriteStatus(file.id, file.disliked ? "neutral" : "disliked")}
                            >
                              <ActionIcon shape="dislike" />
                            </button>
                            <button aria-label="Tag diagnostics" className="iconBtn" title="Tag diagnostics" type="button" onClick={() => void onInspectFile(file.id)}>
                              <ActionIcon shape="tags" />
                            </button>
                            <button aria-label="Edit metadata" className="iconBtn" title="Edit metadata" type="button" onClick={() => onEditFile(file)}>
                              <ActionIcon shape="edit" />
                            </button>
                            <button aria-label="Remove from index" className="iconBtn danger" title="Remove from index" type="button" onClick={() => void onRemoveFile(file)}>
                              <ActionIcon shape="remove" />
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
              );
            })}
            {virtualBottomPadding > 0 ? <div className="virtualAlbumSpacer" style={{ height: `${virtualBottomPadding}px` }} /> : null}
          </>
        )}
      </section>
      {libraryHasMore ? (
        <LoadMoreRow
          loading={libraryLoadingMore}
          loaded={files.length}
          total={libraryTotal}
          onLoadMore={onLoadMore}
        />
      ) : null}
      {selectedCount > 0 ? (
        <BulkSelectionActionBar
          actionMenuOpen={selectionActionsOpen}
          fileIds={selectedFileIdList}
          playlistAddTargetId={playlistAddTargetId}
          playlistDescriptionInput={playlistDescriptionInput}
          playlistNameInput={playlistNameInput}
          playlists={playlists}
          selectedCount={selectedCount}
          setActionMenuOpen={setSelectionActionsOpen}
          setPlaylistAddTargetId={setPlaylistAddTargetId}
          setPlaylistDescriptionInput={setPlaylistDescriptionInput}
          setPlaylistNameInput={setPlaylistNameInput}
          onClearSelection={onClearSelection}
          onOpenBulkEdit={() => {
            setBulkEditOpen(true);
            setSelectionActionsOpen(false);
          }}
          onProposeAddToPlaylist={onProposeAddToPlaylist}
          onProposePlaylist={onProposePlaylist}
          onRemoveFiles={onRemoveFiles}
        />
      ) : null}
      {bulkEditOpen ? (
        <BulkEditModal
          fileIds={selectedFileIdList}
          selectedCount={selectedCount}
          onCancel={() => setBulkEditOpen(false)}
          onProposeBulkMetadata={onProposeBulkMetadata}
          onProposeBulkRename={onProposeBulkRenameForFiles}
          onProposeBulkTags={onProposeBulkTagsForFiles}
        />
      ) : null}
    </>
  );
}

function BulkSelectionActionBar({
  actionMenuOpen,
  fileIds,
  playlistAddTargetId,
  playlistDescriptionInput,
  playlistNameInput,
  playlists,
  selectedCount,
  setActionMenuOpen,
  setPlaylistAddTargetId,
  setPlaylistDescriptionInput,
  setPlaylistNameInput,
  onClearSelection,
  onOpenBulkEdit,
  onProposeAddToPlaylist,
  onProposePlaylist,
  onRemoveFiles
}: {
  actionMenuOpen: boolean;
  fileIds: string[];
  playlistAddTargetId: string;
  playlistDescriptionInput: string;
  playlistNameInput: string;
  playlists: Playlist[];
  selectedCount: number;
  setActionMenuOpen(open: boolean | ((current: boolean) => boolean)): void;
  setPlaylistAddTargetId(value: string): void;
  setPlaylistDescriptionInput(value: string): void;
  setPlaylistNameInput(value: string): void;
  onClearSelection(): void;
  onOpenBulkEdit(): void;
  onProposeAddToPlaylist(event: FormEvent<HTMLFormElement>): Promise<void>;
  onProposePlaylist(event: FormEvent<HTMLFormElement>): Promise<void>;
  onRemoveFiles(fileIds: string[], label: string): Promise<void>;
}): ReactElement {
  return (
    <div className="selectionActionDock" aria-label="Selected track actions">
      <div>
        <strong>{selectedCount.toLocaleString()} selected</strong>
        <span>Batch actions create reviewable operation proposals.</span>
      </div>
      <div className="selectionActionButtons">
        <button type="button" onClick={() => setActionMenuOpen((current) => !current)}>
          Actions
        </button>
        <button className="secondary" type="button" onClick={onClearSelection}>
          Clear
        </button>
      </div>
      {actionMenuOpen ? (
        <div className="selectionActionMenu">
          <section>
            <h2>Playlist</h2>
            <form className="selectionActionForm" onSubmit={(event) => void onProposePlaylist(event)}>
              <input
                aria-label="New playlist name"
                placeholder="New playlist"
                value={playlistNameInput}
                onChange={(event) => setPlaylistNameInput(event.target.value)}
              />
              <input
                aria-label="New playlist description"
                placeholder="Description"
                value={playlistDescriptionInput}
                onChange={(event) => setPlaylistDescriptionInput(event.target.value)}
              />
              <button disabled={!playlistNameInput.trim()} type="submit">
                Create
              </button>
            </form>
            <form className="selectionActionForm compact" onSubmit={(event) => void onProposeAddToPlaylist(event)}>
              <StyledSelect
                ariaLabel="Existing playlist"
                disabled={playlists.length === 0}
                options={[
                  { value: "", label: "Choose playlist" },
                  ...playlists.map((playlist) => ({ value: playlist.id, label: playlist.name }))
                ]}
                value={playlistAddTargetId}
                onChange={setPlaylistAddTargetId}
              />
              <button disabled={!playlistAddTargetId} type="submit">
                Add
              </button>
            </form>
          </section>
          <section>
            <h2>Edit</h2>
            <div className="selectionActionRow">
              <button type="button" onClick={onOpenBulkEdit}>
                Bulk Edit
              </button>
              <button className="dangerButton" type="button" onClick={() => void onRemoveFiles(fileIds, "selected files")}>
                Remove
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

type BulkEditMode = "metadata" | "tags" | "rename";

function BulkEditModal({
  fileIds,
  selectedCount,
  onCancel,
  onProposeBulkMetadata,
  onProposeBulkRename,
  onProposeBulkTags
}: {
  fileIds: string[];
  selectedCount: number;
  onCancel(): void;
  onProposeBulkMetadata(fileIds: string[], metadata: EditableFileMetadata): Promise<void>;
  onProposeBulkRename(fileIds: string[], pattern: string): Promise<void>;
  onProposeBulkTags(fileIds: string[], tagText: string): Promise<void>;
}): ReactElement {
  const [mode, setMode] = useState<BulkEditMode>("metadata");
  const [saving, setSaving] = useState(false);
  const [metadata, setMetadata] = useState({
    artist: "",
    albumartist: "",
    album: "",
    year: "",
    date: "",
    genre: ""
  });
  const [tagText, setTagText] = useState("");
  const [renamePattern, setRenamePattern] = useState("{artist} - {title}.{ext}");
  const metadataPayload = useMemo(() => {
    const payload: EditableFileMetadata = {};
    for (const key of ["artist", "albumartist", "album", "year", "date", "genre"] as const) {
      const value = metadata[key].trim();
      if (value) {
        payload[key] = value;
      }
    }
    return payload;
  }, [metadata]);
  const canSubmit =
    mode === "metadata"
      ? Object.keys(metadataPayload).length > 0
      : mode === "tags"
        ? parseTagInput(tagText).length > 0
        : renamePattern.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit || saving) {
      return;
    }
    setSaving(true);
    try {
      if (mode === "metadata") {
        await onProposeBulkMetadata(fileIds, metadataPayload);
      } else if (mode === "tags") {
        await onProposeBulkTags(fileIds, tagText);
      } else {
        await onProposeBulkRename(fileIds, renamePattern);
      }
      onCancel();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="bulkEditModal" onSubmit={(event) => void handleSubmit(event)}>
        <div className="metadataEditorHeader">
          <div>
            <h2>Bulk Edit</h2>
            <span>{selectedCount.toLocaleString()} selected track{selectedCount === 1 ? "" : "s"}</span>
          </div>
          <button className="secondary" disabled={saving} type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="segmentedControl" role="group" aria-label="Bulk edit mode">
          <button className={mode === "metadata" ? "active" : ""} type="button" onClick={() => setMode("metadata")}>
            Metadata
          </button>
          <button className={mode === "tags" ? "active" : ""} type="button" onClick={() => setMode("tags")}>
            Tags
          </button>
          <button className={mode === "rename" ? "active" : ""} type="button" onClick={() => setMode("rename")}>
            Rename
          </button>
        </div>
        {mode === "metadata" ? (
          <div className="metadataFields">
            <label>
              Artist
              <input value={metadata.artist} onChange={(event) => setMetadata((current) => ({ ...current, artist: event.target.value }))} />
            </label>
            <label>
              Album Artist
              <input
                value={metadata.albumartist}
                onChange={(event) => setMetadata((current) => ({ ...current, albumartist: event.target.value }))}
              />
            </label>
            <label>
              Album
              <input value={metadata.album} onChange={(event) => setMetadata((current) => ({ ...current, album: event.target.value }))} />
            </label>
            <label>
              Year
              <input value={metadata.year} onChange={(event) => setMetadata((current) => ({ ...current, year: event.target.value }))} />
            </label>
            <label>
              Date
              <input value={metadata.date} onChange={(event) => setMetadata((current) => ({ ...current, date: event.target.value }))} />
            </label>
            <label>
              Genre
              <input value={metadata.genre} onChange={(event) => setMetadata((current) => ({ ...current, genre: event.target.value }))} />
            </label>
          </div>
        ) : mode === "tags" ? (
          <label className="bulkEditSingleField">
            Internal tags
            <input
              autoFocus
              placeholder="favorite, reviewed, vinyl-rip"
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
            />
          </label>
        ) : (
          <label className="bulkEditSingleField">
            Rename pattern
            <input value={renamePattern} onChange={(event) => setRenamePattern(event.target.value)} />
            <span>{`Tokens: {artist}, {album}, {year}, {title}, {filename}, {ext}`}</span>
          </label>
        )}
        <div className="modalActions">
          <button className="secondary" disabled={saving} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button disabled={!canSubmit || saving} type="submit">
            {saving ? "Creating Proposal" : "Create Proposal"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MetadataEditor({
  file,
  onCancel,
  onSubmit
}: {
  file: LibraryFile;
  onCancel(): void;
  onSubmit(fileId: string, metadata: EditableFileMetadata): Promise<void>;
}): ReactElement {
  const tags = file.displayTags;
  const [metadata, setMetadata] = useState<Required<Record<keyof EditableFileMetadata, string>>>({
    title: tags.title ?? "",
    artist: tags.artist ?? "",
    albumartist: tags.albumartist ?? "",
    album: tags.album ?? "",
    year: tags.year ?? "",
    date: tags.date ?? "",
    genre: tags.genre ?? "",
    tracknumber: tags.tracknumber ?? tags.track ?? "",
    discnumber: tags.discnumber ?? tags.disc ?? ""
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(file.id, metadata);
    } finally {
      setSaving(false);
    }
  }

  function setField(key: keyof EditableFileMetadata, value: string): void {
    setMetadata((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="metadataEditor" onSubmit={(event) => void handleSubmit(event)}>
        <div className="metadataEditorHeader">
          <div>
            <h2>Edit Metadata</h2>
            <span title={file.path}>{file.filename}</span>
          </div>
          <button className="secondary" disabled={saving} type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="metadataFields">
          <label>
            Title
            <input value={metadata.title} onChange={(event) => setField("title", event.target.value)} />
          </label>
          <label>
            Artist
            <input value={metadata.artist} onChange={(event) => setField("artist", event.target.value)} />
          </label>
          <label>
            Album Artist
            <input value={metadata.albumartist} onChange={(event) => setField("albumartist", event.target.value)} />
          </label>
          <label>
            Album
            <input value={metadata.album} onChange={(event) => setField("album", event.target.value)} />
          </label>
          <label>
            Year
            <input value={metadata.year} onChange={(event) => setField("year", event.target.value)} />
          </label>
          <label>
            Date
            <input value={metadata.date} onChange={(event) => setField("date", event.target.value)} />
          </label>
          <label>
            Genre
            <input value={metadata.genre} onChange={(event) => setField("genre", event.target.value)} />
          </label>
          <label>
            Track Number
            <input inputMode="numeric" placeholder="1 or 1/12" value={metadata.tracknumber} onChange={(event) => setField("tracknumber", event.target.value)} />
          </label>
          <label>
            Disc Number
            <input inputMode="numeric" placeholder="1" value={metadata.discnumber} onChange={(event) => setField("discnumber", event.target.value)} />
          </label>
        </div>
        <div className="metadataEditorFooter">
          <span className="muted">Creates an operation batch. It does not rewrite embedded audio tags.</span>
          <button disabled={saving} type="submit">
            Propose Edit
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportsView({
  busyImportBatchId,
  importPaths,
  importsState,
  roots,
  setImportPaths,
  onApprove,
  onApproveBatch,
  onApplyBatch,
  onCreateImport,
  onInspect,
  onReject,
  onSelectImportFiles,
  onSelectImportFolder
}: {
  busyImportBatchId: string | null;
  importPaths: string;
  importsState: ImportsState;
  roots: LibraryRoot[];
  setImportPaths(value: string): void;
  onApprove(importItemId: string): Promise<void>;
  onApproveBatch(importBatch: ImportBatch): Promise<void>;
  onApplyBatch(importBatch: ImportBatch): Promise<void>;
  onCreateImport(event: FormEvent<HTMLFormElement>): Promise<void>;
  onInspect(importItemId: string): Promise<void>;
  onReject(importItemId: string): Promise<void>;
  onSelectImportFiles(): Promise<void>;
  onSelectImportFolder(): Promise<void>;
}): ReactElement {
  const imports = "imports" in importsState ? importsState.imports : [];

  return (
    <>
      <section className="importControls" aria-label="Create import">
        <form onSubmit={(event) => void onCreateImport(event)}>
          <textarea
            aria-label="Import source paths"
            placeholder={"Paste one source file path per line. Files will be copied into staging first."}
            value={importPaths}
            onChange={(event) => setImportPaths(event.target.value)}
          />
          <div className="importControlFooter">
            <span className="muted">
              Target root: {roots[0]?.path ?? "add a library root before approving"}
            </span>
            <div className="importButtons">
              <button title="Open native file picker in Electron" type="button" onClick={() => void onSelectImportFiles()}>
                Browse Files
              </button>
              <button title="Open native folder picker in Electron" type="button" onClick={() => void onSelectImportFolder()}>
                Browse Folder
              </button>
              <button type="submit">Stage Paths</button>
            </div>
          </div>
        </form>
      </section>

      {importsState.status === "error" ? <div className="inlineError">{importsState.message}</div> : null}

      <section className="importsList" aria-label="Import inbox">
        {imports.length === 0 ? (
          <div className="emptyState">No active imports.</div>
        ) : (
          imports.map((batch) => {
            const reviewableItems = getReviewableImportItems(batch);
            const importedCount = batch.items.filter((item) => item.status === "imported").length;
            const rejectedCount = batch.items.filter((item) => item.status === "rejected").length;
            const warningCount = batch.items.reduce((total, item) => total + item.warnings.length + item.duplicateCandidates.length, 0);
            const busy = busyImportBatchId === batch.id;
            return (
              <section className="importBatchGroup" key={batch.id} aria-label={deriveImportBatchTitle(batch)}>
                <header className="importBatchHeader">
                  <div>
                    <span className="eyebrow">Album Import</span>
                    <strong>{deriveImportBatchTitle(batch)}</strong>
                    <span>
                      {reviewableItems.length.toLocaleString()} ready · {importedCount.toLocaleString()} imported
                      {rejectedCount > 0 ? ` · ${rejectedCount.toLocaleString()} rejected` : ""} · {batch.source}
                    </span>
                  </div>
                  <div className="importBatchActions">
                    {warningCount > 0 ? <span className="statusPill warning">{warningCount.toLocaleString()} warning{warningCount === 1 ? "" : "s"}</span> : null}
                    <button
                      disabled={reviewableItems.length === 0 || roots.length === 0 || busy}
                      type="button"
                      onClick={() => void onApplyBatch(batch)}
                    >
                      {busy ? "Importing" : `Import Album (${reviewableItems.length.toLocaleString()})`}
                    </button>
                    <button
                      className="secondary"
                      disabled={reviewableItems.length === 0 || roots.length === 0 || busy}
                      type="button"
                      onClick={() => void onApproveBatch(batch)}
                    >
                      Review Batch
                    </button>
                  </div>
                </header>
                <div className="importBatchItems">
                  {batch.items.map((item) => (
                    <div className="importItem" key={item.id}>
                      <div className="importMain">
                        <strong>{item.detectedTitle ?? basenameFromPath(item.stagingPath)}</strong>
                        <span>
                          {item.detectedArtist ?? "Unknown Artist"} · {item.detectedAlbum ?? "Unknown Album"} · {item.detectedYear ?? "-"}
                        </span>
                        <span title={item.proposedDestination ?? ""}>
                          Destination: {item.proposedDestination ?? "No library root selected"}
                        </span>
                        <span>
                          Metadata: {item.selectedCandidate?.source ?? "none"} · {item.metadataCandidates.length} candidate
                          {item.metadataCandidates.length === 1 ? "" : "s"}
                        </span>
                        {item.warnings.length > 0 ? <span className="warningText">{item.warnings.join(", ")}</span> : null}
                        {item.duplicateCandidates.length > 0 ? (
                          <span className="warningText" title={item.duplicateCandidates.map((candidate) => candidate.path).join("\n")}>
                            {item.duplicateCandidates.length} exact duplicate candidate{item.duplicateCandidates.length === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>
                      <div className="importMeta">
                        <span className="statusPill">{item.status}</span>
                        <span>{item.confidenceScore != null ? `${Math.round(item.confidenceScore * 100)}%` : "-"} confidence</span>
                        <span>{item.qualityScore != null ? `${Math.round(item.qualityScore * 100)}%` : "-"} quality</span>
                      </div>
                      <div className="rootActions">
                        <button type="button" onClick={() => void onInspect(item.id)}>
                          Inspect
                        </button>
                        <button disabled={item.status !== "needs_review" || roots.length === 0 || busy} type="button" onClick={() => void onApprove(item.id)}>
                          Approve
                        </button>
                        <button
                          className="secondary"
                          disabled={item.status === "imported" || item.status === "rejected" || busy}
                          type="button"
                          onClick={() => void onReject(item.id)}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </section>
    </>
  );
}

function DiagnosticsModal({
  state,
  onClose,
  onUpdateImportMetadata
}: {
  state: DiagnosticsState;
  onClose(): void;
  onUpdateImportMetadata(
    importItemId: string,
    metadata: { artist: string; album: string; title: string; year: string }
  ): Promise<void>;
}): ReactElement {
  const diagnostics = state.status === "ready" ? state.diagnostics : null;

  return (
    <div className="modalBackdrop" role="presentation">
      <section className="diagnosticsPanel" aria-label="Metadata diagnostics">
        <div className="metadataEditorHeader">
          <div>
            <h2>Metadata Diagnostics</h2>
            <span title={diagnostics?.path}>{diagnostics?.path ?? "Reading file metadata"}</span>
          </div>
          <button className="secondary" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {state.status === "loading" ? <div className="emptyState">Reading metadata tags.</div> : null}
        {state.status === "error" ? <div className="inlineError">{state.message}</div> : null}
        {diagnostics ? <DiagnosticsBody diagnostics={diagnostics} onUpdateImportMetadata={onUpdateImportMetadata} /> : null}
      </section>
    </div>
  );
}

function DiagnosticsBody({
  diagnostics,
  onUpdateImportMetadata
}: {
  diagnostics: MetadataDiagnosticsResponse;
  onUpdateImportMetadata(
    importItemId: string,
    metadata: { artist: string; album: string; title: string; year: string }
  ): Promise<void>;
}): ReactElement {
  return (
    <div className="diagnosticsBody">
      <section className="diagnosticsSummary">
        <div>
          <span>Parser</span>
          <strong>{diagnostics.parserStatus}</strong>
        </div>
        <div>
          <span>Common tags</span>
          <strong>{diagnostics.common.length}</strong>
        </div>
        <div>
          <span>Native tags</span>
          <strong>{diagnostics.native.length}</strong>
        </div>
      </section>

      {diagnostics.error ? <div className="inlineError">{diagnostics.error}</div> : null}

      {diagnostics.importContext ? (
        <section className="diagnosticsSection">
          <h3>Import Decision</h3>
          <ImportMetadataReviewEditor diagnostics={diagnostics} onSubmit={onUpdateImportMetadata} />
          <div className="diagnosticsKv">
            <span>Detected</span>
            <strong>
              {diagnostics.importContext.detectedArtist ?? "Unknown Artist"} ·{" "}
              {diagnostics.importContext.detectedAlbum ?? "Unknown Album"} ·{" "}
              {diagnostics.importContext.detectedTitle ?? "Unknown Title"} · {diagnostics.importContext.detectedYear ?? "-"}
            </strong>
            <span>Selected</span>
            <strong>{formatCandidate(diagnostics.importContext.selectedCandidate)}</strong>
            <span>Warnings</span>
            <strong>{diagnostics.importContext.warnings.length > 0 ? diagnostics.importContext.warnings.join(", ") : "none"}</strong>
          </div>
          <MetadataCandidateTable
            emptyText="No metadata candidates were generated."
            importItemId={diagnostics.importItemId}
            candidates={diagnostics.importContext.metadataCandidates}
            onSelect={onUpdateImportMetadata}
          />
        </section>
      ) : null}

      <section className="diagnosticsSection">
        <h3>Indexed Display Tags</h3>
        <TagTable
          emptyText="No indexed display tags."
          rows={Object.entries(diagnostics.indexedDisplayTags).map(([key, value]) => ({ key, value }))}
        />
      </section>

      <section className="diagnosticsSection">
        <h3>Common Tags</h3>
        <TagTable emptyText="No common tags found by parser." rows={diagnostics.common} />
      </section>

      <section className="diagnosticsSection">
        <h3>Native Tags</h3>
        <TagTable
          emptyText="No native tags found by parser."
          rows={diagnostics.native.map((tag) => ({ key: `${tag.source}:${tag.key}`, value: tag.value }))}
        />
      </section>

      <section className="diagnosticsSection">
        <h3>Format</h3>
        <TagTable
          emptyText="No format fields."
          rows={Object.entries(diagnostics.format).map(([key, value]) => ({ key, value: String(value) }))}
        />
      </section>
    </div>
  );
}

function ImportMetadataReviewEditor({
  diagnostics,
  onSubmit
}: {
  diagnostics: MetadataDiagnosticsResponse;
  onSubmit(
    importItemId: string,
    metadata: { artist: string; album: string; title: string; year: string }
  ): Promise<void>;
}): ReactElement | null {
  const context = diagnostics.importContext;
  const importItemId = diagnostics.importItemId;
  const [metadata, setMetadata] = useState({
    artist: context?.detectedArtist ?? "",
    album: context?.detectedAlbum ?? "",
    title: context?.detectedTitle ?? "",
    year: context?.detectedYear == null ? "" : String(context.detectedYear)
  });
  const [saving, setSaving] = useState(false);

  if (!context || !importItemId) {
    return null;
  }
  const editableImportItemId = importItemId;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(editableImportItemId, metadata);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="importMetadataEditor" onSubmit={(event) => void handleSubmit(event)}>
      <label>
        Artist
        <input
          value={metadata.artist}
          onChange={(event) => setMetadata((current) => ({ ...current, artist: event.target.value }))}
        />
      </label>
      <label>
        Album
        <input
          value={metadata.album}
          onChange={(event) => setMetadata((current) => ({ ...current, album: event.target.value }))}
        />
      </label>
      <label>
        Title
        <input
          value={metadata.title}
          onChange={(event) => setMetadata((current) => ({ ...current, title: event.target.value }))}
        />
      </label>
      <label>
        Year
        <input
          value={metadata.year}
          onChange={(event) => setMetadata((current) => ({ ...current, year: event.target.value }))}
        />
      </label>
      <button disabled={saving} type="submit">
        Save Import Metadata
      </button>
    </form>
  );
}

function TagTable({
  emptyText,
  rows
}: {
  emptyText: string;
  rows: Array<{ key: string; value: string }>;
}): ReactElement {
  if (rows.length === 0) {
    return <div className="diagnosticsEmpty">{emptyText}</div>;
  }

  return (
    <div className="tagTable">
      {rows.map((row, index) => (
        <div className="tagRow" key={`${row.key}-${index}`}>
          <span>{row.key}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function MetadataCandidateTable({
  candidates,
  emptyText,
  importItemId,
  onSelect
}: {
  candidates: MetadataCandidate[];
  emptyText: string;
  importItemId: string | null;
  onSelect(
    importItemId: string,
    metadata: { artist: string; album: string; title: string; year: string }
  ): Promise<void>;
}): ReactElement {
  const [savingCandidateKey, setSavingCandidateKey] = useState<string | null>(null);

  if (candidates.length === 0) {
    return <div className="diagnosticsEmpty">{emptyText}</div>;
  }

  async function handleSelect(candidate: MetadataCandidate, key: string): Promise<void> {
    if (!importItemId) {
      return;
    }
    setSavingCandidateKey(key);
    try {
      await onSelect(importItemId, metadataFromCandidate(candidate));
    } finally {
      setSavingCandidateKey(null);
    }
  }

  return (
    <div className="candidateTable">
      {candidates.map((candidate, index) => {
        const key = `${candidate.source}-${candidate.externalId ?? index}-${candidate.score}`;
        return (
          <div className="candidateRow" key={key}>
            <div>
              <span>
                {candidate.source} · {Math.round(candidate.score * 100)}%
                {candidate.externalId ? ` · ${candidate.externalId}` : ""}
              </span>
              <strong>{formatCandidate(candidate)}</strong>
              <span>{candidate.reason}</span>
            </div>
            <button
              className="secondary compactButton"
              disabled={!importItemId || savingCandidateKey != null}
              type="button"
              onClick={() => void handleSelect(candidate, key)}
            >
              {savingCandidateKey === key ? "Saving" : "Use"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DuplicatesView({
  albumMergeState,
  alternateEditionsState,
  duplicatesState,
  incompleteAlbumsState,
  metadataGapsState,
  qualityUpgradesState,
  onEditMetadata,
  onProposeAlbumMerge,
  onProposeBulkAlbumMerge,
  onProposeBulkCleanup,
  onProposeCleanup,
  onRefreshAlbumMerges,
  onRefreshAlternateEditions,
  onRefreshIncompleteAlbums,
  onRefreshMetadataGaps,
  onRefreshQualityUpgrades
}: {
  albumMergeState: AlbumMergeState;
  alternateEditionsState: AlternateEditionsState;
  duplicatesState: DuplicatesState;
  incompleteAlbumsState: IncompleteAlbumsState;
  metadataGapsState: MetadataGapsState;
  qualityUpgradesState: QualityUpgradesState;
  onEditMetadata(file: LibraryFile): void;
  onProposeAlbumMerge(canonicalAlbum: string, fileIds: string[]): Promise<void>;
  onProposeBulkAlbumMerge(merges: Array<{ canonicalAlbum: string; fileIds: string[] }>): Promise<void>;
  onProposeBulkCleanup(groups: LibraryDuplicateGroup[]): Promise<void>;
  onProposeCleanup(group: LibraryDuplicateGroup): Promise<void>;
  onRefreshAlbumMerges(): Promise<void>;
  onRefreshAlternateEditions(): Promise<void>;
  onRefreshIncompleteAlbums(): Promise<void>;
  onRefreshMetadataGaps(): Promise<void>;
  onRefreshQualityUpgrades(): Promise<void>;
}): ReactElement {
  const albumMergeSuggestions = "suggestions" in albumMergeState ? albumMergeState.suggestions : emptyAlbumMergeSuggestions;
  const alternateEditions = "editions" in alternateEditionsState ? alternateEditionsState.editions : emptyAlternateEditions;
  const duplicates = "duplicates" in duplicatesState ? duplicatesState.duplicates : emptyDuplicates;
  const incompleteAlbums = "albums" in incompleteAlbumsState ? incompleteAlbumsState.albums : emptyIncompleteAlbums;
  const metadataGaps = "gaps" in metadataGapsState ? metadataGapsState.gaps : emptyMetadataGaps;
  const qualityUpgrades = "upgrades" in qualityUpgradesState ? qualityUpgradesState.upgrades : emptyQualityUpgrades;
  const [selectedDuplicateKeys, setSelectedDuplicateKeys] = useState<Set<string>>(new Set());
  const [selectedAlbumMergeKeys, setSelectedAlbumMergeKeys] = useState<Set<string>>(new Set());
  const actionableAlbumMergeSuggestions = useMemo(
    () =>
      albumMergeSuggestions.suggestions
        .map((suggestion) => ({ suggestion, fileIds: albumMergeFileIds(suggestion) }))
        .filter((item) => item.fileIds.length > 0),
    [albumMergeSuggestions.suggestions]
  );
  const selectedDuplicateGroups = useMemo(
    () => duplicates.groups.filter((group) => selectedDuplicateKeys.has(group.key)),
    [duplicates.groups, selectedDuplicateKeys]
  );
  const selectedAlbumMergePayloads = useMemo(
    () =>
      actionableAlbumMergeSuggestions
        .filter((item) => selectedAlbumMergeKeys.has(item.suggestion.key))
        .map((item) => ({ canonicalAlbum: item.suggestion.canonicalAlbum, fileIds: item.fileIds })),
    [actionableAlbumMergeSuggestions, selectedAlbumMergeKeys]
  );
  const selectedDuplicateRemoveCount = useMemo(
    () => selectedDuplicateGroups.reduce((total, group) => total + Math.max(0, group.files.length - 1), 0),
    [selectedDuplicateGroups]
  );
  const selectedAlbumMergeFileCount = useMemo(
    () => selectedAlbumMergePayloads.reduce((total, merge) => total + merge.fileIds.length, 0),
    [selectedAlbumMergePayloads]
  );

  useEffect(() => {
    setSelectedDuplicateKeys((current) => filterSet(current, new Set(duplicates.groups.map((group) => group.key))));
  }, [duplicates.groups]);

  useEffect(() => {
    setSelectedAlbumMergeKeys((current) =>
      filterSet(current, new Set(actionableAlbumMergeSuggestions.map((item) => item.suggestion.key)))
    );
  }, [actionableAlbumMergeSuggestions]);

  return (
    <div className="duplicatesPage">
      <div className="duplicatesErrors">
        {duplicatesState.status === "error" ? <div className="inlineError">{duplicatesState.message}</div> : null}
        {albumMergeState.status === "error" ? <div className="inlineError">{albumMergeState.message}</div> : null}
        {alternateEditionsState.status === "error" ? <div className="inlineError">{alternateEditionsState.message}</div> : null}
        {incompleteAlbumsState.status === "error" ? <div className="inlineError">{incompleteAlbumsState.message}</div> : null}
        {metadataGapsState.status === "error" ? <div className="inlineError">{metadataGapsState.message}</div> : null}
        {qualityUpgradesState.status === "error" ? <div className="inlineError">{qualityUpgradesState.message}</div> : null}
      </div>
      <section className="duplicatesSummary" aria-label="Duplicate summary">
        <div>
          <strong>{duplicates.totalGroups}</strong>
          <span>exact duplicate groups</span>
        </div>
        <div>
          <strong>{duplicates.totalFiles}</strong>
          <span>files in duplicate groups</span>
        </div>
        <div>
          <strong>{metadataGaps.total}</strong>
          <span>files missing core metadata</span>
        </div>
        <div>
          <strong>{qualityUpgrades.total}</strong>
          <span>likely quality upgrades</span>
        </div>
        <div>
          <strong>{incompleteAlbums.total}</strong>
          <span>incomplete albums</span>
        </div>
        <div>
          <strong>{albumMergeSuggestions.total}</strong>
          <span>album merge suggestions</span>
        </div>
        <div>
          <strong>{alternateEditions.total}</strong>
          <span>alternate edition groups</span>
        </div>
      </section>
      <div className="duplicatesSections">
      <section className="duplicatesList diagnosticList alternateEditions" aria-label="Alternate edition groups">
        <div className="cleanupSectionHeader">
          <div>
            <h2>Alternate Editions</h2>
            <p>Likely standard, deluxe, remastered, mono, stereo, or expanded editions to review before merging anything.</p>
          </div>
          <button className="secondary" disabled={alternateEditionsState.status === "loading"} type="button" onClick={() => void onRefreshAlternateEditions()}>
            {alternateEditionsState.status === "loading" ? "Checking" : "Run Check"}
          </button>
        </div>
        {alternateEditions.total === 0 ? (
          <div className="emptyState">
            {alternateEditionsState.status === "idle"
              ? "Run this check when you want to review possible edition variants."
              : alternateEditionsState.status === "loading"
                ? "Checking alternate editions."
                : "No likely alternate editions found."}
          </div>
        ) : (
          alternateEditions.groups.map((group) => (
            <div className="qualityUpgradeItem" key={group.key}>
              <div className="qualityUpgradeHeader">
                <div>
                  <strong>
                    {group.artist} - {group.baseAlbum}
                  </strong>
                  <span>
                    {group.editions.length} edition{group.editions.length === 1 ? "" : "s"} ·{" "}
                    {group.editions.reduce((total, edition) => total + edition.fileCount, 0)} indexed file
                    {group.editions.reduce((total, edition) => total + edition.fileCount, 0) === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="qualityUpgradeRows">
                {group.editions.map((edition) => (
                  <div className={edition.edition === "Standard" ? "qualityUpgradeRow preferred" : "qualityUpgradeRow"} key={edition.album}>
                    <span>{edition.edition}</span>
                    <strong>{edition.album}</strong>
                    <span>
                      {edition.fileCount} file{edition.fileCount === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
      <section className="duplicatesList diagnosticList incompleteAlbums" aria-label="Incomplete albums">
        <div className="cleanupSectionHeader">
          <div>
            <h2>Incomplete Albums</h2>
            <p>Albums whose indexed track numbers prove missing tracks.</p>
          </div>
          <button className="secondary" disabled={incompleteAlbumsState.status === "loading"} type="button" onClick={() => void onRefreshIncompleteAlbums()}>
            {incompleteAlbumsState.status === "loading" ? "Checking" : "Run Check"}
          </button>
        </div>
        {incompleteAlbums.total === 0 ? (
          <div className="emptyState">
            {incompleteAlbumsState.status === "idle"
              ? "Run this check when you want to look for missing track numbers."
              : incompleteAlbumsState.status === "loading"
                ? "Checking album track totals."
                : "No incomplete albums detected."}
          </div>
        ) : (
          incompleteAlbums.albums.map((album) => (
            <div className="qualityUpgradeItem" key={album.key}>
              <div className="qualityUpgradeHeader">
                <div>
                  <strong>
                    {album.artist} - {album.album}
                  </strong>
                  <span>
                    {album.year ? `${album.year} · ` : ""}
                    {album.presentTracks} of {album.expectedTracks} tracks indexed · missing{" "}
                    {formatTrackNumberList(album.missingTrackNumbers)}
                  </span>
                </div>
              </div>
              <div className="qualityUpgradeRows">
                {album.files.slice(0, 8).map((file) => (
                  <div className="qualityUpgradeRow" key={file.id}>
                    <span>{file.displayTags.tracknumber ?? file.displayTags.track ?? "track ?"}</span>
                    <strong title={file.path}>{file.displayTags.title ?? file.filename}</strong>
                    <span>{formatFileFormat(file)}</span>
                  </div>
                ))}
                {album.files.length > 8 ? (
                  <div className="qualityUpgradeRow">
                    <span>More</span>
                    <strong>+ {album.files.length - 8} indexed track{album.files.length - 8 === 1 ? "" : "s"}</strong>
                    <span>hidden</span>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>
      <section className="duplicatesList diagnosticList albumMerge" aria-label="Album merge suggestions">
        <div className="cleanupSectionHeader">
          <div>
            <h2>Album Merge</h2>
            <p>Likely variant album names for the same artist and base title.</p>
          </div>
          <button className="secondary" disabled={albumMergeState.status === "loading"} type="button" onClick={() => void onRefreshAlbumMerges()}>
            {albumMergeState.status === "loading" ? "Checking" : "Run Check"}
          </button>
        </div>
        {albumMergeSuggestions.total === 0 ? (
          <div className="emptyState">
            {albumMergeState.status === "idle"
              ? "Run this check when you want to find album name variants to merge."
              : albumMergeState.status === "loading"
                ? "Checking album variants."
                : "No likely album merge suggestions found."}
          </div>
        ) : (
          <>
            <div className="duplicatesBulkBar">
              <label>
                <input
                  checked={
                    actionableAlbumMergeSuggestions.length > 0 &&
                    actionableAlbumMergeSuggestions.every((item) => selectedAlbumMergeKeys.has(item.suggestion.key))
                  }
                  disabled={actionableAlbumMergeSuggestions.length === 0}
                  type="checkbox"
                  onChange={() =>
                    setSelectedAlbumMergeKeys((current) =>
                      actionableAlbumMergeSuggestions.every((item) => current.has(item.suggestion.key))
                        ? new Set()
                        : new Set(actionableAlbumMergeSuggestions.map((item) => item.suggestion.key))
                    )
                  }
                />
                Select merge suggestions
              </label>
              <span>
                {selectedAlbumMergePayloads.length.toLocaleString()} selected · {selectedAlbumMergeFileCount.toLocaleString()} file
                {selectedAlbumMergeFileCount === 1 ? "" : "s"}
              </span>
              <button disabled={selectedAlbumMergePayloads.length === 0} type="button" onClick={() => void onProposeBulkAlbumMerge(selectedAlbumMergePayloads)}>
                Propose Selected
              </button>
              <button
                className="secondary"
                disabled={actionableAlbumMergeSuggestions.length === 0}
                type="button"
                onClick={() =>
                  void onProposeBulkAlbumMerge(
                    actionableAlbumMergeSuggestions.map((item) => ({
                      canonicalAlbum: item.suggestion.canonicalAlbum,
                      fileIds: item.fileIds
                    }))
                  )
                }
              >
                Propose All
              </button>
            </div>
            {actionableAlbumMergeSuggestions.map(({ suggestion, fileIds: mergeFileIds }) => {
            return (
              <div className="qualityUpgradeItem" key={suggestion.key}>
                <div className="qualityUpgradeHeader">
                  <input
                    aria-label={`Select album merge ${suggestion.artist} ${suggestion.canonicalAlbum}`}
                    checked={selectedAlbumMergeKeys.has(suggestion.key)}
                    type="checkbox"
                    onChange={() => setSelectedAlbumMergeKeys((current) => toggleSetValue(current, suggestion.key))}
                  />
                  <div>
                    <strong>
                      {suggestion.artist} - {suggestion.canonicalAlbum}
                    </strong>
                    <span>
                      {suggestion.variants.length} album name variants · {mergeFileIds.length} file
                      {mergeFileIds.length === 1 ? "" : "s"} to update
                    </span>
                  </div>
                  <button
                    disabled={mergeFileIds.length === 0}
                    type="button"
                    onClick={() => void onProposeAlbumMerge(suggestion.canonicalAlbum, mergeFileIds)}
                  >
                    Propose Merge
                  </button>
                </div>
                <div className="qualityUpgradeRows">
                  {suggestion.variants.map((variant) => (
                    <div className={variant.album === suggestion.canonicalAlbum ? "qualityUpgradeRow preferred" : "qualityUpgradeRow"} key={variant.album}>
                      <span>{variant.album === suggestion.canonicalAlbum ? "Canonical" : "Variant"}</span>
                      <strong>{variant.album}</strong>
                      <span>
                        {variant.fileCount} file{variant.fileCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          </>
        )}
      </section>
      <section className="duplicatesList diagnosticList qualityUpgrades" aria-label="Quality upgrades">
        <div className="cleanupSectionHeader">
          <div>
            <h2>Quality Upgrades</h2>
            <p>Likely lower-quality copies when a better matching track is already indexed.</p>
          </div>
          <button className="secondary" disabled={qualityUpgradesState.status === "loading"} type="button" onClick={() => void onRefreshQualityUpgrades()}>
            {qualityUpgradesState.status === "loading" ? "Checking" : "Run Check"}
          </button>
        </div>
        {qualityUpgrades.total === 0 ? (
          <div className="emptyState">
            {qualityUpgradesState.status === "idle"
              ? "Run this check when you want to compare duplicate-quality candidates."
              : qualityUpgradesState.status === "loading"
                ? "Checking track quality groups."
                : "No likely quality upgrades found."}
          </div>
        ) : (
          qualityUpgrades.suggestions.map((suggestion) => (
            <div className="qualityUpgradeItem" key={suggestion.key}>
              <div className="qualityUpgradeHeader">
                <div>
                  <strong>
                    {suggestion.artist} - {suggestion.title}
                  </strong>
                  <span>
                    Keep {suggestion.preferred.qualityLabel}; review {suggestion.candidates.length} lower-quality cop
                    {suggestion.candidates.length === 1 ? "y" : "ies"}
                  </span>
                </div>
              </div>
              <div className="qualityUpgradeRows">
                <div className="qualityUpgradeRow preferred">
                  <span>Preferred</span>
                  <strong title={suggestion.preferred.file.path}>{suggestion.preferred.file.path}</strong>
                  <span>{suggestion.preferred.reasons.join(" · ")}</span>
                </div>
                {suggestion.candidates.map((candidate) => (
                  <div className="qualityUpgradeRow" key={candidate.file.id}>
                    <span>Lower quality</span>
                    <strong title={candidate.file.path}>{candidate.file.path}</strong>
                    <span>{candidate.reasons.join(" · ")}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
      <section className="duplicatesList cleanupFocus exactDuplicates" aria-label="Duplicate groups">
        <div className="cleanupSectionHeader">
          <div>
            <h2>Exact Duplicates</h2>
            <p>Keep one indexed copy and remove duplicate index entries.</p>
          </div>
        </div>
        {duplicates.totalGroups === 0 ? (
          <div className="emptyState">
            {duplicatesState.status === "loading"
              ? "Checking duplicate hashes."
              : "No exact file duplicates found in hashed library files."}
          </div>
        ) : (
          <>
            <div className="duplicatesBulkBar">
              <label>
                <input
                  checked={duplicates.groups.length > 0 && duplicates.groups.every((group) => selectedDuplicateKeys.has(group.key))}
                  type="checkbox"
                  onChange={() =>
                    setSelectedDuplicateKeys((current) =>
                      duplicates.groups.every((group) => current.has(group.key)) ? new Set() : new Set(duplicates.groups.map((group) => group.key))
                    )
                  }
                />
                Select duplicate groups
              </label>
              <span>
                {selectedDuplicateGroups.length.toLocaleString()} selected · {selectedDuplicateRemoveCount.toLocaleString()} duplicate entr
                {selectedDuplicateRemoveCount === 1 ? "y" : "ies"}
              </span>
              <button disabled={selectedDuplicateGroups.length === 0} type="button" onClick={() => void onProposeBulkCleanup(selectedDuplicateGroups)}>
                Remove Selected
              </button>
              <button className="secondary" type="button" onClick={() => void onProposeBulkCleanup(duplicates.groups)}>
                Remove All Found
              </button>
            </div>
            {duplicates.groups.map((group) => {
            const keepFile = chooseDuplicateKeepFile(group.files);
            const removeCount = group.files.length - 1;
            return (
              <div className="duplicateGroup" key={group.key}>
                <div className="duplicateGroupHeader">
                  <input
                    aria-label={`Select duplicate group ${group.key.slice(0, 16)}`}
                    checked={selectedDuplicateKeys.has(group.key)}
                    type="checkbox"
                    onChange={() => setSelectedDuplicateKeys((current) => toggleSetValue(current, group.key))}
                  />
                  <div>
                    <strong>{group.count} exact matches</strong>
                    <span title={group.key}>SHA-256 {group.key.slice(0, 16)}</span>
                  </div>
                  <button type="button" onClick={() => void onProposeCleanup(group)}>
                    Propose Cleanup
                  </button>
                </div>
                <div className="duplicateRecommendation">
                  <span>Keep</span>
                  <strong title={keepFile.path}>{keepFile.path}</strong>
                  <span>Remove {removeCount} duplicate index entr{removeCount === 1 ? "y" : "ies"}</span>
                </div>
                <div className="duplicateFiles">
                  {group.files.map((file) => {
                    const tags = file.displayTags;
                    const isKept = file.id === keepFile.id;
                    return (
                      <div className={`duplicateFile ${isKept ? "duplicateFileKept" : ""}`} key={file.id}>
                        <strong title={file.path}>
                          {isKept ? "Kept copy: " : ""}
                          {tags.title ?? file.filename}
                        </strong>
                        <span>
                          {tags.artist ?? tags.albumartist ?? "Unknown Artist"} · {tags.album ?? "Unknown Album"} ·{" "}
                          {formatFileFormat(file)}
                        </span>
                        <span title={file.path}>{file.path}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </>
        )}
      </section>
      <section className="duplicatesList cleanupFocus metadataReview" aria-label="Missing metadata">
        <div className="cleanupSectionHeader">
          <div>
            <h2>Missing Metadata</h2>
            <p>Files missing title, artist, album, or year tags.</p>
          </div>
          <button className="secondary" disabled={metadataGapsState.status === "loading"} type="button" onClick={() => void onRefreshMetadataGaps()}>
            {metadataGapsState.status === "loading" ? "Checking" : "Run Check"}
          </button>
        </div>
        {metadataGaps.total === 0 ? (
          <div className="emptyState">
            {metadataGapsState.status === "idle"
              ? "Run this check when you want to find files missing core tags."
              : metadataGapsState.status === "loading"
                ? "Checking metadata completeness."
                : "No core metadata gaps found."}
          </div>
        ) : (
          metadataGaps.items.map((item) => (
            <div className="metadataGapItem" key={item.file.id}>
              <div>
                <strong title={item.file.path}>{item.file.displayTags.title ?? item.file.filename}</strong>
                <span title={item.file.path}>{item.file.path}</span>
              </div>
              <div className="metadataGapFields">
                {item.missingFields.map((field) => (
                  <span className="statusPill" key={field}>
                    missing {field}
                  </span>
                ))}
              </div>
              <div className="metadataGapSuggestion">
                <span>Suggestion</span>
                <strong>{formatMetadataSuggestion(item.suggestedMetadata)}</strong>
              </div>
              <button type="button" onClick={() => onEditMetadata(item.file)}>
                Edit Metadata
              </button>
            </div>
          ))
        )}
      </section>
      </div>
    </div>
  );
}

function OperationsView({
  operationsState,
  onApply,
  onApprove,
  onOpenAgentThread,
  onReject,
  onRevert
}: {
  operationsState: OperationsState;
  onApply(batchId: string): Promise<void>;
  onApprove(batchId: string): Promise<void>;
  onOpenAgentThread(threadId: string): Promise<void>;
  onReject(batchId: string): Promise<void>;
  onRevert(batchId: string): Promise<void>;
}): ReactElement {
  const batches = "batches" in operationsState ? operationsState.batches : [];

  return (
    <>
      {operationsState.status === "error" ? <div className="inlineError">{operationsState.message}</div> : null}
      <section className="operationList" aria-label="Operation batches">
        {batches.length === 0 ? (
          <div className="emptyState">
            {operationsState.status === "loading" ? "Loading operation batches." : "No operation batches yet."}
          </div>
        ) : (
          batches.map((batch) => {
            const agentThreadId = batch.agentThreadId;
            return (
              <div className="operationBatch" key={batch.id}>
                <div className="operationBatchMain">
                  <strong>{batch.summary}</strong>
                  <span>
                    {batch.source} · {batch.riskLevel} risk · {batch.operations.length} operation
                    {batch.operations.length === 1 ? "" : "s"}
                  </span>
                  {agentThreadId ? <span>Linked to agent thread</span> : null}
                  <div className="operationDetails">
                    {batch.operations.map((operation) => (
                      <span className={operation.status === "failed" ? "warningText" : undefined} key={operation.id}>
                        {operation.type}: {operation.status}
                        {operation.error ? ` (${operationErrorMessage(operation.error)})` : ""}
                        {operationNote(operation.payload) ? ` · ${operationNote(operation.payload)}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="importMeta">
                  <span className={batch.status === "failed" ? "statusPill warning" : "statusPill"}>{batch.status}</span>
                </div>
                <div className="rootActions">
                  <button disabled={batch.status !== "proposed" && batch.status !== "draft"} type="button" onClick={() => void onApprove(batch.id)}>
                    Approve
                  </button>
                  <button
                    disabled={batch.status !== "approved" || !isOperationBatchExecutable(batch)}
                    type="button"
                    onClick={() => void onApply(batch.id)}
                  >
                    {isOperationBatchExecutable(batch) ? "Apply" : "Proposal only"}
                  </button>
                  <button
                    className="secondary"
                    disabled={batch.status === "applied" || batch.status === "applying"}
                    type="button"
                    onClick={() => void onReject(batch.id)}
                  >
                    Reject
                  </button>
                  <button
                    className="secondary"
                    disabled={!isOperationBatchRevertible(batch)}
                    type="button"
                    onClick={() => void onRevert(batch.id)}
                  >
                    Revert
                  </button>
                  {agentThreadId ? (
                    <button className="secondary" type="button" onClick={() => void onOpenAgentThread(agentThreadId)}>
                      Agent Thread
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}

function JobsView({
  jobsState,
  selectedJob,
  onInspect,
  onRefresh
}: {
  jobsState: JobsState;
  selectedJob: JobResponse | null;
  onInspect(jobId: string): Promise<void>;
  onRefresh(): Promise<void>;
}): ReactElement {
  const jobs = jobsState.jobs;

  return (
    <>
      {jobsState.status === "error" ? <div className="inlineError">{jobsState.message}</div> : null}
      <section className="jobsToolbar">
        <div>
          <strong>{jobs.length.toLocaleString()} background job{jobs.length === 1 ? "" : "s"}</strong>
          <span>Download staging, imports, and future long-running work.</span>
        </div>
        <button className="secondary" type="button" onClick={() => void onRefresh()}>
          Refresh
        </button>
      </section>
      <section className="jobsLayout" aria-label="Background jobs">
        <div className="jobsList">
          {jobs.length === 0 ? (
            <div className="emptyState">{jobsState.status === "loading" ? "Loading jobs." : "No background jobs yet."}</div>
          ) : (
            jobs.map((job) => (
              <button
                className={selectedJob?.job.id === job.id ? "jobItem active" : "jobItem"}
                key={job.id}
                type="button"
                onClick={() => void onInspect(job.id)}
              >
                <div className="jobItemMain">
                  <strong>{formatJobTitle(job)}</strong>
                  <span>
                    {formatJobType(job.type)} · {formatDateTime(job.createdAt)}
                  </span>
                  <div className="progressRail">
                    <div className="progressFill" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                  </div>
                </div>
                <span className={job.status === "failed" || job.status === "cancelled" ? "statusPill warning" : "statusPill"}>
                  {formatJobStatus(job.status)}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="jobDetail">
          {selectedJob ? (
            <>
              <div className="jobDetailHeader">
                <div>
                  <strong>{formatJobTitle(selectedJob.job)}</strong>
                  <span>{selectedJob.job.id}</span>
                </div>
                <span className={selectedJob.job.status === "failed" || selectedJob.job.status === "cancelled" ? "statusPill warning" : "statusPill"}>
                  {formatJobStatus(selectedJob.job.status)}
                </span>
              </div>
              <div className="jobFacts">
                <span>Type</span>
                <strong>{formatJobType(selectedJob.job.type)}</strong>
                <span>Progress</span>
                <strong>{Math.round(selectedJob.job.progress * 100)}%</strong>
                <span>Created</span>
                <strong>{formatDateTime(selectedJob.job.createdAt)}</strong>
                <span>Completed</span>
                <strong>{selectedJob.job.completedAt ? formatDateTime(selectedJob.job.completedAt) : "not complete"}</strong>
              </div>
              {selectedJob.job.error ? (
                <JobMessagePanel level="error" title="Job failed" message={formatJobMessage(selectedJob.job.error)} />
              ) : null}
              <div className="jobEvents" aria-label="Job events">
                {selectedJob.events.length === 0 ? (
                  <div className="emptyState">No events recorded for this job.</div>
                ) : (
                  selectedJob.events.map((event) => <JobEventRow event={event} key={event.id} />)
                )}
              </div>
            </>
          ) : (
            <div className="emptyState">Select a job to inspect status, errors, and event history.</div>
          )}
        </div>
      </section>
    </>
  );
}

function JobMessagePanel({ level, message, title }: { level: string; message: string; title: string }): ReactElement {
  return (
    <div className={`jobMessagePanel ${jobSeverityClass(level)}`}>
      <SeverityIcon level={level} />
      <div>
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
    </div>
  );
}

function JobEventRow({ event }: { event: JobEvent }): ReactElement {
  const parsed = parseJobEvent(event);
  return (
    <div className={`jobEvent ${jobSeverityClass(event.level)}`}>
      <div className="jobEventRail" aria-hidden="true">
        <SeverityIcon level={event.level} />
      </div>
      <div className="jobEventBody">
        <div className="jobEventMeta">
          <span>{formatDateTime(event.timestamp)}</span>
          <span>{formatJobLevel(event.level)}</span>
        </div>
        <strong>{parsed.summary}</strong>
        {parsed.details.length > 0 ? (
          <div className="jobEventDetails">
            {parsed.details.map((detail) => (
              <span key={detail}>{detail}</span>
            ))}
          </div>
        ) : null}
        {parsed.sample ? <span className="jobEventSample">{parsed.sample}</span> : null}
        {parsed.path ? <span className="jobEventPath" title={parsed.path}>{parsed.path}</span> : null}
      </div>
    </div>
  );
}

function SeverityIcon({ level }: { level: string }): ReactElement {
  const normalized = level.toLowerCase();
  if (normalized === "error" || normalized === "failed" || normalized === "danger") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="M8 1.8 14.6 14H1.4L8 1.8Z" />
        <path d="M8 5.7v3.7" />
        <path d="M8 12h.01" />
      </svg>
    );
  }
  if (normalized === "warning" || normalized === "warn") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 4.7v4" />
        <path d="M8 11.4h.01" />
      </svg>
    );
  }
  if (normalized === "success" || normalized === "completed" || normalized === "info") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6.2" />
        <path d="m5.1 8.2 1.9 1.9 3.9-4.2" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.4v4" />
      <path d="M8 4.6h.01" />
    </svg>
  );
}

const tasteListFields: Array<{ key: keyof Pick<
  TasteProfile,
  | "favoriteArtists"
  | "favoriteAlbums"
  | "favoriteTracks"
  | "preferredGenres"
  | "preferredEras"
  | "preferredCountries"
  | "preferredLabels"
  | "blockedArtists"
  | "blockedGenres"
  | "overplayedTracks"
  | "preferredFormats"
>; label: string; hint: string }> = [
  { key: "favoriteArtists", label: "Favorite artists", hint: "Artists the agent should bias toward." },
  { key: "favoriteAlbums", label: "Favorite albums", hint: "Reference albums for taste matching." },
  { key: "favoriteTracks", label: "Favorite tracks", hint: "Specific tracks that represent your taste." },
  { key: "preferredGenres", label: "Preferred genres", hint: "Genres and style tags to seek." },
  { key: "preferredEras", label: "Preferred eras", hint: "Years or ranges like 1977-1984." },
  { key: "preferredCountries", label: "Preferred countries", hint: "Scenes or regions to prioritize." },
  { key: "preferredLabels", label: "Preferred labels", hint: "Labels worth favoring in discovery." },
  { key: "blockedArtists", label: "Blocked artists", hint: "Artists to avoid recommending." },
  { key: "blockedGenres", label: "Blocked genres", hint: "Genres to avoid recommending." },
  { key: "overplayedTracks", label: "Overplayed tracks", hint: "Tracks to de-prioritize." },
  { key: "preferredFormats", label: "Preferred formats", hint: "FLAC, ALAC, MP3 V0, vinyl rip, etc." }
];

function SettingsView({
  appearance,
  draft,
  state,
  setAppearance,
  setDraft,
  onSelectBackgroundImage,
  onSave
}: {
  appearance: AppearanceSettings;
  draft: TasteProfile;
  state: TasteProfileState;
  setAppearance(settings: AppearanceSettings | ((current: AppearanceSettings) => AppearanceSettings)): void;
  setDraft(profile: TasteProfile): void;
  onSelectBackgroundImage(mode: AppearanceMode): Promise<void>;
  onSave(): Promise<void>;
}): ReactElement {
  const latest = "profile" in state ? state.profile : emptyTasteProfile;
  const accentOptions = Object.entries(accentPalettes) as Array<[AccentColorId, (typeof accentPalettes)[AccentColorId]]>;
  const fontOptions = Object.entries(displayFonts) as Array<[DisplayFontId, (typeof displayFonts)[DisplayFontId]]>;

  return (
    <>
      {state.status === "error" ? <div className="inlineError">{state.message}</div> : null}
      <section className="settingsPanel appearancePanel" aria-label="Appearance preferences">
        <div>
          <strong>Appearance</strong>
          <span>Customize the app theme, highlight color, display type, and main background.</span>
        </div>
        <div className="appearanceGrid">
          <label className="settingsField compact">
            <span>Mode</span>
            <StyledSelect<AppearanceMode>
              ariaLabel="Appearance mode"
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" }
              ]}
              value={appearance.mode}
              onChange={(value) =>
                setAppearance((current) => ({
                  ...current,
                  mode: value,
                  accent: isAccentColorId(current.accent) ? current.accent : defaultAppearanceSettings.accent
                }))
              }
            />
          </label>
          <label className="settingsField compact">
            <span>Display font</span>
            <StyledSelect<DisplayFontId>
              ariaLabel="Display font"
              options={fontOptions.map(([id, font]) => ({ value: id, label: font.label }))}
              value={appearance.displayFont}
              onChange={(value) =>
                setAppearance((current) => ({
                  ...current,
                  displayFont: value
                }))
              }
            />
          </label>
        </div>
        <div className="appearanceSwatches" aria-label="Highlight color">
          {accentOptions.map(([id, palette]) => {
            const color = palette[appearance.mode].acc;
            return (
              <button
                aria-label={`Use ${palette.label} highlight`}
                className={appearance.accent === id ? "colorSwatch active" : "colorSwatch"}
                key={id}
                style={{ "--swatch": color } as CSSProperties}
                title={palette.label}
                type="button"
                onClick={() => setAppearance((current) => ({ ...current, accent: id }))}
              >
                <span>{palette.label}</span>
              </button>
            );
          })}
        </div>
        <div className="backgroundModes" aria-label="Mode background images">
          {appearanceModes.map((mode) => {
            const modeBackground = appearance.backgroundDefaults[mode];
            return (
              <div className="backgroundPicker" key={mode}>
                <div>
                  <strong>{mode === "dark" ? "Dark background" : "Light background"}</strong>
                  <span>{modeBackground ? basenameFromPath(modeBackground.path) : "No image selected."}</span>
                </div>
                <button type="button" onClick={() => void onSelectBackgroundImage(mode)}>
                  Choose Image
                </button>
                <button
                  className="secondary"
                  disabled={!modeBackground}
                  type="button"
                  onClick={() =>
                    setAppearance((current) => ({
                      ...current,
                      backgroundDefaults: { ...current.backgroundDefaults, [mode]: null },
                      backgroundImagePath: current.mode === mode ? null : current.backgroundImagePath,
                      backgroundImageUrl: current.mode === mode ? null : current.backgroundImageUrl
                    }))
                  }
                >
                  Clear
                </button>
              </div>
            );
          })}
        </div>
        {appearance.backgroundImages.length > 0 ? (
          <div className="backgroundHistory" aria-label="Saved background images">
            {appearance.backgroundImages.map((image) => (
              <div className={appearance.backgroundDefaults[appearance.mode]?.path === image.path ? "backgroundHistoryItem active" : "backgroundHistoryItem"} key={image.id}>
                <button
                  type="button"
                  onClick={() =>
                    setAppearance((current) => ({
                      ...current,
                      backgroundDefaults: { ...current.backgroundDefaults, [current.mode]: { path: image.path, url: image.url } },
                      backgroundImagePath: image.path,
                      backgroundImageUrl: image.url
                    }))
                  }
                >
                  <span>{image.name}</span>
                  <small>{image.path}</small>
                </button>
                <button
                  aria-label={`Remove ${image.name}`}
                  className="secondary"
                  type="button"
                  onClick={() =>
                    setAppearance((current) => ({
                      ...current,
                      backgroundDefaults: {
                        dark: current.backgroundDefaults.dark?.path === image.path ? null : current.backgroundDefaults.dark,
                        light: current.backgroundDefaults.light?.path === image.path ? null : current.backgroundDefaults.light
                      },
                      backgroundImagePath: current.backgroundImagePath === image.path ? null : current.backgroundImagePath,
                      backgroundImageUrl: current.backgroundImagePath === image.path ? null : current.backgroundImageUrl,
                      backgroundImages: current.backgroundImages.filter((item) => item.id !== image.id)
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="settingsHeader">
        <div>
          <strong>Taste Profile</strong>
          <span>
            {latest.updatedAt ? `Last updated ${formatDateTime(latest.updatedAt)}` : "No saved taste profile yet."}
          </span>
        </div>
        <button disabled={state.status === "saving"} type="button" onClick={() => void onSave()}>
          {state.status === "saving" ? "Saving" : "Save Profile"}
        </button>
      </section>

      <section className="settingsGrid" aria-label="Taste profile editor">
        {tasteListFields.map((field) => (
          <label className="settingsField" key={field.key}>
            <span>{field.label}</span>
            <textarea
              value={formatTasteList(draft[field.key])}
              onChange={(event) => setDraft({ ...draft, [field.key]: parseTasteList(event.target.value) })}
            />
            <small>{field.hint}</small>
          </label>
        ))}
      </section>

      <section className="settingsPanel" aria-label="Quality preferences">
        <div>
          <strong>Quality Preferences</strong>
          <span>Used by future discovery ranking and cleanup suggestions.</span>
        </div>
        <label className="settingsCheck">
          <input
            checked={draft.qualityPreferences.preferLossless}
            type="checkbox"
            onChange={(event) =>
              setDraft({
                ...draft,
                qualityPreferences: { ...draft.qualityPreferences, preferLossless: event.target.checked }
              })
            }
          />
          <span>Prefer lossless when available</span>
        </label>
        <label className="settingsCheck">
          <input
            checked={draft.qualityPreferences.allowMp3IfRare}
            type="checkbox"
            onChange={(event) =>
              setDraft({
                ...draft,
                qualityPreferences: { ...draft.qualityPreferences, allowMp3IfRare: event.target.checked }
              })
            }
          />
          <span>Allow MP3 if the recording is rare</span>
        </label>
        <label className="settingsField compact">
          <span>Minimum bitrate kbps</span>
          <input
            min={0}
            max={2000}
            type="number"
            value={draft.qualityPreferences.minimumBitrateKbps ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                qualityPreferences: {
                  ...draft.qualityPreferences,
                  minimumBitrateKbps: event.target.value ? Number(event.target.value) : null
                }
              })
            }
          />
        </label>
      </section>

      <section className="settingsGrid" aria-label="Workflow preferences">
        <label className="settingsField wide">
          <span>Tagging preferences</span>
          <textarea
            value={draft.taggingPreferences}
            onChange={(event) => setDraft({ ...draft, taggingPreferences: event.target.value })}
          />
        </label>
        <label className="settingsField wide">
          <span>Folder organization preferences</span>
          <textarea
            value={draft.folderOrganizationPreferences}
            onChange={(event) => setDraft({ ...draft, folderOrganizationPreferences: event.target.value })}
          />
        </label>
        <label className="settingsField wide">
          <span>Playlist style preferences</span>
          <textarea
            value={draft.playlistStylePreferences}
            onChange={(event) => setDraft({ ...draft, playlistStylePreferences: event.target.value })}
          />
        </label>
        <label className="settingsField wide">
          <span>Notes</span>
          <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
        </label>
      </section>
    </>
  );
}

function DiscoveryView({
  discoveryQuery,
  downloadState,
  downloadJobs,
  discoveryState,
  discoverySource,
  formatFilter,
  expandedClusterIds,
  expandedGroupIds,
  inspectedGroupId,
  availabilityFilter,
  libraryFiles,
  libraryFilter,
  parsedListState,
  pastedListText,
  savedCandidates,
  savedLists,
  selectedFileIds,
  selectedGroupIds,
  setDiscoveryQuery,
  setDiscoverySource,
  setPastedListText,
  sortMode,
  setAvailabilityFilter,
  setFormatFilter,
  setLibraryFilter,
  setSortMode,
  onGroupSelect,
  onDownloadSelection,
  onInspectGroup,
  onOpenJobs,
  onRefreshHealth,
  onProposeSavedCandidateDownload,
  onRemoveSavedCandidate,
  onSaveCandidate,
  onSaveParsedList,
  onSearchParsedItem,
  onLoadSavedList,
  onSearchSavedListMissing,
  onParseList,
  onRemoveSavedList,
  onSearch,
  onToggleCluster,
  onToggleFileSelect,
  onToggleGroup
}: {
  discoveryQuery: string;
  downloadState: { status: "idle" | "working"; message: string | null };
  downloadJobs: DiscoveryDownloadJob[];
  discoveryState: DiscoveryState;
  discoverySource: DiscoverySource;
  formatFilter: DiscoveryFormatFilter;
  expandedClusterIds: Set<string>;
  expandedGroupIds: Set<string>;
  inspectedGroupId: string | null;
  availabilityFilter: DiscoveryAvailabilityFilter;
  libraryFiles: DiscoveryLibraryFile[];
  libraryFilter: DiscoveryLibraryFilter;
  parsedListState: ParsedDiscoveryListState;
  pastedListText: string;
  savedCandidates: SavedDiscoveryCandidate[];
  savedLists: SavedDiscoveryList[];
  selectedFileIds: Set<string>;
  selectedGroupIds: Set<string>;
  setDiscoveryQuery(value: string): void;
  setDiscoverySource(value: DiscoverySource): void;
  setPastedListText(value: string): void;
  sortMode: DiscoverySort;
  setAvailabilityFilter(value: DiscoveryAvailabilityFilter): void;
  setFormatFilter(value: DiscoveryFormatFilter): void;
  setLibraryFilter(value: DiscoveryLibraryFilter): void;
  setSortMode(value: DiscoverySort): void;
  onGroupSelect(group: DiscoveryGroup): void;
  onDownloadSelection(): Promise<void>;
  onInspectGroup(groupId: string): void;
  onOpenJobs(): void;
  onRefreshHealth(): Promise<void>;
  onProposeSavedCandidateDownload(candidate: SavedDiscoveryCandidate): Promise<void>;
  onRemoveSavedCandidate(candidateId: string): Promise<void>;
  onSaveCandidate(group: DiscoveryGroup): Promise<void>;
  onSaveParsedList(): Promise<void>;
  onSearchParsedItem(item: AgentParsedListItem): Promise<void>;
  onLoadSavedList(list: SavedDiscoveryList): void;
  onSearchSavedListMissing(list: SavedDiscoveryList): Promise<void>;
  onParseList(event: FormEvent<HTMLFormElement>): Promise<void>;
  onRemoveSavedList(listId: string): Promise<void>;
  onSearch(event: FormEvent<HTMLFormElement>): Promise<void>;
  onToggleCluster(clusterId: string): void;
  onToggleFileSelect(fileId: string): void;
  onToggleGroup(groupId: string): void;
}): ReactElement {
  const groupingQuery = discoveryState.query || discoveryQuery.trim();
  const libraryIndex = useMemo(() => createDiscoveryLibraryIndex(libraryFiles), [libraryFiles]);
  const baseGroups = useMemo(() => groupDiscoveryResults(discoveryState.results, groupingQuery), [discoveryState.results, groupingQuery]);
  const libraryMatches = useMemo(() => {
    const matches = new Map<string, DiscoveryLibraryMatch>();
    for (const group of baseGroups) {
      matches.set(group.id, summarizeDiscoveryLibraryMatch(group, libraryIndex));
    }
    return matches;
  }, [baseGroups, libraryIndex]);
  const groups = useMemo(
    () =>
      sortDiscoveryGroups(
        filterDiscoveryGroups(baseGroups, formatFilter, availabilityFilter).filter((group) =>
          matchesDiscoveryLibraryFilter(getDiscoveryLibraryMatch(group, libraryMatches), libraryFilter)
        ),
        sortMode
      ),
    [availabilityFilter, baseGroups, formatFilter, libraryFilter, libraryMatches, sortMode]
  );
  const clusters = useMemo(() => clusterDiscoveryGroups(groups), [groups]);
  const unfilteredGroupCount = baseGroups.length;
  const actionableGroupCount = useMemo(
    () => baseGroups.filter((group) => matchesDiscoveryLibraryFilter(getDiscoveryLibraryMatch(group, libraryMatches), "actionable")).length,
    [baseGroups, libraryMatches]
  );
  const [releaseFilter, setReleaseFilter] = useState<DiscoveryReleaseFilter>("recommended");
  const [visibleClusterLimit, setVisibleClusterLimit] = useState(10);
  const [discoverySearchMode, setDiscoverySearchMode] = useState<"search" | "list">("search");
  const [discoveryMainView, setDiscoveryMainView] = useState<"results" | "saved">("results");
  const releaseFilteredClusters = useMemo(
    () => filterDiscoveryClustersByRelease(clusters, releaseFilter, (group) => getDiscoveryLibraryMatch(group, libraryMatches)),
    [clusters, libraryMatches, releaseFilter]
  );
  const visibleClusters = releaseFilteredClusters.slice(0, visibleClusterLimit);
  const hiddenClusterCount = Math.max(0, releaseFilteredClusters.length - visibleClusters.length);
  const inspectedGroup = groups.find((group) => group.id === inspectedGroupId) ?? null;
  const selectedGroupCount = selectedGroupIds.size;
  const selectedFileCount = useMemo(
    () => discoveryState.results.filter((result) => selectedFileIds.has(result.id) && !result.isLocked && isAudioDiscoveryResult(result)).length,
    [discoveryState.results, selectedFileIds]
  );
  const downloadsConfigured = discoveryState.health?.downloadsConfigured === true;
  const canDownload = selectedFileCount > 0 && downloadState.status !== "working" && downloadsConfigured;
  const downloadButtonLabel =
    downloadState.status === "working"
      ? "Creating Download Batch"
      : `Download ${selectedFileCount.toLocaleString()} File${selectedFileCount === 1 ? "" : "s"}`;
  const [parsedListFilter, setParsedListFilter] = useState<"all" | "missing" | "owned">("all");
  const visibleParsedListItems = parsedListState.items.filter((item) =>
    parsedListFilter === "missing"
      ? item.ownedMatchCount === 0
      : parsedListFilter === "owned"
        ? item.ownedMatchCount > 0
        : true
  );
  const firstMissingParsedItem = parsedListState.items.find((item) => item.ownedMatchCount === 0) ?? null;
  const missingParsedCount = parsedListState.items.filter((item) => item.ownedMatchCount === 0).length;
  const activeDownloadCount = downloadJobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const discoveryStatusDetail = discoveryState.health?.message ?? discoveryState.health?.url ?? "Check slskd before searching.";

  useEffect(() => {
    setVisibleClusterLimit(10);
  }, [availabilityFilter, discoveryState.results, formatFilter, groupingQuery, libraryFilter, releaseFilter, sortMode]);

  return (
    <section className="discoveryControls discoveryPage" aria-label="Discovery">
      <section className="discoveryHero">
        <div className="discoveryHeroCopy">
          <h2>{discoverySearchMode === "search" ? "Search songs, artists, and albums" : "Find a list of albums"}</h2>
          <div className="segmentedControl" aria-label="Discovery mode">
            <button
              className={discoverySearchMode === "search" ? "active" : ""}
              type="button"
              onClick={() => setDiscoverySearchMode("search")}
            >
              Search
            </button>
            <button
              className={discoverySearchMode === "list" ? "active" : ""}
              type="button"
              onClick={() => setDiscoverySearchMode("list")}
            >
              List
            </button>
          </div>
        </div>
        {discoverySearchMode === "search" ? (
          <form className="discoverySearchForm" onSubmit={(event) => void onSearch(event)}>
            <label>
              <span>Source</span>
              <StyledSelect<DiscoverySource>
                ariaLabel="Discovery source"
                options={[{ value: "slskd", label: "slskd" }]}
                value={discoverySource}
                onChange={setDiscoverySource}
              />
            </label>
            <label className="discoverySearchInput">
              <span>Search</span>
              <input
                aria-label="Search Discovery source"
                placeholder={discoverySource === "slskd" ? "Artist, album, catalog number, or pasted-list query" : "Search Discovery"}
                value={discoveryQuery}
                onChange={(event) => setDiscoveryQuery(event.target.value)}
              />
            </label>
            <button disabled={discoveryState.status === "searching" || !discoveryQuery.trim()} type="submit">
              {discoveryState.status === "searching" ? "Searching" : "Search"}
            </button>
            <button className="secondary" type="button" onClick={() => void onRefreshHealth()}>
              Check
            </button>
          </form>
        ) : (
          <form className="discoveryListParser" onSubmit={(event) => void onParseList(event)}>
            <textarea
              aria-label="Pasted chart or album list"
              placeholder={"Paste rows, one item per line. Example: 1. Artist - Album (1980)"}
              value={pastedListText}
              onChange={(event) => setPastedListText(event.target.value)}
            />
            <div className="discoveryListParserFooter">
              <button
                className="secondary"
                disabled={!pastedListText.trim() || parsedListState.status === "parsing"}
                type="submit"
              >
                {parsedListState.status === "parsing" ? "Parsing" : "Parse"}
              </button>
              <button
                className="secondary"
                disabled={parsedListState.items.length === 0 || parsedListState.status === "parsing"}
                type="button"
                onClick={() => void onSaveParsedList()}
              >
                Save
              </button>
            </div>
          </form>
        )}
      </section>

      {discoveryState.status === "error" ? <div className="inlineError">{discoveryState.message}</div> : null}
      {downloadState.message ? (
        <div className={downloadState.message.toLowerCase().includes("error") ? "inlineError" : "inlineNotice"}>
          {downloadState.message}
        </div>
      ) : null}

      <div className="discoveryWorkspace">
        <div className="discoveryMainColumn">
          {discoveryState.results.length > 0 ? (
            <section className="discoveryFilterPanel" aria-label="Discovery filters">
              <div className="discoverySummary">
                <div>
                  <strong>
                    {releaseFilteredClusters.length.toLocaleString()} of {clusters.length.toLocaleString()} release section
                    {clusters.length === 1 ? "" : "s"}
                  </strong>
                  <span>
                    {groups.length.toLocaleString()} of {unfilteredGroupCount.toLocaleString()} source folder
                    {unfilteredGroupCount === 1 ? "" : "s"} · {actionableGroupCount.toLocaleString()} actionable ·{" "}
                    {discoveryState.results.length.toLocaleString()} file result{discoveryState.results.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="discoveryRefiners">
                <label>
                  <span>Sort</span>
                  <StyledSelect<DiscoverySort>
                    ariaLabel="Discovery sort"
                    options={[
                      { value: "best", label: "Best candidates" },
                      { value: "match", label: "Closest query match" },
                      { value: "tracks", label: "Most tracks" },
                      { value: "size", label: "Largest folders" },
                      { value: "user", label: "User / folder" }
                    ]}
                    value={sortMode}
                    onChange={setSortMode}
                  />
                </label>
                <label>
                  <span>Format</span>
                  <StyledSelect<DiscoveryFormatFilter>
                    ariaLabel="Discovery format"
                    options={[
                      { value: "all", label: "All formats" },
                      { value: "lossless", label: "Lossless folders" },
                      { value: "compressed", label: "Compressed folders" }
                    ]}
                    value={formatFilter}
                    onChange={setFormatFilter}
                  />
                </label>
                <label>
                  <span>Availability</span>
                  <StyledSelect<DiscoveryAvailabilityFilter>
                    ariaLabel="Discovery availability"
                    options={[
                      { value: "available", label: "Unlocked folders" },
                      { value: "all", label: "All folders" }
                    ]}
                    value={availabilityFilter}
                    onChange={setAvailabilityFilter}
                  />
                </label>
                <label>
                  <span>Library</span>
                  <StyledSelect<DiscoveryLibraryFilter>
                    ariaLabel="Discovery library filter"
                    options={[
                      { value: "actionable", label: "Missing or upgrades" },
                      { value: "missing", label: "Missing only" },
                      { value: "owned", label: "Owned or upgrades" },
                      { value: "all", label: "All candidates" }
                    ]}
                    value={libraryFilter}
                    onChange={setLibraryFilter}
                  />
                </label>
                <label>
                  <span>Release Type</span>
                  <StyledSelect<DiscoveryReleaseFilter>
                    ariaLabel="Discovery release type"
                    options={[
                      { value: "recommended", label: "Recommended" },
                      { value: "all", label: "All release sections" },
                      { value: "albums", label: "Album-like sections" },
                      { value: "singles", label: "Singles / loose files" },
                      { value: "collections", label: "Large collections" },
                      { value: "upgrades", label: "Possible upgrades" }
                    ]}
                    value={releaseFilter}
                    onChange={setReleaseFilter}
                  />
                </label>
              </div>
            </section>
          ) : null}

          {discoveryState.results.length > 0 ? (
            <section className="discoveryDownloadAction" aria-label="Discovery download action">
              <button
                disabled={!canDownload}
                title={downloadsConfigured ? undefined : "Set MUSIC_OS_SLSKD_DOWNLOAD_DIR before proposing downloads"}
                type="button"
                onClick={() => void onDownloadSelection()}
              >
                <DownloadIcon />
                <span>{downloadButtonLabel}</span>
              </button>
            </section>
          ) : null}

          <section className="discoveryResults" aria-label="Discovery results">
            <div className="discoveryResultsHeader">
              <div>
                <span className="eyebrow">Browse Sources</span>
                <strong>{discoveryMainView === "results" ? (groupingQuery ? `Results for "${groupingQuery}"` : "Search results") : "Saved candidates"}</strong>
              </div>
              <div className="segmentedControl" aria-label="Discovery result view">
                <button
                  className={discoveryMainView === "results" ? "active" : ""}
                  type="button"
                  onClick={() => setDiscoveryMainView("results")}
                >
                  Results
                </button>
                <button
                  className={discoveryMainView === "saved" ? "active" : ""}
                  type="button"
                  onClick={() => setDiscoveryMainView("saved")}
                >
                  Saved
                </button>
              </div>
            </div>
            {discoveryMainView === "saved" ? (
              savedCandidates.length === 0 ? (
                <div className="emptyState">Saved candidates will appear here after you save a source.</div>
              ) : (
                <div className="savedDiscoveryList savedDiscoveryListMain">
                  {savedCandidates.map((candidate) => (
                    <div className="savedDiscoveryItem" key={candidate.id}>
                      <div>
                        <strong title={candidate.folder ?? undefined}>
                          {candidate.releaseArtist ? `${candidate.releaseArtist} - ${candidate.releaseTitle}` : candidate.releaseTitle}
                        </strong>
                        <span>
                          {candidate.username ?? "unknown user"} · {candidate.resultCount.toLocaleString()} file
                          {candidate.resultCount === 1 ? "" : "s"} · {candidate.qualityLabel}
                          {candidate.primaryFormat ? ` · ${candidate.primaryFormat}` : ""}
                        </span>
                      </div>
                      <div className="savedDiscoveryActions">
                        <button
                          className="compactButton"
                          disabled={candidate.availableCount === 0 || downloadState.status === "working" || !downloadsConfigured}
                          title={downloadsConfigured ? undefined : "Set MUSIC_OS_SLSKD_DOWNLOAD_DIR before proposing downloads"}
                          type="button"
                          onClick={() => void onProposeSavedCandidateDownload(candidate)}
                        >
                          Download
                        </button>
                        <button className="secondary compactButton" type="button" onClick={() => void onRemoveSavedCandidate(candidate.id)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : releaseFilteredClusters.length === 0 ? (
              discoveryState.status === "searching" ? (
                <DiscoveryLoadingState query={discoveryState.query} />
              ) : (
                <div className="emptyState">
                  {discoveryState.results.length > 0
                    ? "No results match the active Discovery filters."
                    : "Search results will appear here. Downloads will be staged through Imports in the next step."}
                </div>
              )
            ) : (
              <>
                {visibleClusters.map((cluster) => (
                  <DiscoveryClusterResult
                    cluster={cluster}
                    expanded={expandedClusterIds.has(cluster.id)}
                    expandedGroupIds={expandedGroupIds}
                    key={cluster.id}
                    libraryMatches={libraryMatches}
                    selectedFileIds={selectedFileIds}
                    selectedGroupIds={selectedGroupIds}
                    onGroupSelect={onGroupSelect}
                    onInspectGroup={onInspectGroup}
                    onSaveCandidate={onSaveCandidate}
                    onToggleCluster={onToggleCluster}
                    onToggleFileSelect={onToggleFileSelect}
                    onToggleGroup={onToggleGroup}
                  />
                ))}
                {hiddenClusterCount > 0 ? (
                  <button
                    className="secondary discoveryShowMore"
                    type="button"
                    onClick={() => setVisibleClusterLimit((current) => current + 10)}
                  >
                    Show 10 More ({hiddenClusterCount.toLocaleString()} hidden)
                  </button>
                ) : null}
              </>
            )}
          </section>
        </div>

        <aside className="discoverySideColumn" aria-label="Discovery staging workspace">
          <section className={discoveryState.health?.reachable ? "discoveryStatus ready" : "discoveryStatus"}>
            <div>
              <span className="eyebrow">Connection</span>
              <strong>{discoveryState.health?.reachable ? "slskd reachable" : "slskd not confirmed"}</strong>
            </div>
            <span>{discoveryStatusDetail}</span>
            {discoveryState.health?.reachable && !discoveryState.health.downloadsConfigured ? (
              <span className="warningText">Download staging needs MUSIC_OS_SLSKD_DOWNLOAD_DIR before transfer batches can run.</span>
            ) : null}
          </section>

          {inspectedGroup ? (
            <DiscoveryCandidateDetail
              group={inspectedGroup}
              libraryMatch={getDiscoveryLibraryMatch(inspectedGroup, libraryMatches)}
              selectedFileCount={inspectedGroup.files.filter((file) => !file.isLocked && isAudioDiscoveryResult(file) && selectedFileIds.has(file.id)).length}
              saved={savedCandidates.some((candidate) => candidate.candidateKey === inspectedGroup.id)}
              onSave={() => onSaveCandidate(inspectedGroup)}
              onSelect={() => onGroupSelect(inspectedGroup)}
            />
          ) : (
            <section className="discoveryCandidateDetail isEmpty" aria-label="Discovery candidate detail">
              <span className="eyebrow">Candidate Detail</span>
              <strong>Select a source to inspect it.</strong>
              <span>Use Inspect on any result to see library match, quality flags, preview files, and staging options.</span>
            </section>
          )}

          {parsedListState.items.length > 0 ? (
            <section className="parsedDiscoveryList" aria-label="Parsed Discovery list">
              <div className="parsedDiscoveryToolbar">
                <strong>
                  {visibleParsedListItems.length.toLocaleString()} shown · {missingParsedCount.toLocaleString()} missing
                </strong>
                <div className="segmentedControl" aria-label="Parsed list filter">
                  <button className={parsedListFilter === "all" ? "active" : ""} type="button" onClick={() => setParsedListFilter("all")}>
                    All
                  </button>
                  <button className={parsedListFilter === "missing" ? "active" : ""} type="button" onClick={() => setParsedListFilter("missing")}>
                    Missing
                  </button>
                  <button className={parsedListFilter === "owned" ? "active" : ""} type="button" onClick={() => setParsedListFilter("owned")}>
                    Owned
                  </button>
                </div>
                <button
                  className="compactButton"
                  disabled={!firstMissingParsedItem}
                  type="button"
                  onClick={() => firstMissingParsedItem && void onSearchParsedItem(firstMissingParsedItem)}
                >
                  Search First
                </button>
              </div>
              {visibleParsedListItems.slice(0, 8).map((item, index) => (
                <div className="parsedDiscoveryItem" key={`${item.rank ?? index}-${item.query}`}>
                  <div>
                    <strong>
                      {item.rank ? `${item.rank}. ` : ""}
                      {item.artist ? `${item.artist} - ` : ""}
                      {item.title}
                      {item.year ? ` (${item.year})` : ""}
                    </strong>
                    <span>
                      {item.ownedMatchCount.toLocaleString()} indexed match{item.ownedMatchCount === 1 ? "" : "es"} · query {item.query}
                    </span>
                  </div>
                  <button className="compactButton" type="button" onClick={() => void onSearchParsedItem(item)}>
                    Search
                  </button>
                </div>
              ))}
              {visibleParsedListItems.length > 8 ? (
                <div className="parsedDiscoveryMore">
                  Showing 8 of {visibleParsedListItems.length.toLocaleString()} parsed rows.
                </div>
              ) : null}
            </section>
          ) : null}

          {downloadJobs.length > 0 ? (
            <section className="downloadJobsCompact" aria-label="Discovery download jobs">
              <div className="discoveryPanelHeader">
                <div>
                  <span className="eyebrow">Transfers</span>
                  <strong>Download jobs</strong>
                </div>
                <span>{activeDownloadCount.toLocaleString()} active</span>
              </div>
              <button type="button" onClick={onOpenJobs}>
                View Jobs
              </button>
            </section>
          ) : null}

          {savedLists.length > 0 ? (
            <section className="savedDiscoveryLists" aria-label="Saved parsed Discovery lists">
              <div className="savedDiscoveryHeader">
                <strong>Saved Lists</strong>
                <span>{savedLists.length.toLocaleString()} parsed source{savedLists.length === 1 ? "" : "s"}</span>
              </div>
              <div className="savedDiscoveryList">
                {savedLists.slice(0, 6).map((list) => (
                  <div className="savedDiscoveryItem" key={list.id}>
                    <div>
                      <strong>{list.name}</strong>
                      <span>
                        {list.itemCount.toLocaleString()} item{list.itemCount === 1 ? "" : "s"} ·{" "}
                        {list.missingCount.toLocaleString()} missing · {list.ownedCount.toLocaleString()} owned
                      </span>
                    </div>
                    <div className="savedDiscoveryActions">
                      <button
                        className="compactButton"
                        disabled={list.items.length === 0}
                        type="button"
                        onClick={() => void onSearchSavedListMissing(list)}
                      >
                        Missing
                      </button>
                      <button className="compactButton" type="button" onClick={() => onLoadSavedList(list)}>
                        Load
                      </button>
                      <button className="compactButton danger" type="button" onClick={() => void onRemoveSavedList(list.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function filterDiscoveryClustersByRelease(
  clusters: DiscoveryCluster[],
  releaseFilter: DiscoveryReleaseFilter,
  getLibraryMatch: (group: DiscoveryGroup) => DiscoveryLibraryMatch
): DiscoveryCluster[] {
  if (releaseFilter === "all") {
    return clusters;
  }

  return clusters.filter((cluster) => {
    const best = cluster.bestGroup;
    const libraryMatch = getLibraryMatch(best);
    if (releaseFilter === "recommended") {
      if (libraryMatch.status === "possible_upgrade") {
        return true;
      }
      if (best.releaseCompleteness === "album" || best.releaseCompleteness === "ep") {
        return best.availableCount > 0;
      }
      if (best.releaseCompleteness === "single") {
        return best.availableCount > 0 && best.matchScore >= 14;
      }
      return false;
    }
    if (releaseFilter === "upgrades") {
      return cluster.groups.some((group) => getLibraryMatch(group).status === "possible_upgrade");
    }
    if (releaseFilter === "albums") {
      return best.releaseCompleteness === "album" || best.releaseCompleteness === "ep";
    }
    if (releaseFilter === "collections") {
      return best.releaseCompleteness === "collection";
    }
    return best.releaseCompleteness === "single" || best.releaseCompleteness === "folder";
  });
}

function getDiscoveryLibraryMatch(group: DiscoveryGroup, libraryMatches: Map<string, DiscoveryLibraryMatch>): DiscoveryLibraryMatch {
  return libraryMatches.get(group.id) ?? EMPTY_DISCOVERY_LIBRARY_MATCH;
}

function matchesDiscoveryLibraryFilter(match: DiscoveryLibraryMatch, libraryFilter: DiscoveryLibraryFilter): boolean {
  if (libraryFilter === "all") {
    return true;
  }
  if (libraryFilter === "actionable") {
    return match.status !== "already_owned";
  }
  if (libraryFilter === "missing") {
    return match.status === "not_in_library";
  }
  return match.status === "already_owned" || match.status === "possible_upgrade";
}

const EMPTY_DISCOVERY_LIBRARY_MATCH: DiscoveryLibraryMatch = {
  status: "not_in_library",
  label: "not in library",
  detail: "No matching indexed album or track",
  matchedFileCount: 0,
  localQualityLabel: null,
  remoteQualityLabel: null
};

function DiscoveryHighlightCard({
  cluster,
  libraryMatch,
  selectedFileIds,
  onGroupSelect,
  onInspectGroup
}: {
  cluster: DiscoveryCluster;
  libraryMatch: DiscoveryLibraryMatch;
  selectedFileIds: Set<string>;
  onGroupSelect(group: DiscoveryGroup): void;
  onInspectGroup(groupId: string): void;
}): ReactElement {
  const selectedCount = cluster.bestGroup.files.filter((file) => !file.isLocked && isAudioDiscoveryResult(file) && selectedFileIds.has(file.id)).length;
  const stageLabel =
    selectedCount > 0
      ? `${selectedCount.toLocaleString()} selected`
      : cluster.bestGroup.availableCount > 0
        ? `Stage ${cluster.bestGroup.availableCount.toLocaleString()}`
        : "Locked";

  return (
    <article className="discoveryHighlightCard">
      <div>
        <span className="muted">{cluster.matchLabel}</span>
        <strong title={cluster.bestGroup.folder ?? undefined}>
          {cluster.releaseArtist ? `${cluster.releaseArtist} - ${cluster.releaseTitle}` : cluster.releaseTitle}
        </strong>
        <span>
          {cluster.sourceCount.toLocaleString()} source{cluster.sourceCount === 1 ? "" : "s"} ·{" "}
          {cluster.bestGroup.files.length.toLocaleString()} best files · {cluster.qualityLabel}
        </span>
      </div>
      <div className="discoveryHighlightFacts">
        <span className={libraryMatch.status === "possible_upgrade" ? "statusPill warning" : "statusPill"}>
          {libraryMatch.label}
        </span>
        <span className="statusPill">{cluster.bestGroup.primaryFormat ?? cluster.formats[0] ?? "file"}</span>
        <span className="statusPill">{formatBytes(cluster.bestGroup.totalSizeBytes)}</span>
      </div>
      <div className="discoveryTrackPreview" title={cluster.bestGroup.folder ?? undefined}>
        {cluster.bestGroup.previewFiles.slice(0, 3).map((file) => (
          <span key={file.id}>{file.filename}</span>
        ))}
      </div>
      <div className="discoveryHighlightActions">
        <button
          className="compactButton"
          disabled={cluster.bestGroup.availableCount === 0}
          type="button"
          onClick={() => onGroupSelect(cluster.bestGroup)}
        >
          {stageLabel}
        </button>
        <button className="secondary compactButton" type="button" onClick={() => onInspectGroup(cluster.bestGroup.id)}>
          Inspect
        </button>
      </div>
    </article>
  );
}

function DiscoveryCandidateDetail({
  group,
  libraryMatch,
  selectedFileCount,
  saved,
  onSave,
  onSelect
}: {
  group: DiscoveryGroup;
  libraryMatch: DiscoveryLibraryMatch;
  selectedFileCount: number;
  saved: boolean;
  onSave(): void;
  onSelect(): void;
}): ReactElement {
  const warnings = getDiscoveryCandidateWarnings(group, libraryMatch);
  const selectedLabel =
    selectedFileCount > 0
      ? `${selectedFileCount.toLocaleString()} selected`
      : group.availableCount > 0
        ? `Stage ${group.availableCount.toLocaleString()}`
        : "Locked";
  const formatLabel = group.primaryFormat ?? (group.formats.length > 0 ? group.formats.join(", ") : "file");

  return (
    <section className="discoveryCandidateDetail" aria-label="Discovery candidate detail">
      <div className="discoveryCandidateDetailHeader">
        <div>
          <span className="muted">Candidate Detail</span>
          <strong>{group.releaseArtist ? `${group.releaseArtist} - ${group.releaseTitle}` : group.releaseTitle}</strong>
          <span title={group.folder ?? undefined}>
            {getDiscoveryFolderLabel(group)} · {group.username ?? "unknown user"}
          </span>
        </div>
        <div className="discoveryCandidateActions">
          <button className="compactButton" disabled={group.availableCount === 0} type="button" onClick={onSelect}>
            {selectedLabel}
          </button>
          <button className="secondary compactButton" disabled={saved} type="button" onClick={onSave}>
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
      <div className="discoveryCandidateFacts">
        <div>
          <span>Artist</span>
          <strong>{group.releaseArtist ?? "Unknown"}</strong>
        </div>
        <div>
          <span>Album / Release</span>
          <strong>{group.releaseTitle}</strong>
        </div>
        <div>
          <span>Source</span>
          <strong>{group.username ?? "unknown user"}</strong>
        </div>
        <div>
          <span>Format</span>
          <strong>{formatLabel}</strong>
        </div>
        <div>
          <span>Quality</span>
          <strong>{group.qualityLabel}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>{Math.round(group.score)}</strong>
        </div>
        <div>
          <span>Files</span>
          <strong>
            {group.files.length.toLocaleString()} total · {group.availableCount.toLocaleString()} stageable audio
          </strong>
        </div>
        <div>
          <span>Size</span>
          <strong>{formatBytes(group.totalSizeBytes)}</strong>
        </div>
      </div>
      <div className="discoveryCandidateLibrary">
        <span className={libraryMatch.status === "possible_upgrade" ? "statusPill warning" : "statusPill"}>
          {libraryMatch.label}
        </span>
        <strong>{libraryMatch.detail}</strong>
      </div>
      <div className="discoveryCandidateWarnings">
        {warnings.length === 0 ? (
          <span className="statusPill">No warnings</span>
        ) : (
          warnings.map((warning) => (
            <span className="statusPill warning" key={warning}>
              {warning}
            </span>
          ))
        )}
      </div>
      <div className="discoveryCandidatePreview" title={group.folder ?? undefined}>
        {group.previewFiles.map((file) => (
          <span key={file.id}>{file.filename}</span>
        ))}
      </div>
    </section>
  );
}

function getDiscoveryCandidateWarnings(group: DiscoveryGroup, libraryMatch: DiscoveryLibraryMatch): string[] {
  const warnings: string[] = [];
  if (group.matchLabel === "weak match" || group.matchLabel === "partial match") {
    warnings.push(group.matchLabel);
  }
  if (group.lockedCount > 0) {
    warnings.push(`${group.lockedCount.toLocaleString()} locked file${group.lockedCount === 1 ? "" : "s"}`);
  }
  if (group.availableCount === 0) {
    warnings.push("no unlocked files");
  }
  if (group.releaseCompleteness === "single" || group.releaseCompleteness === "folder" || group.releaseCompleteness === "collection") {
    warnings.push(`${group.releaseCompleteness} candidate`);
  }
  if (libraryMatch.status === "already_owned") {
    warnings.push("already indexed");
  }
  return warnings;
}

function DiscoveryClusterResult({
  cluster,
  expanded,
  expandedGroupIds,
  libraryMatches,
  selectedFileIds,
  selectedGroupIds,
  onGroupSelect,
  onInspectGroup,
  onSaveCandidate,
  onToggleCluster,
  onToggleFileSelect,
  onToggleGroup
}: {
  cluster: DiscoveryCluster;
  expanded: boolean;
  expandedGroupIds: Set<string>;
  libraryMatches: Map<string, DiscoveryLibraryMatch>;
  selectedFileIds: Set<string>;
  selectedGroupIds: Set<string>;
  onGroupSelect(group: DiscoveryGroup): void;
  onInspectGroup(groupId: string): void;
  onSaveCandidate(group: DiscoveryGroup): Promise<void>;
  onToggleCluster(clusterId: string): void;
  onToggleFileSelect(fileId: string): void;
  onToggleGroup(groupId: string): void;
}): ReactElement {
  const hiddenSourceCount = Math.max(0, cluster.groups.length - 3);
  const visibleGroups = expanded ? cluster.groups : cluster.groups.slice(0, 3);

  return (
    <section className="discoveryCluster" aria-label={`${cluster.releaseArtist ? `${cluster.releaseArtist} - ` : ""}${cluster.releaseTitle}`}>
      <div className="discoveryClusterHeader">
        <div>
          <strong>
            {cluster.releaseArtist ? `${cluster.releaseArtist} - ${cluster.releaseTitle}` : cluster.releaseTitle}
          </strong>
          <span>
            {cluster.sourceCount.toLocaleString()} source folder{cluster.sourceCount === 1 ? "" : "s"} ·{" "}
            {cluster.availableCount.toLocaleString()} stageable audio file{cluster.availableCount === 1 ? "" : "s"} ·{" "}
            {formatBytes(cluster.totalSizeBytes)}
            {cluster.formats.length > 0 ? ` · ${cluster.formats.join(", ")}` : ""}
          </span>
          <span>
            Best source: {cluster.bestGroup.username ?? "unknown user"} · {getDiscoveryFolderLabel(cluster.bestGroup)}
          </span>
        </div>
        <div className="discoveryClusterActions">
          {hiddenSourceCount > 0 ? (
            <button className="secondary compactButton" type="button" onClick={() => onToggleCluster(cluster.id)}>
              {expanded ? "Show Best" : `Show ${hiddenSourceCount.toLocaleString()} More`}
            </button>
          ) : null}
        </div>
      </div>
      <div className="discoveryClusterSources">
        {visibleGroups.map((group) => (
          <DiscoveryGroupResult
            expanded={expandedGroupIds.has(group.id)}
            group={group}
            key={group.id}
            libraryMatch={getDiscoveryLibraryMatch(group, libraryMatches)}
            selected={selectedGroupIds.has(group.id)}
            selectedFileIds={selectedFileIds}
            onGroupSelect={onGroupSelect}
            onInspectGroup={onInspectGroup}
            onSaveCandidate={onSaveCandidate}
            onToggleFileSelect={onToggleFileSelect}
            onToggleGroup={onToggleGroup}
          />
        ))}
      </div>
    </section>
  );
}

function DiscoveryGroupResult({
  expanded,
  group,
  libraryMatch,
  selected,
  selectedFileIds,
  onGroupSelect,
  onInspectGroup,
  onSaveCandidate,
  onToggleFileSelect,
  onToggleGroup
}: {
  expanded: boolean;
  group: DiscoveryGroup;
  libraryMatch: DiscoveryLibraryMatch;
  selected: boolean;
  selectedFileIds: Set<string>;
  onGroupSelect(group: DiscoveryGroup): void;
  onInspectGroup(groupId: string): void;
  onSaveCandidate(group: DiscoveryGroup): Promise<void>;
  onToggleFileSelect(fileId: string): void;
  onToggleGroup(groupId: string): void;
}): ReactElement {
  const availableCount = group.availableCount;
  const selectedAvailableCount = group.files.filter((file) => !file.isLocked && isAudioDiscoveryResult(file) && selectedFileIds.has(file.id)).length;
  const stageLabel =
    selectedAvailableCount > 0
      ? `${selectedAvailableCount.toLocaleString()} selected`
      : group.availableCount > 0
        ? `Stage ${group.availableCount.toLocaleString()}`
        : "Locked";

  return (
    <article className={selected ? "discoveryGroup selected" : "discoveryGroup"}>
      <div className="discoveryGroupHeader">
        <label className="selectControl">
          <input checked={selected} type="checkbox" onChange={() => onGroupSelect(group)} />
          <span>Select</span>
        </label>
        <div className="discoveryGroupMain">
          <strong title={group.folder ?? undefined}>
            {group.releaseArtist ? `${group.releaseArtist} - ${group.releaseTitle}` : group.releaseTitle}
          </strong>
          <span>
            {getDiscoveryFolderLabel(group)} · {group.username ?? "unknown user"} · {group.files.length.toLocaleString()} file
            {group.files.length === 1 ? "" : "s"} · {formatBytes(group.totalSizeBytes)}
          </span>
          <span>
            {group.matchLabel} · {group.releaseCompleteness} · {group.qualityLabel} · {group.availableCount.toLocaleString()} stageable audio
            {group.primaryFormat ? ` · ${group.primaryFormat}` : ""}
            {group.averageBitrate ? ` · avg ${Math.round(group.averageBitrate / 1000)} kbps` : ""} · score {Math.round(group.score)}
          </span>
          <span className={libraryMatch.status === "possible_upgrade" ? "warningText" : undefined}>
            Library: {libraryMatch.detail}
          </span>
          <div className="discoveryGroupPills">
            <span className={group.matchLabel === "weak match" ? "statusPill warning" : "statusPill"}>{group.matchLabel}</span>
            <span
              className={
                libraryMatch.status === "possible_upgrade"
                  ? "statusPill warning"
                  : libraryMatch.status === "already_owned"
                    ? "statusPill muted"
                    : "statusPill"
              }
            >
              {libraryMatch.label}
            </span>
            <span className="statusPill">{group.qualityLabel}</span>
            <span className={group.lockedCount > 0 ? "statusPill warning" : "statusPill"}>
              {group.lockedCount > 0
                ? `${group.lockedCount.toLocaleString()} locked`
                : `${availableCount.toLocaleString()} audio`}
            </span>
          </div>
          <div className="discoveryTrackPreview" title={group.folder ?? undefined}>
            {group.previewFiles.map((file) => (
              <span key={file.id}>{file.filename}</span>
            ))}
            {group.files.length > group.previewFiles.length ? <span>+{group.files.length - group.previewFiles.length} more</span> : null}
          </div>
        </div>
        <div className="discoveryGroupActions">
          <button className="compactButton" disabled={group.availableCount === 0} type="button" onClick={() => onGroupSelect(group)}>
            {stageLabel}
          </button>
          <button className="secondary compactButton" type="button" onClick={() => onInspectGroup(group.id)}>
            Inspect
          </button>
          <button className="secondary compactButton" type="button" onClick={() => void onSaveCandidate(group)}>
            Save
          </button>
          <button className="secondary compactButton" type="button" onClick={() => onToggleGroup(group.id)}>
            {expanded ? "Hide Files" : "Files"}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="discoveryFileList">
          {group.files.map((result) => (
            <div className="discoveryFileRow" key={result.id}>
              <label className="selectControl">
                <input
                  checked={selectedFileIds.has(result.id)}
                  disabled={!isAudioDiscoveryResult(result) || result.isLocked}
                  type="checkbox"
                  onChange={() => onToggleFileSelect(result.id)}
                />
                <span className="srOnly">Select file</span>
              </label>
              <div className="discoveryResultMain">
                <strong title={result.path}>{result.filename}</strong>
                <span>
                  {formatBytes(result.sizeBytes)} · {result.extension?.toUpperCase() ?? "file"}
                  {result.bitrate ? ` · ${Math.round(result.bitrate / 1000)} kbps` : ""}
                  {result.lengthSeconds ? ` · ${formatSeconds(result.lengthSeconds)}` : ""}
                </span>
              </div>
              <span className={result.isLocked || !isAudioDiscoveryResult(result) ? "statusPill warning" : "statusPill"}>
                {result.isLocked ? "locked" : isAudioDiscoveryResult(result) ? "audio" : "asset"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function HomeView({
  albumsState,
  currentPlaybackFile,
  currentWaveform,
  libraryTotal,
  playback,
  playbackBusy,
  playlists,
  visualizerFrameRef,
  onOpenAlbum,
  onOpenArtistPage,
  onPlayAlbum,
  onPlayFile
}: {
  albumsState: AlbumsState;
  currentPlaybackFile: LibraryFile | null;
  currentWaveform: WaveformSummaryResponse | null;
  libraryTotal: number;
  playback: PlaybackStateResponse;
  playbackBusy: boolean;
  playlists: Playlist[];
  visualizerFrameRef: MutableRefObject<VisualizerFrameResponse | null>;
  onOpenAlbum(album: AlbumGroupItem): void;
  onOpenArtistPage(artist: string): void;
  onPlayAlbum(albumId: string): Promise<void>;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
}): ReactElement {
  const albums = "albums" in albumsState ? albumsState.albums.albums : [];
  const artists = useMemo(() => groupAlbumsByArtist(albums), [albums]);
  const files = useMemo(() => {
    const fileMap = new Map<string, LibraryFile>();
    for (const album of albums) {
      for (const file of album.files) {
        fileMap.set(file.id, file);
      }
    }
    return [...fileMap.values()];
  }, [albums]);
  const favoriteAlbums = useMemo(
    () =>
      [...albums]
        .sort(
          (left, right) =>
            albumLikeCount(right.files) - albumLikeCount(left.files) ||
            albumAverageRating(right.files) - albumAverageRating(left.files) ||
            albumPlayCount(right.files) - albumPlayCount(left.files) ||
            compareAlbumsByMode(left, right, "artistAlbum")
        )
        .slice(0, 5),
    [albums]
  );
  const recentAlbums = useMemo(() => sortAlbumsByMode(albums, "recent").slice(0, 6), [albums]);
  const favoriteArtists = useMemo(() => sortArtistSections(artists, "likes").slice(0, 5), [artists]);
  const topSongs = useMemo(
    () =>
      [...files]
        .sort(
          (left, right) =>
            Number(Boolean(right.liked)) - Number(Boolean(left.liked)) ||
            (right.rating ?? -1) - (left.rating ?? -1) ||
            right.playCount - left.playCount ||
            compareText(left.displayTags.title ?? left.filename, right.displayTags.title ?? right.filename)
        )
        .slice(0, 6),
    [files]
  );
  const allListenTimeMs = useMemo(() => getAlbumsListenTimeMs(albums), [albums]);
  const losslessCount = useMemo(() => files.filter((file) => isLosslessFile(file)).length, [files]);
  const ratedCount = useMemo(() => files.filter((file) => file.rating != null || file.liked != null).length, [files]);
  const topSongQueue = useMemo(() => topSongs.map((file) => file.id), [topSongs]);
  const topAlbum = favoriteAlbums[0] ?? recentAlbums[0] ?? null;
  const loadedTotal = "albums" in albumsState ? albumsState.albums.total : albums.length;
  const nowPlayingTitle = currentPlaybackFile?.displayTags.title ?? playback.currentDisplayName ?? "Idle";
  const nowPlayingArtist = currentPlaybackFile?.displayTags.artist ?? "No track loaded";

  return (
    <div className="homeView">
      {albumsState.status === "error" ? <div className="inlineError">{albumsState.message}</div> : null}
      {albumsState.status === "loading" && albums.length === 0 ? <div className="emptyState">Loading home.</div> : null}
      <section className="homePulsePanel">
        <div className="homePulseCopy">
          <span className="homeKicker">Library pulse</span>
          <strong>{libraryTotal.toLocaleString()} tracks</strong>
          <div className="homePulseStats">
            <span>{loadedTotal.toLocaleString()} albums</span>
            <span>{artists.length.toLocaleString()} artists</span>
            <span>{formatListenTime(allListenTimeMs)}</span>
          </div>
        </div>
        <div className="homeAlbumStack" aria-hidden="true">
          {(favoriteAlbums.length > 0 ? favoriteAlbums : recentAlbums).slice(0, 4).map((album, index) => (
            <button
              className={`homeStackCover stack${index + 1}`}
              key={album.id}
              style={{ "--stack-index": index } as CSSProperties}
              type="button"
              onClick={() => onOpenAlbum(album)}
            >
              <Artwork className="homeStackArt" eager={index === 0} src={artworkAlbumUrl(album.id)} />
            </button>
          ))}
        </div>
        <div className="homePulseFooter">
          <span>{losslessCount.toLocaleString()} lossless</span>
          <span>{ratedCount.toLocaleString()} rated or marked</span>
          <span>{playlists.length.toLocaleString()} playlists</span>
        </div>
      </section>

      <aside className="homeNowPanel">
        <span className="homeKicker">Now</span>
        <div className="homeNowBody">
          <Artwork className="homeNowArt" eager src={currentPlaybackFile ? artworkFileUrl(currentPlaybackFile.id) : null} />
          <div>
            <strong title={nowPlayingTitle}>{nowPlayingTitle}</strong>
            <button className="linkButton" type="button" onClick={() => currentPlaybackFile?.displayTags.artist ? onOpenArtistPage(currentPlaybackFile.displayTags.artist) : undefined}>
              {nowPlayingArtist}
            </button>
            {playback.currentFileId ? <MiniTrackWaveform playback={playback} waveform={currentWaveform} /> : null}
            <div className="homeNowSpectrum" aria-hidden="true">
              <SpectrumCanvas
                className="homeNowSpectrumCanvas"
                frameRef={visualizerFrameRef}
                mode="spectrum"
                playing={playback.status === "playing"}
              />
            </div>
          </div>
        </div>
        <div className="homeNowMeta">
          <span>{playback.status === "playing" ? "Playing" : playback.currentFileId ? "Paused" : "Stopped"}</span>
          <span>{playback.queue.length.toLocaleString()} queued</span>
        </div>
      </aside>

      <section className="homePanel homeFavorites">
        <div className="homeSectionHeader">
          <strong>Favorite albums</strong>
          <span>likes, ratings, plays</span>
        </div>
        <div className="homeAlbumShelf">
          {favoriteAlbums.map((album) => (
            <article className={album.id === favoriteAlbums[0]?.id ? "homeAlbumCard featured" : "homeAlbumCard"} key={album.id}>
              <button className="homeAlbumArtButton" type="button" onClick={() => onOpenAlbum(album)}>
                <Artwork className="homeAlbumArt" src={artworkAlbumUrl(album.id)} />
              </button>
              <div>
                <button className="linkButton strongLink" title={album.album} type="button" onClick={() => onOpenAlbum(album)}>
                  {album.album}
                </button>
                <button className="linkButton" title={album.artist} type="button" onClick={() => onOpenArtistPage(album.artist)}>
                  {album.artist}
                </button>
                <span>
                  {albumLikeCount(album.files).toLocaleString()} liked · {albumPlayCount(album.files).toLocaleString()} plays
                </span>
              </div>
              <button className="roundIconButton" disabled={playbackBusy} title={`Play ${album.album}`} type="button" onClick={() => void onPlayAlbum(album.id)}>
                <TransportIcon shape={playback.status === "playing" && playback.queue.includes(album.files[0]?.id ?? "") ? "pause" : "play"} />
              </button>
            </article>
          ))}
          {favoriteAlbums.length === 0 ? <span className="homeEmptyLine">Rate, like, or play albums to shape this shelf.</span> : null}
        </div>
      </section>

      <section className="homePanel homeArtists">
        <div className="homeSectionHeader">
          <strong>Artists in rotation</strong>
          <span>your heaviest signals</span>
        </div>
        <div className="homeArtistList">
          {favoriteArtists.map((section) => {
            const artistFiles = section.albums.flatMap((album) => album.files);
            return (
              <button className="homeArtistRow" key={section.artist} type="button" onClick={() => onOpenArtistPage(section.artist)}>
                <div className="homeArtistCovers" aria-hidden="true">
                  {section.albums.slice(0, 3).map((album, index) => (
                    <Artwork className={`homeArtistCover cover${index + 1}`} key={album.id} src={artworkAlbumUrl(album.id)} />
                  ))}
                </div>
                <div>
                  <strong>{section.artist}</strong>
                  <span>
                    {section.albums.length.toLocaleString()} albums · {artistPlayCount(section.albums).toLocaleString()} plays · {formatListenTime(getFilesListenTimeMs(artistFiles))}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="homePanel homeRecent">
        <div className="homeSectionHeader">
          <strong>Recent additions</strong>
          <span>freshly indexed</span>
        </div>
        <div className="homeRecentRail">
          {recentAlbums.map((album) => (
            <button className="homeRecentAlbum" key={album.id} type="button" onClick={() => onOpenAlbum(album)}>
              <Artwork className="homeRecentArt" src={artworkAlbumUrl(album.id)} />
              <strong title={album.album}>{album.album}</strong>
              <span title={album.artist}>{album.artist}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="homePanel homeSongs">
        <div className="homeSectionHeader">
          <strong>Top tracks</strong>
          <span>ready to start a queue</span>
        </div>
        <div className="homeSongList">
          {topSongs.map((file, index) => (
            <button
              className={file.id === playback.currentFileId ? "homeSongRow active" : "homeSongRow"}
              key={file.id}
              type="button"
              onClick={() => void onPlayFile(file.id, topSongQueue)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <Artwork className="homeSongArt" src={artworkFileUrl(file.id)} />
              <div>
                <strong title={file.displayTags.title ?? file.filename}>{file.displayTags.title ?? file.filename}</strong>
                <small title={file.displayTags.album ?? "Unknown album"}>{file.displayTags.album ?? "Unknown album"}</small>
              </div>
              <span>{file.playCount.toLocaleString()} plays</span>
            </button>
          ))}
        </div>
      </section>

      {topAlbum ? (
        <section className="homeSpotlight">
          <Artwork className="homeSpotlightArt" src={artworkAlbumUrl(topAlbum.id)} />
          <div>
            <span className="homeKicker">Start here</span>
            <button className="linkButton strongLink" type="button" onClick={() => onOpenAlbum(topAlbum)}>
              {topAlbum.album}
            </button>
            <button className="linkButton" type="button" onClick={() => onOpenArtistPage(topAlbum.artist)}>
              {topAlbum.artist}
            </button>
          </div>
          <button disabled={playbackBusy} type="button" onClick={() => void onPlayAlbum(topAlbum.id)}>
            Play
          </button>
        </section>
      ) : null}
    </div>
  );
}

function AlbumsView({
  albumsState,
  currentWaveform,
  initialTarget,
  loadingMore,
  playback,
  playbackBusy,
  resetKey,
  onEnqueuePlayback,
  onLoadMore,
  onPlayAlbum,
  onPlayFile
}: {
  albumsState: AlbumsState;
  currentWaveform: WaveformSummaryResponse | null;
  initialTarget: AlbumViewTarget | null;
  loadingMore: boolean;
  playback: PlaybackStateResponse;
  playbackBusy: boolean;
  resetKey: number;
  onEnqueuePlayback(fileIds: string[], position: QueueInsertPosition): Promise<void>;
  onLoadMore(): Promise<void>;
  onPlayAlbum(albumId: string): Promise<void>;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
}): ReactElement {
  const albums = "albums" in albumsState ? albumsState.albums.albums : [];
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [albumViewMode, setAlbumViewMode] = useState<AlbumGroupMode>("all");
  const [albumLayout, setAlbumLayout] = useState<"grid" | "flow">("grid");
  const [albumSortMode, setAlbumSortMode] = useState<AlbumSortMode>("artistAlbum");
  const consumedTargetKeyRef = useRef<number | null>(null);
  const resetKeyRef = useRef(resetKey);
  const sortedAlbums = useMemo(() => sortAlbumsByMode(albums, albumSortMode), [albumSortMode, albums]);
  const [facetFilter, setFacetFilter] = useState<AlbumFacetFilter>({ genre: "all", decade: "all" });
  const albumFacets = useMemo(() => getAlbumFacets(sortedAlbums), [sortedAlbums]);
  const filteredAlbums = useMemo(() => filterAlbumsByFacet(sortedAlbums, facetFilter), [facetFilter, sortedAlbums]);
  const albumSections = useMemo(() => groupAlbumsByMode(filteredAlbums, albumViewMode), [albumViewMode, filteredAlbums]);
  const artistSections = useMemo(() => groupAlbumsByArtist(filteredAlbums), [filteredAlbums]);
  const selectedAlbum = useMemo(() => sortedAlbums.find((album) => album.id === selectedAlbumId) ?? null, [selectedAlbumId, sortedAlbums]);
  const artistAlbums = useMemo(
    () => (selectedArtist ? sortedAlbums.filter((album) => album.artist === selectedArtist) : []),
    [selectedArtist, sortedAlbums]
  );
  const hasMoreAlbums = "albums" in albumsState && albumsState.albums.albums.length < albumsState.albums.total;

  function openAlbum(album: AlbumGroupItem): void {
    setSelectedArtist(null);
    setSelectedAlbumId(album.id);
    setSelectedFileId(album.files[0]?.id ?? null);
  }

  function openArtist(artist: string): void {
    setSelectedArtist(artist);
    setSelectedAlbumId(null);
    setSelectedFileId(null);
  }

  useEffect(() => {
    if (!initialTarget || consumedTargetKeyRef.current === initialTarget.key) {
      return;
    }

    const album = sortedAlbums.find((item) => item.id === initialTarget.albumId);
    if (!album) {
      return;
    }

    setSelectedArtist(null);
    setSelectedAlbumId(album.id);
    setSelectedFileId(album.files[0]?.id ?? null);
    consumedTargetKeyRef.current = initialTarget.key;
  }, [initialTarget, sortedAlbums]);

  useEffect(() => {
    if (resetKeyRef.current === resetKey) {
      return;
    }
    resetKeyRef.current = resetKey;
    consumedTargetKeyRef.current = null;
    setSelectedArtist(null);
    setSelectedAlbumId(null);
    setSelectedFileId(null);
  }, [resetKey]);

  return (
    <>
      {albumsState.status === "error" ? <div className="inlineError">{albumsState.message}</div> : null}
      {sortedAlbums.length === 0 ? (
        <div className="emptyState">
          {albumsState.status === "loading" ? "Loading albums." : "No album groups found. Scan files with album tags first."}
        </div>
      ) : selectedArtist ? (
        <ArtistDetailView
          albums={artistAlbums}
          artist={selectedArtist}
          playbackBusy={playbackBusy}
          onEnqueuePlayback={onEnqueuePlayback}
          onBack={() => setSelectedArtist(null)}
          onOpenAlbum={openAlbum}
          onPlayFile={onPlayFile}
        />
      ) : selectedAlbum ? (
        <AlbumDetailView
          album={selectedAlbum}
          currentWaveform={currentWaveform}
          playback={playback}
          playbackBusy={playbackBusy}
          selectedFileId={selectedFileId}
          onBack={() => {
            setSelectedAlbumId(null);
            setSelectedFileId(null);
          }}
          onOpenArtist={openArtist}
          onEnqueuePlayback={onEnqueuePlayback}
          onPlayAlbum={onPlayAlbum}
          onPlayFile={onPlayFile}
          onSelectFile={setSelectedFileId}
        />
      ) : (
        <>
          <div className="albumViewToolbar" aria-label="Album view controls">
            <div>
              <strong>{filteredAlbums.length.toLocaleString()} loaded albums</strong>
              <span>{albumsState.status === "ready" ? `${albumsState.albums.total.toLocaleString()} total · ` : ""}{artistSections.length.toLocaleString()} artists</span>
            </div>
            <div className="albumViewToolbarControls">
              <div className="segmentedControl" role="group" aria-label="Album layout">
                <button
                  className={albumLayout === "grid" ? "active" : ""}
                  type="button"
                  onClick={() => setAlbumLayout("grid")}
                >
                  Grid
                </button>
                <button
                  className={albumLayout === "flow" ? "active" : ""}
                  type="button"
                  onClick={() => setAlbumLayout("flow")}
                >
                  3D
                </button>
              </div>
              {albumLayout === "grid" ? (
                <>
                  <SortSelect<AlbumSortMode>
                    ariaLabel="Album sort"
                    value={albumSortMode}
                    options={[
                      { value: "artistAlbum", label: "Artist / album" },
                      { value: "recent", label: "Recently added" },
                      { value: "listens", label: "Most listens" },
                      { value: "likes", label: "Most likes" },
                      { value: "rating", label: "Highest rating" }
                    ]}
                    onChange={setAlbumSortMode}
                  />
                  <AlbumFacetControls
                    facets={albumFacets}
                    filter={facetFilter}
                    groupMode={albumViewMode}
                    groupModes={["all", "artist", "genre", "decade"]}
                    onFilterChange={setFacetFilter}
                    onGroupModeChange={setAlbumViewMode}
                  />
                </>
              ) : null}
            </div>
          </div>
          {albumLayout === "flow" ? (
            <>
              <AlbumFlowView albums={filteredAlbums} onOpenAlbum={openAlbum} />
              {hasMoreAlbums ? <LoadMoreRow loading={loadingMore} loaded={albums.length} total={albumsState.albums.total} onLoadMore={onLoadMore} /> : null}
            </>
          ) : albumViewMode === "all" ? (
            <PagedScrollSection className="albumGrid" hasMore={hasMoreAlbums} loading={loadingMore} onLoadMore={onLoadMore}>
              {filteredAlbums.map((album) => (
                  <AlbumCard
                    album={album}
                    key={album.id}
                    playbackBusy={playbackBusy}
                    onOpenAlbum={openAlbum}
                    onOpenArtist={openArtist}
                    onPlayAlbum={onPlayAlbum}
                  />
                ))}
                {hasMoreAlbums ? <LoadMoreRow loading={loadingMore} loaded={albums.length} total={albumsState.albums.total} onLoadMore={onLoadMore} /> : null}
            </PagedScrollSection>
          ) : (
            <PagedScrollSection className="artistAlbumSections" hasMore={hasMoreAlbums} loading={loadingMore} onLoadMore={onLoadMore}>
              {albumSections.map((section) => (
                <section className="artistAlbumSection" key={section.artist}>
                  <header>
                    {albumViewMode === "artist" ? (
                      <button className="artistSectionName" type="button" onClick={() => openArtist(section.artist)}>
                        {section.artist}
                      </button>
                    ) : (
                      <strong className="artistSectionName">{section.artist}</strong>
                    )}
                    <span>
                      {section.albums.length.toLocaleString()} album{section.albums.length === 1 ? "" : "s"}
                    </span>
                  </header>
                  <div className="albumGrid compact">
                    {section.albums.map((album) => (
                      <AlbumCard
                        album={album}
                        key={album.id}
                        playbackBusy={playbackBusy}
                        onOpenAlbum={openAlbum}
                        onOpenArtist={openArtist}
                        onPlayAlbum={onPlayAlbum}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {hasMoreAlbums ? <LoadMoreRow loading={loadingMore} loaded={albums.length} total={albumsState.albums.total} onLoadMore={onLoadMore} /> : null}
            </PagedScrollSection>
          )}
        </>
      )}
    </>
  );
}

function AlbumCard({
  album,
  playbackBusy,
  onOpenAlbum,
  onOpenArtist,
  onPlayAlbum
}: {
  album: AlbumGroupItem;
  playbackBusy: boolean;
  onOpenAlbum(album: AlbumGroupItem): void;
  onOpenArtist(artist: string): void;
  onPlayAlbum(albumId: string): Promise<void>;
}): ReactElement {
  return (
    <article
      className="albumCard"
      role="button"
      tabIndex={0}
      onClick={() => onOpenAlbum(album)}
      onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenAlbum(album);
        }
      }}
    >
      <div className="albumCover">
        <Artwork className="albumArt" src={artworkAlbumUrl(album.id)} />
        <button
          aria-label={`Play ${album.album}`}
          className="albumPlay"
          disabled={playbackBusy || album.files.length === 0}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void onPlayAlbum(album.id);
          }}
        >
          <TransportIcon shape="play" />
        </button>
      </div>
      <div className="albumInfo">
        <strong title={album.album}>{album.album}</strong>
        <button
          className="linkButton"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenArtist(album.artist);
          }}
        >
          <span title={album.artist}>{album.artist}</span>
        </button>
        <span className="albumMeta">
          {album.year ? `${album.year} · ` : ""}
          {album.fileCount} track{album.fileCount === 1 ? "" : "s"}
          {album.durationMs != null ? ` · ${formatTime(album.durationMs)}` : ""} · {album.formats.join("/")}
        </span>
      </div>
    </article>
  );
}

const ALBUM_FLOW_TAIL = 20;

function AlbumFlowView({
  albums,
  onOpenAlbum
}: {
  albums: AlbumGroupItem[];
  onOpenAlbum(album: AlbumGroupItem): void;
}): ReactElement {
  const [position, setPosition] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState(960);
  const [stageHeight, setStageHeight] = useState(540);
  const pendingPositionRef = useRef<number | null>(null);
  const positionFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect?.width) {
        setStageWidth(rect.width);
      }
      if (rect?.height) {
        setStageHeight(rect.height);
      }
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (positionFrameRef.current != null) {
        cancelAnimationFrame(positionFrameRef.current);
      }
    };
  }, []);

  // Coalesce high-frequency slider input into one state update per frame.
  function handleSliderChange(value: number): void {
    pendingPositionRef.current = value;
    if (positionFrameRef.current == null) {
      positionFrameRef.current = requestAnimationFrame(() => {
        positionFrameRef.current = null;
        if (pendingPositionRef.current != null) {
          setPosition(pendingPositionRef.current);
          pendingPositionRef.current = null;
        }
      });
    }
  }

  const maxIndex = Math.max(0, albums.length - 1);
  const linePosition = Math.min(Math.max(position, 0), maxIndex);
  const hoveredAlbum = hoveredId ? (albums.find((album) => album.id === hoveredId) ?? null) : null;
  // Remember the last hovered album so the track panel can animate out while
  // still showing its content.
  const lastAlbumRef = useRef<AlbumGroupItem | null>(null);
  if (hoveredAlbum) {
    lastAlbumRef.current = hoveredAlbum;
  }
  const panelAlbum = hoveredAlbum ?? lastAlbumRef.current;

  function keepHovered(albumId: string): void {
    setHoveredId(albumId);
  }

  function releaseHovered(albumId: string): void {
    setHoveredId((current) => (current === albumId ? null : current));
  }

  // World-space offsets of an item's slot in the receding line. Items scrolled
  // past (depth < 0) fly off-frame to the left, toward the viewer. The first
  // step is wider than the rest so the front album separates clearly.
  function lineOffsets(depth: number): { x: number; y: number; z: number } {
    if (depth < 0) {
      return { x: depth * stageWidth * 0.45, y: depth * -36, z: depth * -200 };
    }
    const x = stageWidth * (0.085 * Math.min(depth, 1) + 0.042 * Math.max(0, depth - 1));
    return { x, y: depth * -9, z: depth * -150 };
  }

  // World offsets that project onto the center of the stage at the featured
  // depth (z=220 scales by 1.25 around the 76%/34% perspective origin), minus
  // the 28%/58% slot anchor.
  const featuredTransform = `translate(-50%, -50%) translate3d(${Math.round(
    stageWidth * 0.272
  )}px, ${Math.round(stageHeight * -0.112)}px, 220px) rotateY(0deg)`;

  return (
    <section className="albumFlow" aria-label="Albums in 3D">
      <div className={hoveredAlbum ? "albumFlowStage hasFocus" : "albumFlowStage"} ref={stageRef}>
        {hoveredAlbum ? (
          <div className="albumFlowCaption" key={hoveredAlbum.id}>
            <h2>{hoveredAlbum.album}</h2>
            <p>{hoveredAlbum.artist}</p>
            <span>
              {hoveredAlbum.year ? `${hoveredAlbum.year} · ` : ""}
              {hoveredAlbum.fileCount} track{hoveredAlbum.fileCount === 1 ? "" : "s"}
              {hoveredAlbum.durationMs != null ? ` · ${formatTime(hoveredAlbum.durationMs)}` : ""} ·{" "}
              {hoveredAlbum.formats.join("/")}
            </span>
          </div>
        ) : null}
        {albums.map((album, index) => {
          const depth = index - linePosition;
          // Keep a generous window mounted on both sides of the position so
          // artwork is not unloaded and re-decoded while scrubbing back and
          // forth, while still staying bounded for very large libraries.
          if (depth < -30 || depth > ALBUM_FLOW_TAIL + 8) {
            return null;
          }

          const isFeatured = hoveredId === album.id;
          const offsets = lineOffsets(depth);
          const fade =
            depth < 0 ? Math.max(0, 1 + depth * 0.85) : Math.min(1, Math.max(0, (ALBUM_FLOW_TAIL + 1 - depth) / 9));
          const lineTransform = `translate(-50%, -50%) translate3d(${Math.round(offsets.x)}px, ${Math.round(
            offsets.y
          )}px, ${Math.round(offsets.z)}px) rotateY(-32deg)`;
          const interactive = depth >= 0 && fade >= 0.15;
          // Two elements per album: a visual that animates between the line
          // and the featured spot, and an invisible hit-area button that never
          // leaves the line, so hover focus stays stable while covers move.
          return (
            <Fragment key={album.id}>
              <div
                aria-hidden="true"
                className={isFeatured ? "albumFlowItem featured" : "albumFlowItem"}
                style={{
                  transform: isFeatured ? featuredTransform : lineTransform,
                  opacity: isFeatured ? 1 : fade,
                  zIndex: isFeatured ? 1000 : 500 - Math.round(depth * 10),
                  pointerEvents: isFeatured ? "auto" : "none"
                }}
                onClick={isFeatured ? () => onOpenAlbum(album) : undefined}
                onMouseEnter={isFeatured ? () => keepHovered(album.id) : undefined}
                onMouseLeave={isFeatured ? () => releaseHovered(album.id) : undefined}
              >
                {isFeatured ? <span aria-hidden="true" className="albumFlowSpotlight" /> : null}
                <Artwork className="albumFlowArt" eager src={artworkAlbumUrl(album.id)} />
              </div>
              {interactive ? (
                <button
                  aria-label={`${album.album} by ${album.artist}`}
                  className="albumFlowHit"
                  type="button"
                  style={{
                    transform: lineTransform,
                    zIndex: 900 - Math.round(depth * 10)
                  }}
                  onBlur={() => releaseHovered(album.id)}
                  onClick={() => onOpenAlbum(album)}
                  onFocus={() => keepHovered(album.id)}
                  onMouseEnter={() => keepHovered(album.id)}
                  onMouseLeave={() => releaseHovered(album.id)}
                />
              ) : null}
            </Fragment>
          );
        })}
        {panelAlbum ? (
          <aside
            aria-hidden={!hoveredAlbum}
            aria-label={`Tracks on ${panelAlbum.album}`}
            className={hoveredAlbum ? "albumFlowTracks visible" : "albumFlowTracks"}
            onMouseEnter={() => keepHovered(panelAlbum.id)}
            onMouseLeave={() => releaseHovered(panelAlbum.id)}
          >
            <header>
              Tracks · {panelAlbum.files.length}
            </header>
            <ol>
              {panelAlbum.files.map((file, trackIndex) => (
                <li key={file.id}>
                  <span className="albumFlowTrackIndex">{trackIndex + 1}</span>
                  <span className="albumFlowTrackTitle">{file.displayTags["title"] ?? file.filename}</span>
                  <span className="albumFlowTrackTime">
                    {file.durationMs != null ? formatTime(file.durationMs) : ""}
                  </span>
                </li>
              ))}
            </ol>
          </aside>
        ) : null}
      </div>
      <div className="albumFlowControls">
        <input
          aria-label="Scroll through albums"
          max={maxIndex}
          min={0}
          step={0.01}
          type="range"
          value={linePosition}
          onChange={(event) => handleSliderChange(Number(event.target.value))}
        />
        <span>
          {albums.length === 0 ? "0 / 0" : `${Math.min(Math.round(linePosition) + 1, albums.length)} / ${albums.length}`}
        </span>
      </div>
    </section>
  );
}

function ArtistsView({
  albumsState,
  currentWaveform,
  initialTarget,
  loadingMore,
  playback,
  playbackBusy,
  resetKey,
  onEnqueuePlayback,
  onLoadMore,
  onPlayAlbum,
  onPlayFile
}: {
  albumsState: AlbumsState;
  currentWaveform: WaveformSummaryResponse | null;
  initialTarget: ArtistViewTarget | null;
  loadingMore: boolean;
  playback: PlaybackStateResponse;
  playbackBusy: boolean;
  resetKey: number;
  onEnqueuePlayback(fileIds: string[], position: QueueInsertPosition): Promise<void>;
  onLoadMore(): Promise<void>;
  onPlayAlbum(albumId: string): Promise<void>;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
}): ReactElement {
  const albums = "albums" in albumsState ? albumsState.albums.albums : [];
  const [artistGroupMode, setArtistGroupMode] = useState<AlbumGroupMode>("all");
  const [artistSortMode, setArtistSortMode] = useState<ArtistSortMode>("artist");
  const sortedAlbums = useMemo(() => sortAlbumsByArtistAlbum(albums), [albums]);
  const [facetFilter, setFacetFilter] = useState<AlbumFacetFilter>({ genre: "all", decade: "all" });
  const albumFacets = useMemo(() => getAlbumFacets(sortedAlbums), [sortedAlbums]);
  const filteredAlbums = useMemo(() => filterAlbumsByFacet(sortedAlbums, facetFilter), [facetFilter, sortedAlbums]);
  const artistSections = useMemo(() => sortArtistSections(groupAlbumsByArtist(filteredAlbums), artistSortMode), [artistSortMode, filteredAlbums]);
  const groupedArtistSections = useMemo(() => groupArtistSectionsByMode(artistSections, artistGroupMode), [artistGroupMode, artistSections]);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selectedAlbum = useMemo(() => sortedAlbums.find((album) => album.id === selectedAlbumId) ?? null, [selectedAlbumId, sortedAlbums]);
  const selectedArtistAlbums = useMemo(
    () => (selectedArtist ? sortedAlbums.filter((album) => album.artist === selectedArtist) : []),
    [selectedArtist, sortedAlbums]
  );
  const hasMoreAlbums = "albums" in albumsState && albumsState.albums.albums.length < albumsState.albums.total;

  useEffect(() => {
    setSelectedArtist(null);
    setSelectedAlbumId(null);
    setSelectedFileId(null);
  }, [resetKey]);

  useEffect(() => {
    if (!initialTarget) {
      return;
    }

    setSelectedArtist(initialTarget.artist);
    setSelectedAlbumId(null);
    setSelectedFileId(null);
  }, [initialTarget]);

  function openArtist(artist: string): void {
    setSelectedArtist(artist);
    setSelectedAlbumId(null);
    setSelectedFileId(null);
  }

  function openAlbum(album: AlbumGroupItem): void {
    setSelectedAlbumId(album.id);
    setSelectedArtist(null);
    setSelectedFileId(album.files[0]?.id ?? null);
  }

  return (
    <>
      {albumsState.status === "error" ? <div className="inlineError">{albumsState.message}</div> : null}
      {selectedAlbum ? (
        <AlbumDetailView
          album={selectedAlbum}
          currentWaveform={currentWaveform}
          playback={playback}
          playbackBusy={playbackBusy}
          selectedFileId={selectedFileId}
          onBack={() => {
            setSelectedAlbumId(null);
            setSelectedFileId(null);
          }}
          onOpenArtist={openArtist}
          onEnqueuePlayback={onEnqueuePlayback}
          onPlayAlbum={onPlayAlbum}
          onPlayFile={onPlayFile}
          onSelectFile={setSelectedFileId}
        />
      ) : selectedArtist ? (
        <ArtistDetailView
          albums={selectedArtistAlbums}
          artist={selectedArtist}
          playbackBusy={playbackBusy}
          onEnqueuePlayback={onEnqueuePlayback}
          onBack={() => setSelectedArtist(null)}
          onOpenAlbum={openAlbum}
          onPlayFile={onPlayFile}
        />
      ) : artistSections.length === 0 ? (
        <div className="emptyState">
          {albumsState.status === "loading" ? "Loading artists." : "No artists found. Scan files with artist tags first."}
        </div>
      ) : (
        <>
          <div className="albumViewToolbar" aria-label="Artist view controls">
            <div>
              <strong>{artistSections.length.toLocaleString()} loaded artists</strong>
              <span>{filteredAlbums.length.toLocaleString()} of {albumsState.status === "ready" ? albumsState.albums.total.toLocaleString() : filteredAlbums.length.toLocaleString()} albums</span>
            </div>
            <div className="albumViewToolbarControls">
              <SortSelect<ArtistSortMode>
                ariaLabel="Artist sort"
                value={artistSortMode}
                options={[
                  { value: "artist", label: "Artist name" },
                  { value: "recent", label: "Recently added" },
                  { value: "listens", label: "Most listens" },
                  { value: "likes", label: "Most likes" },
                  { value: "rating", label: "Highest rating" }
                ]}
                onChange={setArtistSortMode}
              />
              <AlbumFacetControls
                facets={albumFacets}
                filter={facetFilter}
                groupMode={artistGroupMode}
                groupModes={["all", "genre", "decade"]}
                onFilterChange={setFacetFilter}
                onGroupModeChange={setArtistGroupMode}
              />
            </div>
          </div>
          <PagedScrollSection className="artistIndexSections" hasMore={hasMoreAlbums} loading={loadingMore} onLoadMore={onLoadMore}>
            {groupedArtistSections.map((group) => (
              <section className="artistIndexSection" key={group.label}>
                {artistGroupMode === "all" ? null : (
                  <header>
                    <strong>{group.label}</strong>
                    <span>{group.sections.length.toLocaleString()} artist{group.sections.length === 1 ? "" : "s"}</span>
                  </header>
                )}
                <div className="artistsIndex">
                  {group.sections.map((section) => {
                    const previewAlbums = section.albums.slice(0, 3);
                    const fileCount = section.albums.reduce((total, album) => total + album.fileCount, 0);
                    const listenTimeMs = getAlbumsListenTimeMs(section.albums);
                    return (
                      <button className="artistIndexCard" key={section.artist} type="button" onClick={() => openArtist(section.artist)}>
                        <span className="artistIndexVisual" aria-hidden="true">
                          {previewAlbums.map((album, index) => (
                            <Artwork className={`artistIndexArt art${index + 1}`} key={album.id} src={artworkAlbumUrl(album.id)} />
                          ))}
                        </span>
                        <span className="artistIndexInfo">
                          <strong>{section.artist}</strong>
                          <small>
                            {section.albums.length.toLocaleString()} album{section.albums.length === 1 ? "" : "s"} ·{" "}
                            {fileCount.toLocaleString()} song{fileCount === 1 ? "" : "s"}
                          </small>
                          <small>{formatListenTime(listenTimeMs)}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {hasMoreAlbums ? <LoadMoreRow loading={loadingMore} loaded={albums.length} total={albumsState.albums.total} onLoadMore={onLoadMore} /> : null}
          </PagedScrollSection>
        </>
      )}
    </>
  );
}

function AlbumFacetControls({
  facets,
  filter,
  groupMode,
  groupModes,
  onFilterChange,
  onGroupModeChange
}: {
  facets: { genres: string[]; decades: string[] };
  filter: AlbumFacetFilter;
  groupMode: AlbumGroupMode;
  groupModes: AlbumGroupMode[];
  onFilterChange(filter: AlbumFacetFilter): void;
  onGroupModeChange(mode: AlbumGroupMode): void;
}): ReactElement {
  return (
    <div className="albumFacetControls">
      <div className="segmentedControl" role="group" aria-label="Group layout">
        {groupModes.map((mode) => (
          <button className={groupMode === mode ? "active" : ""} key={mode} type="button" onClick={() => onGroupModeChange(mode)}>
            {mode === "all" ? "All" : `By ${mode[0].toUpperCase()}${mode.slice(1)}`}
          </button>
        ))}
      </div>
      <label>
        <span>Genre</span>
        <StyledSelect
          ariaLabel="Genre"
          options={[{ value: "all", label: "All genres" }, ...facets.genres.map((genre) => ({ value: genre, label: genre }))]}
          value={filter.genre}
          onChange={(genre) => onFilterChange({ ...filter, genre })}
        />
      </label>
      <label>
        <span>Decade</span>
        <StyledSelect
          ariaLabel="Decade"
          options={[{ value: "all", label: "All decades" }, ...facets.decades.map((decade) => ({ value: decade, label: decade }))]}
          value={filter.decade}
          onChange={(decade) => onFilterChange({ ...filter, decade })}
        />
      </label>
    </div>
  );
}

function SortSelect<T extends string>({
  ariaLabel,
  options,
  value,
  onChange
}: {
  ariaLabel: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange(value: T): void;
}): ReactElement {
  return (
    <label className="sortSelectControl">
      <span>Sort</span>
      <StyledSelect<T> ariaLabel={ariaLabel} options={options} value={value} onChange={onChange} />
    </label>
  );
}

function NowPlayingModal({
  appearanceMode,
  files,
  playback,
  playbackBusy,
  onClose,
  onFavoriteStatus,
  onNext,
  onPauseResume,
  onPlayFile,
  onPrevious,
  onRating,
  onRepeatMode,
  onSeek,
  onOpenAlbumPage,
  onOpenArtistPage,
  onVolumeChange,
  visualizerFrameRef,
  waveformState
}: {
  appearanceMode: AppearanceMode;
  files: LibraryFile[];
  playback: PlaybackStateResponse;
  playbackBusy: boolean;
  onClose(): void;
  onFavoriteStatus(fileId: string, status: "liked" | "disliked" | "neutral"): Promise<void>;
  onNext(): Promise<void>;
  onPauseResume(): Promise<void>;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
  onPrevious(): Promise<void>;
  onRating(fileId: string, rating: number | null): Promise<void>;
  onRepeatMode(repeatMode: PlaybackRepeatMode): Promise<void>;
  onSeek(ratio: number): Promise<void>;
  onOpenAlbumPage(group: Pick<LibraryAlbumGroup, "artist" | "album" | "year">): void | Promise<void>;
  onOpenArtistPage(artist: string): void;
  onVolumeChange(value: string): Promise<void>;
  visualizerFrameRef: MutableRefObject<VisualizerFrameResponse | null>;
  waveformState: WaveformState;
}): ReactElement {
  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const currentFile = playback.currentFileId ? filesById.get(playback.currentFileId) ?? null : null;
  const displayTitle = currentFile?.displayTags.title ?? playback.currentDisplayName ?? "Nothing queued";
  const displayArtist = currentFile?.displayTags.artist ?? currentFile?.displayTags.albumartist ?? "Unknown Artist";
  const displayAlbum = currentFile?.displayTags.album ?? "Unknown Album";
  const albumTarget = currentFile ? getFileAlbumTarget(currentFile) : null;
  const artworkUrl = playback.currentFileId ? artworkFileUrl(playback.currentFileId) : null;
  const visualizerPalette = useArtworkVisualizerPalette(artworkUrl, appearanceMode);
  const visualizerStyle = useMemo<CSSProperties | undefined>(() => {
    if (!visualizerPalette) {
      return undefined;
    }
    return {
      "--acc": visualizerPalette.acc,
      "--acc-ink": visualizerPalette.accInk,
      "--acc-line": visualizerPalette.accLine,
      "--acc-dim": visualizerPalette.accDim
    } as CSSProperties;
  }, [visualizerPalette]);
  const queueFileIdsRef = useRef(playback.queue);
  const onPlayFileRef = useRef(onPlayFile);
  useEffect(() => {
    queueFileIdsRef.current = playback.queue;
    onPlayFileRef.current = onPlayFile;
  }, [onPlayFile, playback.queue]);
  const onQueueRowPlay = useMemo(
    () => (fileId: string) => {
      void onPlayFileRef.current(fileId, queueFileIdsRef.current);
    },
    []
  );
  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Now playing"
        aria-modal="true"
        className="nowPlayingOverlay"
        role="dialog"
        style={visualizerStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="overlayEdgeReveal left" aria-hidden="true" />
        <div className="overlayEdgeReveal right" aria-hidden="true" />
        <div className="nowPlayingCockpit">
          <VisualizerPanel
            frameRef={visualizerFrameRef}
            playback={playback}
            waveformState={waveformState}
          />
          <header className="overlayTopbar">
            <button className="modalClose secondary" type="button" onClick={onClose}>
              Close
            </button>
          </header>
          <div className="nowPlayingFocus">
            <div className="nowPlayingArtShell">
              {playback.currentFileId ? (
                <Artwork className="nowPlayingModalArt" src={artworkUrl} />
              ) : (
                <span className="nowPlayingModalArt placeholder">
                  <UiIcon name="album" />
                </span>
              )}
              <BeatSyncedAlbumGlow frameRef={visualizerFrameRef} playing={playback.status === "playing"} />
            </div>
            <div className="nowPlayingRightColumn">
              <div className="nowPlayingModalInfo">
                <span>{playback.status}</span>
                <h2>{displayTitle}</h2>
                <button
                  className="nowPlayingMetaLink artist"
                  disabled={!currentFile?.displayTags.artist}
                  type="button"
                  onClick={() => currentFile?.displayTags.artist ? onOpenArtistPage(currentFile.displayTags.artist) : undefined}
                >
                  {displayArtist}
                </button>
                <button
                  className="nowPlayingMetaLink album"
                  disabled={!albumTarget}
                  type="button"
                  onClick={() => albumTarget ? void onOpenAlbumPage(albumTarget) : undefined}
                >
                  {displayAlbum}
                </button>
                {currentFile ? (
                  <NowPlayingActions
                    file={currentFile}
                    variant="modal"
                    onFavoriteStatus={onFavoriteStatus}
                    onRating={onRating}
                  />
                ) : null}
              </div>
              <div className="focusSpectrum" aria-hidden="true">
                <SpectrumCanvas className="focusSpectrumCanvas" frameRef={visualizerFrameRef} mode="spectrum" playing={playback.status === "playing"} />
              </div>
            </div>
            <div className="overlayPlaybackControls">
              <div className="nowPlayingModalTime">
                <span>{formatTime(playback.positionMs)}</span>
                <button
                  aria-label="Seek playback"
                  className="modalProgressSeek"
                  disabled={playbackBusy || playback.status === "stopped" || !playback.durationMs || playback.durationMs <= 0}
                  type="button"
                  onClick={(event) => void onSeek(getPointerRatio(event.currentTarget, event.clientX))}
                >
                  <span className="progressRail">
                    <WaveformCanvas className="modalWaveformRailCanvas" playback={playback} variant="rail" waveform={waveformState.waveform} />
                    <div className="progressFill" key={playback.currentFileId ?? "stopped"} style={{ width: `${getProgressPercent(playback)}%` }} />
                  </span>
                </button>
                <span>{formatTime(playback.durationMs)}</span>
              </div>
              <div className="overlayControls">
                <RepeatControls
                  disabled={playbackBusy || playback.status === "stopped"}
                  repeatMode={playback.repeatMode}
                  variant="modal"
                  onRepeatMode={onRepeatMode}
                />
                <div className="transport modalTransport">
                  <button disabled={playbackBusy || playback.status === "stopped"} type="button" onClick={() => void onPrevious()}>
                    <TransportIcon shape="previous" />
                  </button>
                  <button className="tPlay" disabled={playbackBusy || playback.status === "stopped"} type="button" onClick={() => void onPauseResume()}>
                    <TransportIcon shape={playback.status === "playing" ? "pause" : "play"} />
                  </button>
                  <button disabled={playbackBusy || playback.status === "stopped"} type="button" onClick={() => void onNext()}>
                    <TransportIcon shape="next" />
                  </button>
                </div>
                <label className="volumeControl modal">
                  <span className="volumeIcon" aria-hidden="true">
                    <UiIcon name="volume" />
                  </span>
                  <input
                    aria-label="Playback volume"
                    max={100}
                    min={0}
                    type="range"
                    value={playback.volumePercent}
                    onChange={(event) => void onVolumeChange(event.target.value)}
                  />
                  <strong>{playback.volumePercent}</strong>
                </label>
              </div>
            </div>
          </div>
        </div>
        <NowPlayingQueue
          currentFileId={playback.currentFileId}
          filesById={filesById}
          queueFileIds={playback.queue}
          onPlayFile={onQueueRowPlay}
        />
      </section>
    </div>
  );
}

const NowPlayingQueue = memo(function NowPlayingQueue({
  currentFileId,
  filesById,
  queueFileIds,
  onPlayFile
}: {
  currentFileId: string | null;
  filesById: Map<string, LibraryFile>;
  queueFileIds: string[];
  onPlayFile(fileId: string): void;
}): ReactElement {
  const rowHeightPx = 58;
  const overscanRows = 6;
  const queueRowsRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef(0);
  const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 });
  const queueFiles = useMemo(
    () => queueFileIds.map((fileId) => filesById.get(fileId)).filter((file): file is LibraryFile => file != null),
    [filesById, queueFileIds]
  );
  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(viewport.scrollTop / rowHeightPx) - overscanRows);
    const count = Math.ceil(Math.max(viewport.height, rowHeightPx) / rowHeightPx) + overscanRows * 2;
    return {
      start,
      end: Math.min(queueFiles.length, start + count)
    };
  }, [queueFiles.length, viewport.height, viewport.scrollTop]);
  const visibleQueueFiles = useMemo(
    () => queueFiles.slice(visibleRange.start, visibleRange.end),
    [queueFiles, visibleRange.end, visibleRange.start]
  );
  const queueRows = useMemo(
    () => visibleQueueFiles.map((file, offset) => {
      const index = visibleRange.start + offset;
      return (
      <NowPlayingQueueRow
        active={file.id === currentFileId}
        file={file}
        index={index}
        key={`${file.id}-${index}`}
        onPlayFile={onPlayFile}
      />
      );
    }),
    [currentFileId, onPlayFile, visibleQueueFiles, visibleRange.start]
  );
  const updateViewport = useMemo(
    () => () => {
      const node = queueRowsRef.current;
      if (!node) {
        return;
      }
      setViewport((current) => {
        const next = { height: node.clientHeight, scrollTop: node.scrollTop };
        return current.height === next.height && current.scrollTop === next.scrollTop ? current : next;
      });
    },
    []
  );
  useEffect(() => {
    updateViewport();
    const node = queueRowsRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateViewport);
    observer.observe(node);
    return () => observer.disconnect();
  }, [updateViewport]);
  useEffect(() => () => window.cancelAnimationFrame(scrollFrameRef.current), []);
  const handleQueueScroll = () => {
    window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(updateViewport);
  };

  return (
    <aside className="nowPlayingQueue" aria-label="Up next">
      <header>
        <div>
          <strong>Up Next</strong>
          <span>{queueFileIds.length.toLocaleString()} item{queueFileIds.length === 1 ? "" : "s"}</span>
        </div>
      </header>
      <div className="queueRows" ref={queueRowsRef} onScroll={handleQueueScroll}>
        {queueFiles.length === 0 ? (
          <div className="emptyState">No queued songs.</div>
        ) : (
          <div className="queueRowsSpacer" style={{ height: `${queueFiles.length * rowHeightPx}px` }}>
            <div
              className="queueRowsWindow"
              style={{ transform: `translateY(${visibleRange.start * rowHeightPx}px)` }}
            >
              {queueRows}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}, areNowPlayingQueuePropsEqual);

function BeatSyncedAlbumGlow({
  frameRef,
  playing
}: {
  frameRef: MutableRefObject<VisualizerFrameResponse | null>;
  playing: boolean;
}): ReactElement {
  const glowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = glowRef.current;
    if (!node) {
      return;
    }
    let animationFrame = 0;
    let averageEnergy = 0;
    let pulse = 0;
    const draw = () => {
      const frame = frameRef.current;
      const bands = frame?.bands ?? [];
      const measuredBands = Math.max(1, Math.ceil(bands.length * 0.45));
      let bandTotal = 0;
      for (let index = 0; index < Math.min(bands.length, measuredBands); index += 1) {
        bandTotal += bands[index] ?? 0;
      }
      const bandEnergy = bands.length > 0 ? bandTotal / measuredBands : 0;
      const energy = playing
        ? Math.min(1, Math.max(frame?.rms ?? 0, (frame?.peak ?? 0) * 0.72, bandEnergy))
        : 0;
      averageEnergy = averageEnergy * 0.92 + energy * 0.08;
      const beat = Math.max(0, energy - averageEnergy);
      pulse = Math.max(beat * 3.6, pulse * 0.86);
      const clampedPulse = Math.min(1, pulse);
      node.style.setProperty("--beat-glow-blur", `${0.5 + clampedPulse * 0.32}rem`);
      node.style.setProperty("--beat-glow-opacity", (0.66 + clampedPulse * 0.26).toFixed(3));
      node.style.setProperty("--beat-glow-scale", (1 + clampedPulse * 0.065).toFixed(3));
      animationFrame = window.requestAnimationFrame(draw);
    };
    draw();
    return () => {
      window.cancelAnimationFrame(animationFrame);
      node.style.removeProperty("--beat-glow-blur");
      node.style.removeProperty("--beat-glow-opacity");
      node.style.removeProperty("--beat-glow-scale");
    };
  }, [frameRef, playing]);

  return <div className="artSignalGlow" aria-hidden="true" ref={glowRef} />;
}

function areNowPlayingQueuePropsEqual(
  previous: {
    currentFileId: string | null;
    filesById: Map<string, LibraryFile>;
    queueFileIds: string[];
    onPlayFile(fileId: string): void;
  },
  next: {
    currentFileId: string | null;
    filesById: Map<string, LibraryFile>;
    queueFileIds: string[];
    onPlayFile(fileId: string): void;
  }
): boolean {
  return previous.currentFileId === next.currentFileId &&
    previous.filesById === next.filesById &&
    previous.onPlayFile === next.onPlayFile &&
    areStringArraysEqual(previous.queueFileIds, next.queueFileIds);
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

const NowPlayingQueueRow = memo(function NowPlayingQueueRow({
  active,
  file,
  index,
  onPlayFile
}: {
  active: boolean;
  file: LibraryFile;
  index: number;
  onPlayFile(fileId: string): void;
}): ReactElement {
  return (
    <button
      className={active ? "queueRow active" : "queueRow"}
      type="button"
      onClick={() => onPlayFile(file.id)}
    >
      <span>{index + 1}</span>
      <Artwork className="queueArt" src={artworkFileUrl(file.id)} />
      <span>
        <strong>{file.displayTags.title ?? file.filename}</strong>
        <small>
          {file.displayTags.artist ?? file.displayTags.albumartist ?? "Unknown Artist"} - {file.displayTags.album ?? "Unknown Album"}
        </small>
      </span>
      <small>{file.durationMs == null ? "-" : formatTime(file.durationMs)}</small>
    </button>
  );
});

function AlbumDetailView({
  album,
  currentWaveform,
  playback,
  playbackBusy,
  selectedFileId,
  onBack,
  onEnqueuePlayback,
  onOpenArtist,
  onPlayAlbum,
  onPlayFile,
  onSelectFile
}: {
  album: AlbumGroupItem;
  currentWaveform: WaveformSummaryResponse | null;
  playback: PlaybackStateResponse;
  playbackBusy: boolean;
  selectedFileId: string | null;
  onBack(): void;
  onEnqueuePlayback(fileIds: string[], position: QueueInsertPosition): Promise<void>;
  onOpenArtist(artist: string): void;
  onPlayAlbum(albumId: string): Promise<void>;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
  onSelectFile(fileId: string): void;
}): ReactElement {
  const selectedFile = album.files.find((file) => file.id === selectedFileId) ?? album.files[0] ?? null;
  const albumQueueFileIds = useMemo(() => album.files.map((file) => file.id), [album.files]);

  return (
    <section className="albumDetailView" aria-label={`${album.album} album detail`}>
      <div className="detailNav">
        <button className="secondary" type="button" onClick={onBack}>
          Back to Albums
        </button>
      </div>
      <div className="albumDetailShell">
        <aside className="albumDetailInfo">
          <Artwork className="albumDetailArt" src={artworkAlbumUrl(album.id)} />
          <div>
            <h2>{album.album}</h2>
            <button className="artistLink" type="button" onClick={() => onOpenArtist(album.artist)}>
              {album.artist}
            </button>
          </div>
          <dl className="albumFacts">
            <div>
              <dt>Year</dt>
              <dd>{album.year ?? "-"}</dd>
            </div>
            <div>
              <dt>Tracks</dt>
              <dd>{album.fileCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{album.durationMs == null ? "-" : formatTime(album.durationMs)}</dd>
            </div>
            <div>
              <dt>Listen Time</dt>
              <dd>{formatListenTime(getAlbumListenTimeMs(album))}</dd>
            </div>
            <div>
              <dt>Formats</dt>
              <dd>{album.formats.join("/")}</dd>
            </div>
          </dl>
          <div className="albumDetailQueueActions">
            <button
              aria-label={`Play ${album.album}`}
              className="albumDetailPlay"
              disabled={playbackBusy || album.files.length === 0}
              title="Play album"
              type="button"
              onClick={() => void onPlayAlbum(album.id)}
            >
              <TransportIcon shape="play" />
            </button>
            <button disabled={playbackBusy || album.files.length === 0} type="button" onClick={() => void onEnqueuePlayback(albumQueueFileIds, "up_next")}>
              Up Next
            </button>
            <button disabled={playbackBusy || album.files.length === 0} type="button" onClick={() => void onEnqueuePlayback(albumQueueFileIds, "end")}>
              Add Queue
            </button>
          </div>
        </aside>
        <div className="albumDetailTracks">
          <div className="albumDetailTrackHeader">
            <span></span>
            <span>#</span>
            <span>Title</span>
            <span>Length</span>
            <span>Rating</span>
            <span>Listens</span>
            <span>Format</span>
          </div>
          {album.files.map((file) => {
            const tags = file.displayTags;
            const isCurrent = playback.currentFileId === file.id;
            const isSelected = selectedFile?.id === file.id;
            return (
              <div
                className={[
                  "albumDetailTrack",
                  isSelected ? "active" : "",
                  isCurrent ? "playing" : ""
                ].filter(Boolean).join(" ")}
                key={file.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectFile(file.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectFile(file.id);
                  }
                }}
              >
                <span className="rowPlayActions">
                  <button
                    aria-label={`${isCurrent && playback.status === "playing" ? "Pause" : "Play"} ${tags.title ?? file.filename}`}
                    className="rowPlay"
                    disabled={playbackBusy}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onPlayFile(file.id, albumQueueFileIds);
                    }}
                  >
                    <TransportIcon shape={isCurrent && playback.status === "playing" ? "pause" : "play"} />
                  </button>
                  <QueueMenuButton
                    disabled={playbackBusy}
                    fileIds={[file.id]}
                    label={tags.title ?? file.filename}
                    onEnqueue={onEnqueuePlayback}
                  />
                </span>
                <span>{formatTrackNumber(file)}</span>
                <span className="trackTitleCell detailTrackTitle" title={file.path}>
                  <strong>{tags.title ?? file.filename}</strong>
                  {isCurrent ? <MiniTrackWaveform playback={playback} waveform={currentWaveform} /> : null}
                </span>
                <span>{file.durationMs == null ? "-" : formatTime(file.durationMs)}</span>
                <span>{file.rating == null ? "-" : `${file.rating}/5`}</span>
                <span>{formatListenStats(file)}</span>
                <span>{formatFileFormat(file) || file.extension.toUpperCase()}</span>
              </div>
            );
          })}
        </div>
        {selectedFile ? <SongInfoPanel file={selectedFile} onOpenArtist={onOpenArtist} /> : null}
      </div>
    </section>
  );
}

function SongInfoPanel({ file, onOpenArtist }: { file: LibraryFile; onOpenArtist(artist: string): void }): ReactElement {
  const rows = getSongInfoRows(file);
  const artist = file.displayTags.artist ?? file.displayTags.albumartist ?? null;
  return (
    <aside className="songInfoPanel" aria-label="Song file information">
      <div>
        <span>Selected Track</span>
        <h2>{file.displayTags.title ?? file.filename}</h2>
        {artist ? (
          <button className="artistLink" type="button" onClick={() => onOpenArtist(artist)}>
            {artist}
          </button>
        ) : null}
      </div>
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td title={row.value}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

function ArtistDetailView({
  albums,
  artist,
  playbackBusy,
  onEnqueuePlayback,
  onBack,
  onOpenAlbum,
  onPlayFile
}: {
  albums: AlbumGroupItem[];
  artist: string;
  playbackBusy: boolean;
  onEnqueuePlayback(fileIds: string[], position: QueueInsertPosition): Promise<void>;
  onBack(): void;
  onOpenAlbum(album: AlbumGroupItem): void;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
}): ReactElement {
  const songs = useMemo(() => albums.flatMap((album) => album.files), [albums]);
  const [songSortMode, setSongSortMode] = useState<ArtistSongSortMode>("listens");
  const albumByFileId = useMemo(() => {
    const albumMap = new Map<string, { album: AlbumGroupItem; albumIndex: number }>();
    albums.forEach((album, albumIndex) => {
      album.files.forEach((file) => {
        albumMap.set(file.id, { album, albumIndex });
      });
    });
    return albumMap;
  }, [albums]);
  const topSongs = useMemo(
    () => [...songs].sort((left, right) => compareArtistSongs(left, right, songSortMode, albumByFileId)),
    [albumByFileId, songSortMode, songs]
  );
  const topSongQueueFileIds = useMemo(() => topSongs.map((file) => file.id), [topSongs]);
  const heroAlbum = albums[0] ?? null;
  const heroAlbums = albums.slice(0, 6);
  const totalListenTimeMs = useMemo(() => getAlbumsListenTimeMs(albums), [albums]);

  return (
    <section className="artistDetailView" aria-label={`${artist} artist detail`}>
      <div className="artistHero">
        {heroAlbum ? <Artwork className="artistHeroFallback" src={artworkAlbumUrl(heroAlbum.id)} /> : null}
        <div className="artistHeroAlbums" aria-hidden="true">
          {heroAlbums.map((album, index) => (
            <ArtistHeroAlbumArtwork album={album} index={index} key={album.id} total={heroAlbums.length} />
          ))}
        </div>
        <div className="artistHeroContent">
          <button className="secondary" type="button" onClick={onBack}>
            Back to Artists
          </button>
          <h2>{artist}</h2>
          <span>
            {albums.length.toLocaleString()} album{albums.length === 1 ? "" : "s"} · {songs.length.toLocaleString()} indexed song
            {songs.length === 1 ? "" : "s"} · {formatListenTime(totalListenTimeMs)}
          </span>
        </div>
      </div>
      <div className="artistDetailGrid">
        <section>
          <h3>Albums</h3>
          <div className="artistAlbumList">
            {albums.map((album) => (
              <button key={album.id} type="button" onClick={() => onOpenAlbum(album)}>
                <Artwork className="artistAlbumThumb" src={artworkAlbumUrl(album.id)} />
                <span>
                  <strong>{album.album}</strong>
                  <small>
                    {album.year ?? "-"} · {album.fileCount} track{album.fileCount === 1 ? "" : "s"} ·{" "}
                    {album.durationMs == null ? "-" : formatTime(album.durationMs)} · {album.formats.join("/")} ·{" "}
                    {formatListenTime(getAlbumListenTimeMs(album))}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <div className="artistSongHeader">
            <div>
              <h3>Top Songs</h3>
              <span>{topSongs.length.toLocaleString()} song{topSongs.length === 1 ? "" : "s"}</span>
            </div>
            <div className="segmentedControl compact" role="group" aria-label="Sort artist songs">
              <button
                className={songSortMode === "listens" ? "active" : ""}
                type="button"
                onClick={() => setSongSortMode("listens")}
              >
                Listens
              </button>
              <button
                className={songSortMode === "ranking" ? "active" : ""}
                type="button"
                onClick={() => setSongSortMode("ranking")}
              >
                Ranking
              </button>
              <button
                className={songSortMode === "albumYear" ? "active" : ""}
                type="button"
                onClick={() => setSongSortMode("albumYear")}
              >
                Album Year
              </button>
            </div>
          </div>
          <div className="artistSongList">
            {topSongs.map((file) => (
              <div className="artistSongItem" key={file.id}>
                <button
                  aria-label={`Play ${file.displayTags.title ?? file.filename}`}
                  className="rowPlay"
                  disabled={playbackBusy}
                  type="button"
                  onClick={() => void onPlayFile(file.id, topSongQueueFileIds)}
                >
                  <TransportIcon shape="play" />
                </button>
                <Artwork className="artistSongThumb" src={artworkFileUrl(file.id)} />
                <span>
                  <strong title={file.path}>{file.displayTags.title ?? file.filename}</strong>
                  <small>
                    {file.displayTags.album ?? "Unknown Album"} · rating {file.rating ?? "-"} · plays {file.playCount.toLocaleString()}
                    {file.liked ? " · liked" : ""}
                  </small>
                </span>
                <QueueMenuButton
                  disabled={playbackBusy}
                  fileIds={[file.id]}
                  label={file.displayTags.title ?? file.filename}
                  onEnqueue={onEnqueuePlayback}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function PlaylistsView({
  currentWaveform,
  playback,
  playbackBusy,
  selectedPlaylist,
  playlistsState,
  onBack,
  onEnqueuePlayback,
  onOpenAlbumPage,
  onOpenArtistPage,
  onOpenPlaylist,
  onPlayFile,
  onPlayFileIdsShuffled,
  onPlayPlaylist,
  onProposeDeletePlaylist,
  onProposeUpdatePlaylist,
  onProposeRemoveItem
}: {
  currentWaveform: WaveformSummaryResponse | null;
  playback: PlaybackStateResponse;
  playbackBusy: boolean;
  selectedPlaylist: Playlist | null;
  playlistsState: PlaylistsState;
  onBack(): void;
  onEnqueuePlayback(fileIds: string[], position: QueueInsertPosition): Promise<void>;
  onOpenAlbumPage(group: Pick<LibraryAlbumGroup, "artist" | "album" | "year">): void | Promise<void>;
  onOpenArtistPage(artist: string): void;
  onOpenPlaylist(playlistId: string): void;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
  onPlayFileIdsShuffled(fileIds: string[]): Promise<void>;
  onPlayPlaylist(playlistId: string): Promise<void>;
  onProposeDeletePlaylist(playlist: Playlist): Promise<void>;
  onProposeUpdatePlaylist(playlistId: string, updates: { name: string; description: string | null }): Promise<void>;
  onProposeRemoveItem(playlistId: string, itemId: string): Promise<void>;
}): ReactElement {
  const playlists = "playlists" in playlistsState ? playlistsState.playlists : [];

  if (selectedPlaylist) {
    return (
      <PlaylistDetailView
        currentWaveform={currentWaveform}
        playback={playback}
        playbackBusy={playbackBusy}
        playlist={selectedPlaylist}
        onBack={onBack}
        onEnqueuePlayback={onEnqueuePlayback}
        onOpenAlbumPage={onOpenAlbumPage}
        onOpenArtistPage={onOpenArtistPage}
        onPlayFile={onPlayFile}
        onPlayFileIdsShuffled={onPlayFileIdsShuffled}
        onPlayPlaylist={onPlayPlaylist}
        onProposeDeletePlaylist={onProposeDeletePlaylist}
        onProposeUpdatePlaylist={onProposeUpdatePlaylist}
        onProposeRemoveItem={onProposeRemoveItem}
      />
    );
  }

  return (
    <section className="playlistsPage" aria-label="Playlists overview">
      {playlistsState.status === "error" ? <div className="inlineError">{playlistsState.message}</div> : null}
      <section className="playlistList" aria-label="Playlists">
        {playlists.length === 0 ? (
          <div className="emptyState">
            {playlistsState.status === "loading"
              ? "Loading playlists."
              : "No playlists yet. Ask the agent to propose one, then approve and apply the operation batch."}
          </div>
        ) : (
          playlists.map((playlist) => (
            <PlaylistOverviewCard
              key={playlist.id}
              playbackBusy={playbackBusy}
              playlist={playlist}
              onOpenPlaylist={onOpenPlaylist}
              onPlayFileIdsShuffled={onPlayFileIdsShuffled}
              onPlayPlaylist={onPlayPlaylist}
              onProposeDeletePlaylist={onProposeDeletePlaylist}
            />
          ))
        )}
      </section>
    </section>
  );
}

function PlaylistOverviewCard({
  playbackBusy,
  playlist,
  onOpenPlaylist,
  onPlayFileIdsShuffled,
  onPlayPlaylist,
  onProposeDeletePlaylist
}: {
  playbackBusy: boolean;
  playlist: Playlist;
  onOpenPlaylist(playlistId: string): void;
  onPlayFileIdsShuffled(fileIds: string[]): Promise<void>;
  onPlayPlaylist(playlistId: string): Promise<void>;
  onProposeDeletePlaylist(playlist: Playlist): Promise<void>;
}): ReactElement {
  const previewItems = playlist.items.slice(0, 4);
  const playlistFileIds = useMemo(() => playlist.items.map((item) => item.file.id), [playlist.items]);
  const leadItem = previewItems[0] ?? null;
  const leadTitle = leadItem ? leadItem.file.displayTags.title ?? leadItem.file.filename : "No tracks";
  const leadArtist = leadItem ? leadItem.file.displayTags.artist ?? leadItem.file.displayTags.albumartist ?? "Unknown Artist" : "Add tracks from Library";

  return (
    <article className="playlistItem">
      <button className="playlistOpenButton" type="button" onClick={() => onOpenPlaylist(playlist.id)}>
        <span className="playlistCoverStack" aria-hidden="true">
          {previewItems.slice(0, 3).map((item, index) => (
            <Artwork className={`playlistCoverArt slot${index + 1}`} key={item.id} src={artworkFileUrl(item.file.id)} />
          ))}
          {previewItems.length === 0 ? <Artwork className="playlistCoverArt slot1" src={null} /> : null}
        </span>
        <span className="playlistMain">
          <span className="playlistKicker">
            {playlist.items.length.toLocaleString()} track{playlist.items.length === 1 ? "" : "s"} · {playlist.type}
          </span>
          <strong>{playlist.name}</strong>
          <span>{playlist.description ?? `${leadTitle} · ${leadArtist}`}</span>
        </span>
      </button>
      <div className="playlistPreviewTracks">
        {previewItems.map((item) => {
          const tags = item.file.displayTags;
          return (
            <span key={item.id}>
              {item.position + 1}. {tags.title ?? item.file.filename}
            </span>
          );
        })}
      </div>
      <div className="playlistActions">
        <button className="secondary" type="button" onClick={() => onOpenPlaylist(playlist.id)}>
          View
        </button>
        <button disabled={playbackBusy || playlist.items.length === 0} type="button" onClick={() => void onPlayPlaylist(playlist.id)}>
          Play
        </button>
        <button
          className="secondary"
          disabled={playbackBusy || playlist.items.length === 0}
          title="Shuffle play"
          type="button"
          onClick={() => void onPlayFileIdsShuffled(playlistFileIds)}
        >
          <TransportIcon shape="shuffle" />
          Shuffle
        </button>
        <button className="dangerButton" type="button" onClick={() => void onProposeDeletePlaylist(playlist)}>
          Delete
        </button>
      </div>
    </article>
  );
}

function PlaylistDetailView({
  currentWaveform,
  playback,
  playbackBusy,
  playlist,
  onBack,
  onEnqueuePlayback,
  onOpenAlbumPage,
  onOpenArtistPage,
  onPlayFile,
  onPlayFileIdsShuffled,
  onPlayPlaylist,
  onProposeDeletePlaylist,
  onProposeUpdatePlaylist,
  onProposeRemoveItem
}: {
  currentWaveform: WaveformSummaryResponse | null;
  playback: PlaybackStateResponse;
  playbackBusy: boolean;
  playlist: Playlist;
  onBack(): void;
  onEnqueuePlayback(fileIds: string[], position: QueueInsertPosition): Promise<void>;
  onOpenAlbumPage(group: Pick<LibraryAlbumGroup, "artist" | "album" | "year">): void | Promise<void>;
  onOpenArtistPage(artist: string): void;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
  onPlayFileIdsShuffled(fileIds: string[]): Promise<void>;
  onPlayPlaylist(playlistId: string): Promise<void>;
  onProposeDeletePlaylist(playlist: Playlist): Promise<void>;
  onProposeUpdatePlaylist(playlistId: string, updates: { name: string; description: string | null }): Promise<void>;
  onProposeRemoveItem(playlistId: string, itemId: string): Promise<void>;
}): ReactElement {
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? "");
  const changed = name.trim() !== playlist.name || description.trim() !== (playlist.description ?? "");
  const totalDurationMs = playlist.items.reduce((sum, item) => sum + (item.file.durationMs ?? 0), 0);
  const playlistQueueFileIds = useMemo(() => playlist.items.map((item) => item.file.id), [playlist.items]);

  useEffect(() => {
    setName(playlist.name);
    setDescription(playlist.description ?? "");
  }, [playlist.description, playlist.id, playlist.name]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || !changed) {
      return;
    }
    await onProposeUpdatePlaylist(playlist.id, {
      name: nextName,
      description: description.trim() || null
    });
  }

  return (
    <section className="playlistDetailView" aria-label={`${playlist.name} playlist detail`}>
      <div className="detailNav">
        <button className="secondary" type="button" onClick={onBack}>
          Back to Playlists
        </button>
      </div>
      <div className="playlistDetailShell">
        <aside className="playlistDetailInfo">
          <div className="playlistDetailArtwork" aria-hidden="true">
            {playlist.items.slice(0, 4).map((item, index) => (
              <Artwork className={`playlistDetailArt slot${index + 1}`} key={item.id} src={artworkFileUrl(item.file.id)} eager={index === 0} />
            ))}
            {playlist.items.length === 0 ? <Artwork className="playlistDetailArt slot1" src={null} /> : null}
          </div>
          <div>
            <span className="eyebrow">{playlist.createdBy} · {playlist.type}</span>
            <h2>{playlist.name}</h2>
            {playlist.description ? <p>{playlist.description}</p> : <p>No description yet.</p>}
          </div>
          <dl className="albumFacts">
            <div>
              <dt>Tracks</dt>
              <dd>{playlist.items.length.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{totalDurationMs > 0 ? formatTime(totalDurationMs) : "-"}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{playlist.createdBy}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{playlist.type}</dd>
            </div>
          </dl>
          <div className="albumDetailQueueActions">
            <button
              aria-label={`Play ${playlist.name}`}
              className="albumDetailPlay"
              disabled={playbackBusy || playlist.items.length === 0}
              title="Play playlist"
              type="button"
              onClick={() => void onPlayPlaylist(playlist.id)}
            >
              <TransportIcon shape="play" />
            </button>
            <button
              disabled={playbackBusy || playlist.items.length === 0}
              title="Shuffle play"
              type="button"
              onClick={() => void onPlayFileIdsShuffled(playlistQueueFileIds)}
            >
              <TransportIcon shape="shuffle" />
              Shuffle
            </button>
            <button disabled={playbackBusy || playlist.items.length === 0} type="button" onClick={() => void onEnqueuePlayback(playlistQueueFileIds, "up_next")}>
              Up Next
            </button>
            <button disabled={playbackBusy || playlist.items.length === 0} type="button" onClick={() => void onEnqueuePlayback(playlistQueueFileIds, "end")}>
              Add Queue
            </button>
          </div>
          <button className="dangerButton" type="button" onClick={() => void onProposeDeletePlaylist(playlist)}>
            Delete Playlist
          </button>
        </aside>
        <div className="playlistDetailPanel">
          <form className="playlistEditForm" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              <span>Name</span>
              <input aria-label="Playlist name" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>Description</span>
              <input
                aria-label="Playlist description"
                placeholder="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <button disabled={!changed || !name.trim()} type="submit">
              Propose Edit
            </button>
          </form>
          <div className="playlistTracks" role="list" aria-label="Playlist tracks">
            {playlist.items.length === 0 ? <div className="emptyState">This playlist has no tracks.</div> : null}
            {playlist.items.map((item) => {
            const tags = item.file.displayTags;
            const isCurrent = playback.currentFileId === item.file.id;
            const trackArtist = tags.artist ?? tags.albumartist ?? null;
            const trackAlbum = tags.album ?? null;
            const trackYear = tags.year ?? tags.date ?? null;
            return (
              <div className={isCurrent ? "playlistTrackRow active" : "playlistTrackRow"} key={item.id} role="listitem">
                <span className="rowPlayActions">
                  <button
                    aria-label={`Play ${tags.title ?? item.file.filename}`}
                    className="rowPlay"
                    disabled={playbackBusy}
                    type="button"
                    onClick={() => void onPlayFile(item.file.id, playlistQueueFileIds)}
                  >
                    <TransportIcon shape={isCurrent && playback.status === "playing" ? "pause" : "play"} />
                  </button>
                  <QueueMenuButton
                    disabled={playbackBusy}
                    fileIds={[item.file.id]}
                    label={tags.title ?? item.file.filename}
                    onEnqueue={onEnqueuePlayback}
                  />
                </span>
                <Artwork className="playlistTrackArt" src={artworkFileUrl(item.file.id)} />
                <span>
                  <strong title={item.file.path}>{tags.title ?? item.file.filename}</strong>
                  {isCurrent ? <MiniTrackWaveform playback={playback} waveform={currentWaveform} /> : null}
                  <small>
                    {trackArtist ? (
                      <button type="button" onClick={() => onOpenArtistPage(trackArtist)}>
                        {trackArtist}
                      </button>
                    ) : (
                      <span>Unknown Artist</span>
                    )}
                    <span aria-hidden="true">·</span>
                    {trackArtist && trackAlbum ? (
                      <button type="button" onClick={() => void onOpenAlbumPage({ artist: trackArtist, album: trackAlbum, year: trackYear })}>
                        {trackAlbum}
                      </button>
                    ) : (
                      <span>{trackAlbum ?? "Unknown Album"}</span>
                    )}
                  </small>
                </span>
                <span>{item.file.durationMs == null ? "-" : formatTime(item.file.durationMs)}</span>
                <button className="secondary" type="button" onClick={() => void onProposeRemoveItem(playlist.id, item.id)}>
                  Remove
                </button>
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentView({
  agentBusy,
  agentInput,
  activeThreadId,
  messages,
  threads,
  setAgentInput,
  onNewThread,
  onSelectThread,
  onSubmit
}: {
  agentBusy: boolean;
  agentInput: string;
  activeThreadId: string | null;
  messages: AgentMessage[];
  threads: AgentThreadsResponse["threads"];
  setAgentInput(value: string): void;
  onNewThread(): Promise<void>;
  onSelectThread(threadId: string): Promise<void>;
  onSubmit(event: FormEvent<HTMLFormElement>): Promise<void>;
}): ReactElement {
  const promptExamples = ["find steely dan", "make a van halen playlist", "play traveling wilburys", "search soulseek city pop"];

  return (
    <section className="agentView" aria-label="Agent">
      <div className="agentThreadBar">
        <label>
          <span>Thread</span>
          <StyledSelect
            ariaLabel="Thread"
            disabled={agentBusy || threads.length === 0}
            options={threads.map((thread) => ({ value: thread.id, label: thread.title }))}
            value={activeThreadId ?? ""}
            onChange={(threadId) => void onSelectThread(threadId)}
          />
        </label>
        <button className="secondary" disabled={agentBusy} type="button" onClick={() => void onNewThread()}>
          New Thread
        </button>
      </div>
      <form className="agentComposer" onSubmit={(event) => void onSubmit(event)}>
        <input
          aria-label="Agent message"
          placeholder="Ask the agent to find tracks, make a playlist, or play matching songs"
          value={agentInput}
          onChange={(event) => setAgentInput(event.target.value)}
        />
        <button disabled={agentBusy || !agentInput.trim()} type="submit">
          Send
        </button>
      </form>
      <div className="agentQuickPrompts" aria-label="Example prompts">
        {promptExamples.map((prompt) => (
          <button disabled={agentBusy} key={prompt} type="button" onClick={() => setAgentInput(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
      <div className="agentTranscript">
        {messages.map((message) => (
          <div className={`agentMessage ${message.role}`} key={message.id}>
            <span>{message.role === "user" ? "You" : "Agent"}</span>
            <strong>{message.text}</strong>
            {message.role === "agent" && message.response ? (
              <AgentResultSummary response={message.response} run={message.run ?? null} />
            ) : null}
          </div>
        ))}
        {agentBusy ? (
          <div className="agentMessage agent">
            <span>Agent</span>
            <strong>Searching library.</strong>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AgentResultSummary({ response, run }: { response: AgentMessageResponse; run?: AgentRun | null }): ReactElement {
  const resultCount =
    response.intent === "search_discovery"
      ? response.discoveryResults.length
      : response.intent === "parse_pasted_list"
        ? response.parsedListItems.length
        : response.intent === "propose_import"
          ? response.importResults.length
        : response.results.length;
  return (
    <div className="agentResultSummary">
      <span>
        Tool: {response.intent} · Query: {response.searchQuery || "-"} · Results: {resultCount}
      </span>
      {response.operationBatch ? (
        <span>
          Proposed batch: {response.operationBatch.summary} · {response.operationBatch.status}
        </span>
      ) : null}
      {run && run.steps.length > 0 ? <AgentRunTrace run={run} /> : null}
      {response.researchSources && response.researchSources.length > 0 ? (
        <div className="agentResults">
          {response.researchSources.slice(0, 6).map((source) => (
            <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
              {source.title}
              {source.summary ? ` · ${source.summary}` : ""}
            </a>
          ))}
        </div>
      ) : null}
      {response.results.length > 0 ? (
        <div className="agentResults">
          {response.results.slice(0, 8).map((result) => (
            <span key={result.fileId}>
              {result.title} · {result.artist ?? "Unknown Artist"} · {result.album ?? "Unknown Album"}
            </span>
          ))}
        </div>
      ) : null}
      {response.discoveryGroups && response.discoveryGroups.length > 0 ? (
        <div className="agentResults">
          {response.discoveryGroups.slice(0, 6).map((group) => (
            <span key={`${group.releaseArtist ?? "unknown"}-${group.releaseTitle}`}>
              {group.releaseArtist ? `${group.releaseArtist} - ${group.releaseTitle}` : group.releaseTitle} ·{" "}
              {group.sourceCount} source{group.sourceCount === 1 ? "" : "s"} · {group.unlockedCount} unlocked ·{" "}
              {group.bestFormat ?? "file"} · owned matches {group.ownedMatchCount}
            </span>
          ))}
        </div>
      ) : null}
      {response.discoveryResults.length > 0 ? (
        <div className="agentResults">
          {response.discoveryResults.slice(0, 8).map((result) => (
            <span key={result.discoveryId}>
              {result.filename} · {result.username ?? "Unknown user"} · {result.extension?.toUpperCase() ?? "file"} ·{" "}
              {result.isLocked ? "locked" : "available"} · owned matches {result.ownedMatchCount}
            </span>
          ))}
        </div>
      ) : null}
      {response.parsedListItems.length > 0 ? (
        <div className="agentResults">
          {response.parsedListItems.slice(0, 8).map((item) => (
            <span key={`${item.rank ?? "item"}-${item.query}`}>
              {item.rank ? `${item.rank}. ` : ""}
              {item.artist ? `${item.artist} - ` : ""}
              {item.title}
              {item.year ? ` · ${item.year}` : ""} · owned matches {item.ownedMatchCount}
            </span>
          ))}
        </div>
      ) : null}
      {response.importResults.length > 0 ? (
        <div className="agentResults">
          {response.importResults.slice(0, 8).map((item) => (
            <span key={item.importItemId}>
              {item.artist ?? "Unknown Artist"} - {item.title ?? "Unknown Title"} · {item.album ?? "Unknown Album"}
              {item.year ? ` · ${item.year}` : ""} · duplicates {item.duplicateCount}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AgentRunTrace({ run }: { run: AgentRun }): ReactElement {
  return (
    <details className="agentResults">
      <summary>
        Run trace Â· {run.status} Â· {run.steps.length} step{run.steps.length === 1 ? "" : "s"}
      </summary>
      {run.steps.map((step) => (
        <span key={step.id}>
          {step.stepIndex + 1}. {stepLabel(step.type, step.toolName)} Â· {step.status} Â· {step.summary}
          {step.error ? ` Â· ${step.error}` : ""}
        </span>
      ))}
    </details>
  );
}

function stepLabel(type: AgentRun["steps"][number]["type"], toolName: string | null): string {
  return toolName ? `${type}:${toolName}` : type;
}

async function listRoots() {
  return getJson("/library/roots", libraryRootsResponseSchema);
}

async function listFiles(query: string, offset = 0, limit = libraryPageSize) {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("offset", String(offset));
  params.set("limit", String(limit));
  return getJson(`/library/files?${params.toString()}`, libraryFilesResponseSchema);
}

async function getLibraryFileDiagnostics(fileId: string) {
  return getJson(`/library/files/${encodeURIComponent(fileId)}/diagnostics`, metadataDiagnosticsResponseSchema);
}

async function getImportItemDiagnostics(importItemId: string) {
  return getJson(`/imports/items/${encodeURIComponent(importItemId)}/diagnostics`, metadataDiagnosticsResponseSchema);
}

async function listDuplicates() {
  return getJson("/library/duplicates", duplicateGroupsResponseSchema);
}

async function listMetadataGaps() {
  return getJson("/library/metadata-gaps", metadataGapsResponseSchema);
}

async function listQualityUpgrades() {
  return getJson("/library/quality-upgrades", qualityUpgradeSuggestionsResponseSchema);
}

async function listIncompleteAlbums() {
  return getJson("/library/incomplete-albums", incompleteAlbumsResponseSchema);
}

async function listAlbumMergeSuggestions() {
  return getJson("/library/album-merge-suggestions", albumMergeSuggestionsResponseSchema);
}

async function listAlternateEditions() {
  return getJson("/library/alternate-editions", alternateEditionGroupsResponseSchema);
}

async function listAlbums(offset = 0, limit = albumPageSize) {
  const params = new URLSearchParams();
  params.set("offset", String(offset));
  params.set("limit", String(limit));
  return getJson(`/library/albums?${params.toString()}`, albumGroupsResponseSchema);
}

async function getTasteProfile() {
  return getJson("/settings/taste-profile", tasteProfileResponseSchema);
}

async function updateTasteProfile(profile: TasteProfile) {
  return putJson("/settings/taste-profile", { profile, source: "user" }, tasteProfileResponseSchema);
}

async function addRoot(path: string, watchEnabled: boolean) {
  return postJson("/library/roots", { path, watchEnabled }, libraryRootResponseSchema);
}

async function updateRootWatch(rootId: string, watchEnabled: boolean) {
  return postJson("/library/roots/watch", { rootId, watchEnabled }, libraryRootResponseSchema);
}

async function scanRoot(rootId: string) {
  return postJson("/library/scan", { rootId }, libraryScanResultSchema);
}

async function scanWatchedRoots() {
  return postJson("/library/scan-watched", {}, watchedLibraryScanResultSchema);
}

async function listImportInbox() {
  return getJson("/imports/inbox", importsInboxResponseSchema);
}

async function createImportFromPaths(paths: string[], libraryRootId: string | undefined) {
  return postJson("/imports/create-from-paths", { paths, libraryRootId }, importBatchResponseSchema);
}

async function rejectImportItem(importItemId: string) {
  return postJson("/imports/reject-item", { importItemId }, importItemResponseSchema);
}

async function updateImportItemMetadata(
  importItemId: string,
  metadata: { artist: string; album: string; title: string; year: string }
) {
  return postJson("/imports/update-item-metadata", { importItemId, metadata }, importItemResponseSchema);
}

async function listOperationBatches() {
  return getJson("/operations/batches", operationBatchesResponseSchema);
}

async function listPlaylists() {
  return getJson("/playlists", playlistsResponseSchema);
}

async function getDiscoveryHealth() {
  return getJson("/discovery/health", discoveryHealthResponseSchema);
}

async function searchDiscovery(query: string, source: DiscoverySource): Promise<DiscoverySearchResponse> {
  return postJson("/discovery/search", { query, source, responseLimit: 100 }, discoverySearchResponseSchema);
}

async function listSavedDiscoveryCandidates(): Promise<SavedDiscoveryCandidatesResponse> {
  return getJson("/discovery/saved-candidates", savedDiscoveryCandidatesResponseSchema);
}

async function saveDiscoveryCandidate(candidate: SaveDiscoveryCandidateRequest) {
  return postJson("/discovery/saved-candidates", candidate, savedDiscoveryCandidateResponseSchema);
}

async function removeSavedDiscoveryCandidate(candidateId: string): Promise<void> {
  const response = await fetch(`${backendOrigin}/discovery/saved-candidates/${encodeURIComponent(candidateId)}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }
}

async function listSavedDiscoveryLists(): Promise<SavedDiscoveryListsResponse> {
  return getJson("/discovery/saved-lists", savedDiscoveryListsResponseSchema);
}

async function saveDiscoveryList(list: SaveDiscoveryListRequest) {
  return postJson("/discovery/saved-lists", list, savedDiscoveryListResponseSchema);
}

async function removeSavedDiscoveryList(listId: string): Promise<void> {
  const response = await fetch(`${backendOrigin}/discovery/saved-lists/${encodeURIComponent(listId)}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }
}

async function downloadDiscoveryResults(
  results: DiscoveryResult[],
  libraryRootId: string | undefined
): Promise<DiscoveryDownloadResponse> {
  return postJson("/discovery/download", { results, libraryRootId }, discoveryDownloadResponseSchema);
}

async function proposeQueueDownload(results: DiscoveryResult[], query: string, libraryRootId: string | undefined) {
  return postJson("/operations/propose-queue-download", { results, query, libraryRootId }, operationBatchResponseSchema);
}

async function listDiscoveryDownloads() {
  return getJson("/discovery/downloads", discoveryDownloadJobsResponseSchema);
}

async function listJobs() {
  return getJson("/jobs", jobsResponseSchema);
}

async function getJob(jobId: string) {
  return getJson(`/jobs/${encodeURIComponent(jobId)}`, jobResponseSchema);
}

async function retryDiscoveryDownload(jobId: string) {
  return postJson("/discovery/downloads/retry", { jobId }, discoveryDownloadJobResponseSchema);
}

async function cancelDiscoveryDownload(jobId: string) {
  return postJson("/discovery/downloads/cancel", { jobId }, discoveryDownloadJobResponseSchema);
}

async function getActiveAgentThread() {
  return getJson("/agent/threads/active", agentThreadResponseSchema);
}

async function listAgentThreads() {
  return getJson("/agent/threads", agentThreadsResponseSchema);
}

async function getAgentThread(threadId: string) {
  return getJson(`/agent/threads/${encodeURIComponent(threadId)}`, agentThreadResponseSchema);
}

async function createAgentThread() {
  return postJson("/agent/threads", {}, agentThreadResponseSchema);
}

async function sendAgentMessage(message: string, threadId: string | undefined) {
  const result = await postJson("/agent/runs", { message, threadId }, agentRunResponseSchema);
  if (!result.run.response) {
    throw new Error(result.run.error ?? "Agent run did not return a response");
  }
  return {
    response: result.run.response,
    run: result.run
  };
}

async function proposeImportApproval(importItemId: string, libraryRootId: string) {
  return postJson("/operations/propose-import-approval", { importItemId, libraryRootId }, operationBatchResponseSchema);
}

async function proposeBulkImportApproval(importItemIds: string[], libraryRootId: string) {
  return postJson("/operations/propose-bulk-import-approval", { importItemIds, libraryRootId }, operationBatchResponseSchema);
}

async function proposeImportApprovals(importItemIds: string[], libraryRootId: string): Promise<OperationBatch[]> {
  try {
    const result = await proposeBulkImportApproval(importItemIds, libraryRootId);
    return [result.batch];
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  const batches: OperationBatch[] = [];
  for (const importItemId of importItemIds) {
    const result = await proposeImportApproval(importItemId, libraryRootId);
    batches.push(result.batch);
  }
  return batches;
}

async function proposeFileMetadata(fileId: string, metadata: EditableFileMetadata) {
  return postJson("/operations/propose-file-metadata", { fileId, metadata }, operationBatchResponseSchema);
}

async function proposeBulkFileMetadata(fileIds: string[], metadata: EditableFileMetadata) {
  return postJson("/operations/propose-bulk-file-metadata", { fileIds, metadata }, operationBatchResponseSchema);
}

async function proposeRating(fileId: string, rating: number | null) {
  return postJson("/operations/propose-rating", { fileId, rating }, operationBatchResponseSchema);
}

async function proposeFavoriteStatus(
  fileId: string,
  status: { liked: boolean | null; disliked: boolean | null }
) {
  return postJson("/operations/propose-favorite-status", { fileId, ...status }, operationBatchResponseSchema);
}

async function updateFileRating(fileId: string, rating: number | null): Promise<LibraryFile> {
  const result = await postJson(
    `/library/files/${encodeURIComponent(fileId)}/rating`,
    { rating },
    libraryFilesResponseSchema
  );
  const file = result.files[0];
  if (!file) {
    throw new Error("Rating update did not return a file");
  }
  return file;
}

async function updateFileFavoriteStatus(
  fileId: string,
  status: { liked: boolean | null; disliked: boolean | null }
): Promise<LibraryFile> {
  const result = await postJson(
    `/library/files/${encodeURIComponent(fileId)}/favorite-status`,
    status,
    libraryFilesResponseSchema
  );
  const file = result.files[0];
  if (!file) {
    throw new Error("Favorite status update did not return a file");
  }
  return file;
}

async function proposeRemoveFile(fileId: string) {
  return postJson("/operations/propose-remove-file", { fileId }, operationBatchResponseSchema);
}

async function proposeRemoveFiles(fileIds: string[], reason: string) {
  return postJson("/operations/propose-remove-files", { fileIds, reason }, operationBatchResponseSchema);
}

async function proposeDuplicateCleanup(keepFileId: string, removeFileIds: string[]) {
  return postJson("/operations/propose-duplicate-cleanup", { keepFileId, removeFileIds }, operationBatchResponseSchema);
}

async function proposeBulkDuplicateCleanup(groups: Array<{ keepFileId: string; removeFileIds: string[] }>) {
  return postJson("/operations/propose-bulk-duplicate-cleanup", { groups }, operationBatchResponseSchema);
}

async function proposeBulkInternalTags(fileIds: string[], tags: string[]) {
  return postJson("/operations/propose-bulk-internal-tags", { fileIds, tags }, operationBatchResponseSchema);
}

async function proposeBulkRenameFiles(fileIds: string[], pattern: string) {
  return postJson("/operations/propose-bulk-rename-files", { fileIds, pattern }, operationBatchResponseSchema);
}

async function proposePlaylist(name: string, description: string | undefined, fileIds: string[]) {
  return postJson("/operations/propose-playlist", { name, description, fileIds }, operationBatchResponseSchema);
}

async function proposeUpdatePlaylist(playlistId: string, updates: { name: string; description: string | null }) {
  return postJson("/operations/propose-update-playlist", { playlistId, ...updates }, operationBatchResponseSchema);
}

async function proposeDeletePlaylist(playlistId: string) {
  return postJson("/operations/propose-delete-playlist", { playlistId }, operationBatchResponseSchema);
}

async function proposeAddTracksToPlaylist(playlistId: string, fileIds: string[]) {
  return postJson("/operations/propose-add-tracks-to-playlist", { playlistId, fileIds }, operationBatchResponseSchema);
}

async function proposeRemoveTracksFromPlaylist(playlistId: string, itemIds: string[]) {
  return postJson("/operations/propose-remove-tracks-from-playlist", { playlistId, itemIds }, operationBatchResponseSchema);
}

async function proposeAlbumMerge(canonicalAlbum: string, fileIds: string[]) {
  return postJson("/operations/propose-album-merge", { canonicalAlbum, fileIds }, operationBatchResponseSchema);
}

async function proposeBulkAlbumMerge(merges: Array<{ canonicalAlbum: string; fileIds: string[] }>) {
  return postJson("/operations/propose-bulk-album-merge", { merges }, operationBatchResponseSchema);
}

async function approveOperationBatch(batchId: string) {
  return postJson("/operations/approve-batch", { batchId }, operationBatchResponseSchema);
}

async function rejectOperationBatch(batchId: string) {
  return postJson("/operations/reject-batch", { batchId }, operationBatchResponseSchema);
}

async function applyOperationBatch(batchId: string) {
  return postJson("/operations/apply-batch", { batchId }, operationBatchResponseSchema);
}

async function revertOperationBatch(batchId: string) {
  return postJson("/operations/revert-batch", { batchId }, operationBatchResponseSchema);
}

async function getPlaybackState() {
  return getJson("/playback/state", playbackStateSchema);
}

async function getVisualizerCapabilities() {
  return getJson("/playback/visualizer/capabilities", visualizerCapabilitiesSchema);
}

async function getWaveform(fileId: string, signal?: AbortSignal) {
  const response = await fetch(`${backendOrigin}/playback/waveform/${encodeURIComponent(fileId)}`, { signal });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return waveformResponseSchema.parse(await response.json());
}

async function playQueue(fileIds: string[], startIndex: number) {
  return postJson("/playback/play-queue", { fileIds, startIndex }, playbackStateSchema);
}

async function enqueuePlayback(fileIds: string[], position: QueueInsertPosition) {
  return postJson("/playback/enqueue", { fileIds, position }, playbackStateSchema);
}

async function setPlaybackRepeatMode(repeatMode: PlaybackRepeatMode) {
  return postJson("/playback/repeat", { repeatMode }, playbackStateSchema);
}

async function playPlaylist(playlistId: string) {
  return postJson("/playback/play-playlist", { playlistId }, playbackStateSchema);
}

async function playAlbum(albumId: string) {
  return postJson("/playback/play-album", { albumId }, playbackStateSchema);
}

async function pausePlayback() {
  return postJson("/playback/pause", {}, playbackStateSchema);
}

async function resumePlayback() {
  return postJson("/playback/resume", {}, playbackStateSchema);
}

async function seekPlayback(positionMs: number) {
  return postJson("/playback/seek", { positionMs }, playbackStateSchema);
}

async function setPlaybackVolume(volumePercent: number) {
  return postJson("/playback/volume", { volumePercent }, playbackStateSchema);
}

async function stopPlayback() {
  return postJson("/playback/stop", {}, playbackStateSchema);
}

async function previousPlayback() {
  return postJson("/playback/previous", {}, playbackStateSchema);
}

async function nextPlayback() {
  return postJson("/playback/next", {}, playbackStateSchema);
}

async function removeRoot(rootId: string) {
  const response = await fetch(`${backendOrigin}/library/roots/${encodeURIComponent(rootId)}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

async function getJson<T>(path: string, schema: { parse(value: unknown): T }): Promise<T> {
  const response = await fetch(`${backendOrigin}${path}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return schema.parse(await response.json());
}

async function postJson<T>(path: string, body: unknown, schema: { parse(value: unknown): T }): Promise<T> {
  const response = await fetch(`${backendOrigin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return schema.parse(await response.json());
}

async function putJson<T>(path: string, body: unknown, schema: { parse(value: unknown): T }): Promise<T> {
  const response = await fetch(`${backendOrigin}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return schema.parse(await response.json());
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? `Request failed with ${response.status}`;
  } catch {
    return `Request failed with ${response.status}`;
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message);
}

function discoveryGroupToSaveRequest(group: DiscoveryGroup, query: string): SaveDiscoveryCandidateRequest {
  return {
    candidateKey: group.id,
    source: "slskd",
    query,
    releaseArtist: group.releaseArtist,
    releaseTitle: group.releaseTitle,
    username: group.username,
    folder: group.folder,
    resultCount: group.files.length,
    availableCount: group.availableCount,
    totalSizeBytes: group.totalSizeBytes,
    primaryFormat: group.primaryFormat,
    qualityLabel: group.qualityLabel,
    matchLabel: group.matchLabel,
    results: group.files
  };
}

function discoveryAgentPrompt(group: DiscoveryGroup): string {
  const query = [group.releaseArtist, group.releaseTitle].filter(Boolean).join(" ").trim() || getDiscoveryFolderLabel(group);
  return `search soulseek ${query}`;
}

function savedDiscoveryAgentPrompt(candidate: SavedDiscoveryCandidate): string {
  return `search soulseek ${savedCandidateQuery(candidate)}`;
}

function savedCandidateQuery(candidate: SavedDiscoveryCandidate): string {
  return [candidate.releaseArtist, candidate.releaseTitle].filter(Boolean).join(" ").trim() || candidate.releaseTitle;
}

function groupLibraryFilesByAlbum(files: LibraryFile[], sortMode: LibrarySortMode): LibraryAlbumGroup[] {
  const groups = new Map<string, LibraryAlbumGroup>();
  const groupFormats = new Map<string, Set<string>>();
  for (const file of files) {
    const artist = albumArtistLabel(file);
    const album = file.displayTags.album?.trim() || "Unknown Album";
    const year = cleanDisplayYear(file.displayTags.year ?? file.displayTags.date);
    const key = [normalizeLibraryGroupValue(artist), normalizeLibraryGroupValue(album), year ?? ""].join("::");
    const existing =
      groups.get(key) ??
      ({
        key,
        artist,
        album,
        year,
        formats: [],
        files: []
      } satisfies LibraryAlbumGroup);
    existing.files.push(file);
    const formats = groupFormats.get(key) ?? new Set<string>();
    formats.add(file.extension.toUpperCase());
    groupFormats.set(key, formats);
    groups.set(key, existing);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, formats: [...(groupFormats.get(group.key) ?? new Set<string>())].sort(), files: sortAlbumTrackFiles(group.files) }))
    .sort((left, right) => compareLibraryAlbumGroups(left, right, sortMode));
}

function getEstimatedLibraryAlbumGroupHeight(group: LibraryAlbumGroup): number {
  return 128 + group.files.length * 37;
}

function getVirtualOffsets(heights: number[]): number[] {
  const offsets = [0];
  for (const height of heights) {
    offsets.push(offsets[offsets.length - 1] + height);
  }
  return offsets;
}

function getVirtualIndexBeforeOffset(offsets: number[], offset: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (offsets[middle] <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function getVirtualIndexAfterOffset(offsets: number[], offset: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] < offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function sortAlbumTrackFiles(files: LibraryFile[]): LibraryFile[] {
  return [...files].sort(
    (left, right) =>
      readDiscNumber(left.displayTags) - readDiscNumber(right.displayTags) ||
      readTrackNumber(left.displayTags, left.filename) - readTrackNumber(right.displayTags, right.filename) ||
      compareText(left.displayTags.title ?? left.filename, right.displayTags.title ?? right.filename)
  );
}

function albumArtistLabel(file: LibraryFile): string {
  return file.displayTags.albumartist?.trim() || file.displayTags.artist?.trim() || "Unknown Artist";
}

function formatTrackNumber(file: LibraryFile): string {
  const disc = readDiscNumber(file.displayTags);
  const track = readTrackNumber(file.displayTags, file.filename);
  if (track === Number.MAX_SAFE_INTEGER) {
    return "-";
  }
  return disc > 1 ? `${disc}.${track}` : String(track);
}

function readDiscNumber(tags: Record<string, string>): number {
  return readNumericTag(tags.discnumber ?? tags.disc) ?? 1;
}

function readTrackNumber(tags: Record<string, string>, filename: string): number {
  return readNumericTag(tags.tracknumber ?? tags.track) ?? readFilenameTrackNumber(filename) ?? Number.MAX_SAFE_INTEGER;
}

function readNumericTag(value: string | undefined): number | null {
  const match = value?.match(/\d+/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readFilenameTrackNumber(filename: string): number | null {
  const match = filename.match(/^\D*(\d{1,3})(?:\s*[-._]\s*|\s+)/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanDisplayYear(value: string | undefined): string | null {
  const match = value?.match(/\b(\d{4})\b/);
  return match?.[1] ?? null;
}

function normalizeLibraryGroupValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filterLibraryFiles(
  files: LibraryFile[],
  filters: {
    format: LibraryFormatFilter;
    missing: LibraryMissingFilter;
    favorite: LibraryFavoriteFilter;
    minimumRating: string;
    minimumPlays: string;
    tagText: string;
  }
): LibraryFile[] {
  const minimumRating = parseOptionalNumber(filters.minimumRating);
  const minimumPlays = parseOptionalNumber(filters.minimumPlays);
  const tagText = filters.tagText.trim().toLowerCase();

  return files.filter((file) => {
    if (filters.format === "lossless" && !isLosslessFile(file)) {
      return false;
    }
    if (filters.format === "compressed" && isLosslessFile(file)) {
      return false;
    }
    if (filters.missing === "present" && file.missing) {
      return false;
    }
    if (filters.missing === "missing" && !file.missing) {
      return false;
    }
    if (filters.favorite === "liked" && !file.liked) {
      return false;
    }
    if (filters.favorite === "disliked" && !file.disliked) {
      return false;
    }
    if (filters.favorite === "unrated" && (file.liked || file.disliked || file.rating != null)) {
      return false;
    }
    if (minimumRating != null && (file.rating ?? -1) < minimumRating) {
      return false;
    }
    if (minimumPlays != null && file.playCount < minimumPlays) {
      return false;
    }
    if (tagText && !libraryFileSearchText(file).includes(tagText)) {
      return false;
    }
    return true;
  });
}

function libraryFileSearchText(file: LibraryFile): string {
  return [
    file.filename,
    file.extension,
    file.codec ?? "",
    file.path,
    ...Object.entries(file.displayTags).flatMap(([key, value]) => [key, value])
  ]
    .join(" ")
    .toLowerCase();
}

function isLosslessFile(file: LibraryFile): boolean {
  const extension = file.extension.toLowerCase();
  const codec = (file.codec ?? "").toLowerCase();
  return ["flac", "alac", "wav", "aiff", "aif", "ape", "wv"].includes(extension) || /flac|alac|pcm|wavpack|ape/.test(codec);
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function sortAlbumsByArtistAlbum(albums: AlbumGroupItem[]): AlbumGroupItem[] {
  return [...albums].sort((left, right) => compareText(left.artist, right.artist) || compareText(left.album, right.album));
}

function sortAlbumsByMode(albums: AlbumGroupItem[], sortMode: AlbumSortMode): AlbumGroupItem[] {
  return [...albums].sort((left, right) => compareAlbumsByMode(left, right, sortMode));
}

function compareLibraryAlbumGroups(left: LibraryAlbumGroup, right: LibraryAlbumGroup, sortMode: LibrarySortMode): number {
  if (sortMode === "recent") {
    return albumRecentTimestamp(right.files) - albumRecentTimestamp(left.files) || compareLibraryAlbumGroups(left, right, "artistAlbum");
  }
  if (sortMode === "listens") {
    return albumPlayCount(right.files) - albumPlayCount(left.files) || compareLibraryAlbumGroups(left, right, "artistAlbum");
  }
  if (sortMode === "likes") {
    return albumLikeCount(right.files) - albumLikeCount(left.files) || compareLibraryAlbumGroups(left, right, "artistAlbum");
  }
  if (sortMode === "rating") {
    return albumAverageRating(right.files) - albumAverageRating(left.files) || compareLibraryAlbumGroups(left, right, "artistAlbum");
  }
  return compareText(left.artist, right.artist) || compareText(left.album, right.album) || compareText(left.year ?? "", right.year ?? "");
}

function compareAlbumsByMode(left: AlbumGroupItem, right: AlbumGroupItem, sortMode: AlbumSortMode): number {
  if (sortMode === "recent") {
    return albumRecentTimestamp(right.files) - albumRecentTimestamp(left.files) || compareAlbumsByMode(left, right, "artistAlbum");
  }
  if (sortMode === "listens") {
    return albumPlayCount(right.files) - albumPlayCount(left.files) || compareAlbumsByMode(left, right, "artistAlbum");
  }
  if (sortMode === "likes") {
    return albumLikeCount(right.files) - albumLikeCount(left.files) || compareAlbumsByMode(left, right, "artistAlbum");
  }
  if (sortMode === "rating") {
    return albumAverageRating(right.files) - albumAverageRating(left.files) || compareAlbumsByMode(left, right, "artistAlbum");
  }
  return compareText(left.artist, right.artist) || compareText(left.album, right.album);
}

function groupAlbumsByArtist(albums: AlbumGroupItem[]): { artist: string; albums: AlbumGroupItem[] }[] {
  const groups = new Map<string, AlbumGroupItem[]>();
  for (const album of albums) {
    groups.set(album.artist, [...(groups.get(album.artist) ?? []), album]);
  }
  return [...groups.entries()]
    .map(([artist, groupAlbums]) => ({ artist, albums: groupAlbums }))
    .sort((left, right) => compareText(left.artist, right.artist));
}

function sortArtistSections(
  sections: { artist: string; albums: AlbumGroupItem[] }[],
  sortMode: ArtistSortMode
): { artist: string; albums: AlbumGroupItem[] }[] {
  return [...sections].sort((left, right) => compareArtistSections(left, right, sortMode));
}

function compareArtistSections(
  left: { artist: string; albums: AlbumGroupItem[] },
  right: { artist: string; albums: AlbumGroupItem[] },
  sortMode: ArtistSortMode
): number {
  if (sortMode === "recent") {
    return artistRecentTimestamp(right.albums) - artistRecentTimestamp(left.albums) || compareArtistSections(left, right, "artist");
  }
  if (sortMode === "listens") {
    return artistPlayCount(right.albums) - artistPlayCount(left.albums) || compareArtistSections(left, right, "artist");
  }
  if (sortMode === "likes") {
    return artistLikeCount(right.albums) - artistLikeCount(left.albums) || compareArtistSections(left, right, "artist");
  }
  if (sortMode === "rating") {
    return artistAverageRating(right.albums) - artistAverageRating(left.albums) || compareArtistSections(left, right, "artist");
  }
  return compareText(left.artist, right.artist);
}

function albumRecentTimestamp(files: LibraryFile[]): number {
  return Math.max(0, ...files.map(fileAddedTimestamp));
}

function albumPlayCount(files: LibraryFile[]): number {
  return files.reduce((total, file) => total + file.playCount, 0);
}

function albumLikeCount(files: LibraryFile[]): number {
  return files.reduce((total, file) => total + Number(Boolean(file.liked)), 0);
}

function albumAverageRating(files: LibraryFile[]): number {
  const rated = files.filter((file) => file.rating != null);
  if (rated.length === 0) {
    return -1;
  }
  return rated.reduce((total, file) => total + (file.rating ?? 0), 0) / rated.length;
}

function artistRecentTimestamp(albums: AlbumGroupItem[]): number {
  return Math.max(0, ...albums.map((album) => albumRecentTimestamp(album.files)));
}

function artistPlayCount(albums: AlbumGroupItem[]): number {
  return albums.reduce((total, album) => total + albumPlayCount(album.files), 0);
}

function artistLikeCount(albums: AlbumGroupItem[]): number {
  return albums.reduce((total, album) => total + albumLikeCount(album.files), 0);
}

function artistAverageRating(albums: AlbumGroupItem[]): number {
  const ratings = albums.map((album) => albumAverageRating(album.files)).filter((rating) => rating >= 0);
  if (ratings.length === 0) {
    return -1;
  }
  return ratings.reduce((total, rating) => total + rating, 0) / ratings.length;
}

function fileAddedTimestamp(file: LibraryFile): number {
  const timestamp = Date.parse(file.ctime ?? file.mtime);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function groupAlbumsByMode(albums: AlbumGroupItem[], mode: AlbumGroupMode): { artist: string; albums: AlbumGroupItem[] }[] {
  if (mode === "genre") {
    return groupAlbumsByLabel(albums, getPrimaryAlbumGenre, "Unknown Genre");
  }
  if (mode === "decade") {
    return groupAlbumsByLabel(albums, getAlbumDecade, "Unknown Decade");
  }
  return groupAlbumsByArtist(albums);
}

function groupArtistSectionsByMode(
  sections: { artist: string; albums: AlbumGroupItem[] }[],
  mode: AlbumGroupMode
): { label: string; sections: { artist: string; albums: AlbumGroupItem[] }[] }[] {
  if (mode === "all" || mode === "artist") {
    return [{ label: "All Artists", sections }];
  }

  const groups = new Map<string, { artist: string; albums: AlbumGroupItem[] }[]>();
  for (const section of sections) {
    const label =
      mode === "genre"
        ? getPrimaryAlbumGenre(section.albums[0] ?? null, "Unknown Genre")
        : getAlbumDecade(section.albums[0] ?? null, "Unknown Decade");
    groups.set(label, [...(groups.get(label) ?? []), section]);
  }
  return [...groups.entries()]
    .map(([label, groupSections]) => ({ label, sections: groupSections }))
    .sort((left, right) => compareFacetLabel(left.label, right.label, mode));
}

function groupAlbumsByLabel(
  albums: AlbumGroupItem[],
  getLabel: (album: AlbumGroupItem | null, fallback: string) => string,
  fallback: string
): { artist: string; albums: AlbumGroupItem[] }[] {
  const groups = new Map<string, AlbumGroupItem[]>();
  for (const album of albums) {
    const label = getLabel(album, fallback);
    groups.set(label, [...(groups.get(label) ?? []), album]);
  }
  return [...groups.entries()]
    .map(([artist, groupAlbums]) => ({ artist, albums: groupAlbums }))
    .sort((left, right) => compareText(left.artist, right.artist));
}

function getAlbumFacets(albums: AlbumGroupItem[]): { genres: string[]; decades: string[] } {
  const genres = new Set<string>();
  const decades = new Set<string>();
  for (const album of albums) {
    for (const genre of getAlbumGenres(album)) {
      genres.add(genre);
    }
    const decade = getAlbumDecade(album, "");
    if (decade) {
      decades.add(decade);
    }
  }
  return {
    genres: [...genres].sort(compareText),
    decades: [...decades].sort((left, right) => compareText(left, right))
  };
}

function filterAlbumsByFacet(albums: AlbumGroupItem[], filter: AlbumFacetFilter): AlbumGroupItem[] {
  return albums.filter((album) => {
    if (filter.genre !== "all" && !getAlbumGenres(album).some((genre) => genre.toLowerCase() === filter.genre.toLowerCase())) {
      return false;
    }
    if (filter.decade !== "all" && getAlbumDecade(album, "Unknown Decade") !== filter.decade) {
      return false;
    }
    return true;
  });
}

function getAlbumGenres(album: AlbumGroupItem): string[] {
  return [
    ...new Set(
      album.files
        .flatMap((file) => splitGenreTag(file.displayTags.genre))
        .map((genre) => genre.trim())
        .filter(Boolean)
    )
  ].sort(compareText);
}

function getPrimaryAlbumGenre(album: AlbumGroupItem | null, fallback: string): string {
  if (!album) {
    return fallback;
  }
  return getAlbumGenres(album)[0] ?? fallback;
}

function splitGenreTag(value: string | undefined): string[] {
  return value?.split(/[;,/|]+/).map((genre) => genre.trim()).filter(Boolean) ?? [];
}

function getAlbumDecade(album: AlbumGroupItem | null, fallback: string): string {
  if (!album) {
    return fallback;
  }
  const year = album.year ?? album.files.map((file) => cleanDisplayYear(file.displayTags.year ?? file.displayTags.date)).find(Boolean) ?? null;
  if (!year) {
    return fallback;
  }
  const decadeStart = Math.floor(Number(year) / 10) * 10;
  return Number.isFinite(decadeStart) ? `${decadeStart}s` : fallback;
}

function compareFacetLabel(left: string, right: string, mode: AlbumGroupMode): number {
  if (mode === "decade") {
    if (left === "Unknown Decade") {
      return 1;
    }
    if (right === "Unknown Decade") {
      return -1;
    }
  }
  return compareText(left, right);
}

function formatFileFormat(file: LibraryFile): string {
  const parts = [file.extension.toUpperCase()];
  if (file.bitrate) {
    parts.push(`${Math.round(file.bitrate / 1000)} kbps`);
  }
  if (file.sampleRate) {
    parts.push(`${(file.sampleRate / 1000).toFixed(1)} kHz`);
  }
  return parts.join(" / ");
}

function formatListenStats(file: LibraryFile): string {
  if (file.playCount === 0 && file.skipCount === 0) {
    return "-";
  }
  return `${file.playCount.toLocaleString()} / ${file.skipCount.toLocaleString()}`;
}

function getAlbumsListenTimeMs(albums: AlbumGroupItem[]): number {
  return albums.reduce((total, album) => total + getAlbumListenTimeMs(album), 0);
}

function getAlbumListenTimeMs(album: AlbumGroupItem): number {
  return album.files.reduce((total, file) => total + (file.durationMs ?? 0) * file.playCount, 0);
}

function getFilesListenTimeMs(files: LibraryFile[]): number {
  return files.reduce((total, file) => total + (file.durationMs ?? 0) * file.playCount, 0);
}

function formatListenTime(valueMs: number): string {
  if (valueMs <= 0) {
    return "No recorded listen time";
  }
  const totalMinutes = Math.floor(valueMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours.toLocaleString()}h ${minutes}m listened`;
  }
  return `${minutes.toLocaleString()}m listened`;
}

function formatListenTooltip(file: LibraryFile): string {
  const details = [`${file.playCount.toLocaleString()} play${file.playCount === 1 ? "" : "s"}`];
  details.push(`${file.skipCount.toLocaleString()} skip${file.skipCount === 1 ? "" : "s"}`);
  if (file.lastPlayedAt) {
    details.push(`last played ${formatDateTime(file.lastPlayedAt)}`);
  }
  if (file.lastSkippedAt) {
    details.push(`last skipped ${formatDateTime(file.lastSkippedAt)}`);
  }
  return details.join(" · ");
}

function getSongInfoRows(file: LibraryFile): Array<{ label: string; value: string }> {
  const tags = file.displayTags;
  return [
    ["Title", tags.title ?? file.filename],
    ["Artist", tags.artist ?? "-"],
    ["Album Artist", tags.albumartist ?? "-"],
    ["Album", tags.album ?? "-"],
    ["Track", formatTrackNumber(file)],
    ["Disc", tags.discnumber ?? tags.disc ?? "-"],
    ["Year", tags.year ?? tags.date ?? "-"],
    ["Genre", tags.genre ?? "-"],
    ["Duration", file.durationMs == null ? "-" : formatTime(file.durationMs)],
    ["Format", formatFileFormat(file) || file.extension.toUpperCase()],
    ["Codec", file.codec ?? "-"],
    ["Bitrate", file.bitrate == null ? "-" : `${Math.round(file.bitrate / 1000)} kbps`],
    ["Sample Rate", file.sampleRate == null ? "-" : `${(file.sampleRate / 1000).toFixed(1)} kHz`],
    ["Channels", file.channels == null ? "-" : String(file.channels)],
    ["File Size", formatBytes(file.sizeBytes)],
    ["Play / Skip", `${file.playCount.toLocaleString()} / ${file.skipCount.toLocaleString()}`],
    ["Rating", file.rating == null ? "-" : `${file.rating}/5`],
    ["Preference", file.liked ? "Liked" : file.disliked ? "Disliked" : "Neutral"],
    ["Status", file.scanStatus],
    ["Path", file.path],
    ["Updated", file.mtime],
    ["Indexed ID", file.id]
  ].map(([label, value]) => ({ label, value }));
}

function compareArtistTopSongs(left: LibraryFile, right: LibraryFile): number {
  return (
    Number(Boolean(right.liked)) - Number(Boolean(left.liked)) ||
    (right.rating ?? -1) - (left.rating ?? -1) ||
    right.playCount - left.playCount ||
    compareText(left.displayTags.title ?? left.filename, right.displayTags.title ?? right.filename)
  );
}

function compareArtistSongs(
  left: LibraryFile,
  right: LibraryFile,
  sortMode: ArtistSongSortMode,
  albumByFileId: Map<string, { album: AlbumGroupItem; albumIndex: number }>
): number {
  if (sortMode === "ranking") {
    return compareArtistTopSongs(left, right);
  }

  if (sortMode === "albumYear") {
    const leftAlbum = albumByFileId.get(left.id);
    const rightAlbum = albumByFileId.get(right.id);
    const leftYear = parseAlbumYear(leftAlbum?.album.year);
    const rightYear = parseAlbumYear(rightAlbum?.album.year);
    return (
      leftYear - rightYear ||
      compareText(leftAlbum?.album.album ?? left.displayTags.album ?? "", rightAlbum?.album.album ?? right.displayTags.album ?? "") ||
      compareTrackNumbers(left, right) ||
      compareText(left.displayTags.title ?? left.filename, right.displayTags.title ?? right.filename)
    );
  }

  return (
    right.playCount - left.playCount ||
    right.skipCount - left.skipCount ||
    (right.lastPlayedAt == null ? 0 : Date.parse(right.lastPlayedAt)) - (left.lastPlayedAt == null ? 0 : Date.parse(left.lastPlayedAt)) ||
    compareText(left.displayTags.title ?? left.filename, right.displayTags.title ?? right.filename)
  );
}

function parseAlbumYear(value: string | null | undefined): number {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }
  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function compareTrackNumbers(left: LibraryFile, right: LibraryFile): number {
  const leftTrack = parseTrackNumber(left);
  const rightTrack = parseTrackNumber(right);
  return leftTrack - rightTrack;
}

function parseTrackNumber(file: LibraryFile): number {
  const raw = file.displayTags.tracknumber ?? file.displayTags.track ?? "";
  const match = String(raw).match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function formatTrackNumberList(numbers: number[]): string {
  if (numbers.length === 0) {
    return "none";
  }

  const ranges: string[] = [];
  let start = numbers[0];
  let previous = numbers[0];
  for (const number of numbers.slice(1)) {
    if (number === previous + 1) {
      previous = number;
      continue;
    }
    ranges.push(start === previous ? String(start) : `${start}-${previous}`);
    start = number;
    previous = number;
  }
  ranges.push(start === previous ? String(start) : `${start}-${previous}`);
  return ranges.join(", ");
}

function chooseDuplicateKeepFile(files: LibraryFile[]): LibraryFile {
  return [...files].sort((a, b) => getDuplicateKeepScore(b) - getDuplicateKeepScore(a) || a.path.localeCompare(b.path))[0];
}

function albumMergeFileIds(suggestion: LibraryAlbumMergeSuggestion): string[] {
  return suggestion.variants
    .filter((variant) => variant.album !== suggestion.canonicalAlbum)
    .flatMap((variant) => variant.files.map((file) => file.id));
}

function getDuplicateKeepScore(file: LibraryFile): number {
  let score = 0;
  if (!file.missing) {
    score += 100;
  }
  score += Object.keys(file.displayTags).length * 5;
  if (file.displayTags.title) {
    score += 10;
  }
  if (file.displayTags.artist || file.displayTags.albumartist) {
    score += 10;
  }
  if (file.displayTags.album) {
    score += 10;
  }
  score += Math.max(0, 120 - file.path.length) / 10;
  return score;
}

function formatMetadataSuggestion(metadata: EditableFileMetadata): string {
  const parts = [metadata.artist, metadata.album, metadata.title, metadata.year].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  return parts.length > 0 ? parts.join(" · ") : "No automatic suggestion";
}

function parseTagInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ];
}

function formatTime(value: number | null): string {
  if (value == null) {
    return "0:00";
  }

  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function shuffleFileIds(fileIds: string[]): string[] {
  const next = [...fileIds];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function formatBytes(value: number | null): string {
  if (value == null) {
    return "unknown size";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSeconds(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatTasteList(values: string[]): string {
  return values.join("\n");
}

function parseTasteList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function formatJobTitle(job: JobSummary): string {
  if (job.type === "discovery_download") {
    const payload = readRecord(job.payload);
    const selected = Array.isArray(payload.results) ? payload.results.length : null;
    return selected == null ? "Discovery Download" : `Discovery Download · ${selected} file${selected === 1 ? "" : "s"}`;
  }
  return formatJobType(job.type);
}

function formatJobType(type: string): string {
  const known: Record<string, string> = {
    discovery_download: "Discovery Download"
  };
  return known[type] ?? titleCase(type.replace(/[_-]+/g, " "));
}

function formatJobStatus(status: string): string {
  const known: Record<string, string> = {
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled"
  };
  return known[status] ?? titleCase(status.replace(/[_-]+/g, " "));
}

function formatJobLevel(level: string): string {
  return titleCase(level.replace(/[_-]+/g, " "));
}

function jobSeverityClass(level: string): string {
  const normalized = level.toLowerCase();
  if (normalized === "error" || normalized === "failed" || normalized === "danger") {
    return "isError";
  }
  if (normalized === "warning" || normalized === "warn") {
    return "isWarning";
  }
  if (normalized === "success" || normalized === "completed") {
    return "isSuccess";
  }
  return "isInfo";
}

function formatJobMessage(value: unknown): string {
  const record = readRecord(value);
  if (record && typeof record.message === "string") {
    return cleanQuotedMessage(record.message);
  }
  if (typeof value === "string") {
    return cleanQuotedMessage(value);
  }
  return formatUnknown(value);
}

function parseJobEvent(event: JobEvent): { summary: string; details: string[]; sample: string | null; path: string | null } {
  const message = cleanQuotedMessage(event.message);
  const segments = splitJobMessage(message);

  if (message.startsWith("Waiting for remote Soulseek slots")) {
    const transfer = parseTransferSample(segments.slice(2).join("; "));
    return {
      summary: "Waiting for remote Soulseek slots",
      details: [segments[1]].filter(Boolean),
      sample: transfer.sample,
      path: transfer.path
    };
  }

  if (message.startsWith("Checked slskd downloads in ")) {
    const location = message.match(/^Checked slskd downloads in ([^;]+)/)?.[1] ?? null;
    const transfer = parseTransferSample(segments.slice(3).join("; "));
    return {
      summary: location ? `Checked downloads in ${location}` : "Checked slskd downloads",
      details: segments.slice(1, 3).filter(Boolean),
      sample: transfer.sample,
      path: transfer.path
    };
  }

  if (message.startsWith("No completed files were found in ")) {
    const location = message.match(/^No completed files were found in ([^;]+)/)?.[1] ?? null;
    return {
      summary: "No completed files were found",
      details: [location ? `Folder: ${location}` : "", ...segments.slice(1)].filter(Boolean),
      sample: event.data ? formatJobMessage(event.data) : null,
      path: null
    };
  }

  return {
    summary: segments[0] || message,
    details: segments.slice(1).filter(Boolean),
    sample: event.data ? formatJobMessage(event.data) : null,
    path: null
  };
}

function splitJobMessage(message: string): string[] {
  return message
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function parseTransferSample(value: string): { sample: string | null; path: string | null } {
  const [samplePart, pathPart] = value.split(/\s+paths:\s+/i);
  return {
    sample: samplePart?.trim() || null,
    path: pathPart?.trim().replaceAll("\\", "/") || null
  };
}

function cleanQuotedMessage(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDiscoveryDownloadMessage(job: DiscoveryDownloadJob): string {
  if (job.imported) {
    return job.imported.items.map((item) => item.detectedTitle ?? basenameFromPath(item.stagingPath)).join(", ");
  }
  if (job.status === "running" || job.status === "queued") {
    if (job.completedCount === 0) {
      return job.message?.includes("Queued, Remotely")
        ? job.message
        : "Waiting for remote Soulseek slots. No downloaded files have arrived yet.";
    }
    return `Staged ${job.completedCount.toLocaleString()} of ${job.selectedCount.toLocaleString()} selected file${job.selectedCount === 1 ? "" : "s"}.`;
  }
  return job.error ?? job.message ?? "Waiting for slskd.";
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toggleSetValue<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function filterSet<T>(current: Set<T>, allowed: Set<T>): Set<T> {
  const next = new Set<T>();
  for (const value of current) {
    if (allowed.has(value)) {
      next.add(value);
    }
  }
  return next.size === current.size ? current : next;
}

function mergeFilesById(current: LibraryFile[], incoming: LibraryFile[]): LibraryFile[] {
  const seen = new Set(current.map((file) => file.id));
  const next = [...current];
  for (const file of incoming) {
    if (!seen.has(file.id)) {
      seen.add(file.id);
      next.push(file);
    }
  }
  return next;
}

function mergeAlbumsById(current: AlbumGroupItem[], incoming: AlbumGroupItem[]): AlbumGroupItem[] {
  const seen = new Set(current.map((album) => album.id));
  const next = [...current];
  for (const album of incoming) {
    if (!seen.has(album.id)) {
      seen.add(album.id);
      next.push(album);
    }
  }
  return next;
}

function getProgressPercent(playback: PlaybackStateResponse): number {
  if (!playback.durationMs || playback.durationMs <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (playback.positionMs / playback.durationMs) * 100));
}

function getPointerRatio(element: HTMLElement, clientX: number): number {
  const bounds = element.getBoundingClientRect();
  return bounds.width <= 0 ? 0 : (clientX - bounds.left) / bounds.width;
}

function getEffectiveVisualizerMode(mode: VisualizerMode, capabilities: VisualizerCapabilitiesResponse | null, reducedMotion = false): VisualizerMode {
  if (reducedMotion && mode !== "meter") {
    return "meter";
  }
  if (mode === "spectrogram" && capabilities?.spectrogram !== "available") {
    return capabilities?.liveAnalyzer === "available" ? "spectrum" : "meter";
  }
  if (mode === "spectrum" && capabilities?.liveAnalyzer !== "available") {
    return "meter";
  }
  return mode;
}

export function mergePlaybackState(
  current: PlaybackStateResponse,
  next: PlaybackStateResponse
): PlaybackStateResponse {
  const samePlayingFile =
    current.status === "playing" &&
    next.status === "playing" &&
    current.currentFileId != null &&
    current.currentFileId === next.currentFileId;

  if (!samePlayingFile) {
    return next;
  }

  const loopedToStart =
    current.durationMs != null &&
    current.durationMs > 0 &&
    current.positionMs >= current.durationMs - 3000 &&
    next.positionMs <= 2500 &&
    next.positionMs < current.positionMs;

  if (loopedToStart) {
    return next;
  }

  return {
    ...next,
    positionMs: Math.max(current.positionMs, next.positionMs)
  };
}

function useVisualizerStream(
  enabled: boolean,
  mode: VisualizerMode,
  currentFileId: string | null
): { frameRef: MutableRefObject<VisualizerFrameResponse | null> } {
  const frameRef = useRef<VisualizerFrameResponse | null>(null);

  useEffect(() => {
    frameRef.current = null;
    if (!enabled) {
      return;
    }

    let closed = false;
    let retryTimer: number | null = null;
    let source: EventSource | null = null;

    function connect(): void {
      if (closed) {
        return;
      }
      source = new EventSource(`${backendOrigin}/playback/visualizer/stream?mode=${encodeURIComponent(mode)}`);
      source.addEventListener("frame", (event) => {
        try {
          const parsed = visualizerFrameSchema.safeParse(JSON.parse((event as MessageEvent<string>).data));
          if (parsed.success) {
            frameRef.current = parsed.data;
          }
        } catch {
          // Drop malformed visualizer frames. Playback controls and UI state must
          // not depend on high-frequency visual telemetry being perfect.
        }
      });
      source.onerror = () => {
        source?.close();
        source = null;
        if (!closed) {
          retryTimer = window.setTimeout(connect, 1500);
        }
      };
    }

    connect();
    return () => {
      closed = true;
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
      }
      source?.close();
    };
  }, [enabled, mode, currentFileId]);

  return { frameRef };
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");

  useEffect(() => {
    function onVisibilityChange(): void {
      setVisible(document.visibilityState === "visible");
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return visible;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    function onChange(): void {
      setReduced(query.matches);
    }
    if ("addEventListener" in query) {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    const legacyQuery = query as MediaQueryList & {
      addListener(listener: (event: MediaQueryListEvent) => void): void;
      removeListener(listener: (event: MediaQueryListEvent) => void): void;
    };
    legacyQuery.addListener(onChange);
    return () => legacyQuery.removeListener(onChange);
  }, []);

  return reduced;
}

function useWaveform(fileId: string | null, enabled: boolean): WaveformState {
  const [state, setState] = useState<WaveformState>({ status: "idle", waveform: null, message: null });
  const cacheRef = useRef<Map<string, WaveformSummaryResponse>>(new Map());

  useEffect(() => {
    if (!enabled || !fileId) {
      setState({ status: "idle", waveform: null, message: null });
      return;
    }

    const requestedFileId = fileId;
    const cached = cacheRef.current.get(requestedFileId);
    if (cached) {
      setState({ status: "ready", waveform: cached, message: null });
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const response = await getWaveform(requestedFileId, controller.signal);
        if (cancelled) {
          return;
        }
        if (response.status === "ready") {
          cacheRef.current.set(requestedFileId, response.waveform);
          setState({ status: "ready", waveform: response.waveform, message: null });
          return;
        }
        setState({ status: response.status, waveform: null, message: response.message });
        if (response.status === "pending") {
          retryTimer = window.setTimeout(load, 2500);
        }
      } catch (error) {
        if (!cancelled) {
          setState({ status: "error", waveform: null, message: getErrorMessage(error) });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [enabled, fileId]);

  return state;
}

function MiniTrackWaveform({
  playback,
  waveform
}: {
  playback: PlaybackStateResponse;
  waveform: WaveformSummaryResponse | null;
}): ReactElement {
  return (
    <span className="miniTrackWaveform" aria-hidden="true">
      <WaveformCanvas className="miniTrackWaveformCanvas" playback={playback} variant="rail" waveform={waveform} />
    </span>
  );
}

function WaveformCanvas({
  className,
  playback,
  waveform,
  variant
}: {
  className: string;
  playback: PlaybackStateResponse;
  waveform: WaveformSummaryResponse | null;
  variant: "rail" | "hero";
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const draw = () => drawWaveform(canvas, waveform?.peaks ?? null, getProgressPercent(playback) / 100, variant);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [playback.currentFileId, playback.positionMs, playback.durationMs, variant, waveform]);

  return <canvas aria-hidden="true" className={className} ref={canvasRef} />;
}

function SpectrumCanvas({
  className,
  frameRef,
  mode,
  playing
}: {
  className: string;
  frameRef: MutableRefObject<VisualizerFrameResponse | null>;
  mode: "meter" | "spectrum";
  playing: boolean;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    if (!playing && !frameRef.current) {
      drawSpectrum(canvas, new Array(mode === "meter" ? 8 : 32).fill(0), mode);
      return;
    }
    let animationFrame = 0;
    const levels = new Array(mode === "meter" ? 8 : 32).fill(0);
    const draw = () => {
      const frame = frameRef.current;
      const incoming = frame?.bands?.length ? frame.bands : [];
      for (let index = 0; index < levels.length; index += 1) {
        const rawNext = playing ? incoming[Math.floor((index / levels.length) * incoming.length)] ?? 0 : 0;
        const next = mode === "spectrum" ? Math.min(1, Math.pow(rawNext, 0.78) * 1.18) : rawNext;
        const attack = mode === "meter" ? 0.92 : 0.82;
        const decay = mode === "meter" ? 0.68 : 0.78;
        levels[index] = next > levels[index]
          ? levels[index] + (next - levels[index]) * attack
          : Math.max(next, levels[index] * decay);
      }
      drawSpectrum(canvas, levels, mode);
      animationFrame = window.requestAnimationFrame(draw);
    };
    draw();
    return () => window.cancelAnimationFrame(animationFrame);
  }, [frameRef, mode, playing]);

  return <canvas aria-hidden="true" className={className} ref={canvasRef} />;
}

function LevelMeterCanvas({
  channel,
  className,
  frameRef,
  playing
}: {
  channel: "left" | "right";
  className: string;
  frameRef: MutableRefObject<VisualizerFrameResponse | null>;
  playing: boolean;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let animationFrame = 0;
    let level = 0;
    let peak = 0;
    const draw = () => {
      const frame = frameRef.current;
      const bands = frame?.bands ?? [];
      const sideBias = channel === "left" ? 0 : 0.5;
      const bandIndex = bands.length > 0 ? Math.floor(sideBias * (bands.length - 1)) : 0;
      const incoming = playing
        ? Math.max(frame?.rms ?? 0, bands[bandIndex] ?? 0, frame?.peak ? frame.peak * 0.72 : 0)
        : 0;
      level = incoming > level ? level + (incoming - level) * 0.88 : Math.max(incoming, level * 0.72);
      peak = Math.max(level, peak * 0.93);
      drawLevelMeter(canvas, level, peak);
      animationFrame = window.requestAnimationFrame(draw);
    };
    draw();
    return () => window.cancelAnimationFrame(animationFrame);
  }, [channel, frameRef, playing]);

  return <canvas aria-hidden="true" className={className} ref={canvasRef} />;
}

function SpectrogramCanvas({
  className,
  frameRef,
  fileId,
  playing
}: {
  className: string;
  frameRef: MutableRefObject<VisualizerFrameResponse | null>;
  fileId: string | null;
  playing: boolean;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let animationFrame = 0;
    let lastFrameId = -1;
    let lastIdleColumnAt = 0;
    const context = prepareCanvas(canvas);
    const { width, height } = canvas.getBoundingClientRect();
    context.clearRect(0, 0, width, height);
    const draw = () => {
      const frame = frameRef.current;
      if (!playing) {
        animationFrame = window.requestAnimationFrame(draw);
        return;
      }
      if ((frame?.fftBins?.length || frame?.bands?.length) && frame.frameId !== lastFrameId && frame.status === "playing") {
        lastFrameId = frame.frameId;
        drawSpectrogramColumn(canvas, frame.fftBins?.length ? frame.fftBins : frame.bands);
      } else if (!(frame?.fftBins?.length || frame?.bands?.length) && performance.now() - lastIdleColumnAt > 75) {
        lastIdleColumnAt = performance.now();
        drawSpectrogramColumn(canvas, fallbackPeaks(64).map((value) => value * 0.14));
      }
      animationFrame = window.requestAnimationFrame(draw);
    };
    draw();
    return () => window.cancelAnimationFrame(animationFrame);
  }, [frameRef, fileId, playing]);

  return <canvas aria-hidden="true" className={className} ref={canvasRef} />;
}

function VisualizerPanel({
  frameRef,
  playback,
  waveformState
}: {
  frameRef: MutableRefObject<VisualizerFrameResponse | null>;
  playback: PlaybackStateResponse;
  waveformState: WaveformState;
}): ReactElement {
  return (
    <section className="visualizerPanel" aria-label="Playback visualizer">
      <div className="visualizerStage">
        <div className="waveformRibbon">
          <WaveformCanvas className="heroWaveformCanvas" playback={playback} variant="hero" waveform={waveformState.waveform} />
        </div>
        <div className="meterRail left" aria-hidden="true">
          <div className="meterHeader">
            <strong>L</strong>
            <span>Meter</span>
          </div>
          <LevelMeterCanvas className="meterRailCanvas" frameRef={frameRef} playing={playback.status === "playing"} channel="left" />
          <div className="meterTicks">
            {[0, -6, -12, -18, -24, -36, -48, -60].map((tick) => <span key={tick}>{tick}</span>)}
          </div>
          <small>dB</small>
        </div>
        <div className="meterRail right" aria-hidden="true">
          <div className="meterHeader">
            <strong>R</strong>
            <span>Meter</span>
          </div>
          <LevelMeterCanvas className="meterRailCanvas" frameRef={frameRef} playing={playback.status === "playing"} channel="right" />
          <div className="meterTicks">
            {[0, -6, -12, -18, -24, -36, -48, -60].map((tick) => <span key={tick}>{tick}</span>)}
          </div>
          <small>dB</small>
        </div>
        <div className="spectrogramFloor">
          <div className="visualizerLabel">
            <strong>Spectrogram</strong>
          </div>
          <div className="spectrogramKey" aria-hidden="true">
            <span>-60 dB</span>
            <i />
            <span>-36</span>
            <span>-18</span>
            <span>0 dB</span>
          </div>
          <SpectrogramCanvas className="spectrogramCanvas" fileId={playback.currentFileId} frameRef={frameRef} playing={playback.status === "playing"} />
        </div>
      </div>
    </section>
  );
}

function drawWaveform(canvas: HTMLCanvasElement, peaks: number[] | null, progress: number, variant: "rail" | "hero"): void {
  const context = prepareCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  if (width <= 0 || height <= 0) {
    return;
  }
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const colors = getCanvasThemeColors(canvas);
  context.clearRect(0, 0, width, height);
  const values = peaks && peaks.length > 0 ? peaks : fallbackPeaks(96);
  const step = Math.max(1, width / values.length);
  const playedWidth = clampedProgress * width;
  const drawBars = (played: boolean) => {
    for (let index = 0; index < values.length; index += 1) {
      const value = Math.max(0.035, values[index] ?? 0);
      const barHeight = Math.max(1, value * height * (variant === "hero" ? 0.82 : 0.9));
      const x = index * step;
      const hueShift = index / Math.max(1, values.length - 1);
      const characterColor = hueShift < 0.5
        ? mixRgb(colors.accent, { r: 90, g: 210, b: 255 }, 0.16 + hueShift * 0.24)
        : mixRgb(colors.accent, { r: 255, g: 226, b: 95 }, 0.18 + (hueShift - 0.5) * 0.28);
      const unplayedColor = mixRgb(colors.bg, colors.accent, 0.16 + Math.sin(hueShift * Math.PI) * 0.08);
      context.fillStyle = played
        ? rgba(characterColor, variant === "hero" ? 0.92 : 0.64)
        : rgba(unplayedColor, variant === "hero" ? 0.34 : 0.2);
      context.fillRect(x, (height - barHeight) / 2, Math.max(1, step * 0.72), barHeight);
    }
  };

  drawBars(false);
  if (playedWidth > 0) {
    context.save();
    context.beginPath();
    context.rect(0, 0, playedWidth, height);
    context.clip();
    drawBars(true);
    context.restore();
  }
  const cursor = context.createLinearGradient(playedWidth - 1, 0, playedWidth + 1, height);
  cursor.addColorStop(0, rgba(mixRgb(colors.accent, { r: 255, g: 255, b: 255 }, 0.55), 0.25));
  cursor.addColorStop(0.5, rgba(mixRgb(colors.accent, { r: 255, g: 255, b: 255 }, 0.42), variant === "hero" ? 0.95 : 0.66));
  cursor.addColorStop(1, rgba(colors.accent, 0.18));
  context.fillStyle = cursor;
  context.fillRect(Math.max(0, playedWidth - 1), 0, variant === "hero" ? 2.25 : 1.5, height);
}

function drawSpectrum(canvas: HTMLCanvasElement, levels: number[], mode: "meter" | "spectrum"): void {
  const context = prepareCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  if (width <= 0 || height <= 0) {
    return;
  }
  context.clearRect(0, 0, width, height);
  const colors = getCanvasThemeColors(canvas);
  const gap = mode === "meter" ? 2 : 3;
  const barWidth = Math.max(2, (width - gap * (levels.length - 1)) / levels.length);
  for (let index = 0; index < levels.length; index += 1) {
    const value = Math.max(0.025, Math.min(mode === "meter" ? 0.86 : 0.96, levels[index] ?? 0));
    const barHeight = Math.max(2, value * height);
    const heat = index / Math.max(1, levels.length - 1);
    const color = mixRgb(colors.accent, colors.accentInk, mode === "meter" ? heat * 0.18 : heat * 0.28);
    context.fillStyle = rgba(color, mode === "meter" ? 0.86 : 0.76);
    context.fillRect(index * (barWidth + gap), height - barHeight, barWidth, barHeight);
  }
}

function drawLevelMeter(canvas: HTMLCanvasElement, level: number, peak: number): void {
  const context = prepareCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  if (width <= 0 || height <= 0) {
    return;
  }
  const colors = getCanvasThemeColors(canvas);
  context.clearRect(0, 0, width, height);

  const columns = 2;
  const gap = Math.max(3, width * 0.12);
  const columnWidth = Math.max(4, (width - gap) / columns);
  const segmentGap = 2;
  const segmentCount = Math.max(18, Math.floor(height / 7));
  const segmentHeight = Math.max(2, (height - segmentGap * (segmentCount - 1)) / segmentCount);
  const activeSegments = Math.round(Math.max(0, Math.min(1, level)) * segmentCount);
  const peakY = height - Math.max(0, Math.min(1, peak)) * height;

  for (let column = 0; column < columns; column += 1) {
    const x = column * (columnWidth + gap);
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const active = segment < activeSegments;
      const y = height - (segment + 1) * segmentHeight - segment * segmentGap;
      const hotness = segment / Math.max(1, segmentCount - 1);
      const color = hotness > 0.86
        ? mixRgb(colors.accent, { r: 255, g: 190, b: 50 }, 0.72)
        : hotness > 0.68
          ? mixRgb(colors.accent, { r: 255, g: 226, b: 95 }, 0.36)
          : colors.accent;
      context.fillStyle = rgba(color, active ? 0.96 : 0.13);
      context.fillRect(x, y, columnWidth, segmentHeight);
    }
    context.fillStyle = rgba(mixRgb(colors.accent, { r: 255, g: 236, b: 170 }, 0.5), 0.95);
    context.fillRect(x, Math.max(0, peakY - 1), columnWidth, 2);
  }
}

function drawSpectrogramColumn(canvas: HTMLCanvasElement, bins: number[]): void {
  const context = prepareCanvas(canvas);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const displayWidth = canvas.width / ratio;
  const displayHeight = canvas.height / ratio;
  if (displayWidth <= 1 || displayHeight <= 0 || bins.length === 0) {
    return;
  }
  const colors = getCanvasThemeColors(canvas);
  context.setTransform(1, 0, 0, 1, 0, 0);
  const columnWidth = Math.max(2, Math.round(ratio));
  const image = context.getImageData(columnWidth, 0, Math.max(1, canvas.width - columnWidth), canvas.height);
  context.putImageData(image, 0, 0);
  context.clearRect(canvas.width - columnWidth, 0, columnWidth, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    const bin = Math.max(0, bins[Math.floor((1 - y / Math.max(1, canvas.height - 1)) * (bins.length - 1))] ?? 0);
    const color = getSpectrogramColor(colors, Math.min(1, Math.pow(bin, 0.68) * 1.18));
    context.fillStyle = rgba(color, 0.96);
    context.fillRect(canvas.width - columnWidth, y, columnWidth, 1);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
  }
  const context = canvas.getContext("2d")!;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

function fallbackPeaks(count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = index / count;
    return 0.18 + Math.abs(Math.sin(angle * Math.PI * 8)) * 0.32 + Math.abs(Math.sin(angle * Math.PI * 19)) * 0.16;
  });
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface HslColor {
  h: number;
  s: number;
  l: number;
}

function getCanvasThemeColors(canvas: HTMLCanvasElement): { accent: RgbColor; accentInk: RgbColor; bg: RgbColor } {
  const styles = getComputedStyle(canvas);
  return {
    accent: parseCssColor(styles.getPropertyValue("--acc")) ?? { r: 195, g: 245, b: 60 },
    accentInk: parseCssColor(styles.getPropertyValue("--acc-ink")) ?? { r: 16, g: 19, b: 10 },
    bg: parseCssColor(styles.getPropertyValue("--bg0")) ?? { r: 11, g: 13, b: 16 }
  };
}

function parseCssColor(value: string): RgbColor | null {
  const trimmed = value.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const hexValue = hex[1];
    if (!hexValue) {
      return null;
    }
    const raw = hexValue.length === 3 ? hexValue.split("").map((char) => `${char}${char}`).join("") : hexValue;
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16)
    };
  }
  const rgb = trimmed.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) {
    const [, red, green, blue] = rgb;
    if (!red || !green || !blue) {
      return null;
    }
    return {
      r: clampColor(Number(red)),
      g: clampColor(Number(green)),
      b: clampColor(Number(blue))
    };
  }
  return null;
}

function mixRgb(left: RgbColor, right: RgbColor, amount: number): RgbColor {
  const clamped = Math.max(0, Math.min(1, amount));
  return {
    r: Math.round(left.r + (right.r - left.r) * clamped),
    g: Math.round(left.g + (right.g - left.g) * clamped),
    b: Math.round(left.b + (right.b - left.b) * clamped)
  };
}

function rgbToHsl(color: RgbColor): HslColor {
  const red = color.r / 255;
  const green = color.g / 255;
  const blue = color.b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) {
    return { h: 0, s: 0, l: lightness };
  }
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  return {
    h: (hue * 60 + 360) % 360,
    s: saturation,
    l: lightness
  };
}

function hslToRgb(color: HslColor): RgbColor {
  const chroma = (1 - Math.abs(2 * color.l - 1)) * color.s;
  const hue = color.h / 60;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const match = color.l - chroma / 2;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (hue >= 0 && hue < 1) {
    red = chroma;
    green = x;
  } else if (hue < 2) {
    red = x;
    green = chroma;
  } else if (hue < 3) {
    green = chroma;
    blue = x;
  } else if (hue < 4) {
    green = x;
    blue = chroma;
  } else if (hue < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }
  return {
    r: clampColor((red + match) * 255),
    g: clampColor((green + match) * 255),
    b: clampColor((blue + match) * 255)
  };
}

function getSpectrogramColor(colors: { accent: RgbColor; accentInk: RgbColor; bg: RgbColor }, value: number): RgbColor {
  const accentShadow = mixRgb(colors.bg, colors.accent, 0.22);
  const accentMid = mixRgb(colors.bg, colors.accent, 0.68);
  const accentHot = mixRgb(colors.accent, { r: 255, g: 226, b: 95 }, 0.44);
  const whiteHot = mixRgb(accentHot, { r: 255, g: 255, b: 240 }, 0.58);
  const stops: Array<{ at: number; color: RgbColor }> = [
    { at: 0, color: mixRgb(colors.bg, colors.accentInk, 0.3) },
    { at: 0.2, color: accentShadow },
    { at: 0.42, color: mixRgb(accentShadow, { r: 28, g: 164, b: 190 }, 0.46) },
    { at: 0.66, color: accentMid },
    { at: 0.84, color: accentHot },
    { at: 1, color: whiteHot }
  ];
  const clamped = Math.max(0, Math.min(1, value));
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1]!;
    const next = stops[index]!;
    if (clamped <= next.at) {
      return mixRgb(previous.color, next.color, (clamped - previous.at) / Math.max(0.001, next.at - previous.at));
    }
  }
  return stops[stops.length - 1]!.color;
}

function rgba(color: RgbColor, alpha: number): string {
  return `rgb(${clampColor(color.r)} ${clampColor(color.g)} ${clampColor(color.b)} / ${Math.max(0, Math.min(1, alpha))})`;
}

function rgbToCss(color: RgbColor): string {
  return `rgb(${clampColor(color.r)} ${clampColor(color.g)} ${clampColor(color.b)})`;
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function loadVisualizerMode(): VisualizerMode {
  try {
    const value = window.localStorage.getItem(visualizerModeStorageKey);
    return value === "meter" || value === "spectrum" || value === "spectrogram" ? value : "spectrum";
  } catch {
    return "spectrum";
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadAppearanceSettings(): AppearanceSettings {
  try {
    const raw = window.localStorage.getItem(appearanceStorageKey);
    if (!raw) {
      return defaultAppearanceSettings;
    }
    const value = JSON.parse(raw) as Partial<AppearanceSettings>;
    const mode = value.mode === "light" || value.mode === "dark" ? value.mode : defaultAppearanceSettings.mode;
    const accent = isAccentColorId(value.accent) ? value.accent : defaultAppearanceSettings.accent;
    const displayFont = isDisplayFontId(value.displayFont) ? value.displayFont : defaultAppearanceSettings.displayFont;
    const backgroundImages = Array.isArray(value.backgroundImages)
      ? value.backgroundImages.map(normalizeSavedBackgroundImage).filter((image): image is SavedBackgroundImage => image != null).slice(0, 12)
      : [];
    const backgroundImagePath =
      typeof value.backgroundImagePath === "string" && value.backgroundImagePath.trim() ? value.backgroundImagePath : null;
    const backgroundImageUrl =
      typeof value.backgroundImageUrl === "string" && value.backgroundImageUrl.trim()
        ? value.backgroundImageUrl
        : backgroundImages.find((image) => image.path === backgroundImagePath)?.url ?? (backgroundImagePath ? pathToBackgroundUrl(backgroundImagePath) : null);
    const legacyBackground = backgroundImagePath && backgroundImageUrl ? { path: backgroundImagePath, url: backgroundImageUrl } : null;
    const backgroundDefaults = normalizeAppearanceBackgrounds(value.backgroundDefaults, legacyBackground);
    return { accent, backgroundDefaults, backgroundImagePath, backgroundImageUrl, backgroundImages, displayFont, mode };
  } catch {
    return defaultAppearanceSettings;
  }
}

function getAppearanceStyle(settings: AppearanceSettings): CSSProperties {
  const theme = settings.mode === "light" ? getLightThemeVariables() : getDarkThemeVariables();
  const accent = accentPalettes[settings.accent][settings.mode];
  const background = settings.backgroundDefaults[settings.mode];
  const backgroundUrl = background?.url ?? "";
  return {
    ...theme,
    "--acc": accent.acc,
    "--acc-dim": accent.accDim,
    "--acc-ink": accent.accInk,
    "--acc-line": accent.accLine,
    "--app-bg-image": backgroundUrl ? `url("${backgroundUrl}")` : "none",
    "--font-head": displayFonts[settings.displayFont].value,
    "--ok-line": accent.okLine
  } as CSSProperties;
}

function getDarkThemeVariables(): Record<string, string> {
  return {
    "--bg0": "#0b0d10",
    "--bg1": "#10131a",
    "--bg2": "#151923",
    "--bg3": "#1b2130",
    "--app-bg-opacity": "0.86",
    "--center-bg-tint": "rgba(11, 13, 16, 0.32)",
    "--center-bg-vignette": "rgba(11, 13, 16, 0.58)",
    "--line": "#1f2633",
    "--line2": "#2b3445",
    "--panel-bg0": "rgba(11, 13, 16, 0.68)",
    "--panel-bg1": "rgba(16, 19, 26, 0.7)",
    "--panel-bg2": "rgba(21, 25, 35, 0.64)",
    "--panel-bg3": "rgba(27, 33, 48, 0.6)",
    "--tx0": "#e9eef5",
    "--tx1": "#aab3c5",
    "--tx2": "#69748c"
  };
}

function getLightThemeVariables(): Record<string, string> {
  return {
    "--bg0": "#eef1ed",
    "--bg1": "#f8faf6",
    "--bg2": "#eef2ec",
    "--bg3": "#e4eadf",
    "--app-bg-opacity": "0.82",
    "--center-bg-tint": "rgba(238, 241, 237, 0.32)",
    "--center-bg-vignette": "rgba(238, 241, 237, 0.56)",
    "--line": "#d8dfd4",
    "--line2": "#c1ccbd",
    "--panel-bg0": "rgba(238, 241, 237, 0.66)",
    "--panel-bg1": "rgba(248, 250, 246, 0.68)",
    "--panel-bg2": "rgba(238, 242, 236, 0.62)",
    "--panel-bg3": "rgba(228, 234, 223, 0.58)",
    "--tx0": "#151a17",
    "--tx1": "#344038",
    "--tx2": "#5f6d64"
  };
}

function isAccentColorId(value: unknown): value is AccentColorId {
  return typeof value === "string" && value in accentPalettes;
}

function isDisplayFontId(value: unknown): value is DisplayFontId {
  return typeof value === "string" && value in displayFonts;
}

function normalizeAppearanceBackgrounds(value: unknown, fallback: SelectedBackgroundImage | null): AppearanceBackgrounds {
  if (value == null || typeof value !== "object") {
    return { dark: fallback, light: fallback };
  }
  const item = value as Partial<Record<AppearanceMode, SelectedBackgroundImage>>;
  const hasDark = Object.prototype.hasOwnProperty.call(item, "dark");
  const hasLight = Object.prototype.hasOwnProperty.call(item, "light");
  return {
    dark: hasDark ? normalizeSelectedBackgroundImage(item.dark) : fallback,
    light: hasLight ? normalizeSelectedBackgroundImage(item.light) : fallback
  };
}

function normalizeSelectedBackgroundImage(value: unknown): SelectedBackgroundImage | null {
  if (value == null || typeof value !== "object") {
    return null;
  }
  const item = value as Partial<SelectedBackgroundImage>;
  if (typeof item.path !== "string" || !item.path.trim()) {
    return null;
  }
  return {
    path: item.path,
    url: typeof item.url === "string" && item.url.trim() ? item.url : pathToBackgroundUrl(item.path)
  };
}

function normalizeSavedBackgroundImage(value: unknown): SavedBackgroundImage | null {
  if (value == null || typeof value !== "object") {
    return null;
  }
  const item = value as Partial<SavedBackgroundImage>;
  if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.path !== "string" || typeof item.addedAt !== "string") {
    return null;
  }
  return {
    id: item.id,
    name: item.name,
    path: item.path,
    url: typeof item.url === "string" && item.url.trim() ? item.url : pathToBackgroundUrl(item.path),
    addedAt: item.addedAt
  };
}

function pathToBackgroundUrl(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const wslDrivePath = normalized.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (wslDrivePath) {
    return encodeURI(`file:///${wslDrivePath[1].toUpperCase()}:/${wslDrivePath[2]}`);
  }
  const drivePath = normalized.match(/^([a-zA-Z]):\/(.*)$/);
  if (drivePath) {
    return encodeURI(`file:///${drivePath[1]}:/${drivePath[2]}`);
  }
  if (normalized.startsWith("/")) {
    return encodeURI(`file://${normalized}`);
  }
  return encodeURI(normalized);
}

function getFileAlbumTarget(file: LibraryFile): Pick<LibraryAlbumGroup, "artist" | "album" | "year"> | null {
  const album = file.displayTags.album?.trim();
  const artist = (file.displayTags.albumartist ?? file.displayTags.artist)?.trim();
  if (!album || !artist) {
    return null;
  }
  return {
    album,
    artist,
    year: (file.displayTags.year ?? file.displayTags.date ?? null)?.trim() || null
  };
}

function getViewSubtitle(view: string): string {
  if (view === "Home") {
    return "Dashboard";
  }
  if (view === "Imports") {
    return "Stage files, review detected metadata, then approve import into the library.";
  }
  if (view === "Duplicates") {
    return "Find exact duplicates and missing core metadata before proposing cleanup.";
  }
  if (view === "Albums") {
    return "Browse indexed album groups and start album playback.";
  }
  if (view === "Artists") {
    return "Browse artists by albums, genre, decade, and listening history.";
  }
  if (view === "Operations") {
    return "Review, approve, apply, and audit file and library mutations.";
  }
  if (view === "Discovery") {
    return "Search Soulseek through slskd without importing files directly into the library.";
  }
  if (view === "Playlists") {
    return "Play approved playlists and inspect their indexed library tracks.";
  }
  if (view === "Agent") {
    return "Search library contents, start playback, and propose playlist batches.";
  }
  if (view === "Jobs") {
    return "Inspect background jobs, progress, errors, and event history.";
  }
  return "Planned for a later phase.";
}

function operationErrorMessage(error: unknown): string {
  if (typeof error === "object" && error != null && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error);
}

function isOperationBatchExecutable(batch: OperationBatch): boolean {
  return batch.operations.length > 0;
}

function isOperationBatchRevertible(batch: OperationBatch): boolean {
  if (batch.status !== "applied" && batch.status !== "partially_applied") {
    return false;
  }
  const appliedOperations = batch.operations.filter((operation) => operation.status === "applied");
  return appliedOperations.length > 0 && appliedOperations.every((operation) => isOperationRevertible(operation));
}

function isOperationRevertible(operation: OperationBatch["operations"][number]): boolean {
  if (operation.type === "create_playlist") {
    return operation.after != null;
  }
  return (
    operation.before != null &&
    (operation.type === "update_playlist" ||
      operation.type === "delete_playlist" ||
      operation.type === "add_tracks_to_playlist" ||
      operation.type === "remove_tracks_from_playlist" ||
      operation.type === "associate_file_with_track" ||
      operation.type === "associate_track_with_album" ||
      operation.type === "merge_duplicate_tracks" ||
      operation.type === "mark_duplicate" ||
      operation.type === "set_file_metadata" ||
      operation.type === "set_rating" ||
      operation.type === "set_favorite_status" ||
      operation.type === "set_internal_tags")
  );
}

function operationNote(payload: unknown): string | null {
  if (typeof payload === "object" && payload != null && typeof (payload as { note?: unknown }).note === "string") {
    return (payload as { note: string }).note;
  }
  return null;
}

function formatCandidate(candidate: MetadataCandidate | null): string {
  if (!candidate) {
    return "none";
  }
  return [
    candidate.artist ?? "Unknown Artist",
    candidate.album ?? "Unknown Album",
    candidate.title ?? "Unknown Title",
    candidate.year ?? "-"
  ].join(" · ");
}

function metadataFromCandidate(candidate: MetadataCandidate): { artist: string; album: string; title: string; year: string } {
  return {
    artist: candidate.artist ?? "",
    album: candidate.album ?? "",
    title: candidate.title ?? "",
    year: candidate.year == null ? "" : String(candidate.year)
  };
}

function getReviewableImportItems(importBatch: ImportBatch): ImportItem[] {
  return importBatch.items.filter((item) => item.status === "needs_review");
}

function deriveImportBatchTitle(importBatch: ImportBatch): string {
  const reviewableItem = getReviewableImportItems(importBatch)[0] ?? importBatch.items[0];
  if (!reviewableItem) {
    return "Empty import";
  }

  const artist = reviewableItem.detectedArtist?.trim() || "Unknown Artist";
  const album = reviewableItem.detectedAlbum?.trim();
  if (album) {
    return `${artist} - ${album}`;
  }

  const sourceFolder = importBatch.source.split(/[\\/]/).filter(Boolean).at(-1);
  return sourceFolder || `${artist} - ${reviewableItem.detectedTitle ?? basenameFromPath(reviewableItem.stagingPath)}`;
}

function normalizeClientPath(path: string): string {
  const trimmed = path.trim();
  const windowsDrive = trimmed.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!windowsDrive) {
    return trimmed.replaceAll("\\", "/");
  }

  return `/mnt/${windowsDrive[1].toLowerCase()}/${windowsDrive[2].replaceAll("\\", "/")}`;
}

function deriveParsedListName(items: AgentParsedListItem[]): string {
  const first = items[0];
  if (!first) {
    return "Pasted Discovery List";
  }
  const prefix = first.artist ? `${first.artist} - ${first.title}` : first.title;
  return items.length === 1 ? prefix.slice(0, 160) : `${prefix} + ${items.length - 1} more`.slice(0, 160);
}

function messagesFromAgentThread(thread: AgentThreadResponse): AgentMessage[] {
  if (thread.messages.length === 0) {
    return [
      {
        id: "agent-welcome",
        role: "agent",
        text: "Ask me to find tracks, play matching tracks, or propose a playlist from the indexed library.",
        response: null
      }
    ];
  }

  return thread.messages.map((message) =>
    message.role === "user"
      ? { id: message.id, role: "user", text: message.text, response: null }
      : { id: message.id, role: "agent", text: message.text, response: message.response }
  );
}

function basenameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function BackendHealth({ state }: { state: HealthState }): ReactElement {
  if (state.status === "loading") {
    return <div className="health loading">Backend checking</div>;
  }

  if (state.status === "error") {
    return <div className="health error">Backend offline</div>;
  }

  return (
    <div className="health ready">
      Backend ok
      <span>{state.health.database.path}</span>
    </div>
  );
}
