# Music OS Product Architecture

`PLAN.md` is the source plan for the product. This document is the maintained architecture reference that implementation changes should update.

## MVP Direction

Music OS is a local-first desktop music application with a controlled music library, staging-first imports, operation-batch mutations, mpv playback, and an eventual tool-using agent.

The initial implementation is scoped to Phase 0 foundations:

- Electron desktop shell.
- React renderer.
- Local TypeScript backend.
- SQLite database initialized by migrations.
- Typed contracts with Zod.
- Health bridge from renderer to backend.

## Non-Negotiable Invariants

- Downloads and external files never bypass staging.
- The renderer never receives raw filesystem or shell access.
- Mutating actions must become typed operation batches before they are applied.
- The agent may propose changes, but it must not mutate the library directly.
- Database changes must be represented as migrations.
- API payloads and tool calls must be validated at boundaries.

## Initial Monorepo Layout

```text
apps/
  desktop/     Electron, preload, React renderer
  backend/     Local API, SQLite ownership, services, jobs
  agent/       Future agent runtime
packages/
  core/        Shared schemas, types, constants
  db/          Migrations, database helpers, repositories
  playback/    mpv adapter contract
  connectors/  Source connector contracts and adapters
  metadata/    Metadata adapter contracts and resolvers
  operations/  Operation batch contracts and executor
  ui/          Shared UI components and design system
docs/
  progress-model.md
  product-architecture.md
```

## Phase 0 Acceptance Mapping

| Acceptance Criterion | Implementation Target |
| --- | --- |
| App opens without errors | Electron main creates a BrowserWindow and loads Vite output/dev server |
| Backend health visible in UI | Preload exposes `musicOs.health()` backed by backend health client |
| Database file created | Backend initializes SQLite and runs migration `0001_initial_schema.sql` |
| Typecheck passes | Workspace `npm run typecheck` checks backend, desktop, and packages |

## Phase 1 Implementation

The local library scanner is implemented in the backend:

- `LibraryRepository` owns SQLite reads/writes for library roots, files, embedded tags, and missing-file state.
- `LibraryScanner` recursively walks configured roots and indexes supported audio extensions.
- The scanner records filesystem stats for every supported audio file and uses `music-metadata` to populate duration, codec/container, bitrate, sample rate, channel count, and common embedded tags when readable.
- Rescans upsert by normalized path, so repeated scans update rows without creating duplicates.
- Files previously seen under a root are marked `missing` when they disappear on a later scan.

The renderer uses typed local HTTP endpoints:

```text
GET  /library/roots
POST /library/roots
POST /library/scan
GET  /library/files?query=
```

The renderer still has no raw filesystem access. The user enters a path, and the backend validates and scans it.

Library browsing now layers client-side refiners over the typed `/library/files` result set. The Library grid can sort by title, artist, album, year, format, bitrate, play count, rating, or date indexed, and can filter by lossless/compressed format, present/missing state, liked/disliked/unrated preference, minimum rating, minimum play count, and freeform display-tag text.

Library roots also store a `watchEnabled` intent flag. The Library UI can set it while adding a root or toggle it later per root. This records which folders should participate in a later long-running watcher/import loop while preserving the current explicit rescan behavior.

The backend exposes `POST /library/scan-watched` to scan every enabled root with `watchEnabled = true` and return aggregate scan totals. The Library UI surfaces this as `Scan Watched`, giving watch roots deterministic behavior before a persistent filesystem watcher is introduced.

## Phase 2 Implementation

Playback is implemented through the local backend. The renderer sends typed local HTTP requests and does not launch player processes itself.

Current playback endpoints:

```text
GET  /playback/state
POST /playback/play-file
POST /playback/play-queue
POST /playback/pause
POST /playback/resume
POST /playback/stop
POST /playback/next
POST /playback/previous
POST /playback/seek
```

The backend uses `MUSIC_OS_MPV_PATH` to locate mpv. In WSL, Windows mpv can be used by setting:

```bash
MUSIC_OS_MPV_PATH="/mnt/c/Program Files/mpv-x86_64-20181002/mpv.exe"
```

When the configured player path ends in `.exe`, backend playback translates WSL paths such as `/mnt/d/Music/file.flac` into Windows paths such as `D:\Music\file.flac`.

For Windows mpv launched from WSL, the backend uses mpv IPC where possible and falls back to terminating the Windows `mpv` process on Stop. This keeps the UI stop action aligned with the actual external player window.

mpv IPC runs over a persistent async connection (`apps/backend/src/services/mpv-ipc.ts`). Native mpv exposes a unix socket that backend Node connects to directly; Windows mpv launched from WSL exposes a Windows named pipe that WSL Node cannot open, so a single long-lived Windows `node.exe` relay process bridges stdin/stdout to the pipe. Commands are correlated by `request_id`, and unsolicited mpv events stream through the same connection. This replaced the earlier design that spawned a blocking PowerShell process per command, which froze the backend event loop on every state poll.

The playback service auto-advances the queue when mpv signals that a track finished: newer mpv builds tag `end-file` with reason `eof`, while mpv 0.29 omits the reason but emits `idle` only when playback genuinely ran out, so both signals route to the same guarded advance. A load-generation token discards end-of-track signals that raced with an explicit track change. End-to-end auto-advance against real mpv is verified by `playback-advance:smoke`, which plays generated silent WAV fixtures and asserts the queue advances and then stops cleanly.

The renderer supports file-level playback, queues the current grid results when a row is played, starts album and playlist playback from their views, and exposes the bottom progress rail as a seek control when duration is known. The now-playing bar shows an animated EQ glyph, playback status dot, queue position badge, icon transport controls, and a tabular time readout, and the space bar toggles pause/resume outside text inputs.

The playback state endpoint polls mpv IPC for `time-pos`, `duration`, and `pause` before returning state. If an mpv property poll misses, the backend advances `positionMs` from its own monotonic clock while status is `playing`. The renderer also interpolates `positionMs` locally, then resynchronizes from backend polling.

## Phase 3 Implementation

The import inbox is implemented as a staging-first workflow. Manual source paths are copied into a backend-owned staging folder before review. The original source files are not moved or deleted during staging.

Current import endpoints:

```text
GET  /imports/inbox
POST /imports/create-from-paths
POST /imports/update-item-metadata
POST /imports/approve-item
POST /imports/reject-item
```

Import behavior:

- `create-from-paths` creates an `imports` row and one `import_items` row per source path.
- Each source file is copied to `.music-os/staging/<import-id>/`.
- The staged copy is scanned for technical metadata and embedded tags.
- A staged `files` row is created with `staged = 1`, so it does not appear as a normal library file.
- A basic destination proposal is generated from detected artist, year, album, and title.
- During review, the user can edit detected artist, album, title, and year. The metadata diagnostics panel also lets the user choose any generated embedded, filename, or MusicBrainz candidate. Either path stores a user-confirmed selected candidate and recomputes the proposed destination before approval.
- Approving an import item moves the staged file into the selected library root and indexes it as a normal library file.
- Rejecting an import item marks it rejected and does not add it to the library.

This phase intentionally keeps import approval deterministic. Richer operation-batch review and undo support will be added when Phase 5 wires the operation executor.

## Phase 4 Implementation

Phase 4 adds local fingerprinting, duplicate detection, and import metadata candidate scoring. The scanner computes a streaming SHA-256 hash for each supported audio file and stores it on the `files` row.

When `fpcalc` is available through `MUSIC_OS_FPCALC_PATH` or a standard local path, imports also compute and store Chromaprint fingerprints in `audio_fingerprints`. Systems without `fpcalc` continue using SHA-256 and metadata matching.

Current duplicate endpoint:

```text
GET /library/duplicates
GET /library/files/:fileId/diagnostics
GET /imports/items/:importItemId/diagnostics
```

Duplicate behavior:

- Exact duplicate groups are built from non-staged, non-missing files with the same SHA-256.
- The Duplicates view shows exact-match groups and the paths involved.
- Exact duplicate groups can create a reviewable cleanup operation batch. The batch keeps one recommended indexed copy and removes the other exact-match entries from the library index only; it does not delete audio files from disk.
- Staged imports compare their scanned SHA-256 against existing library files.
- Import items surface exact duplicate candidates and warning text while staying in `needs_review`, so approval remains a user choice.

Import metadata behavior:

- Each staged import stores metadata candidates from embedded tags, filename parsing, and MusicBrainz recording search when title/artist seeds are available.
- Candidates carry source, identifiers, title, artist, album, year, score, reason, and external URL when applicable.
- The highest-scoring candidate becomes the selected import proposal and drives detected artist/album/title/year plus destination proposal.
- Low-confidence matches remain in review and add a warning.
- Imports also store a basic technical quality score from codec/container, bitrate, sample rate, and channel count.
- Metadata diagnostics can re-read an import item or indexed library file on demand and return parser status, format fields, normalized `common` tags, raw/native tag IDs, indexed display tags, and import candidate/warning context. This is read-only and is used to debug files whose artist/album/title were not detected.

MusicBrainz is called with `fmt=json` and a meaningful `User-Agent`. Set `MUSIC_OS_MUSICBRAINZ_ENABLED=0` to disable external lookup for offline testing.

## Phase 5 Implementation

The operation batch system routes reviewable mutations through `operation_batches` and `operations`. Batches are proposed first, then explicitly approved, then applied. Applying captures operation `before`, `after`, and `error` JSON so successful and failed mutations remain auditable.

Current operation endpoints:

```text
GET  /operations/batches
POST /operations/propose-import-approval
POST /operations/propose-playlist
POST /operations/propose-update-playlist
POST /operations/propose-add-tracks-to-playlist
POST /operations/propose-remove-tracks-from-playlist
POST /operations/propose-associate-file-with-track
POST /operations/propose-associate-track-with-album
POST /operations/propose-merge-duplicate-tracks
POST /operations/propose-mark-duplicate
POST /operations/propose-file-metadata
POST /operations/propose-remove-file
POST /operations/approve-batch
POST /operations/reject-batch
POST /operations/apply-batch
```

Implemented operation types:

- `import_file`: approves a staged import item and indexes the final library file only when the approved batch is applied.
- `reject_import_item`: executor support exists for rejecting staged import items through a batch.
- `create_playlist`: creates a manual playlist and fails safely if the playlist name already exists. Revert support removes the created playlist and playlist items only if the playlist still has the same name and item count captured at apply time.
- `update_playlist`: updates playlist name and description after review, rejects duplicate playlist names, and captures previous metadata for safe revert.
- `add_tracks_to_playlist`: adds selected indexed files to an existing playlist after review, skips tracks that are already present, and records created playlist item IDs for safe revert.
- `remove_tracks_from_playlist`: removes selected playlist item rows after review and captures row snapshots so revert can restore the removed entries.
- `associate_file_with_track`: adds an indexed file to an existing track as an additional track-file link. It is additive, idempotent, and revert removes only links created by that operation.
- `associate_track_with_album`: assigns an existing track to an existing album row and captures the previous album association, including `null`, for safe revert.
- `merge_duplicate_tracks`: moves duplicate track-file links, playlist references, and internal tag links onto a canonical track, records `merged_into_track_id`, and captures row snapshots for safe revert. It does not move, retag, or delete audio files.
- `mark_duplicate`: records a manual canonical/duplicate file relationship in `duplicate_marks`. It is non-destructive, idempotent, and revert removes only the mark row created by that operation.
- `set_internal_tags`: replaces a track's internal user tags and records before/after tag names.
- `set_file_metadata`: stores app-level metadata overrides for indexed files. Overrides win over embedded tags in library display/search, and rescans do not erase them.
- `remove_file_from_library`: removes an indexed file and related app rows without deleting the audio file from disk.
- `move_file`: moves an indexed file to a proposed destination and updates the existing file row.
- `rename_file`: renames an indexed file in place and updates the existing file row.

The Imports view now proposes an `import_file` operation batch instead of immediately approving the import. The Operations view lists proposed/applied/failed batches, supports approve/apply/reject actions, and shows per-operation status and error details.

The Library view exposes row-level metadata edit and remove-from-index actions. Both create operation batches and require approval/application in the Operations view before mutating the database.

The operation smoke test verifies that proposed and approved batches do not mutate until apply, applied operations record `before` and `after`, failed operations capture error JSON without marking the batch as applied, metadata overrides affect display tags, and remove-from-index leaves the audio file on disk. The revert smoke test verifies undo for metadata edits, ratings, favorite status, internal tags, and unchanged playlist creation batches. The playlist edit smoke test verifies update/add/remove playlist operation batches and safe revert of playlist edits. The track association smoke test verifies additive file-to-track association, idempotent re-apply, and safe revert of operation-created links. The track-album association smoke test verifies album assignment and revert to the captured previous album ID.

## Phase 6 Implementation

Phase 6 adds a first local agent surface and playlist playback/read workflows. The agent is deterministic in this phase: it routes simple user requests into known backend tools instead of calling an LLM. This keeps the permission model testable while the tool contracts settle.

Current playlist and agent endpoints:

```text
GET  /playlists
GET  /playlists/:id
POST /playback/play-playlist
POST /agent/message
```

Agent behavior:

- `search_library`: searches indexed library files and returns matching tracks. The agent uses the library search tool before claiming what exists.
- `propose_playlist`: searches indexed library files, then creates a `create_playlist` operation batch with selected file IDs. It does not create a playlist directly.
- `playback`: searches indexed library files, then queues the matching files through the playback service.
- `unknown`: returns supported capabilities without mutating state.

Playlist behavior:

- `create_playlist` operation payloads can include ordered `fileIds`.
- Applying the batch creates the playlist, ensures each selected library file has a track link, and inserts ordered playlist items.
- Existing playlists can be edited through `update_playlist`, `add_tracks_to_playlist`, and `remove_tracks_from_playlist` operation batches.
- Playlist reads hydrate items back to indexed library files so the UI can show current display tags and play the playlist.

Renderer behavior:

- The Agent view provides a transcript, sends typed agent messages, shows search/tool summaries, and inserts proposed operation batches into the Operations view.
- The Playlists view lists approved playlists, shows their first tracks, and can start playlist playback.
- The Playlists view can propose playlist name/description edits through Operations.
- The Playlists view can propose removal of individual playlist items through Operations.
- The Library view can propose a manual playlist from selected rows or propose adding selected rows to an existing playlist. Both routes send the user to Operations for review before playlist rows change.
- All library-affecting agent proposals still flow through Operations approval and apply.

The `agent:smoke` script verifies that search does not mutate state, playlist requests create proposed agent operation batches, proposed batches do not create playlists before approval/apply, and applied playlist batches create playlist items backed by indexed library files.

## Phase 7 Implementation

Phase 7 begins the slskd connector. The first slice is read-only discovery: Music OS can check a local slskd API and search Soulseek through it, while keeping remote results separate from the library and import inbox. Discovery results are grouped by remote user and folder in the UI so a folder can be evaluated as a candidate before any file acquisition happens.

Current discovery endpoints:

```text
GET  /discovery/health
POST /discovery/search
```

Backend configuration:

```bash
MUSIC_OS_SLSKD_URL=http://127.0.0.1:5030
MUSIC_OS_SLSKD_API_KEY=<slskd api key>
MUSIC_OS_SLSKD_DOWNLOAD_DIR=/mnt/d/Downloads/slskd-downloads
# Optional fallback if API key auth is not used:
MUSIC_OS_SLSKD_USERNAME=<slskd web username>
MUSIC_OS_SLSKD_PASSWORD=<slskd web password>

# Optional search reliability tuning:
MUSIC_OS_SLSKD_SEARCH_ATTEMPTS=2
MUSIC_OS_SLSKD_SEARCH_TIMEOUT_MS=30000
MUSIC_OS_SLSKD_SEARCH_GRACE_MS=8000
MUSIC_OS_SLSKD_SEARCH_COMPLETED_EMPTY_GRACE_MS=5000
MUSIC_OS_SLSKD_SEARCH_PARTIAL_AFTER_MS=4000
MUSIC_OS_SLSKD_SEARCH_FILE_LIMIT=10000
MUSIC_OS_SLSKD_SEARCH_FILTER_RESPONSES=1
```

Connector behavior:

- `SlskdService` talks to slskd over its HTTP API.
- API key auth is preferred through `X-API-Key`; Basic auth is available as a fallback.
- Discovery health reports both connection reachability and whether download staging has a configured `MUSIC_OS_SLSKD_DOWNLOAD_DIR`.
- Search results are normalized into `DiscoveryResult` records with username, filename, remote path/folder, size, extension, audio hints, lock status, and raw source data.
- Discovery searches retry empty slskd responses once by default, then retry with a cleaned search text when that differs from the original query. This handles transient 0-result responses from slskd without making every successful search wait for the full timeout.
- Results also carry peer availability hints from the slskd response: `hasFreeUploadSlot`, `queueLength`, and `uploadSpeedBytesPerSecond`. Backend download source selection (agent download proposals and the transfer smoke scripts) ranks unlocked results by free slot, then shorter remote queue, then faster reported upload speed, so transfers prefer peers likely to start sending immediately.
- The mapper is tolerant of response shape differences across slskd versions.
- Selected unlocked results create database-backed `discovery_download` jobs. Jobs queue files through slskd, poll the configured download folder, and copy completed files into Music OS staging as a `slskd_download` import batch.

slskd reliability notes:

- Verify the slskd Soulseek listen port is reachable from the public internet. slskd documents poor search results as one symptom of a misconfigured listen port.
- If searches intermittently return 0 results under load, inspect slskd logs or metrics for search throttling and circuit breaker drops. On capable hardware, tune slskd's `throttling.search.incoming.concurrency`, `circuit_breaker`, and `response_file_limit`.
- If slskd logs repeated distributed parent connection churn or request timeouts, review the slskd connection timeout settings before increasing Music OS request timeouts.

Renderer behavior:

- The Discovery view exposes a slskd status check and search form.
- The Discovery health panel warns when search is reachable but download staging is not configured, and download proposal actions are disabled until `MUSIC_OS_SLSKD_DOWNLOAD_DIR` is set.
- Discovery search requests include a typed source selector. The only implemented source is currently `slskd`, but the API/UI boundary is source-aware for later connectors.
- Results are grouped as remote candidates, with inferred artist/release labels derived from folder and file names. Candidates are scored for query match, album-like shape, availability, and audio quality, then sortable by best candidate, closest query match, track count, size, or user/folder and filterable by format, availability, local library state, and release type. The pure candidate ranking/filtering path is covered by `discovery-candidates:smoke`. Discovery defaults to recommended release sections, classifies oversized folders as large collections, keeps those collections behind an explicit filter, shows top stageable candidates above the full result list, limits the initial visible release sections, and keeps source-level file lists behind explicit expansion so broad searches do not become unstructured result dumps. Release sections expose best-source staging and a candidate detail panel with source, format, confidence, library match, warning, and preview-file context. Source candidates can be saved as local bookmarks in SQLite, proposed later as queue_download operation batches, or sent into the active Agent thread as a deterministic Discovery search handoff. Selecting and staging results can create Import Inbox items, but nothing is written directly into the library.
- Discovery shows queued/running/completed/failed download jobs with retry/cancel controls. Cancelling stops Music OS monitoring; slskd may still continue the underlying transfer.
- The Jobs view lists database-backed background jobs and exposes their event history for debugging long-running work.

Live transfer validation:

```bash
MUSIC_OS_SLSKD_PREFLIGHT_QUERY="small specific query" \
npm run slskd:preflight-smoke --workspace @music-os/backend
```

The preflight smoke script uses the configured slskd URL/API key and a temporary Music OS database. It checks slskd health, searches, selects one unlocked result, creates a proposed `queue_download` operation batch, and verifies no download job, import batch, or library file is created because the batch is never applied. This validates the real connector/proposal path without starting a transfer.

```bash
MUSIC_OS_LIVE_SLSKD_CONFIRM=1 \
MUSIC_OS_LIVE_SLSKD_QUERY="small specific query" \
npm run slskd:live-smoke --workspace @music-os/backend
```

The live smoke script uses the configured slskd URL/API key/download directory, but creates a temporary Music OS database and library root. It searches slskd, selects the most available unlocked result, creates and applies a `queue_download` operation batch, waits for the Discovery download job, and verifies completed files land in Import Inbox without entering the library directly.

Live validation has been run against a real slskd instance: the applied `queue_download` batch created a Discovery download job, the transfer completed through slskd, and the file entered Import Inbox staging in `needs_review` without being indexed into the library. Availability-ranked source selection was added after an earlier validation attempt stalled in a remote peer's upload queue.

## Phase 8 Implementation

Phase 8 starts the agent-discovery bridge. The first slice is deterministic and read-only: agent prompts that mention Discovery, Soulseek, slskd, external search, or downloads call the configured Discovery connector and return typed remote candidate summaries.

Agent Discovery behavior:

- `search_discovery` searches through the same slskd service used by the Discovery view.
- Candidate summaries include remote filename, user, folder, format, lock status, size, and an `ownedMatchCount`.
- Owned-match counts are computed by searching the indexed library for likely title/folder terms from each remote candidate.
- `parse_pasted_list` parses chart/list text into ranked candidate items with artist, title, year, search query, and owned-match counts. The Agent can parse list text from chat, and Discovery exposes a direct paste panel whose parsed rows can launch connector searches.
- Parsed chart/list results can be saved in SQLite as reusable local Discovery sources. Saved lists preserve the original pasted text, parsed rows, and owned/missing counts; the Discovery UI can reload or remove them later.
- Parsed list rows can be filtered by all/missing/owned, searched individually, or searched from the first missing item. Saved lists expose the same missing-search handoff so a pasted chart can become a repeatable acquisition checklist.
- Plain agent Discovery search remains read-only and does not queue downloads.
- Explicit agent prompts to download, queue, stage, grab, or propose external candidates create a reviewable `queue_download` operation batch. Proposed candidates are unlocked results ranked by peer availability. Applying an approved `queue_download` operation creates the same database-backed Discovery download job used by manual Discovery staging; completed files still enter Import Inbox and never bypass staging. This executable path has been validated end to end with a real completed slskd transfer via `slskd:live-smoke`.
- Explicit agent prompts to propose/review/approve imports search reviewable Import Inbox items and create an agent-sourced import approval operation batch. The batch still requires normal Operations approval/apply before files enter the library.

The `agent:smoke` script verifies the read-only Discovery search path, owned-match detection, pasted-list parsing, executable `queue_download` handoff for explicit download requests, and import approval proposals from staged inbox items. The `saved-discovery-lists:smoke` script verifies saved parsed-list persistence across backend app restarts.

## Phase 9 Implementation

Phase 9 starts with conservative cleanup tools over already-indexed library data. The first slice is exact duplicate cleanup: the Duplicates view recommends one copy to keep in each SHA-256 group, then creates a normal operation batch to remove the other duplicate entries from the index.

Cleanup behavior:

- Exact duplicate cleanup is proposal-first and must still be approved/applied in Operations.
- Backend validation requires all removed files to share the kept file's SHA-256.
- Applying cleanup uses `remove_file_from_library`, so the audio files remain on disk.
- `duplicate:smoke` verifies the group disappears from the index while the removed duplicate path still exists.
- Track/file association is available as a reviewable operation primitive for later duplicate-track and alternate-edition cleanup flows. It does not remove existing links.
- Track/album association is available as a reviewable operation primitive for later canonical album entity workflows. It changes only `tracks.album_id`, not file tags or paths.
- Manual duplicate marking stores canonical/duplicate file pairs without deleting, moving, or retagging either file; `mark-duplicate:smoke` verifies apply, idempotency, and revert.
- Duplicate track merge stores durable merge state on the duplicate track, moves app database references to the canonical track, and is verified with `track-merge:smoke`.
- Agent duplicate cleanup prompts inspect exact SHA-256 duplicate groups, choose a canonical file by metadata completeness/path stability, and create an agent-sourced `mark_duplicate` operation batch for review. Applying the batch records duplicate marks only; it does not remove index rows or files.
- Quality upgrade suggestions group indexed files by normalized artist and title, score their technical quality, and surface lower-quality copies when a clearly better matching file is already indexed.
- Quality suggestions are read-only for now; they identify preferred and lower-quality indexed copies without deleting, moving, or mutating anything.
- `quality:smoke` verifies FLAC-over-low-bitrate-MP3 suggestions while ignoring unrelated tracks.
- Missing metadata cleanup lists indexed files missing title, artist/albumartist, album, or year/date.
- Missing metadata rows can open the existing metadata editor, which creates normal `set_file_metadata` operation batches for approval/apply.
- `metadata:smoke` verifies gap detection skips fully tagged files and produces filename-derived suggestions for review.
- Library rows can be selected for bulk internal tag proposals. The UI creates a single operation batch with one `set_internal_tags` operation per selected track/file, so tags remain reviewable before they are applied.
- `operation:smoke` verifies bulk internal tag proposals use the existing operation review/apply pipeline.
- Selected library rows can also create bulk rename proposals from a tokenized filename pattern such as `{artist} - {title}.{ext}`.
- Bulk rename validates generated filenames and duplicate targets before creating a batch, then uses normal `rename_file` operations for approval/apply.
- `operation:smoke` verifies bulk rename proposals before the single-file rename path.
- Album merge suggestions group indexed files by album artist/artist and normalized album title, stripping common edition words like deluxe, remastered, expanded, and anniversary.
- Album merge proposals create reviewable `set_file_metadata` operation batches that set variant files to the canonical album name; no files are moved or deleted.
- `album-merge:smoke` verifies suggestion detection, proposal creation, apply behavior, and that merged variants disappear from suggestions.
- Alternate edition grouping uses the same normalized album family detection, but presents standard, remastered, mono, stereo, deluxe, expanded, and other edition labels as a read-only review panel.
- Alternate editions do not create merge operations automatically; the view exists to distinguish editions that should remain separate before a user decides to merge metadata.
- `alternate-editions:smoke` verifies standard/remastered/mono grouping and confirms the check does not mutate indexed files.
- Taste profile data is stored in `taste_profile` as typed key/value JSON rows with source, confidence, and timestamps.
- The Settings view edits the structured profile fields from the plan: favorites, preferred genres/eras/countries/labels, blocked artists/genres, overplayed tracks, preferred formats, quality preferences, tagging preferences, folder organization preferences, playlist style preferences, and notes.
- `taste-profile:smoke` verifies profile defaults, save behavior, and persistence after reopening the database.

## Phase 10 Implementation

Phase 10 starts without introducing a separate LangGraph service. The existing operation-batch system already provides the first durable approval checkpoint for agent workflows: agent actions create proposed batches, the app can restart while they are paused, and approval/application can resume later from SQLite state.

Current durable workflow behavior:

- Agent proposals are persisted as `operation_batches` and `operations`.
- Agent-created operation batches retain `agent_thread_id` so Operations history can be traced back to the thread that proposed the work, and linked Operations rows can open the source Agent thread.
- Agent chat state is persisted as `agent_threads` and `agent_messages`.
- `GET /agent/threads/active` returns the active thread and transcript for the Agent UI.
- `GET /agent/threads`, `POST /agent/threads`, and `GET /agent/threads/:id` support thread listing, creation, and switching.
- `POST /agent/message` appends user/agent messages to a thread while still returning the typed tool response.
- Proposed batches do not mutate state before approval.
- After restart, the backend can reload the proposed batch, approve it, apply it, and retain operation before/after audit data.
- `durable-workflow:smoke` verifies pause-before-approval, restart survival, resume through approval/apply, and audit retention.
- `agent-thread:smoke` verifies transcript persistence, multiple thread separation, thread listing, operation-batch thread linkage, and restart survival.

LangGraph remains a later option if workflows need branching graph execution beyond persisted operation batches and jobs.

## Renderer Design System

The renderer uses a flat, terminal-inspired design system defined entirely in `apps/desktop/src/renderer/styles.css`:

- Design tokens are CSS custom properties on `:root`: layered surfaces (`--bg0`..`--bg3`), hairline borders (`--line`, `--line2`), a three-step text scale (`--tx0`..`--tx2`), and a lime accent (`--acc`) with derived dim/line variants.
- Typography is JetBrains Mono Variable for UI and data, with Space Grotesk Variable for headings, both bundled offline through `@fontsource-variable` packages imported in `main.tsx`.
- All sizing uses rem units.
- Motion uses two shared easings (`--fast` ~120ms, `--med` ~220ms): views animate in with a small fade/translate, modals scale in, hover states transition borders and colors, and `prefers-reduced-motion` disables all of it.
- Library grid rows use `content-visibility: auto` with a fixed intrinsic size so large libraries do not pay full render cost for offscreen rows.
- The Library view is organized around a single command bar (search + `Filters`/`Roots` toggle chips). Root management, scan summaries, and the filter/sort refiners live in collapsible panels that are hidden by default (roots auto-open when no roots exist), and the bulk action bar renders only while files are selected. Row actions are compact icon buttons (like, dislike, tag diagnostics, edit, remove) plus a small rating select.
- Vite dev runs with polling file-watching (`server.watch.usePolling`) because WSL receives no file events for edits made from Windows on `/mnt/*`.

## Artwork

Cover art is served by the backend (`apps/backend/src/services/artwork-service.ts`) through two endpoints:

- `GET /artwork/file/:fileId` extracts embedded cover art from the audio file with `music-metadata` (`selectCover`), cached in memory by file id + mtime (misses cached too). If that exact file has no embedded art, the endpoint falls back to the containing album's artwork so Library rows and the now-playing bar can use sibling embedded art or the album-level Cover Art Archive result.
- `GET /artwork/album/:albumId` tries embedded art across the album's first few files, then falls back to the Cover Art Archive: a MusicBrainz release search (serialized to 1 request/sec, honoring `MUSIC_OS_MUSICBRAINZ_ENABLED` / `MUSIC_OS_MUSICBRAINZ_USER_AGENT`) resolves release MBIDs, then `coverartarchive.org/release/{mbid}/front-250` is fetched. Edition qualifiers like "(Japan Red Vinyl)" are stripped and retried when the first search misses. Album results are cached in memory per album id.

The renderer shows art in Library rows (thumbnail next to the title), the Albums view (cover card grid with hover play overlay), and the now-playing bar (current track art replaces the EQ glyph when available; the animated EQ remains the fallback). Images carry long-lived cache headers; missing art returns 404 with a short max-age and the renderer falls back to a music-note glyph.
