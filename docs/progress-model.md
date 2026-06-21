# Progress Model

This file tracks implementation against `PLAN.md`. It is the working delivery model, while `docs/product-architecture.md` is the architecture reference.

## Status Terms

- `not-started`: no implementation exists.
- `active`: implementation is underway.
- `implemented`: code exists for the requirement.
- `verified`: acceptance criteria were checked with tests, typecheck, runtime smoke test, or inspected output.
- `blocked`: implementation cannot continue without a decision or external dependency.

## Current Focus

| Phase | Status | Evidence | Next Verification |
| --- | --- | --- | --- |
| Phase 0: Project Setup | verified | Monorepo scaffold, docs, typed packages, SQLite migration, backend health smoke test, desktop shell production build, Electron preload health bridge, and toolbar health visibility verified by `electron-health:smoke` | Complete |
| Phase 1: Local Library Scanner | verified | Add root endpoint/UI, recursive scanner, embedded tag/technical metadata capture, file grid with client-side sort/filter refiners, persisted watch-root intent with explicit watched-root scan action, smoke test proves no duplicate rows, missing marking, embedded tag indexing, and watch flag persistence; Library view reorganized into a single command bar (search + Filters/Roots toggle chips), collapsible roots/filter panels, selection-gated bulk action bar, icon row actions, and per-row artwork thumbnails served from `/artwork/file/:fileId` with album covers (embedded-first, Cover Art Archive fallback) powering an Albums cover grid | User validation against personal music folder |
| Phase 2: Playback | verified | Configured mpv path, backend playback service, WSL-to-Windows path translation, playback endpoints, file queue, album grouping/playback, playlist playback, grid Play buttons, bottom now-playing controls, clickable seek progress control, API smoke test for play/pause/resume/next/stop, `/playback/state` polls mpv for current position/duration, backend and renderer both interpolate progress between successful polls, durable play/skip history verified by `playback-history:smoke`, manual rating/liked/disliked operation batches verified by `ratings:smoke`, album queue ordering verified by `album-playback:smoke`, user validated progress bar/time display, persistent async mpv IPC bridge (Windows named pipe relayed through a long-lived Windows `node.exe` process, unix socket for native mpv) replacing per-command blocking PowerShell spawns, automatic queue advance on mpv end-of-file/idle events verified end-to-end by `playback-advance:smoke`, redesigned now-playing bar (animated EQ glyph, status dot, queue position badge, icon transport, tabular time readout), and a space-bar pause/resume shortcut | User validation of gapless queue progression with real library data |
| Phase 3: Import Inbox | verified | Manual path staging, import_items, metadata analysis, editable review metadata, selectable metadata candidates, proposed destination, approve/reject API, Imports UI, smoke test proves staged files stay out of library until approval, user validated real imported files | User validation of candidate selection against real imports |
| Phase 4: Metadata and Fingerprinting | verified | Scanner persists SHA-256 fingerprints, optional Chromaprint storage migration/service, duplicate groups API/UI, import duplicate warnings, metadata candidates/selection/quality scoring, metadata diagnostics API/UI for parser common/native tags, filename low-confidence smoke, MusicBrainz resolver live check, user validated real duplicate import detection | Use diagnostics to improve support for unusual tag mappings |
| Phase 5: Operation Batch System | verified | Operation batch service/API/executor, import approval proposal/apply flow, Operations UI, create/update playlist/add playlist tracks/remove playlist tracks/associate file with track/associate track with album/merge duplicate tracks/set tags/move/rename operations, file metadata override operation, non-destructive remove-from-index operation, conservative revert support for metadata/rating/favorite/internal-tag/create-playlist/playlist-edit/track-association/track-album-association/track-merge batches, operation smoke verifies review-before-apply plus applied/failed logging, and `revert:smoke`, `playlist-edit:smoke`, `track-association:smoke`, `track-album-association:smoke`, and `track-merge:smoke` verify undo behavior | User validation with real import approval, metadata edit, index removal, playlist edits, track associations, duplicate track merges, and safe batch revert |
| Phase 6: Agent v1 Read-Only + Playlists | verified | Deterministic local agent service, library search/playback/playlist proposal tool paths, playlist API/UI, Agent UI, operation-batch playlist creation with file membership, manual playlist proposal from selected Library rows, reviewable playlist metadata edits, add-selected-to-playlist, and remove-playlist-item UI, `agent:smoke` proves search-before-claim and proposal-before-mutation, and `operation:smoke`/`playlist-edit:smoke` cover playlist batch apply/failure/revert behavior | User validation with real library prompts, playlist edits, and playlist playback |
| Phase 7: slskd Connector | verified | slskd config, typed Discovery source selector, backend discovery health/search/download routes, tolerant slskd API client, download-staging readiness in `/discovery/health` and Discovery UI, release-inferred, query-ranked, library-aware, and collapsed release-sectioned Discovery candidate UI with compact source previews, top-candidate highlights, recommended default release filtering, oversized collection isolation, result limiting, actionable saved candidate bookmarks, and Agent handoff verified by smoke/build checks, selected-result staged acquisition through reviewable queue_download operation batches, non-downloading live slskd preflight verified by `slskd:preflight-smoke`, database-backed download job monitor, Jobs page, peer-availability capture (free slot, queue length, upload speed) with availability-ranked source selection, and a real completed slskd transfer landing in Import Inbox without touching the library verified by `slskd:live-smoke` | User validation of Discovery staging through the app UI with real searches |
| Phase 8: Agent v2 Discovery | verified | Agent can call deterministic Discovery search, compare remote/list/import candidates to indexed library state, parse pasted chart lists from Agent or Discovery UI, persist parsed lists as reusable Discovery sources with missing/owned search workflow controls, return typed candidate and release-group summaries, create reviewable queue_download/import approval proposals ranked by peer availability, execute approved queue_download operations through the Discovery download job monitor, create non-mutating queue_download proposals against real slskd search results verified by `slskd:preflight-smoke`, and execute the applied queue_download path against a real completed slskd transfer into Import Inbox verified by `slskd:live-smoke` | User validation of agent download prompts against the real slskd connector |
| Phase 9: Cleanup and Power Tools | active | Exact duplicate cleanup proposal route/UI, quality upgrade suggestions, incomplete album detection, missing metadata cleanup view, album merge suggestions/proposals, alternate edition grouping, taste profile editor, bulk internal tag proposals, bulk rename proposals, non-destructive index-removal batch, metadata edit operation handoff, additive track/file association primitive, track/album association primitive, manual duplicate mark primitive, duplicate track merge primitive, agent-sourced duplicate mark proposals, smoke tests for duplicate cleanup, quality upgrades, incomplete albums, metadata gaps, album merge, alternate editions, taste profile, bulk tags, bulk rename, track association, track-album association, duplicate marks, track merges, and agent duplicate proposals | User validation with real cleanup and Settings edits |
| Phase 10: Advanced Agent Harness | active | Initial durable approval/resume harness through persisted agent operation batches, restart survival, operation before/after audit verified by `durable-workflow:smoke`, persisted agent threads/messages, Agent UI thread switching, and Operations-to-Agent source-thread links on agent operation batches verified by `agent-thread:smoke` | Optional LangGraph service only if workflows outgrow operation batches |

## Tracking Rules

1. Every feature update must move at least one roadmap row forward or add evidence explaining why it cannot.
2. Database changes require a migration in `packages/db/src/migrations`.
3. Renderer code must call typed backend/preload APIs only.
4. Mutations that affect files, tags, playlists, imports, or library records must route through operation batch contracts once the executor exists.
5. A phase is not `verified` until its acceptance criteria from `PLAN.md` have direct evidence.

## Immediate Phase 0 Checklist

- [x] Create monorepo structure.
- [x] Add architecture docs folder.
- [x] Add typed core schemas.
- [x] Add initial SQLite migration.
- [x] Add backend health/database initialization entrypoint.
- [x] Add Electron + React shell.
- [x] Install dependencies.
- [x] Run typecheck.
- [x] Run backend health smoke test.
- [x] Build desktop renderer/main/preload bundles.
- [x] Start backend and renderer dev servers.
- [x] Verify backend health endpoint and dev CORS headers.
- [x] Confirm health is visible in Electron shell.

## Immediate Phase 1 Checklist

- [x] Add library root API.
- [x] Add library root UI.
- [x] Add recursive audio file scanner.
- [x] Extract file stats and embedded metadata when available.
- [x] Persist scanned files in SQLite.
- [x] Display indexed files in the Library grid.
- [x] Add Library grid sorting and filters for metadata, format, missing state, rating, preference, and play count.
- [x] Persist file-watch intent on library roots and expose root Watch controls in the Library UI.
- [x] Add explicit scan action for all watched roots.
- [x] Add manual rescan action.
- [x] Verify repeated scan updates rows without duplicating records.
- [x] Verify deleted files are marked missing.
- [x] Verify embedded tag indexing with a tagged scanner fixture.
- [x] Verify library root watch flag persistence and watched-root scan behavior with `root-watch:smoke`.
- [ ] User validation with a real music folder.

## Immediate Phase 2 Checklist

- [x] Configure mpv executable path through `MUSIC_OS_MPV_PATH`.
- [x] Verify Windows mpv from WSL with `mpv:check`.
- [x] Add playback state and play-file API contracts.
- [x] Add backend playback service.
- [x] Translate WSL `/mnt/<drive>/...` paths for Windows mpv.
- [x] Add playback endpoints for state, play file, play queue, pause, resume, stop, next, previous, and seek.
- [x] Add Play buttons to Library rows.
- [x] Add bottom player now-playing state and controls.
- [x] Add clickable bottom progress seek control wired to `/playback/seek`.
- [x] Verify API playback sequence against indexed files.
- [x] Poll mpv IPC for playback position and duration in `/playback/state`.
- [x] Add backend monotonic progress fallback if mpv property polling misses.
- [x] Interpolate visible playback progress in the renderer between backend polls.
- [x] User validation that current time and progress bar advance during playback.
- [x] Add durable play count and skip tracking once the track/listen model is wired.
- [x] Show play/skip counts in the Library grid.
- [x] Add reviewable manual rating and liked/disliked status operations.
- [x] Verify rating and favorite status persistence with `ratings:smoke`.
- [x] Add logical album grouping and album playback from indexed metadata.
- [x] Verify album queue ordering with `album-playback:smoke`.
- [x] Replace per-command blocking PowerShell mpv IPC with a persistent async bridge (`mpv-ipc.ts`).
- [x] Auto-advance the queue when mpv reports end-of-file/idle, verified by `playback-advance:smoke`.
- [x] Redesign the now-playing bar with icon transport, queue position, EQ glyph, and time readout.
- [x] Add a space-bar pause/resume keyboard shortcut.
- [x] Serve embedded cover art via `GET /artwork/file/:fileId` (music-metadata, in-memory cache).
- [x] Serve album cover art via `GET /artwork/album/:albumId` with Cover Art Archive fallback (MusicBrainz release search, rate-limited, edition-qualifier retry).
- [x] Show artwork in Library rows, Albums cover grid (hover play overlay), and the now-playing bar.
- [x] Declutter the Library view: single command bar with search plus Filters/Roots toggle chips, collapsible roots and filter panels, selection-gated bulk action bar, icon row actions.
- [ ] User validation of Albums view and rating controls with real library data.

## Visual / Player Roadmap (not yet started)

- [x] Audio visualizer foundation with mpv retained as the playback engine: separate `/playback/visualizer/stream` SSE channel, `/playback/waveform/:fileId` cached waveform endpoint, `/playback/visualizer/capabilities`, canvas-based renderer surfaces, bottom-player waveform/meter, Now Playing waveform/spectrum/spectrogram modes, optional ffmpeg-backed waveform cache, and optional ffmpeg sidecar analyzer for live meter/spectrum/spectrogram frames. Visualizer frames are kept out of `/playback/state` and out of React per-frame state; stream frames use playback snapshots instead of polling mpv IPC at visualizer cadence.
- [ ] Album art correction workflow (choose/replace art, persist overrides through operation batches) per PLAN.md "Album art display and correction later".
- [ ] Optional on-disk artwork cache so Cover Art Archive lookups survive backend restarts.

## Immediate Phase 3 Checklist

- [x] Add manual path import API.
- [x] Copy source files into backend staging before review.
- [x] Create `imports` and `import_items` records.
- [x] Scan staged copies for technical metadata and embedded tags.
- [x] Generate a basic destination proposal from detected artist/year/album/title.
- [x] Edit detected import metadata before approval and recompute proposed destination.
- [x] Choose a generated metadata candidate from import diagnostics before approval.
- [x] Keep staged files out of the normal Library grid/count before approval.
- [x] Add Imports view with stage, approve, and reject actions.
- [x] Approve import by moving staged file into the selected library root and indexing it.
- [x] Reject import item without adding it to the library.
- [x] Verify staged-to-approved behavior with `import:smoke`.
- [x] Verify pre-approval metadata edits with `import:smoke`.
- [x] User validation with real incoming files.

## Immediate Phase 4 Checklist

- [x] Persist SHA-256 and quick hash values for scanned files.
- [x] Expose exact duplicate groups from hashed library files.
- [x] Add Duplicates view for exact hash matches.
- [x] Add exact duplicate warnings to staged import items.
- [x] Show duplicate candidates in the Imports view.
- [x] Verify exact duplicate library/import behavior with `duplicate:smoke`.
- [x] Add metadata candidate contract fields to import item payloads.
- [x] Add MusicBrainz recording resolver.
- [x] Add candidate scoring for embedded tags, filename parsing, and MusicBrainz matches.
- [x] Add low-confidence warning path for filename-only matches.
- [x] Add optional Chromaprint/fpcalc fingerprint storage path.
- [x] Add metadata diagnostics for import items and library files.
- [x] Verify badly named filename matching with `metadata:smoke`.
- [x] Verify diagnostics expose embedded tags in `import:smoke`.
- [x] Verify MusicBrainz resolver with a live recording search.
- [x] User validation with real duplicate imports after backend restart.

## Immediate Phase 5 Checklist

- [x] Add backend operation batch repository/service over existing operation tables.
- [x] Add API routes to list, create, approve, reject, and apply operation batches.
- [x] Add an operation executor with safe failure logging.
- [x] Route import approval through an `import_file` operation batch.
- [x] Add operation batch approval UI.
- [x] Add operation history UI.
- [x] Add create playlist operation.
- [x] Add update playlist operation.
- [x] Add set internal tags operation.
- [x] Add move/rename file operation.
- [x] Add indexed file metadata override operation.
- [x] Add non-destructive file removal from library index operation.
- [x] Add reviewable add-tracks-to-playlist operation.
- [x] Add reviewable remove-tracks-from-playlist operation.
- [x] Add reviewable associate-file-with-track operation.
- [x] Add reviewable associate-track-with-album operation.
- [x] Add reviewable merge-duplicate-tracks operation.
- [x] Verify mutations are reviewable before applying.
- [x] Verify applied operations are logged.
- [x] Verify failed operations fail safely.
- [x] Verify metadata edit and index removal in `operation:smoke`.
- [x] Add conservative revert support for safe database-backed operation batches.
- [x] Add guarded playlist creation revert that removes only unchanged created playlists and playlist items.
- [x] Add safe playlist edit revert for added playlist rows and removed playlist row snapshots.
- [x] Add safe playlist metadata update revert.
- [x] Add safe file-track association revert for operation-created links.
- [x] Add safe track-album association revert to the captured prior album id.
- [x] Verify reversible metadata, rating, favorite, internal tag, and playlist creation batches with `revert:smoke`.
- [x] Verify playlist add/remove/revert behavior with `playlist-edit:smoke`.
- [x] Verify file-track association and revert behavior with `track-association:smoke`.
- [x] Verify track-album association and revert behavior with `track-album-association:smoke`.
- [x] Verify duplicate track merge and revert behavior with `track-merge:smoke`.

## Immediate Phase 6 Checklist

- [x] Add playlist read API and typed playlist response contracts.
- [x] Add playlist playback endpoint over approved playlist items.
- [x] Store selected library file IDs in create-playlist operation payloads.
- [x] Apply create-playlist batches into playlists, playlist items, tracks, and track-file links.
- [x] Add deterministic local agent message API.
- [x] Add agent library search path that reads indexed library files before replying.
- [x] Add agent playlist proposal path that creates an operation batch and does not mutate until approval/apply.
- [x] Add agent playback path that queues matching indexed library files.
- [x] Add Playlists view with playlist item inspection and play action.
- [x] Add manual playlist proposal from selected Library rows.
- [x] Add manual playlist metadata update proposal from the Playlists view.
- [x] Add manual add-selected-to-existing-playlist proposal from selected Library rows.
- [x] Add manual remove-playlist-item proposal from the Playlists view.
- [x] Add Agent view with transcript, tool result summaries, and operation batch handoff.
- [x] Verify Phase 6 agent search and playlist proposal/apply behavior with `agent:smoke`.
- [x] Verify workspace typecheck after Phase 6 UI/API changes.
- [ ] User validation with real library prompts and playlist playback.

## Immediate Phase 7 Checklist

- [x] Add backend config for slskd URL and API credentials.
- [x] Add typed discovery health and search contracts.
- [x] Add slskd service with API-key or Basic auth headers.
- [x] Add backend discovery health endpoint.
- [x] Add backend discovery search endpoint.
- [x] Add Discovery view search UI.
- [x] Add typed Discovery source selector.
- [x] Keep discovery results separate from library/import records.
- [x] Verify slskd health against local running slskd.
- [x] Verify Soulseek search results render in Discovery.
- [x] Group Discovery results by remote user and folder.
- [x] Add candidate scoring, sorting, and filters for Discovery results.
- [x] Verify Discovery candidate ranking/filtering with `discovery-candidates:smoke`.
- [x] Add inferred artist/release labels and query-match ranking for Discovery candidates.
- [x] Cluster repeated Discovery source folders into release sections while keeping source-level staging explicit.
- [x] Add compact release previews and clearer stageable-file selection for Discovery candidates.
- [x] Add expandable file detail rows for Discovery folder candidates.
- [x] Collapse Discovery search results by inferred release and show top-ranked source folders first.
- [x] Add release-level best-source staging controls for Discovery results.
- [x] Add Discovery candidate detail panel with source, confidence, library match, warnings, and preview context.
- [x] Add top Discovery candidate highlights, release-type filtering, and visible-result limiting for large result sets.
- [x] Default Discovery search display to recommended release sections and isolate oversized collection folders behind their own filter.
- [x] Add persisted saved Discovery candidate bookmarks.
- [x] Let saved Discovery candidates propose downloads or hand off to Agent.
- [x] Add Discovery candidate handoff into the Agent thread.
- [x] Compare Discovery candidates against indexed library files and label missing, owned, and possible-upgrade results.
- [x] Add Discovery library-state filters for actionable, missing, owned, and all candidates.
- [x] Add Discovery candidate selection state for folder/file results.
- [x] Route Discovery selected-result staging through reviewable `queue_download` operation batches.
- [x] Add selected-result download into controlled staging.
- [x] Hand completed downloads into Import Inbox.
- [x] Add database-backed download job monitor with retry/cancel controls.
- [x] Add generic Jobs view for job table and event inspection.
- [x] Verify download job staging, cancel, retry, and operation-batch handoff behavior with `discovery-download:smoke`.
- [x] Add guarded live slskd transfer validation script.
- [x] Add non-downloading live slskd preflight validation script.
- [x] Verify slskd health/search/queue_download proposal against real slskd without creating jobs/imports/library files with `slskd:preflight-smoke`.
- [x] Expose download-staging readiness in Discovery health and disable Discovery download proposal actions until `MUSIC_OS_SLSKD_DOWNLOAD_DIR` is configured.
- [x] Capture peer availability hints (free upload slot, queue length, upload speed) on discovery results and rank download source selection by availability.
- [x] Verify staged slskd downloads with a real completed transfer.

## Immediate Phase 8 Checklist

- [x] Add typed agent discovery result summaries.
- [x] Add deterministic agent Discovery search tool path.
- [x] Compare Discovery candidates against indexed library matches.
- [x] Return release-grouped Discovery summaries from agent search responses.
- [x] Keep agent Discovery search read-only with no download queueing.
- [x] Add reviewable agent `queue_download` proposal batches for explicit download/stage prompts.
- [x] Add deterministic pasted-list parser for chart/RYM-style lines.
- [x] Add Discovery UI for pasted chart/list parsing and source search handoff.
- [x] Compare parsed list items against indexed library matches.
- [x] Persist parsed chart/list rows as reusable local Discovery sources.
- [x] Add parsed-list missing/owned filters and saved-list missing search handoff.
- [x] Verify agent Discovery search with `agent:smoke`.
- [x] Verify pasted-list parsing with `agent:smoke`.
- [x] Verify saved parsed-list persistence with `saved-discovery-lists:smoke`.
- [x] Add agent import approval proposal handoff for staged Import Inbox items.
- [x] Verify agent import proposal handoff with `agent:smoke`.
- [x] Execute approved download proposals through Discovery download jobs.
- [x] Verify executable queue_download handoff with `agent:smoke`.
- [x] Add guarded live queue_download transfer validation script.
- [x] Verify real slskd search can create a non-mutating queue_download proposal with `slskd:preflight-smoke`.
- [x] Validate executable download handoff with a real completed slskd transfer.

## Immediate Phase 9 Checklist

- [x] Add exact duplicate cleanup proposals from the Duplicates view.
- [x] Keep duplicate cleanup reviewable through operation batches.
- [x] Ensure duplicate cleanup removes index entries only and never deletes files from disk.
- [x] Verify duplicate cleanup with `duplicate:smoke`.
- [x] Add quality upgrade suggestions for lower-bitrate/lossy copies.
- [x] Verify quality upgrade suggestions with `quality:smoke`.
- [x] Add incomplete album detection from indexed track totals.
- [x] Verify incomplete album detection with `incomplete-albums:smoke`.
- [x] Add missing metadata cleanup view.
- [x] Let missing metadata rows hand off to metadata edit operation proposals.
- [x] Verify missing metadata detection with `metadata:smoke`.
- [x] Add bulk internal tag proposal from selected library rows.
- [x] Verify bulk internal tags with `operation:smoke`.
- [x] Add bulk rename proposal from selected library rows.
- [x] Verify bulk rename with `operation:smoke`.
- [x] Add album merge suggestions and proposal handoff.
- [x] Verify album merge with `album-merge:smoke`.
- [x] Add read-only alternate edition grouping.
- [x] Verify alternate editions with `alternate-editions:smoke`.
- [x] Add persistent taste profile editor in Settings.
- [x] Verify taste profile persistence with `taste-profile:smoke`.
- [x] Add durable manual duplicate mark storage.
- [x] Add reviewable, reversible `mark_duplicate` operation primitive.
- [x] Verify duplicate marks with `mark-duplicate:smoke`.
- [x] Add durable duplicate track merge state.
- [x] Add reviewable, reversible `merge_duplicate_tracks` operation primitive.
- [x] Verify duplicate track merge behavior with `track-merge:smoke`.
- [x] Add deterministic Agent duplicate cleanup proposals that create reviewable `mark_duplicate` batches.
- [x] Verify Agent duplicate proposals with `agent:smoke`.

## Immediate Phase 10 Checklist

- [x] Verify agent proposal can pause before approval.
- [x] Verify proposed agent workflow survives app restart.
- [x] Verify approval/apply can resume after restart.
- [x] Verify applied tool calls retain before/after audit data.
- [x] Verify durable approval/resume behavior with `durable-workflow:smoke`.
- [x] Persist agent threads and message transcripts in SQLite.
- [x] Load active agent thread history in the Agent UI.
- [x] Add agent thread list/create/get APIs and Agent UI thread switching.
- [x] Link agent-created operation batches to their source agent thread.
- [x] Expose source agent thread navigation from linked Operations batches.
- [x] Verify agent thread restart survival with `agent-thread:smoke`.
- [ ] Decide whether a separate LangGraph service is needed after real long-running workflow use.
