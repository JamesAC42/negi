import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement
} from "react";
import {
  clusterDiscoveryGroups,
  filterDiscoveryGroups,
  filterDiscoveryGroupsByLibrary,
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
  playlistsResponseSchema,
  qualityUpgradeSuggestionsResponseSchema,
  tasteProfileResponseSchema,
  watchedLibraryScanResultSchema,
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
  type TasteProfileResponse
} from "@music-os/core";

type HealthState =
  | { status: "loading" }
  | { status: "ready"; health: HealthResponse }
  | { status: "error"; message: string };

type LibraryState =
  | { status: "loading" }
  | { status: "ready"; roots: LibraryRoot[]; files: LibraryFilesResponse["files"]; total: number }
  | { status: "error"; message: string; roots: LibraryRoot[]; files: LibraryFilesResponse["files"]; total: number };

type ImportsState =
  | { status: "loading" }
  | { status: "ready"; imports: ImportBatch[] }
  | { status: "error"; message: string; imports: ImportBatch[] };

type DuplicatesState =
  | { status: "loading" }
  | { status: "ready"; duplicates: DuplicateGroupsResponse }
  | { status: "error"; message: string; duplicates: DuplicateGroupsResponse };

type MetadataGapsState =
  | { status: "loading" }
  | { status: "ready"; gaps: MetadataGapsResponse }
  | { status: "error"; message: string; gaps: MetadataGapsResponse };

type QualityUpgradesState =
  | { status: "loading" }
  | { status: "ready"; upgrades: QualityUpgradeSuggestionsResponse }
  | { status: "error"; message: string; upgrades: QualityUpgradeSuggestionsResponse };

type IncompleteAlbumsState =
  | { status: "loading" }
  | { status: "ready"; albums: IncompleteAlbumsResponse }
  | { status: "error"; message: string; albums: IncompleteAlbumsResponse };

type AlbumMergeState =
  | { status: "loading" }
  | { status: "ready"; suggestions: AlbumMergeSuggestionsResponse }
  | { status: "error"; message: string; suggestions: AlbumMergeSuggestionsResponse };

type AlternateEditionsState =
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
  | { id: string; role: "agent"; text: string; response: AgentMessageResponse | null };

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

const navItems = ["Library", "Artists", "Albums", "Duplicates", "Imports", "Operations", "Discovery", "Playlists", "Agent", "Jobs", "Settings"];
const appearanceStorageKey = "music-os:appearance:v1";
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
  const [activeView, setActiveView] = useState("Library");
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [library, setLibrary] = useState<LibraryState>({
    status: "loading"
  });
  const [importsState, setImportsState] = useState<ImportsState>({ status: "loading" });
  const [duplicatesState, setDuplicatesState] = useState<DuplicatesState>({ status: "loading" });
  const [metadataGapsState, setMetadataGapsState] = useState<MetadataGapsState>({ status: "loading" });
  const [qualityUpgradesState, setQualityUpgradesState] = useState<QualityUpgradesState>({ status: "loading" });
  const [incompleteAlbumsState, setIncompleteAlbumsState] = useState<IncompleteAlbumsState>({ status: "loading" });
  const [albumMergeState, setAlbumMergeState] = useState<AlbumMergeState>({ status: "loading" });
  const [alternateEditionsState, setAlternateEditionsState] = useState<AlternateEditionsState>({ status: "loading" });
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
  const [bulkRenamePattern, setBulkRenamePattern] = useState("{artist} - {title}.{ext}");
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [playlistNameInput, setPlaylistNameInput] = useState("");
  const [playlistDescriptionInput, setPlaylistDescriptionInput] = useState("");
  const [playlistAddTargetId, setPlaylistAddTargetId] = useState("");
  const [selectedLibraryFileIds, setSelectedLibraryFileIds] = useState<Set<string>>(new Set());
  const [scanResult, setScanResult] = useState<LibraryScanResult | null>(null);
  const [watchedScanResult, setWatchedScanResult] = useState<WatchedLibraryScanResult | null>(null);
  const [busyRootId, setBusyRootId] = useState<string | null>(null);
  const [playbackBusy, setPlaybackBusy] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearanceSettings());
  const [artistsViewResetKey, setArtistsViewResetKey] = useState(0);
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
    volumePercent: 100,
    error: null
  });

  useEffect(() => {
    window.localStorage.setItem(appearanceStorageKey, JSON.stringify(appearance));
  }, [appearance]);

  async function refreshLibrary(query = search): Promise<void> {
    try {
      const [rootsResult, filesResult] = await Promise.all([listRoots(), listFiles(query)]);
      setLibrary({
        status: "ready",
        roots: rootsResult.roots,
        files: filesResult.files,
        total: filesResult.total
      });
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
      const result = await listAlbums();
      setAlbumsState({ status: "ready", albums: result });
    } catch (error) {
      setAlbumsState((current) => ({
        status: "error",
        message: getErrorMessage(error),
        albums: "albums" in current ? current.albums : emptyAlbums
      }));
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
    void refreshLibrary("");
    void refreshImports();
    void refreshDuplicates();
    void refreshMetadataGaps();
    void refreshQualityUpgrades();
    void refreshIncompleteAlbums();
    void refreshAlbumMergeSuggestions();
    void refreshAlternateEditions();
    void refreshOperations();
    void refreshAlbums();
    void refreshPlaylists();
    void refreshJobs();
    void refreshTasteProfile();
    void refreshDiscoveryHealth();
    void refreshDiscoveryDownloads();
    void refreshSavedDiscoveryCandidates();
    void refreshSavedDiscoveryLists();
    void refreshAgentThread();
    void refreshPlayback();
    return () => {
      cancelled = true;
    };
  }, []);

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
      return;
    }

    let lastTick = Date.now();
    const interval = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTick;
      lastTick = now;

      setPlayback((current) => {
        if (current.status !== "playing" || !current.currentFileId) {
          return current;
        }

        const nextPosition = current.positionMs + elapsed;
        return {
          ...current,
          positionMs: current.durationMs == null ? nextPosition : Math.min(nextPosition, current.durationMs)
        };
      });
    }, 250);

    return () => window.clearInterval(interval);
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
      await Promise.all([
        refreshLibrary(),
        refreshDuplicates(),
        refreshMetadataGaps(),
        refreshQualityUpgrades(),
        refreshIncompleteAlbums(),
        refreshAlbumMergeSuggestions(),
        refreshAlbums(),
        refreshAlternateEditions()
      ]);
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
      await Promise.all([
        refreshLibrary(),
        refreshDuplicates(),
        refreshMetadataGaps(),
        refreshQualityUpgrades(),
        refreshIncompleteAlbums(),
        refreshAlbumMergeSuggestions(),
        refreshAlbums(),
        refreshAlternateEditions()
      ]);
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
      await Promise.all([
        refreshLibrary(),
        refreshDuplicates(),
        refreshMetadataGaps(),
        refreshQualityUpgrades(),
        refreshIncompleteAlbums(),
        refreshAlbumMergeSuggestions(),
        refreshAlbums(),
        refreshAlternateEditions()
      ]);
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
      void Promise.all([
        refreshImports(),
        refreshLibrary(),
        refreshDuplicates(),
        refreshMetadataGaps(),
        refreshQualityUpgrades(),
        refreshIncompleteAlbums(),
        refreshAlbumMergeSuggestions(),
        refreshAlbums(),
        refreshAlternateEditions(),
        refreshPlaylists(),
        refreshJobs(),
        refreshDiscoveryDownloads()
      ]);
    } catch (error) {
      setOperationsError(error);
      void refreshOperations();
    }
  }

  async function handleRevertBatch(batchId: string): Promise<void> {
    try {
      const result = await revertOperationBatch(batchId);
      replaceOperationBatch(result.batch);
      void Promise.all([
        refreshLibrary(),
        refreshDuplicates(),
        refreshMetadataGaps(),
        refreshQualityUpgrades(),
        refreshIncompleteAlbums(),
        refreshAlbumMergeSuggestions(),
        refreshAlbums(),
        refreshAlternateEditions(),
        refreshPlaylists(),
        refreshJobs()
      ]);
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

  async function handleProposeRating(fileId: string, rating: number | null): Promise<void> {
    const result = await proposeRating(fileId, rating);
    replaceOperationBatch(result.batch);
    setActiveView("Operations");
  }

  async function handleProposeFavoriteStatus(fileId: string, status: "liked" | "disliked" | "neutral"): Promise<void> {
    const result = await proposeFavoriteStatus(fileId, {
      liked: status === "neutral" ? null : status === "liked",
      disliked: status === "neutral" ? null : status === "disliked"
    });
    replaceOperationBatch(result.batch);
    setActiveView("Operations");
  }

  async function handleProposePlaybackRating(fileId: string, rating: number | null): Promise<void> {
    const result = await proposeRating(fileId, rating);
    replaceOperationBatch(result.batch);
  }

  async function handleProposePlaybackFavoriteStatus(fileId: string, status: "liked" | "disliked" | "neutral"): Promise<void> {
    const result = await proposeFavoriteStatus(fileId, {
      liked: status === "neutral" ? null : status === "liked",
      disliked: status === "neutral" ? null : status === "disliked"
    });
    replaceOperationBatch(result.batch);
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

  function toggleLibraryFileSelection(fileId: string): void {
    setSelectedLibraryFileIds((current) => toggleSetValue(current, fileId));
  }

  function clearLibrarySelection(): void {
    setSelectedLibraryFileIds(new Set());
  }

  async function handleProposeBulkTags(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const tags = parseTagInput(bulkTagInput);
    const fileIds = [...selectedLibraryFileIds];
    if (fileIds.length === 0 || tags.length === 0) {
      return;
    }

    const result = await proposeBulkInternalTags(fileIds, tags);
    replaceOperationBatch(result.batch);
    setBulkTagInput("");
    setSelectedLibraryFileIds(new Set());
    setActiveView("Operations");
  }

  async function handleProposeBulkRename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const fileIds = [...selectedLibraryFileIds];
    const pattern = bulkRenamePattern.trim();
    if (fileIds.length === 0 || !pattern) {
      return;
    }

    const result = await proposeBulkRenameFiles(fileIds, pattern);
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

  async function handleSeekPlayback(event: MouseEvent<HTMLButtonElement>): Promise<void> {
    if (playbackBusy || playback.status === "stopped" || !playback.durationMs || playback.durationMs <= 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.width <= 0 ? 0 : (event.clientX - bounds.left) / bounds.width;
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

  function openAlbumPage(group: Pick<LibraryAlbumGroup, "artist" | "album" | "year">): void {
    const albumGroups = "albums" in albumsState ? albumsState.albums.albums : [];
    const matchingAlbum =
      albumGroups.find(
        (album) =>
          album.artist === group.artist &&
          album.album === group.album &&
          (album.year ?? null) === (group.year ?? null)
      ) ??
      albumGroups.find((album) => album.artist === group.artist && album.album === group.album);

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
      const response = await sendAgentMessage(message, agentThreadId ?? undefined);
      if (response.threadId) {
        setAgentThreadId(response.threadId);
      }
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: response.reply, response }
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
      const response = await sendAgentMessage(message, agentThreadId ?? undefined);
      if (response.threadId) {
        setAgentThreadId(response.threadId);
      }
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: response.reply, response }
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
      const response = await sendAgentMessage(message, agentThreadId ?? undefined);
      if (response.threadId) {
        setAgentThreadId(response.threadId);
      }
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: response.reply, response }
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
      const response = await sendAgentMessage(message, agentThreadId ?? undefined);
      if (response.threadId) {
        setAgentThreadId(response.threadId);
      }
      setAgentMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", text: response.reply, response }
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
  const selectedRoot = roots[0] ?? null;
  const currentPlaybackFile = useMemo(
    () => (playback.currentFileId ? files.find((file) => file.id === playback.currentFileId) ?? null : null),
    [files, playback.currentFileId]
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
          {navItems.map((item) => (
            <button
              className={item === activeView ? "navItem active" : "navItem"}
              key={item}
              type="button"
              onClick={() => {
                if (item === "Artists" && activeView === "Artists") {
                  setArtistsViewResetKey((current) => current + 1);
                }
                setActiveView(item);
              }}
            >
              <NavIcon view={item} />
              {item}
            </button>
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

        {activeView === "Library" ? (
          <LibraryView
            bulkRenamePattern={bulkRenamePattern}
            bulkTagInput={bulkTagInput}
            busyRootId={busyRootId}
            files={files}
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
            onInspectFile={handleInspectLibraryFile}
            onOpenAlbumPage={openAlbumPage}
            onOpenArtistPage={openArtistPage}
            onPlayFile={handlePlayFile}
            onProposeAddToPlaylist={handleProposeAddSelectedToPlaylist}
            onProposeBulkRename={handleProposeBulkRename}
            onProposeBulkTags={handleProposeBulkTags}
            onProposePlaylist={handleProposeSelectedPlaylist}
            onProposeFavoriteStatus={handleProposeFavoriteStatus}
            onProposeRating={handleProposeRating}
            onRemoveFile={handleProposeRemoveFile}
            onRemoveRoot={handleRemoveRoot}
            onScanRoot={handleScanRoot}
            onScanWatchedRoots={handleScanWatchedRoots}
            onSearch={handleSearch}
            onToggleFileSelection={toggleLibraryFileSelection}
            onToggleRootWatch={handleToggleRootWatch}
          />
        ) : activeView === "Artists" ? (
          <ArtistsView
            albumsState={albumsState}
            initialTarget={artistViewTarget}
            playbackBusy={playbackBusy}
            resetKey={artistsViewResetKey}
            onPlayAlbum={handlePlayAlbum}
            onPlayFile={handlePlayFile}
          />
        ) : activeView === "Albums" ? (
          <AlbumsView
            albumsState={albumsState}
            initialTarget={albumViewTarget}
            playbackBusy={playbackBusy}
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
            onCreateImport={handleCreateImport}
            onInspect={handleInspectImportItem}
            onReject={handleRejectImport}
            onSelectImportFiles={handleSelectImportFiles}
            onSelectImportFolder={handleSelectImportFolder}
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
            onProposeCleanup={handleProposeDuplicateCleanup}
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
            onCancelDownload={handleCancelDiscoveryDownload}
            onInspectGroup={setInspectedDiscoveryGroupId}
            onOpenImports={() => setActiveView("Imports")}
            onRefreshHealth={refreshDiscoveryHealth}
            onProposeSavedCandidateDownload={handleProposeSavedDiscoveryCandidateDownload}
            onRemoveSavedCandidate={handleRemoveSavedDiscoveryCandidate}
            onRetryDownload={handleRetryDiscoveryDownload}
            onSaveCandidate={handleSaveDiscoveryCandidate}
            onSaveParsedList={handleSaveParsedDiscoveryList}
            onSearchParsedItem={handleSearchParsedDiscoveryItem}
            onSendCandidateToAgent={handleSendDiscoveryCandidateToAgent}
            onSendSavedCandidateToAgent={handleSendSavedDiscoveryCandidateToAgent}
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
            playlistsState={playlistsState}
            onPlayPlaylist={handlePlayPlaylist}
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
            <div className="progressFill" style={{ width: `${getProgressPercent(playback)}%` }} />
          </div>
        </button>
        <div className="playerBody">
          <button
            aria-label="Open now playing view"
            className="nowPlaying"
            disabled={!playback.currentFileId}
            type="button"
            onClick={() => setNowPlayingOpen(true)}
          >
            <div className={playback.status === "playing" ? "playerGlyph live" : "playerGlyph"}>
              {playback.currentFileId ? (
                <Artwork className="playerArt" src={artworkFileUrl(playback.currentFileId)} />
              ) : null}
              <div className="eqBars" aria-hidden="true">
                <span className="eqBar" />
                <span className="eqBar" />
                <span className="eqBar" />
              </div>
            </div>
            <div className="nowPlayingText">
              <strong>{playback.currentDisplayName ?? "Nothing queued"}</strong>
              <span className="npMeta">
                <span className={`npStatusDot ${playback.status}`} aria-hidden="true" />
                <span>{playback.status}</span>
                {playback.queueIndex != null && playback.queue.length > 0 ? (
                  <span className="queueBadge">
                    {playback.queueIndex + 1} / {playback.queue.length}
                  </span>
                ) : null}
                {playback.error ? <span className="playerError" title={playback.error}>{playback.error}</span> : null}
              </span>
            </div>
          </button>
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
          files={files}
          playback={playback}
          playbackBusy={playbackBusy}
          onClose={() => setNowPlayingOpen(false)}
          onFavoriteStatus={handleProposePlaybackFavoriteStatus}
          onNext={handleNext}
          onPauseResume={handlePauseResume}
          onPlayFile={handlePlayFile}
          onPrevious={handlePrevious}
          onRating={handleProposePlaybackRating}
        />
      ) : null}
    </main>
  );
}

async function fetchBackendHealth(): Promise<HealthResponse> {
  return getJson("/health", healthResponseSchema);
}

function artworkFileUrl(fileId: string): string {
  return `http://127.0.0.1:47831/artwork/file/${encodeURIComponent(fileId)}`;
}

function artworkAlbumUrl(albumId: string): string {
  return `http://127.0.0.1:47831/artwork/album/${encodeURIComponent(albumId)}`;
}

function artistImageUrl(artist: string): string {
  return `http://127.0.0.1:47831/artist-image/${encodeURIComponent(artist)}`;
}

function Artwork({ src, className }: { src: string | null; className: string }): ReactElement {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <span aria-hidden="true" className={`${className} artFallback`}>
        <svg viewBox="0 0 16 16">
          <path d="M13 2 6 3.5v7.2a2.6 2.6 0 1 0 1.2 2.2V6.5L11.8 5v4.2A2.6 2.6 0 1 0 13 11.3z" />
        </svg>
      </span>
    );
  }
  return <img alt="" className={className} loading="lazy" src={src} onError={() => setFailedSrc(src)} />;
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

function TransportIcon({ shape }: { shape: "play" | "pause" | "stop" | "next" | "previous" }): ReactElement {
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
      ) : (
        <path d="M13 2.5v11l-7-5.5zm-8 0H3v11h2z" />
      )}
    </svg>
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
    view === "Library"
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
      {name === "library" ? (
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
      ) : (
        <path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h9" />
      )}
    </svg>
  );
}

function LibraryView({
  bulkRenamePattern,
  bulkTagInput,
  busyRootId,
  files,
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
  onInspectFile,
  onOpenAlbumPage,
  onOpenArtistPage,
  onPlayFile,
  onProposeAddToPlaylist,
  onProposeBulkRename,
  onProposeBulkTags,
  onProposePlaylist,
  onProposeFavoriteStatus,
  onProposeRating,
  onRemoveFile,
  onRemoveRoot,
  onScanRoot,
  onScanWatchedRoots,
  onSearch,
  onToggleFileSelection,
  onToggleRootWatch
}: {
  bulkRenamePattern: string;
  bulkTagInput: string;
  busyRootId: string | null;
  files: LibraryFile[];
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
  onInspectFile(fileId: string): Promise<void>;
  onOpenAlbumPage(group: LibraryAlbumGroup): void;
  onOpenArtistPage(artist: string): void;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
  onProposeAddToPlaylist(event: FormEvent<HTMLFormElement>): Promise<void>;
  onProposeBulkRename(event: FormEvent<HTMLFormElement>): Promise<void>;
  onProposeBulkTags(event: FormEvent<HTMLFormElement>): Promise<void>;
  onProposePlaylist(event: FormEvent<HTMLFormElement>): Promise<void>;
  onProposeFavoriteStatus(fileId: string, status: "liked" | "disliked" | "neutral"): Promise<void>;
  onProposeRating(fileId: string, rating: number | null): Promise<void>;
  onRemoveFile(file: LibraryFile): Promise<void>;
  onRemoveRoot(root: LibraryRoot): Promise<void>;
  onScanRoot(rootId: string): Promise<void>;
  onScanWatchedRoots(): Promise<void>;
  onSearch(event: FormEvent<HTMLFormElement>): Promise<void>;
  onToggleFileSelection(fileId: string): void;
  onToggleRootWatch(root: LibraryRoot): Promise<void>;
}): ReactElement {
  const selectedCount = selectedFileIds.size;
  const watchedRootCount = roots.filter((root) => root.watchEnabled).length;
  const [formatFilter, setFormatFilter] = useState<LibraryFormatFilter>("all");
  const [missingFilter, setMissingFilter] = useState<LibraryMissingFilter>("present");
  const [favoriteFilter, setFavoriteFilter] = useState<LibraryFavoriteFilter>("all");
  const [minimumRating, setMinimumRating] = useState("");
  const [minimumPlays, setMinimumPlays] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showRoots, setShowRoots] = useState(false);
  const albumLibraryRef = useRef<HTMLElement | null>(null);
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
  const albumGroups = useMemo(() => groupLibraryFilesByAlbum(filteredFiles), [filteredFiles]);
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

  useEffect(() => {
    const list = albumLibraryRef.current;
    const scroller = list?.closest(".centerPane") as HTMLElement | null;
    if (!list || !scroller || albumGroups.length === 0) {
      setVisibleAlbumRange({ start: 0, end: Math.min(albumGroups.length, 16) });
      return;
    }

    const updateVisibleRange = () => {
      const listTop = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const overscan = 900;
      const viewportTop = Math.max(0, scroller.scrollTop - listTop - overscan);
      const viewportBottom = Math.min(albumGroupTotalHeight, scroller.scrollTop - listTop + scroller.clientHeight + overscan);
      const start = Math.max(0, getVirtualIndexBeforeOffset(albumGroupOffsets, viewportTop) - 1);
      const end = Math.min(albumGroups.length, getVirtualIndexAfterOffset(albumGroupOffsets, viewportBottom) + 2);
      setVisibleAlbumRange((current) => (current.start === start && current.end === end ? current : { start, end }));
    };

    updateVisibleRange();
    scroller.addEventListener("scroll", updateVisibleRange, { passive: true });
    window.addEventListener("resize", updateVisibleRange);
    return () => {
      scroller.removeEventListener("scroll", updateVisibleRange);
      window.removeEventListener("resize", updateVisibleRange);
    };
  }, [albumGroupOffsets, albumGroupTotalHeight, albumGroups.length]);

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
                {filteredFiles.length.toLocaleString()} of {files.length.toLocaleString()} shown
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
              <span><UiIcon name="format" />Format</span>
              <select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as LibraryFormatFilter)}>
                <option value="all">All</option>
                <option value="lossless">Lossless</option>
                <option value="compressed">Compressed</option>
              </select>
            </label>
            <label>
              <span><UiIcon name="status" />Status</span>
              <select value={missingFilter} onChange={(event) => setMissingFilter(event.target.value as LibraryMissingFilter)}>
                <option value="present">Present</option>
                <option value="missing">Missing</option>
                <option value="all">All</option>
              </select>
            </label>
            <label>
              <span><UiIcon name="preference" />Preference</span>
              <select value={favoriteFilter} onChange={(event) => setFavoriteFilter(event.target.value as LibraryFavoriteFilter)}>
                <option value="all">All</option>
                <option value="liked">Liked</option>
                <option value="disliked">Disliked</option>
                <option value="unrated">Unrated</option>
              </select>
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
          <select
            aria-label="Existing playlist"
            disabled={selectedCount === 0 || playlists.length === 0}
            value={playlistAddTargetId}
            onChange={(event) => setPlaylistAddTargetId(event.target.value)}
          >
            <option value="">Choose playlist</option>
            {playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {playlist.name}
              </option>
            ))}
          </select>
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
          <button className="secondary" disabled={selectedCount === 0} type="button" onClick={onClearSelection}>
            Clear
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
            {virtualAlbumGroups.map((group) => (
              <section className="libraryAlbumGroup" key={group.key} aria-label={`${group.artist} - ${group.album}`}>
                <div className="libraryAlbumArt">
                  <Artwork className="albumGroupArt" src={artworkFileUrl(group.files[0].id)} />
                </div>
                <div className="libraryAlbumContent">
                  <div className="libraryAlbumHeader">
                    <div>
                      <button className="libraryAlbumTitleButton" type="button" onClick={() => onOpenAlbumPage(group)}>
                        <strong>{group.album}</strong>
                      </button>
                      <span>
                        <button className="libraryAlbumArtistButton" type="button" onClick={() => onOpenArtistPage(group.artist)}>
                          {group.artist}
                        </button>
                        {group.year ? ` · ${group.year}` : ""} · {group.files.length} track{group.files.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <span>{group.formats.join("/")}</span>
                  </div>
                  <div className="albumTrackHeader">
                    <span>Select</span>
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
                      return (
                        <div className={isCurrent ? "albumTrackRow active" : "albumTrackRow"} key={file.id}>
                          <label className="rowSelect" title="Select for bulk actions">
                            <input
                              checked={selectedFileIds.has(file.id)}
                              type="checkbox"
                              onChange={() => onToggleFileSelection(file.id)}
                            />
                          </label>
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
                          <span>{formatTrackNumber(file)}</span>
                          <span className="trackTitle" title={file.path}>{tags.title ?? file.filename}</span>
                          <span>{file.durationMs == null ? "-" : formatTime(file.durationMs)}</span>
                          <span>{formatBytes(file.sizeBytes)}</span>
                          <span>{formatFileFormat(file)}</span>
                          <span title={formatListenTooltip(file)}>{formatListenStats(file)}</span>
                          <span className={file.missing ? "statusPill warning" : "statusPill"}>{file.scanStatus}</span>
                          <span className="rowActions">
                            <select
                              aria-label={`Rating for ${tags.title ?? file.filename}`}
                              title="Rating"
                              value={file.rating ?? ""}
                              onChange={(event) =>
                                void onProposeRating(file.id, event.target.value === "" ? null : Number(event.target.value))
                              }
                            >
                              <option value="">–</option>
                              <option value="5">5</option>
                              <option value="4">4</option>
                              <option value="3">3</option>
                              <option value="2">2</option>
                              <option value="1">1</option>
                              <option value="0">0</option>
                            </select>
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
            ))}
            {virtualBottomPadding > 0 ? <div className="virtualAlbumSpacer" style={{ height: `${virtualBottomPadding}px` }} /> : null}
          </>
        )}
      </section>
    </>
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
  importPaths,
  importsState,
  roots,
  setImportPaths,
  onApprove,
  onCreateImport,
  onInspect,
  onReject,
  onSelectImportFiles,
  onSelectImportFolder
}: {
  importPaths: string;
  importsState: ImportsState;
  roots: LibraryRoot[];
  setImportPaths(value: string): void;
  onApprove(importItemId: string): Promise<void>;
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
          imports.flatMap((batch) =>
            batch.items.map((item) => (
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
                  <button disabled={item.status !== "needs_review" || roots.length === 0} type="button" onClick={() => void onApprove(item.id)}>
                    Approve
                  </button>
                  <button className="secondary" disabled={item.status === "imported" || item.status === "rejected"} type="button" onClick={() => void onReject(item.id)}>
                    Reject
                  </button>
                </div>
              </div>
            ))
          )
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
  onProposeCleanup
}: {
  albumMergeState: AlbumMergeState;
  alternateEditionsState: AlternateEditionsState;
  duplicatesState: DuplicatesState;
  incompleteAlbumsState: IncompleteAlbumsState;
  metadataGapsState: MetadataGapsState;
  qualityUpgradesState: QualityUpgradesState;
  onEditMetadata(file: LibraryFile): void;
  onProposeAlbumMerge(canonicalAlbum: string, fileIds: string[]): Promise<void>;
  onProposeCleanup(group: LibraryDuplicateGroup): Promise<void>;
}): ReactElement {
  const albumMergeSuggestions = "suggestions" in albumMergeState ? albumMergeState.suggestions : emptyAlbumMergeSuggestions;
  const alternateEditions = "editions" in alternateEditionsState ? alternateEditionsState.editions : emptyAlternateEditions;
  const duplicates = "duplicates" in duplicatesState ? duplicatesState.duplicates : emptyDuplicates;
  const incompleteAlbums = "albums" in incompleteAlbumsState ? incompleteAlbumsState.albums : emptyIncompleteAlbums;
  const metadataGaps = "gaps" in metadataGapsState ? metadataGapsState.gaps : emptyMetadataGaps;
  const qualityUpgrades = "upgrades" in qualityUpgradesState ? qualityUpgradesState.upgrades : emptyQualityUpgrades;

  return (
    <>
      {duplicatesState.status === "error" ? <div className="inlineError">{duplicatesState.message}</div> : null}
      {albumMergeState.status === "error" ? <div className="inlineError">{albumMergeState.message}</div> : null}
      {alternateEditionsState.status === "error" ? <div className="inlineError">{alternateEditionsState.message}</div> : null}
      {incompleteAlbumsState.status === "error" ? <div className="inlineError">{incompleteAlbumsState.message}</div> : null}
      {metadataGapsState.status === "error" ? <div className="inlineError">{metadataGapsState.message}</div> : null}
      {qualityUpgradesState.status === "error" ? <div className="inlineError">{qualityUpgradesState.message}</div> : null}
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
      <section className="duplicatesList" aria-label="Alternate edition groups">
        <div className="cleanupSectionHeader">
          <div>
            <h2>Alternate Editions</h2>
            <p>Likely standard, deluxe, remastered, mono, stereo, or expanded editions to review before merging anything.</p>
          </div>
        </div>
        {alternateEditions.total === 0 ? (
          <div className="emptyState">
            {alternateEditionsState.status === "loading" ? "Checking alternate editions." : "No likely alternate editions found."}
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
      <section className="duplicatesList" aria-label="Incomplete albums">
        <div className="cleanupSectionHeader">
          <div>
            <h2>Incomplete Albums</h2>
            <p>Albums whose indexed track numbers prove missing tracks.</p>
          </div>
        </div>
        {incompleteAlbums.total === 0 ? (
          <div className="emptyState">
            {incompleteAlbumsState.status === "loading" ? "Checking album track totals." : "No incomplete albums detected."}
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
      <section className="duplicatesList" aria-label="Album merge suggestions">
        <div className="cleanupSectionHeader">
          <div>
            <h2>Album Merge</h2>
            <p>Likely variant album names for the same artist and base title.</p>
          </div>
        </div>
        {albumMergeSuggestions.total === 0 ? (
          <div className="emptyState">
            {albumMergeState.status === "loading" ? "Checking album variants." : "No likely album merge suggestions found."}
          </div>
        ) : (
          albumMergeSuggestions.suggestions.map((suggestion) => {
            const mergeFileIds = suggestion.variants
              .filter((variant) => variant.album !== suggestion.canonicalAlbum)
              .flatMap((variant) => variant.files.map((file) => file.id));
            return (
              <div className="qualityUpgradeItem" key={suggestion.key}>
                <div className="qualityUpgradeHeader">
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
          })
        )}
      </section>
      <section className="duplicatesList" aria-label="Quality upgrades">
        <div className="cleanupSectionHeader">
          <div>
            <h2>Quality Upgrades</h2>
            <p>Likely lower-quality copies when a better matching track is already indexed.</p>
          </div>
        </div>
        {qualityUpgrades.total === 0 ? (
          <div className="emptyState">
            {qualityUpgradesState.status === "loading" ? "Checking track quality groups." : "No likely quality upgrades found."}
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
      <section className="duplicatesList" aria-label="Duplicate groups">
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
          duplicates.groups.map((group) => {
            const keepFile = chooseDuplicateKeepFile(group.files);
            const removeCount = group.files.length - 1;
            return (
              <div className="duplicateGroup" key={group.key}>
                <div className="duplicateGroupHeader">
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
          })
        )}
      </section>
      <section className="duplicatesList" aria-label="Missing metadata">
        <div className="cleanupSectionHeader">
          <div>
            <h2>Missing Metadata</h2>
            <p>Files missing title, artist, album, or year tags.</p>
          </div>
        </div>
        {metadataGaps.total === 0 ? (
          <div className="emptyState">
            {metadataGapsState.status === "loading" ? "Checking metadata completeness." : "No core metadata gaps found."}
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
    </>
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
                    {job.type} · {formatDateTime(job.createdAt)}
                  </span>
                  <div className="progressRail">
                    <div className="progressFill" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                  </div>
                </div>
                <span className={job.status === "failed" || job.status === "cancelled" ? "statusPill warning" : "statusPill"}>
                  {job.status}
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
                  {selectedJob.job.status}
                </span>
              </div>
              <div className="jobFacts">
                <span>Type</span>
                <strong>{selectedJob.job.type}</strong>
                <span>Progress</span>
                <strong>{Math.round(selectedJob.job.progress * 100)}%</strong>
                <span>Created</span>
                <strong>{formatDateTime(selectedJob.job.createdAt)}</strong>
                <span>Completed</span>
                <strong>{selectedJob.job.completedAt ? formatDateTime(selectedJob.job.completedAt) : "not complete"}</strong>
              </div>
              {selectedJob.job.error ? <div className="inlineError">{formatUnknown(selectedJob.job.error)}</div> : null}
              <div className="jobEvents" aria-label="Job events">
                {selectedJob.events.length === 0 ? (
                  <div className="emptyState">No events recorded for this job.</div>
                ) : (
                  selectedJob.events.map((event) => (
                    <div className="jobEvent" key={event.id}>
                      <span>
                        {formatDateTime(event.timestamp)} · {event.level}
                      </span>
                      <strong>{event.message}</strong>
                      {event.data ? <code>{formatUnknown(event.data)}</code> : null}
                    </div>
                  ))
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
            <select
              value={appearance.mode}
              onChange={(event) =>
                setAppearance((current) => ({
                  ...current,
                  mode: event.target.value as AppearanceMode,
                  accent: isAccentColorId(current.accent) ? current.accent : defaultAppearanceSettings.accent
                }))
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label className="settingsField compact">
            <span>Display font</span>
            <select
              value={appearance.displayFont}
              onChange={(event) =>
                setAppearance((current) => ({
                  ...current,
                  displayFont: event.target.value as DisplayFontId
                }))
              }
            >
              {fontOptions.map(([id, font]) => (
                <option key={id} value={id}>
                  {font.label}
                </option>
              ))}
            </select>
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
  onCancelDownload,
  onInspectGroup,
  onOpenImports,
  onRefreshHealth,
  onProposeSavedCandidateDownload,
  onRemoveSavedCandidate,
  onRetryDownload,
  onSaveCandidate,
  onSaveParsedList,
  onSearchParsedItem,
  onSendCandidateToAgent,
  onSendSavedCandidateToAgent,
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
  onCancelDownload(jobId: string): Promise<void>;
  onInspectGroup(groupId: string): void;
  onOpenImports(): void;
  onRefreshHealth(): Promise<void>;
  onProposeSavedCandidateDownload(candidate: SavedDiscoveryCandidate): Promise<void>;
  onRemoveSavedCandidate(candidateId: string): Promise<void>;
  onRetryDownload(jobId: string): Promise<void>;
  onSaveCandidate(group: DiscoveryGroup): Promise<void>;
  onSaveParsedList(): Promise<void>;
  onSearchParsedItem(item: AgentParsedListItem): Promise<void>;
  onSendCandidateToAgent(group: DiscoveryGroup): Promise<void>;
  onSendSavedCandidateToAgent(candidate: SavedDiscoveryCandidate): Promise<void>;
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
  const groups = useMemo(
    () =>
      sortDiscoveryGroups(
        filterDiscoveryGroupsByLibrary(
          filterDiscoveryGroups(groupDiscoveryResults(discoveryState.results, groupingQuery), formatFilter, availabilityFilter),
          libraryFiles,
          libraryFilter
        ),
        sortMode
      ),
    [availabilityFilter, discoveryState.results, formatFilter, groupingQuery, libraryFiles, libraryFilter, sortMode]
  );
  const clusters = useMemo(() => clusterDiscoveryGroups(groups), [groups]);
  const unfilteredGroupCount = useMemo(
    () => groupDiscoveryResults(discoveryState.results, groupingQuery).length,
    [discoveryState.results, groupingQuery]
  );
  const actionableGroupCount = useMemo(
    () =>
      filterDiscoveryGroupsByLibrary(groupDiscoveryResults(discoveryState.results, groupingQuery), libraryFiles, "actionable").length,
    [discoveryState.results, groupingQuery, libraryFiles]
  );
  const [releaseFilter, setReleaseFilter] = useState<DiscoveryReleaseFilter>("recommended");
  const [visibleClusterLimit, setVisibleClusterLimit] = useState(24);
  const releaseFilteredClusters = useMemo(
    () => filterDiscoveryClustersByRelease(clusters, libraryFiles, releaseFilter),
    [clusters, libraryFiles, releaseFilter]
  );
  const topCandidateClusters = useMemo(
    () =>
      releaseFilteredClusters
        .filter((cluster) => cluster.bestGroup.availableCount > 0)
        .slice(0, 6),
    [releaseFilteredClusters]
  );
  const visibleClusters = releaseFilteredClusters.slice(0, visibleClusterLimit);
  const hiddenClusterCount = Math.max(0, releaseFilteredClusters.length - visibleClusters.length);
  const inspectedGroup = groups.find((group) => group.id === inspectedGroupId) ?? null;
  const selectedGroupCount = selectedGroupIds.size;
  const selectedFileCount = discoveryState.results.filter((result) => selectedFileIds.has(result.id) && !result.isLocked && isAudioDiscoveryResult(result)).length;
  const downloadsConfigured = discoveryState.health?.downloadsConfigured === true;
  const canDownload = selectedFileCount > 0 && downloadState.status !== "working" && downloadsConfigured;
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
  const stagedDownloadCount = downloadJobs.reduce((totalCount, job) => totalCount + job.completedCount, 0);
  const discoveryStatusLabel = discoveryState.health?.reachable ? "Connected" : "Needs Check";
  const discoveryStatusDetail = discoveryState.health?.message ?? discoveryState.health?.url ?? "Check slskd before searching.";

  useEffect(() => {
    setVisibleClusterLimit(24);
  }, [availabilityFilter, discoveryState.results, formatFilter, groupingQuery, libraryFilter, releaseFilter, sortMode]);

  return (
    <section className="discoveryControls discoveryPage" aria-label="Discovery">
      <section className="discoveryHero">
        <div className="discoveryHeroCopy">
          <span className="eyebrow">Discovery</span>
          <h2>Find, compare, and stage albums.</h2>
          <p>Search slskd, review candidate folders against your library, then create a reviewable download batch for Imports.</p>
        </div>
        <form className="discoverySearchForm" onSubmit={(event) => void onSearch(event)}>
          <label>
            <span>Source</span>
            <select
              aria-label="Discovery source"
              value={discoverySource}
              onChange={(event) => setDiscoverySource(event.target.value as DiscoverySource)}
            >
              <option value="slskd">slskd</option>
            </select>
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
      </section>

      <div className="discoveryWorkflowStrip" aria-label="Discovery workflow">
        <div>
          <span>01</span>
          <strong>Search</strong>
          <small>{discoveryStatusLabel}</small>
        </div>
        <div>
          <span>02</span>
          <strong>Review</strong>
          <small>{releaseFilteredClusters.length.toLocaleString()} release sections</small>
        </div>
        <div>
          <span>03</span>
          <strong>Select</strong>
          <small>{selectedFileCount.toLocaleString()} files staged</small>
        </div>
        <div>
          <span>04</span>
          <strong>Import</strong>
          <small>{activeDownloadCount.toLocaleString()} active · {stagedDownloadCount.toLocaleString()} ready</small>
        </div>
      </div>

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
                <button
                  disabled={!canDownload}
                  title={downloadsConfigured ? undefined : "Set MUSIC_OS_SLSKD_DOWNLOAD_DIR before proposing downloads"}
                  type="button"
                  onClick={() => void onDownloadSelection()}
                >
                  {downloadState.status === "working" ? "Creating Batch" : `Propose ${selectedFileCount.toLocaleString()} File${selectedFileCount === 1 ? "" : "s"}`}
                </button>
              </div>
              <div className="discoveryRefiners">
                <label>
                  <span>Sort</span>
                  <select value={sortMode} onChange={(event) => setSortMode(event.target.value as DiscoverySort)}>
                    <option value="best">Best candidates</option>
                    <option value="match">Closest query match</option>
                    <option value="tracks">Most tracks</option>
                    <option value="size">Largest folders</option>
                    <option value="user">User / folder</option>
                  </select>
                </label>
                <label>
                  <span>Format</span>
                  <select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as DiscoveryFormatFilter)}>
                    <option value="all">All formats</option>
                    <option value="lossless">Lossless folders</option>
                    <option value="compressed">Compressed folders</option>
                  </select>
                </label>
                <label>
                  <span>Availability</span>
                  <select
                    value={availabilityFilter}
                    onChange={(event) => setAvailabilityFilter(event.target.value as DiscoveryAvailabilityFilter)}
                  >
                    <option value="available">Unlocked folders</option>
                    <option value="all">All folders</option>
                  </select>
                </label>
                <label>
                  <span>Library</span>
                  <select value={libraryFilter} onChange={(event) => setLibraryFilter(event.target.value as DiscoveryLibraryFilter)}>
                    <option value="actionable">Missing or upgrades</option>
                    <option value="missing">Missing only</option>
                    <option value="owned">Owned or upgrades</option>
                    <option value="all">All candidates</option>
                  </select>
                </label>
                <label>
                  <span>Release Type</span>
                  <select value={releaseFilter} onChange={(event) => setReleaseFilter(event.target.value as DiscoveryReleaseFilter)}>
                    <option value="recommended">Recommended</option>
                    <option value="all">All release sections</option>
                    <option value="albums">Album-like sections</option>
                    <option value="singles">Singles / loose files</option>
                    <option value="collections">Large collections</option>
                    <option value="upgrades">Possible upgrades</option>
                  </select>
                </label>
              </div>
            </section>
          ) : null}

          {topCandidateClusters.length > 0 ? (
            <section className="discoveryHighlights" aria-label="Top Discovery candidates">
              <div className="discoveryHighlightsHeader">
                <div>
                  <span className="eyebrow">Best Matches</span>
                  <strong>Start with these candidates</strong>
                  <span>Stageable releases ranked by query match, source quality, and library usefulness.</span>
                </div>
              </div>
              <div className="discoveryHighlightGrid">
                {topCandidateClusters.map((cluster) => (
                  <DiscoveryHighlightCard
                    cluster={cluster}
                    key={cluster.id}
                    libraryMatch={summarizeDiscoveryLibraryMatch(cluster.bestGroup, libraryFiles)}
                    selectedFileIds={selectedFileIds}
                    onGroupSelect={onGroupSelect}
                    onInspectGroup={onInspectGroup}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="discoveryResults" aria-label="Discovery results">
            <div className="discoveryResultsHeader">
              <div>
                <span className="eyebrow">Browse Sources</span>
                <strong>{groupingQuery ? `Results for "${groupingQuery}"` : "Search results"}</strong>
              </div>
              {selectedFileCount > 0 ? (
                <span className="statusPill">{selectedFileCount.toLocaleString()} selected files</span>
              ) : null}
            </div>
            {releaseFilteredClusters.length === 0 ? (
              <div className="emptyState">
                {discoveryState.status === "searching"
                  ? "Searching slskd."
                  : discoveryState.results.length > 0
                    ? "No results match the active Discovery filters."
                    : "Search results will appear here. Downloads will be staged through Imports in the next step."}
              </div>
            ) : (
              <>
                {visibleClusters.map((cluster) => (
                  <DiscoveryClusterResult
                    cluster={cluster}
                    expanded={expandedClusterIds.has(cluster.id)}
                    expandedGroupIds={expandedGroupIds}
                    key={cluster.id}
                    libraryFiles={libraryFiles}
                    selectedFileIds={selectedFileIds}
                    selectedGroupIds={selectedGroupIds}
                    onGroupSelect={onGroupSelect}
                    onInspectGroup={onInspectGroup}
                    onSaveCandidate={onSaveCandidate}
                    onSendCandidateToAgent={onSendCandidateToAgent}
                    onToggleCluster={onToggleCluster}
                    onToggleFileSelect={onToggleFileSelect}
                    onToggleGroup={onToggleGroup}
                  />
                ))}
                {hiddenClusterCount > 0 ? (
                  <button
                    className="secondary discoveryShowMore"
                    type="button"
                    onClick={() => setVisibleClusterLimit((current) => current + 24)}
                  >
                    Show 24 More ({hiddenClusterCount.toLocaleString()} hidden)
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
              libraryMatch={summarizeDiscoveryLibraryMatch(inspectedGroup, libraryFiles)}
              selectedFileCount={inspectedGroup.files.filter((file) => !file.isLocked && isAudioDiscoveryResult(file) && selectedFileIds.has(file.id)).length}
              saved={savedCandidates.some((candidate) => candidate.candidateKey === inspectedGroup.id)}
              onSave={() => onSaveCandidate(inspectedGroup)}
              onSendToAgent={() => onSendCandidateToAgent(inspectedGroup)}
              onSelect={() => onGroupSelect(inspectedGroup)}
            />
          ) : (
            <section className="discoveryCandidateDetail isEmpty" aria-label="Discovery candidate detail">
              <span className="eyebrow">Candidate Detail</span>
              <strong>Select a source to inspect it.</strong>
              <span>Use Inspect on any result to see library match, quality flags, preview files, and agent handoff options.</span>
            </section>
          )}

          <form className="discoveryListParser" onSubmit={(event) => void onParseList(event)}>
            <div className="discoveryPanelHeader">
              <div>
                <span className="eyebrow">List Search</span>
                <strong>Paste a chart or wantlist</strong>
              </div>
              {parsedListState.items.length > 0 ? <span>{missingParsedCount.toLocaleString()} missing</span> : null}
            </div>
            <textarea
              aria-label="Pasted chart or album list"
              placeholder={"Paste rows, one item per line. Example: 1. Artist - Album (1980)"}
              value={pastedListText}
              onChange={(event) => setPastedListText(event.target.value)}
            />
            <div className="discoveryListParserFooter">
              <span className="muted">
                {parsedListState.message ?? "Parsed rows are checked against the indexed library and can launch Discovery searches."}
              </span>
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
            <section className="downloadJobs" aria-label="Discovery download jobs">
              <div className="discoveryPanelHeader">
                <div>
                  <span className="eyebrow">Transfers</span>
                  <strong>Download staging</strong>
                </div>
                <span>{activeDownloadCount.toLocaleString()} active</span>
              </div>
              {downloadJobs.map((job) => (
                <div className="downloadJob" key={job.id}>
                  <div className="downloadJobMain">
                    <strong>
                      {job.selectedCount.toLocaleString()} selected · {job.completedCount.toLocaleString()} staged
                    </strong>
                    <div className="progressRail">
                      <div className="progressFill" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                    </div>
                    <span>{formatDiscoveryDownloadMessage(job)}</span>
                  </div>
                  <span className={job.status === "failed" || job.status === "cancelled" ? "statusPill warning" : "statusPill"}>
                    {job.status}
                  </span>
                  <div className="rootActions">
                    <button disabled={!job.imported} type="button" onClick={onOpenImports}>
                      Import
                    </button>
                    <button
                      className="secondary"
                      disabled={job.status !== "failed" && job.status !== "cancelled"}
                      type="button"
                      onClick={() => void onRetryDownload(job.id)}
                    >
                      Retry
                    </button>
                    <button
                      className="secondary"
                      disabled={job.status !== "queued" && job.status !== "running"}
                      type="button"
                      onClick={() => void onCancelDownload(job.id)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {savedCandidates.length > 0 ? (
            <section className="savedDiscoveryCandidates" aria-label="Saved Discovery candidates">
              <div className="savedDiscoveryHeader">
                <strong>Saved Candidates</strong>
                <span>{savedCandidates.length.toLocaleString()} source candidate{savedCandidates.length === 1 ? "" : "s"}</span>
              </div>
              <div className="savedDiscoveryList">
                {savedCandidates.slice(0, 8).map((candidate) => (
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
                        Propose
                      </button>
                      <button className="secondary compactButton" type="button" onClick={() => void onSendSavedCandidateToAgent(candidate)}>
                        Agent
                      </button>
                      <button className="secondary compactButton" type="button" onClick={() => void onRemoveSavedCandidate(candidate.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
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
  libraryFiles: DiscoveryLibraryFile[],
  releaseFilter: DiscoveryReleaseFilter
): DiscoveryCluster[] {
  if (releaseFilter === "all") {
    return clusters;
  }

  return clusters.filter((cluster) => {
    const best = cluster.bestGroup;
    const libraryMatch = summarizeDiscoveryLibraryMatch(best, libraryFiles);
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
      return cluster.groups.some((group) => summarizeDiscoveryLibraryMatch(group, libraryFiles).status === "possible_upgrade");
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
  onSendToAgent,
  onSelect
}: {
  group: DiscoveryGroup;
  libraryMatch: DiscoveryLibraryMatch;
  selectedFileCount: number;
  saved: boolean;
  onSave(): void;
  onSendToAgent(): void;
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
          <button className="secondary compactButton" type="button" onClick={onSendToAgent}>
            Send Agent
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
  libraryFiles,
  selectedFileIds,
  selectedGroupIds,
  onGroupSelect,
  onInspectGroup,
  onSaveCandidate,
  onSendCandidateToAgent,
  onToggleCluster,
  onToggleFileSelect,
  onToggleGroup
}: {
  cluster: DiscoveryCluster;
  expanded: boolean;
  expandedGroupIds: Set<string>;
  libraryFiles: DiscoveryLibraryFile[];
  selectedFileIds: Set<string>;
  selectedGroupIds: Set<string>;
  onGroupSelect(group: DiscoveryGroup): void;
  onInspectGroup(groupId: string): void;
  onSaveCandidate(group: DiscoveryGroup): Promise<void>;
  onSendCandidateToAgent(group: DiscoveryGroup): Promise<void>;
  onToggleCluster(clusterId: string): void;
  onToggleFileSelect(fileId: string): void;
  onToggleGroup(groupId: string): void;
}): ReactElement {
  const hiddenSourceCount = Math.max(0, cluster.groups.length - 3);
  const visibleGroups = expanded ? cluster.groups : cluster.groups.slice(0, 3);
  const selectedBestCount = cluster.bestGroup.files.filter((file) => !file.isLocked && isAudioDiscoveryResult(file) && selectedFileIds.has(file.id)).length;
  const bestStageLabel =
    selectedBestCount > 0
      ? `${selectedBestCount.toLocaleString()} best selected`
      : cluster.bestGroup.availableCount > 0
        ? `Stage Best ${cluster.bestGroup.availableCount.toLocaleString()}`
        : "Best Locked";

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
          <div className="discoveryClusterMeta">
            <span className={cluster.matchLabel === "weak match" ? "statusPill warning" : "statusPill"}>{cluster.matchLabel}</span>
            <span className="statusPill">{cluster.qualityLabel}</span>
          </div>
          <button
            className="compactButton"
            disabled={cluster.bestGroup.availableCount === 0}
            type="button"
            onClick={() => onGroupSelect(cluster.bestGroup)}
          >
            {bestStageLabel}
          </button>
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
            libraryMatch={summarizeDiscoveryLibraryMatch(group, libraryFiles)}
            selected={selectedGroupIds.has(group.id)}
            selectedFileIds={selectedFileIds}
            onGroupSelect={onGroupSelect}
            onInspectGroup={onInspectGroup}
            onSaveCandidate={onSaveCandidate}
            onSendCandidateToAgent={onSendCandidateToAgent}
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
  onSendCandidateToAgent,
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
  onSendCandidateToAgent(group: DiscoveryGroup): Promise<void>;
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
          <div className="discoveryTrackPreview" title={group.folder ?? undefined}>
            {group.previewFiles.map((file) => (
              <span key={file.id}>{file.filename}</span>
            ))}
            {group.files.length > group.previewFiles.length ? <span>+{group.files.length - group.previewFiles.length} more</span> : null}
          </div>
        </div>
        <div className="discoveryGroupActions">
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
          <button className="compactButton" disabled={group.availableCount === 0} type="button" onClick={() => onGroupSelect(group)}>
            {stageLabel}
          </button>
          <button className="secondary compactButton" type="button" onClick={() => onInspectGroup(group.id)}>
            Inspect
          </button>
          <button className="secondary compactButton" type="button" onClick={() => void onSaveCandidate(group)}>
            Save
          </button>
          <button className="secondary compactButton" type="button" onClick={() => void onSendCandidateToAgent(group)}>
            Agent
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

function AlbumsView({
  albumsState,
  initialTarget,
  playbackBusy,
  onPlayAlbum,
  onPlayFile
}: {
  albumsState: AlbumsState;
  initialTarget: AlbumViewTarget | null;
  playbackBusy: boolean;
  onPlayAlbum(albumId: string): Promise<void>;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
}): ReactElement {
  const albums = "albums" in albumsState ? albumsState.albums.albums : [];
  const sortedAlbums = useMemo(() => sortAlbumsByArtistAlbum(albums), [albums]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [albumViewMode, setAlbumViewMode] = useState<AlbumGroupMode>("all");
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
    if (!initialTarget) {
      return;
    }

    const album = sortedAlbums.find((item) => item.id === initialTarget.albumId);
    if (!album) {
      return;
    }

    setSelectedArtist(null);
    setSelectedAlbumId(album.id);
    setSelectedFileId(album.files[0]?.id ?? null);
  }, [initialTarget, sortedAlbums]);

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
          onBack={() => setSelectedArtist(null)}
          onOpenAlbum={openAlbum}
          onPlayFile={onPlayFile}
        />
      ) : selectedAlbum ? (
        <AlbumDetailView
          album={selectedAlbum}
          playbackBusy={playbackBusy}
          selectedFileId={selectedFileId}
          onBack={() => {
            setSelectedAlbumId(null);
            setSelectedFileId(null);
          }}
          onOpenArtist={openArtist}
          onPlayAlbum={onPlayAlbum}
          onPlayFile={onPlayFile}
          onSelectFile={setSelectedFileId}
        />
      ) : (
        <>
          <div className="albumViewToolbar" aria-label="Album view controls">
            <div>
              <strong>{filteredAlbums.length.toLocaleString()} albums</strong>
              <span>{artistSections.length.toLocaleString()} artists</span>
            </div>
            <AlbumFacetControls
              facets={albumFacets}
              filter={facetFilter}
              groupMode={albumViewMode}
              groupModes={["all", "artist", "genre", "decade"]}
              onFilterChange={setFacetFilter}
              onGroupModeChange={setAlbumViewMode}
            />
          </div>
          {albumViewMode === "all" ? (
            <section className="albumGrid" aria-label="Albums">
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
            </section>
          ) : (
            <section className="artistAlbumSections" aria-label="Grouped albums">
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
            </section>
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

function ArtistsView({
  albumsState,
  initialTarget,
  playbackBusy,
  resetKey,
  onPlayAlbum,
  onPlayFile
}: {
  albumsState: AlbumsState;
  initialTarget: ArtistViewTarget | null;
  playbackBusy: boolean;
  resetKey: number;
  onPlayAlbum(albumId: string): Promise<void>;
  onPlayFile(fileId: string, queueFileIds?: string[]): Promise<void>;
}): ReactElement {
  const albums = "albums" in albumsState ? albumsState.albums.albums : [];
  const sortedAlbums = useMemo(() => sortAlbumsByArtistAlbum(albums), [albums]);
  const [artistGroupMode, setArtistGroupMode] = useState<AlbumGroupMode>("all");
  const [facetFilter, setFacetFilter] = useState<AlbumFacetFilter>({ genre: "all", decade: "all" });
  const albumFacets = useMemo(() => getAlbumFacets(sortedAlbums), [sortedAlbums]);
  const filteredAlbums = useMemo(() => filterAlbumsByFacet(sortedAlbums, facetFilter), [facetFilter, sortedAlbums]);
  const artistSections = useMemo(() => groupAlbumsByArtist(filteredAlbums), [filteredAlbums]);
  const groupedArtistSections = useMemo(() => groupArtistSectionsByMode(artistSections, artistGroupMode), [artistGroupMode, artistSections]);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selectedAlbum = useMemo(() => sortedAlbums.find((album) => album.id === selectedAlbumId) ?? null, [selectedAlbumId, sortedAlbums]);
  const selectedArtistAlbums = useMemo(
    () => (selectedArtist ? sortedAlbums.filter((album) => album.artist === selectedArtist) : []),
    [selectedArtist, sortedAlbums]
  );

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
          playbackBusy={playbackBusy}
          selectedFileId={selectedFileId}
          onBack={() => {
            setSelectedAlbumId(null);
            setSelectedFileId(null);
          }}
          onOpenArtist={openArtist}
          onPlayAlbum={onPlayAlbum}
          onPlayFile={onPlayFile}
          onSelectFile={setSelectedFileId}
        />
      ) : selectedArtist ? (
        <ArtistDetailView
          albums={selectedArtistAlbums}
          artist={selectedArtist}
          playbackBusy={playbackBusy}
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
              <strong>{artistSections.length.toLocaleString()} artists</strong>
              <span>{filteredAlbums.length.toLocaleString()} albums</span>
            </div>
            <AlbumFacetControls
              facets={albumFacets}
              filter={facetFilter}
              groupMode={artistGroupMode}
              groupModes={["all", "genre", "decade"]}
              onFilterChange={setFacetFilter}
              onGroupModeChange={setArtistGroupMode}
            />
          </div>
          <section className="artistIndexSections" aria-label="Artists">
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
          </section>
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
        <select value={filter.genre} onChange={(event) => onFilterChange({ ...filter, genre: event.target.value })}>
          <option value="all">All genres</option>
          {facets.genres.map((genre) => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Decade</span>
        <select value={filter.decade} onChange={(event) => onFilterChange({ ...filter, decade: event.target.value })}>
          <option value="all">All decades</option>
          {facets.decades.map((decade) => (
            <option key={decade} value={decade}>
              {decade}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function NowPlayingModal({
  files,
  playback,
  playbackBusy,
  onClose,
  onFavoriteStatus,
  onNext,
  onPauseResume,
  onPlayFile,
  onPrevious,
  onRating
}: {
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
}): ReactElement {
  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const currentFile = playback.currentFileId ? filesById.get(playback.currentFileId) ?? null : null;
  const queueFiles = useMemo(
    () => playback.queue.map((fileId) => filesById.get(fileId)).filter((file): file is LibraryFile => file != null),
    [filesById, playback.queue]
  );
  const displayTitle = currentFile?.displayTags.title ?? playback.currentDisplayName ?? "Nothing queued";
  const displayArtist = currentFile?.displayTags.artist ?? currentFile?.displayTags.albumartist ?? "Unknown Artist";
  const displayAlbum = currentFile?.displayTags.album ?? "Unknown Album";

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Now playing"
        aria-modal="true"
        className="nowPlayingModal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="nowPlayingHero">
          {playback.currentFileId ? (
            <Artwork className="nowPlayingModalArt" src={artworkFileUrl(playback.currentFileId)} />
          ) : (
            <span className="nowPlayingModalArt placeholder">
              <UiIcon name="album" />
            </span>
          )}
          <div className="nowPlayingModalInfo">
            <span>{playback.status}</span>
            <h2>{displayTitle}</h2>
            <strong>{displayArtist}</strong>
            <small>{displayAlbum}</small>
            {currentFile ? (
              <NowPlayingActions
                file={currentFile}
                variant="modal"
                onFavoriteStatus={onFavoriteStatus}
                onRating={onRating}
              />
            ) : null}
            <div className="nowPlayingModalTime">
              <span>{formatTime(playback.positionMs)}</span>
              <div className="progressRail">
                <div className="progressFill" style={{ width: `${getProgressPercent(playback)}%` }} />
              </div>
              <span>{formatTime(playback.durationMs)}</span>
            </div>
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
          </div>
        </div>
        <aside className="nowPlayingQueue" aria-label="Up next">
          <header>
            <div>
              <strong>Up Next</strong>
              <span>{playback.queue.length.toLocaleString()} item{playback.queue.length === 1 ? "" : "s"}</span>
            </div>
            <button className="modalClose secondary" type="button" onClick={onClose}>
              Close
            </button>
          </header>
          <div className="queueRows">
            {queueFiles.length === 0 ? (
              <div className="emptyState">No queued songs.</div>
            ) : (
              queueFiles.map((file, index) => (
                <button
                  className={file.id === playback.currentFileId ? "queueRow active" : "queueRow"}
                  key={`${file.id}-${index}`}
                  type="button"
                  onClick={() => void onPlayFile(file.id, playback.queue)}
                >
                  <span>{index + 1}</span>
                  <Artwork className="queueArt" src={artworkFileUrl(file.id)} />
                  <span>
                    <strong>{file.displayTags.title ?? file.filename}</strong>
                    <small>
                      {file.displayTags.artist ?? file.displayTags.albumartist ?? "Unknown Artist"} · {file.displayTags.album ?? "Unknown Album"}
                    </small>
                  </span>
                  <small>{file.durationMs == null ? "-" : formatTime(file.durationMs)}</small>
                </button>
              ))
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}

function AlbumDetailView({
  album,
  playbackBusy,
  selectedFileId,
  onBack,
  onOpenArtist,
  onPlayAlbum,
  onPlayFile,
  onSelectFile
}: {
  album: AlbumGroupItem;
  playbackBusy: boolean;
  selectedFileId: string | null;
  onBack(): void;
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
        </aside>
        <div className="albumDetailTracks">
          <div className="albumDetailTrackHeader">
            <span>#</span>
            <span>Title</span>
            <span>Length</span>
            <span>Rating</span>
            <span>Listens</span>
            <span>Format</span>
          </div>
          {album.files.map((file) => {
            const tags = file.displayTags;
            return (
              <button
                className={selectedFile?.id === file.id ? "albumDetailTrack active" : "albumDetailTrack"}
                key={file.id}
                type="button"
                onClick={() => {
                  onSelectFile(file.id);
                  void onPlayFile(file.id, albumQueueFileIds);
                }}
              >
                <span>{formatTrackNumber(file)}</span>
                <strong title={file.path}>{tags.title ?? file.filename}</strong>
                <span>{file.durationMs == null ? "-" : formatTime(file.durationMs)}</span>
                <span>{file.rating == null ? "-" : `${file.rating}/5`}</span>
                <span>{formatListenStats(file)}</span>
                <span>{formatFileFormat(file) || file.extension.toUpperCase()}</span>
              </button>
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
  onBack,
  onOpenAlbum,
  onPlayFile
}: {
  albums: AlbumGroupItem[];
  artist: string;
  playbackBusy: boolean;
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
              <button
                disabled={playbackBusy}
                key={file.id}
                type="button"
                onClick={() => void onPlayFile(file.id, topSongQueueFileIds)}
              >
                <Artwork className="artistSongThumb" src={artworkFileUrl(file.id)} />
                <span>
                  <strong title={file.path}>{file.displayTags.title ?? file.filename}</strong>
                  <small>
                    {file.displayTags.album ?? "Unknown Album"} · rating {file.rating ?? "-"} · plays {file.playCount.toLocaleString()}
                    {file.liked ? " · liked" : ""}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function PlaylistsView({
  playbackBusy,
  playlistsState,
  onPlayPlaylist,
  onProposeUpdatePlaylist,
  onProposeRemoveItem
}: {
  playbackBusy: boolean;
  playlistsState: PlaylistsState;
  onPlayPlaylist(playlistId: string): Promise<void>;
  onProposeUpdatePlaylist(playlistId: string, updates: { name: string; description: string | null }): Promise<void>;
  onProposeRemoveItem(playlistId: string, itemId: string): Promise<void>;
}): ReactElement {
  const playlists = "playlists" in playlistsState ? playlistsState.playlists : [];

  return (
    <>
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
            <PlaylistCard
              key={playlist.id}
              playbackBusy={playbackBusy}
              playlist={playlist}
              onPlayPlaylist={onPlayPlaylist}
              onProposeUpdatePlaylist={onProposeUpdatePlaylist}
              onProposeRemoveItem={onProposeRemoveItem}
            />
          ))
        )}
      </section>
    </>
  );
}

function PlaylistCard({
  playbackBusy,
  playlist,
  onPlayPlaylist,
  onProposeUpdatePlaylist,
  onProposeRemoveItem
}: {
  playbackBusy: boolean;
  playlist: Playlist;
  onPlayPlaylist(playlistId: string): Promise<void>;
  onProposeUpdatePlaylist(playlistId: string, updates: { name: string; description: string | null }): Promise<void>;
  onProposeRemoveItem(playlistId: string, itemId: string): Promise<void>;
}): ReactElement {
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? "");
  const changed = name.trim() !== playlist.name || description.trim() !== (playlist.description ?? "");

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
    <div className="playlistItem">
      <div className="playlistMain">
        <form className="playlistEditForm" onSubmit={(event) => void handleSubmit(event)}>
          <input
            aria-label="Playlist name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            aria-label="Playlist description"
            placeholder="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <button disabled={!changed || !name.trim()} type="submit">
            Propose Edit
          </button>
        </form>
        <span>
          {playlist.items.length} track{playlist.items.length === 1 ? "" : "s"} · {playlist.createdBy} · {playlist.type}
        </span>
        <div className="playlistTracks">
          {playlist.items.slice(0, 8).map((item) => {
            const tags = item.file.displayTags;
            return (
              <div className="playlistTrackRow" key={item.id}>
                <span>
                  {item.position + 1}. {tags.title ?? item.file.filename} · {tags.artist ?? tags.albumartist ?? "Unknown Artist"}
                </span>
                <button className="secondary" type="button" onClick={() => void onProposeRemoveItem(playlist.id, item.id)}>
                  Remove
                </button>
              </div>
            );
          })}
          {playlist.items.length > 8 ? <span>+ {playlist.items.length - 8} more</span> : null}
        </div>
      </div>
      <div className="rootActions">
        <button disabled={playbackBusy || playlist.items.length === 0} type="button" onClick={() => void onPlayPlaylist(playlist.id)}>
          Play
        </button>
      </div>
    </div>
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
          <select
            disabled={agentBusy || threads.length === 0}
            value={activeThreadId ?? ""}
            onChange={(event) => void onSelectThread(event.target.value)}
          >
            {threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title}
              </option>
            ))}
          </select>
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
            {message.role === "agent" && message.response ? <AgentResultSummary response={message.response} /> : null}
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

function AgentResultSummary({ response }: { response: AgentMessageResponse }): ReactElement {
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

async function listRoots() {
  return getJson("/library/roots", libraryRootsResponseSchema);
}

async function listFiles(query: string) {
  return getJson(`/library/files?query=${encodeURIComponent(query)}`, libraryFilesResponseSchema);
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

async function listAlbums() {
  return getJson("/library/albums", albumGroupsResponseSchema);
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
  const response = await fetch(`http://127.0.0.1:47831/discovery/saved-candidates/${encodeURIComponent(candidateId)}`, {
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
  const response = await fetch(`http://127.0.0.1:47831/discovery/saved-lists/${encodeURIComponent(listId)}`, {
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
  return postJson("/agent/message", { message, threadId }, agentMessageResponseSchema);
}

async function proposeImportApproval(importItemId: string, libraryRootId: string) {
  return postJson("/operations/propose-import-approval", { importItemId, libraryRootId }, operationBatchResponseSchema);
}

async function proposeFileMetadata(fileId: string, metadata: EditableFileMetadata) {
  return postJson("/operations/propose-file-metadata", { fileId, metadata }, operationBatchResponseSchema);
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

async function proposeRemoveFile(fileId: string) {
  return postJson("/operations/propose-remove-file", { fileId }, operationBatchResponseSchema);
}

async function proposeDuplicateCleanup(keepFileId: string, removeFileIds: string[]) {
  return postJson("/operations/propose-duplicate-cleanup", { keepFileId, removeFileIds }, operationBatchResponseSchema);
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

async function proposeAddTracksToPlaylist(playlistId: string, fileIds: string[]) {
  return postJson("/operations/propose-add-tracks-to-playlist", { playlistId, fileIds }, operationBatchResponseSchema);
}

async function proposeRemoveTracksFromPlaylist(playlistId: string, itemIds: string[]) {
  return postJson("/operations/propose-remove-tracks-from-playlist", { playlistId, itemIds }, operationBatchResponseSchema);
}

async function proposeAlbumMerge(canonicalAlbum: string, fileIds: string[]) {
  return postJson("/operations/propose-album-merge", { canonicalAlbum, fileIds }, operationBatchResponseSchema);
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

async function playQueue(fileIds: string[], startIndex: number) {
  return postJson("/playback/play-queue", { fileIds, startIndex }, playbackStateSchema);
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
  const response = await fetch(`http://127.0.0.1:47831/library/roots/${encodeURIComponent(rootId)}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

async function getJson<T>(path: string, schema: { parse(value: unknown): T }): Promise<T> {
  const response = await fetch(`http://127.0.0.1:47831${path}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return schema.parse(await response.json());
}

async function postJson<T>(path: string, body: unknown, schema: { parse(value: unknown): T }): Promise<T> {
  const response = await fetch(`http://127.0.0.1:47831${path}`, {
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
  const response = await fetch(`http://127.0.0.1:47831${path}`, {
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

function groupLibraryFilesByAlbum(files: LibraryFile[]): LibraryAlbumGroup[] {
  const groups = new Map<string, LibraryAlbumGroup>();
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
    existing.formats = [...new Set([...existing.formats, file.extension.toUpperCase()])].sort();
    groups.set(key, existing);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, files: sortAlbumTrackFiles(group.files) }))
    .sort(
      (left, right) =>
        compareText(left.artist, right.artist) ||
        compareText(left.album, right.album) ||
        compareText(left.year ?? "", right.year ?? "")
    );
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

function groupAlbumsByArtist(albums: AlbumGroupItem[]): { artist: string; albums: AlbumGroupItem[] }[] {
  const groups = new Map<string, AlbumGroupItem[]>();
  for (const album of albums) {
    groups.set(album.artist, [...(groups.get(album.artist) ?? []), album]);
  }
  return [...groups.entries()]
    .map(([artist, groupAlbums]) => ({ artist, albums: groupAlbums }))
    .sort((left, right) => compareText(left.artist, right.artist));
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
    return selected == null ? "Discovery download" : `Discovery download · ${selected} file${selected === 1 ? "" : "s"}`;
  }
  return job.type.replace(/_/g, " ");
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

function getProgressPercent(playback: PlaybackStateResponse): number {
  if (!playback.durationMs || playback.durationMs <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (playback.positionMs / playback.durationMs) * 100));
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

  return {
    ...next,
    positionMs: Math.max(current.positionMs, next.positionMs)
  };
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

function getViewSubtitle(view: string): string {
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
