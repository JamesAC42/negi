Below is a source-of-truth draft you can put in `docs/product-architecture.md` and feed to a coding agent.

The external integration assumptions are grounded in official/current docs: Electron’s main/renderer/preload model fits a desktop shell with privileged backend access isolated from the UI; mpv exposes JSON IPC for external control; slskd is already shaped as a daemon/API service with optional Swagger/OpenAPI docs; MusicBrainz, AcoustID, ListenBrainz, and Discogs cover metadata/fingerprinting/recommendation inputs; LangGraph is a good later-stage option for persistent human-in-the-loop agent workflows. ([Electron][1])

# Music OS: Product, Roadmap, and Architecture Specification

## 1. Product Summary

Music OS is a local-first desktop music application for personal use. It combines a serious local music player, a powerful music library manager, a staged acquisition/import pipeline, and an AI agent that can help browse, organize, tag, clean, recommend, and play music.

The core idea is not just “a player with search.” The core idea is a controlled local music operating system.

The user should be able to say things like:

“Play Japanese disco from 1980.”

“Make a playlist with these artists.”

“Find duplicate albums where I have both MP3 and FLAC, and propose which copies to keep.”

“Organize my library by Album Artist / Year - Album / Track - Title.”

“Find top Japanese disco albums from 1980, compare them against what I already have, stage candidates, import clean versions, and make a playlist.”

“Tag all YMO-related tracks with better genre/style tags, but show me first.”

The application must treat the local music library as valuable data. The agent must never directly mutate files without producing a reviewable operation batch. File changes, tag writes, imports, renames, playlist creation, and deletes must be auditable and reversible where possible.

The product is for personal local use. It should not be designed as a hosted service, public sharing system, or mass-distribution product.

---

## 2. Product Thesis

Existing apps solve separate parts of the problem:

Traditional music players are good at playback and local organization, but poor at acquisition/import workflows and AI-assisted management.

P2P clients are good at search/download, but poor at clean library import, metadata correction, deduplication, playback UX, and long-term collection management.

Metadata tools are good at tagging, but are not usually integrated into browsing, playback, recommendations, and conversational control.

Recommendation systems are usually tied to streaming services and do not understand the user’s actual local files, alternate editions, file quality, personal tags, and offline collection.

Music OS should unify these into one local-first workflow:

Discover → Search → Stage → Identify → Clean → Import → Organize → Play → Learn Taste → Recommend → Repeat.

The strongest differentiator is the import and agent layer. Files should never fall directly into the library. Every new file enters a staging area, gets fingerprinted, matched, scored, deduplicated, tagged, and only then becomes part of the library.

The agent should operate as a librarian, DJ, metadata assistant, and workflow planner. It should not be a loose chatbot. It should be a tool-using operator with strict permissions.

---

## 3. Target User

Primary user: one technical power user with a large or growing local music collection.

Assumptions:

The user is comfortable running local services.

The user wants a dense, power-user UI.

The user values control over folders, tags, playlists, metadata, quality, and imports.

The user may have music from multiple sources: ripped CDs, Bandcamp, local files, downloads, public-domain files, personal archives, P2P, and manual imports.

The user wants AI automation, but not at the cost of losing control over the library.

The user is comfortable approving proposed changes before they are applied.

---

## 4. Design Principles

### 4.1 Local-first

The local machine is the source of truth. SQLite stores the canonical library index, operation history, import history, tags, playlists, and agent state. Files remain on local disk.

Cloud APIs may be used for metadata and model calls, but the application must continue to function as a local player and library manager without cloud features.

### 4.2 Staging before import

No external result should be imported directly into the library. All new files go through an import inbox/staging folder first.

The staging pipeline must inspect files, fingerprint audio, resolve metadata, detect duplicates, compare quality, propose canonical paths/tags, and require approval before final import.

### 4.3 Agent proposes, deterministic backend executes

The AI agent may plan, search, compare, rank, recommend, and propose operations.

The backend executes only typed, validated operations.

The agent must not directly perform raw filesystem mutations.

All mutating actions must be represented as operation batches.

### 4.4 Reviewable diffs

Before any meaningful mutation, the UI must show what will change.

Examples:

Files to move.

Files to rename.

Tags to write.

Playlists to create.

Tracks to add/remove.

Albums to merge.

Duplicates to mark.

Downloads to queue.

Imports to approve.

Deletes should be disabled or heavily gated in early versions.

### 4.5 Reversibility and auditability

Every applied operation batch must be logged with before/after state. For operations that can be undone, the app should provide an undo action.

At minimum, the app should support undo for:

Playlist creation.

Playlist edits.

Internal tag assignment.

Library metadata edits.

File rename/move operations where the source still exists.

Tag writes where previous tag values were captured.

### 4.6 Source-agnostic acquisition

The product should support multiple acquisition sources over time. The first external search/download source can be slskd, but the architecture should treat it as one connector.

Other sources may include:

Manual file drop.

Watched folders.

Purchased music folders.

Pasted chart/list data.

Metadata databases.

Future legal source connectors.

### 4.7 Dense but understandable UI

The UI can be power-user dense. It should not hide important information in oversimplified cards. However, it must be clear which state a file is in:

Library item.

Search result.

Download candidate.

Staged file.

Import proposal.

Imported track.

Duplicate.

Rejected item.

---

## 5. Non-Goals

The app is not a streaming service.

The app is not a public file-sharing product.

The app is not a cloud-hosted music locker.

The app is not intended to replace every advanced feature of existing players in v1.

The app should not implement the Soulseek protocol directly in the first version.

The app should not perform automated public website scraping as a required core dependency.

The app should not mutate the library silently.

The app should not rely on filenames as canonical identity.

The app should not require a paid cloud model to play or manage local music.

---

## 6. High-Level User Workflows

### 6.1 Local library scan

User selects one or more music library folders.

App scans recursively for supported audio files.

App extracts technical metadata: path, extension, codec, bitrate, sample rate, channels, duration, file size, modified time.

App extracts embedded tags: title, artist, album, album artist, year/date, track number, disc number, genre, composer, label, MusicBrainz IDs, album art if present.

App creates or updates records in SQLite.

App fingerprints audio where needed.

App groups files into tracks, albums, artists, and unresolved clusters.

User sees library in a searchable grid.

### 6.2 Playback

User can play tracks, albums, playlists, search results, and agent-generated queues.

Playback should be controlled by the app using an external playback engine initially.

The app should track play count, last played, skips, manual ratings, and liked/disliked state.

### 6.3 Import inbox

User drops files into the staging folder or queues files from an external source.

App creates an import job.

App fingerprints and scans each file.

App proposes metadata matches.

App compares staged files against the existing library.

App shows import candidates with confidence, quality, warnings, and duplicate status.

User approves import.

App writes tags if approved.

App moves files into the configured library folder structure.

App indexes the newly imported files.

### 6.4 External search and download

User searches from the app UI or asks the agent to search.

App queries external connector adapters.

Results are normalized into a common result format.

User or agent can queue selected results.

Completed downloads land in staging.

Downloads never skip the import inbox.

### 6.5 Agent library management

User asks the agent to inspect, organize, tag, rename, dedupe, make playlists, or play music.

Agent uses read tools to inspect the library.

Agent proposes operation batches for mutating tasks.

User reviews the operation batch.

Backend applies approved operations.

App logs all applied changes.

### 6.6 Discovery and recommendation

User asks for music by vibe, era, country, genre, label, artist similarity, or chart/list source.

Agent queries metadata/recommendation adapters.

Agent compares results against local library.

Agent proposes candidates.

If configured, agent can search external source connectors.

Completed results go to staging and then import approval.

---

## 7. Core Feature Requirements

## 7.1 Library Management

The app must support:

Multiple library roots.

Recursive scanning.

File watching.

Manual rescan.

Track, album, artist, and file views.

Fast search.

Sorting/filtering by artist, album, year, genre, codec, bitrate, format, date added, rating, play count, source, tags, and unresolved status.

Internal user tags independent of embedded file tags.

Editable metadata.

Detection of missing tags.

Detection of inconsistent tags.

Detection of duplicate tracks and albums.

Detection of lossy/lossless variants.

Detection of incomplete albums.

Album art display and correction later.

The library database must distinguish between:

The physical file.

The track/recording.

The release/album.

The artist credit.

The user’s internal interpretation.

The external metadata IDs.

A single track may have multiple files. A single album may have multiple versions or editions.

## 7.2 Playback

Initial playback should use mpv controlled by the backend.

Required playback features:

Play file.

Pause/resume.

Seek.

Next/previous.

Queue.

Play playlist.

Play album.

Play search result.

Show currently playing track.

Persist now-playing state.

Track play count.

Track skips.

Track last played.

Later playback features:

Gapless verification.

ReplayGain handling.

Crossfade optional.

EQ optional.

Keyboard shortcuts.

Global media keys.

Scrobbling optional.

## 7.3 Import Inbox

The import inbox is required for MVP.

Import states:

New file detected.

Scanning.

Fingerprinting.

Metadata lookup.

Match proposed.

Duplicate detected.

Needs user review.

Ready to import.

Rejected.

Imported.

Failed.

Import proposal must show:

Current filename.

Detected technical info.

Embedded tags.

Fingerprint status.

Candidate artist/album/track match.

Confidence score.

Duplicate status.

Existing library comparison.

Proposed final path.

Proposed tag writes.

Warnings.

Actions:

Approve import.

Reject file.

Edit metadata before import.

Choose different metadata match.

Import as single.

Import as album.

Keep as alternate edition.

Replace lower-quality copy.

Keep both.

## 7.4 External Search Connectors

The app should implement a connector abstraction.

Initial connectors:

Local manual import.

Watched download folder.

slskd connector.

Metadata search connector.

RYM pasted-list parser.

Future connectors:

Bandcamp purchase folder parser.

YouTube metadata resolver.

Internet Archive/public-domain source.

Other APIs.

Connector result fields should include:

Source connector name.

External result ID.

Display title.

Artist.

Album.

Track list if available.

Year.

Format.

Quality fields if available.

Size.

Duration.

Remote user/source if applicable.

Confidence.

Risk/warning fields.

Raw metadata JSON.

The connector layer must not directly create library records. It can only create search results, download jobs, or staged files.

## 7.5 Metadata and Fingerprinting

Metadata adapters should be source-specific but normalized.

Initial metadata sources:

MusicBrainz for canonical artist/release/recording metadata.

AcoustID/Chromaprint for fingerprint lookup.

Discogs for release/label/style/edition detail.

ListenBrainz for recommendations and listen-based graphing.

Last.fm optional for similar artists/tracks and tags.

RYM should initially be supported through manual paste/list parsing rather than automated scraping.

The metadata resolver should combine evidence:

Embedded tags.

Filename/folder structure.

Duration.

Acoustic fingerprint.

MusicBrainz match.

Discogs match.

User-selected override.

Confidence should be explicit. Low-confidence matches must require review.

## 7.6 Agent

The agent must support these classes of requests:

Library Q&A.

Playback control.

Playlist generation.

Metadata cleanup proposals.

Tagging proposals.

Renaming proposals.

Duplicate analysis.

Import analysis.

External discovery.

Search/download staging.

Recommendation generation.

Taste memory updates.

The agent must have permission levels:

Read-only: safe to run automatically.

Playback: can play/queue music without approval.

Propose: can create operation batches but not apply them.

Mutate: can apply approved operation batches only.

Dangerous: delete/overwrite/replace operations, disabled by default.

The agent must be able to explain:

What it is doing.

What evidence it used.

What it found.

What it wants to change.

What requires approval.

What it refused to do because it lacked confidence.

The agent must not hallucinate library state. It must query the database through tools.

## 7.7 Operation Batches

Every mutating action must be represented as an operation batch.

Operation batch states:

Draft.

Proposed.

Approved.

Applying.

Applied.

Partially applied.

Failed.

Reverted.

Rejected.

Operation types:

Create playlist.

Update playlist.

Add tracks to playlist.

Remove tracks from playlist.

Set internal tags.

Write embedded tags.

Move file.

Rename file.

Import file.

Associate file with track.

Associate track with album.

Merge duplicate tracks.

Mark duplicate.

Set rating.

Set favorite/disliked status.

Queue download.

Reject import item.

Undoable operation requirements:

Capture before state.

Capture after state.

Validate before applying.

Fail safely.

Apply idempotently when possible.

Operation batches should support partial approval. User should be able to approve some operations and reject others.

---

## 8. UI Specification

## 8.1 App Layout

Use a three-pane layout plus bottom player.

Left sidebar:

Library.

Discovery.

Imports.

Playlists.

Agent.

Jobs.

Settings.

Center pane:

Main view changes based on selected section.

Right pane:

Agent panel and contextual inspector.

Bottom bar:

Now playing, queue, transport controls, progress, volume, active job indicator.

## 8.2 Library View

Modes:

Artists.

Albums.

Tracks.

Folders.

Recently added.

Duplicates.

Missing metadata.

Quality upgrades.

Grid columns for track view:

Title.

Artist.

Album.

Album artist.

Year.

Genre.

User tags.

Duration.

Format.

Bitrate.

Sample rate.

Rating.

Play count.

Date added.

Path.

Search should be global and fast.

Filters should be composable.

## 8.3 Discovery View

Search input.

Source selector.

Result list.

Candidate detail panel.

Actions:

Search.

Save candidate.

Queue download.

Send to agent.

Compare with library.

Open import state if downloaded.

Discovery result display:

Title.

Artist.

Album.

Year.

Source.

Format/quality.

Confidence.

Already owned status.

Warnings.

## 8.4 Imports View

Import inbox with status columns.

Group by import batch.

Each import item has:

Filename.

Detected metadata.

Matched metadata.

Confidence.

Duplicate comparison.

Proposed destination.

Warnings.

Actions:

Approve.

Edit.

Reject.

Choose match.

Import as-is.

Keep both.

Replace existing.

## 8.5 Playlists View

Playlist list.

Playlist detail.

Manual editing.

Agent-generated playlist badge.

Regenerate/extend playlist action.

Save as static playlist.

Later: smart playlists.

## 8.6 Agent Panel

The agent panel is not just chat. It should show:

Conversation.

Current plan.

Tool activity.

Found results.

Proposed operation batches.

Approval buttons.

Warnings.

When the agent proposes changes, show operation cards:

Summary.

Affected objects.

Confidence.

Risks.

Diff.

Approve/reject/edit.

The agent should support commands like:

“Only search my library.”

“Do not download anything.”

“Do not rename files.”

“Show me the plan first.”

“Be aggressive about duplicates.”

“Prefer lossless.”

“Prefer Japanese releases.”

“Make a playlist but do not modify tags.”

## 8.7 Jobs View

Show background jobs:

Library scan.

Fingerprinting.

Metadata lookup.

Download monitor.

Import analysis.

Tag write.

File move.

Agent workflow.

Each job should have:

Status.

Progress.

Start/end time.

Logs.

Errors.

Retry action if applicable.

Cancel action if safe.

---

## 9. Architecture Overview

Use a desktop shell plus local backend architecture.

Recommended initial stack:

Electron.

React.

TypeScript.

Vite.

Node.js backend process.

SQLite database.

Drizzle ORM or Kysely.

Zod for runtime schemas.

mpv playback adapter.

slskd connector adapter.

Optional Python LangGraph agent service later.

Initial agent can be TypeScript-based. LangGraph can be introduced once the core app works and agent workflows need persistence, checkpoints, and human-in-the-loop graph execution.

## 9.1 Process Model

The app should have these logical processes:

Electron main process:

Creates windows.

Starts/stops local backend.

Manages app lifecycle.

Manages secure IPC/preload bridge.

May supervise sidecar processes.

Renderer process:

React UI only.

No raw filesystem access.

No direct database access.

No direct shell execution.

Uses safe API exposed by preload or talks to backend over local HTTP/WebSocket.

Local backend process:

Owns SQLite connection.

Owns filesystem operations.

Owns library scanner.

Owns import pipeline.

Owns job execution.

Owns connector clients.

Owns playback controller.

Owns operation batch executor.

Owns agent tool implementations.

Worker processes:

Fingerprinting.

Large scans.

Metadata jobs.

CPU-heavy tasks.

Optional agent process:

Python FastAPI/LangGraph service or TypeScript agent runtime.

Should communicate with backend through typed API.

## 9.2 High-Level Diagram

```text
+-----------------------------+
| Electron Renderer            |
| React UI                     |
| Library / Imports / Agent    |
+--------------+--------------+
               |
               | Safe IPC or Local HTTP/WebSocket
               |
+--------------v--------------+
| Electron Main / App Shell     |
| Window lifecycle              |
| Backend supervisor            |
| Sidecar supervisor            |
+--------------+--------------+
               |
               | Local API
               |
+--------------v--------------+
| Local Backend                 |
| SQLite                        |
| Library scanner               |
| Import pipeline               |
| Metadata resolver             |
| Playback controller           |
| slskd connector               |
| Operation batch executor      |
| Agent tools                   |
+------+----------+------------+
       |          |
       |          |
+------v--+   +---v-------------+
| mpv     |   | slskd            |
| player  |   | external source  |
+---------+   +------------------+

Optional later:

+-----------------------------+
| Python LangGraph Agent       |
| Persistent workflows          |
| Human-in-the-loop checkpoints |
+-----------------------------+
```

---

## 10. Repository Structure

Use a monorepo.

```text
music-os/
  apps/
    desktop/
      src/
        main/
        preload/
        renderer/
    backend/
      src/
        api/
        jobs/
        services/
        workers/
    agent/
      src/
        graphs/
        tools/
        prompts/
  packages/
    core/
      src/
        types/
        schemas/
        constants/
    db/
      src/
        schema/
        migrations/
        repositories/
    metadata/
      src/
        musicbrainz/
        acoustid/
        discogs/
        listenbrainz/
        lastfm/
        resolver/
    playback/
      src/
        mpv/
        types/
    connectors/
      src/
        slskd/
        local-folder/
        rym-paste/
    operations/
      src/
        operation-types/
        executor/
        undo/
    ui/
      src/
        components/
        views/
        design-system/
  docs/
    product-architecture.md
    agent-tools.md
    operation-model.md
    import-pipeline.md
    database-schema.md
    ui-spec.md
```

The coding agent must update docs when it changes architecture, schemas, operation behavior, or agent tools.

---

## 11. Database Model

SQLite is the source of truth.

Use migrations from day one.

Core tables:

### 11.1 library_roots

Fields:

id.

path.

name.

enabled.

created_at.

updated_at.

last_scan_at.

### 11.2 files

Represents physical files.

Fields:

id.

library_root_id nullable.

path.

normalized_path.

filename.

extension.

size_bytes.

mtime.

ctime.

sha256 nullable.

quick_hash nullable.

duration_ms nullable.

codec nullable.

container nullable.

bitrate nullable.

sample_rate nullable.

channels nullable.

date_added.

date_updated.

scan_status.

missing.

staged boolean.

import_item_id nullable.

### 11.3 audio_fingerprints

Fields:

id.

file_id.

algorithm.

fingerprint.

duration_ms.

acoustid_id nullable.

created_at.

### 11.4 artists

Fields:

id.

name.

sort_name nullable.

musicbrainz_artist_id nullable.

discogs_artist_id nullable.

country nullable.

type nullable.

disambiguation nullable.

created_at.

updated_at.

### 11.5 albums

Fields:

id.

title.

sort_title nullable.

album_artist_id nullable.

release_year nullable.

release_date nullable.

country nullable.

label nullable.

catalog_number nullable.

musicbrainz_release_id nullable.

musicbrainz_release_group_id nullable.

discogs_release_id nullable.

edition_notes nullable.

created_at.

updated_at.

### 11.6 tracks

Represents the logical track/recording as understood by the app.

Fields:

id.

title.

artist_id nullable.

album_id nullable.

album_artist_id nullable.

track_number nullable.

disc_number nullable.

total_tracks nullable.

total_discs nullable.

recording_year nullable.

release_year nullable.

musicbrainz_recording_id nullable.

musicbrainz_track_id nullable.

duration_ms nullable.

isrc nullable.

created_at.

updated_at.

### 11.7 track_files

Joins logical tracks to physical files.

Fields:

id.

track_id.

file_id.

quality_rank nullable.

is_preferred boolean.

source nullable.

created_at.

### 11.8 embedded_tags

Raw tags read from files.

Fields:

id.

file_id.

tag_key.

tag_value.

source.

created_at.

### 11.9 user_tags

User-created internal tags.

Fields:

id.

name.

category nullable.

color nullable.

created_at.

### 11.10 track_user_tags

Fields:

track_id.

user_tag_id.

created_at.

source.

### 11.11 playlists

Fields:

id.

name.

description nullable.

type: manual | smart | agent_generated.

created_by: user | agent | import.

created_at.

updated_at.

agent_thread_id nullable.

### 11.12 playlist_items

Fields:

id.

playlist_id.

track_id.

position.

added_at.

added_by.

reason nullable.

### 11.13 imports

Fields:

id.

source.

source_context_json.

status.

created_at.

updated_at.

completed_at nullable.

### 11.14 import_items

Fields:

id.

import_id.

file_id nullable.

staging_path.

status.

detected_artist nullable.

detected_album nullable.

detected_title nullable.

detected_year nullable.

metadata_candidates_json.

selected_candidate_json nullable.

duplicate_candidates_json.

quality_score nullable.

confidence_score nullable.

proposed_destination nullable.

warnings_json.

created_at.

updated_at.

### 11.15 external_searches

Fields:

id.

connector.

query.

filters_json.

status.

created_at.

completed_at nullable.

### 11.16 external_results

Fields:

id.

search_id.

connector.

external_id.

title.

artist.

album.

year nullable.

format nullable.

quality_json nullable.

size_bytes nullable.

duration_ms nullable.

raw_json.

already_owned_status nullable.

created_at.

### 11.17 download_jobs

Fields:

id.

connector.

external_result_id nullable.

status.

progress nullable.

destination_staging_path nullable.

raw_json.

created_at.

updated_at.

completed_at nullable.

### 11.18 jobs

Fields:

id.

type.

status.

progress.

payload_json.

result_json nullable.

error_json nullable.

created_at.

started_at nullable.

completed_at nullable.

cancel_requested boolean.

### 11.19 job_events

Fields:

id.

job_id.

timestamp.

level.

message.

data_json nullable.

### 11.20 operation_batches

Fields:

id.

source: user | agent | import | system.

status: draft | proposed | approved | applying | applied | partially_applied | failed | reverted | rejected.

summary.

risk_level.

agent_thread_id nullable.

created_at.

approved_at nullable.

applied_at nullable.

reverted_at nullable.

### 11.21 operations

Fields:

id.

batch_id.

type.

status.

payload_json.

before_json.

after_json.

error_json nullable.

created_at.

applied_at nullable.

reverted_at nullable.

### 11.22 agent_threads

Fields:

id.

title.

created_at.

updated_at.

status.

context_json.

### 11.23 agent_messages

Fields:

id.

thread_id.

role: user | assistant | tool | system.

content.

metadata_json nullable.

created_at.

### 11.24 agent_tool_calls

Fields:

id.

thread_id.

message_id nullable.

tool_name.

arguments_json.

result_json nullable.

status.

created_at.

completed_at nullable.

### 11.25 listens

Fields:

id.

track_id.

file_id nullable.

started_at.

completed_at nullable.

duration_played_ms.

was_skip boolean.

source.

### 11.26 ratings

Fields:

id.

track_id nullable.

album_id nullable.

artist_id nullable.

rating.

liked boolean nullable.

disliked boolean nullable.

created_at.

updated_at.

### 11.27 taste_profile

Fields:

id.

key.

value_json.

source.

confidence.

created_at.

updated_at.

---

## 12. Internal API Design

Use typed APIs.

Preferred options:

tRPC for TypeScript end-to-end typing.

Or REST + Zod schemas.

All API payloads must be validated.

Renderer must not bypass backend.

Example API groups:

### 12.1 Library API

```text
library.scan(rootId)
library.addRoot(path)
library.removeRoot(rootId)
library.search(query, filters)
library.getTrack(trackId)
library.getAlbum(albumId)
library.getArtist(artistId)
library.getDuplicates(filters)
library.getMissingMetadata(filters)
```

### 12.2 Playback API

```text
playback.playTrack(trackId)
playback.playFile(fileId)
playback.playAlbum(albumId)
playback.playPlaylist(playlistId)
playback.pause()
playback.resume()
playback.seek(positionMs)
playback.next()
playback.previous()
playback.getNowPlaying()
playback.getQueue()
playback.setQueue(trackIds)
```

### 12.3 Import API

```text
imports.createFromPaths(paths)
imports.createFromDownloadJob(downloadJobId)
imports.getImport(importId)
imports.getInbox(filters)
imports.analyzeImportItem(importItemId)
imports.chooseMetadataCandidate(importItemId, candidateId)
imports.createImportOperationBatch(importId)
imports.rejectImportItem(importItemId)
```

### 12.4 Connector API

```text
connectors.search(connectorName, query, filters)
connectors.getResult(resultId)
connectors.queueDownload(resultId)
connectors.getDownloadJob(downloadJobId)
connectors.testConnection(connectorName)
```

### 12.5 Operation API

```text
operations.getBatch(batchId)
operations.propose(batch)
operations.approve(batchId, operationIds?)
operations.apply(batchId)
operations.reject(batchId)
operations.revert(batchId)
operations.list(filters)
```

### 12.6 Agent API

```text
agent.createThread()
agent.sendMessage(threadId, message)
agent.getThread(threadId)
agent.cancelRun(threadId)
agent.approveToolCall(toolCallId, approvalPayload)
agent.rejectToolCall(toolCallId, reason)
```

### 12.7 Jobs API

```text
jobs.list(filters)
jobs.get(jobId)
jobs.cancel(jobId)
jobs.retry(jobId)
jobs.subscribe()
```

---

## 13. Operation Model

Operation batches are the most important safety mechanism.

The backend must execute only known operation types.

Each operation type must define:

Input schema.

Precondition check.

Before-state capture.

Apply function.

After-state capture.

Undo function if possible.

Risk level.

Whether approval is required.

Whether operation can run in bulk.

Example operation batch:

```json
{
  "source": "agent",
  "summary": "Create playlist and tag 42 tracks as Japanese disco / 1980",
  "riskLevel": "medium",
  "operations": [
    {
      "type": "create_playlist",
      "payload": {
        "name": "Japanese Disco 1980",
        "description": "Agent-generated playlist from local library and imported candidates"
      }
    },
    {
      "type": "add_tracks_to_playlist",
      "payload": {
        "playlistName": "Japanese Disco 1980",
        "trackIds": ["track_1", "track_2"]
      }
    },
    {
      "type": "set_track_user_tags",
      "payload": {
        "trackIds": ["track_1", "track_2"],
        "tags": ["japanese-disco", "1980", "city-pop-adjacent"]
      }
    }
  ]
}
```

Dangerous operations:

Delete file.

Overwrite existing file.

Replace preferred copy.

Bulk embedded tag rewrite.

Bulk rename.

Move outside library root.

These require explicit approval and should be disabled in early MVP.

---

## 14. Agent Architecture

## 14.1 Initial Agent

Start with a TypeScript tool-calling agent inside the backend or a separate backend module.

The first agent should support:

Read library.

Search tracks/albums/artists.

Create playlist proposals.

Create tag proposals.

Explain duplicates.

Control playback.

It does not need durable multi-step workflows at first.

## 14.2 Later Agent

Later, add a Python LangGraph service for more advanced workflows:

Persistent state.

Human approval gates.

Long-running discovery/import flows.

Checkpoints.

Retry after failed tool call.

Branching workflows.

Review/edit/reject support.

Agent service should not directly access SQLite. It should call backend tools over typed API.

## 14.3 Agent Tool Categories

### Read tools

Safe, automatic.

```text
search_library
get_track
get_album
get_artist
get_playlist
get_duplicates
get_missing_metadata
get_recently_added
get_listening_history
get_taste_profile
```

### Playback tools

Safe, automatic or lightly gated.

```text
play_tracks
play_album
play_playlist
pause
resume
set_queue
```

### Discovery tools

Usually safe, but expensive/rate-limited.

```text
search_metadata
search_recommendations
parse_pasted_chart
search_external_connector
compare_candidates_to_library
```

### Download/staging tools

Requires approval before queueing downloads.

```text
queue_download
get_download_status
create_import_from_download
```

### Proposal tools

Safe. Creates operation batch only.

```text
propose_playlist
propose_tags
propose_rename
propose_import
propose_duplicate_resolution
propose_quality_upgrade
```

### Mutation tools

Requires operation batch approval.

```text
apply_operation_batch
revert_operation_batch
```

## 14.4 Agent Prompt Principles

The system prompt for the agent should enforce:

Use tools to inspect library state.

Do not assume files exist.

Do not claim an operation succeeded unless tool result confirms it.

Do not mutate directly.

For mutating requests, create operation batches.

Ask for approval when risk is medium or high.

Prefer staged imports over direct imports.

Prefer internal user tags before embedded tag writes.

Prefer non-destructive duplicate marking before deletion.

State uncertainty.

Preserve user control.

## 14.5 Taste Memory

The agent should maintain structured taste memory, not vague chat summaries.

Taste profile keys:

favorite_artists.

favorite_albums.

favorite_tracks.

preferred_genres.

preferred_eras.

preferred_countries.

preferred_labels.

blocked_artists.

blocked_genres.

overplayed_tracks.

preferred_formats.

quality_preferences.

tagging_preferences.

folder_organization_preferences.

playlist_style_preferences.

Examples:

```json
{
  "preferred_eras": ["1977-1984"],
  "preferred_countries": ["Japan"],
  "preferred_genres": ["city pop", "disco", "funk", "fusion", "synthpop"],
  "quality_preferences": {
    "prefer_lossless": true,
    "allow_mp3_if_rare": true
  },
  "organization": {
    "template": "{albumArtist}/{year} - {album}/{trackNumber} - {title}"
  }
}
```

Taste memory updates should be explicit or inferred with confidence. Low-confidence inferences should be visible/editable.

---

## 15. Import Pipeline Specification

The import pipeline must be deterministic and inspectable.

Steps:

1. Intake.

Sources:

Manual file drop.

Watched folder.

Completed download.

Existing messy folder.

2. File registration.

Create import record.

Create import item records.

Register files as staged.

3. Technical scan.

Read codec, bitrate, sample rate, channels, duration, file size.

4. Embedded tag scan.

Read all tags.

Persist raw embedded tags.

5. Fingerprinting.

Generate acoustic fingerprint where supported.

Attempt fingerprint lookup.

6. Metadata candidate generation.

Use evidence from:

Folder path.

Filename.

Embedded tags.

Fingerprint result.

MusicBrainz search.

Discogs search.

Manual user selection.

7. Candidate scoring.

Score candidates based on:

Fingerprint match.

Duration closeness.

Artist/title similarity.

Album similarity.

Track number match.

Year/date match.

Release country/format preference.

Completeness.

8. Duplicate detection.

Compare staged item to existing library by:

Fingerprint.

MusicBrainz recording ID.

Artist/title/duration similarity.

Album identity.

File hash.

Existing preferred file quality.

9. Quality scoring.

Score file quality based on:

Lossless/lossy.

Bitrate.

Sample rate.

Known source info.

Completeness.

Corruption check if feasible.

10. Proposal generation.

Generate import proposal:

Target track.

Target album.

Tags to write.

Destination folder/path.

Duplicate action.

Warnings.

11. User approval.

User approves, edits, or rejects.

12. Apply import.

Write tags if approved.

Move file to library path.

Associate file with track.

Mark as imported.

Update scan state.

13. Post-import.

Refresh library.

Generate album grouping.

Update playlists if import was agent-driven.

Log operation batch.

---

## 16. Recommendation and Discovery Specification

Recommendations should be hybrid.

Inputs:

Local library.

User ratings.

Play counts.

Skips.

Manual tags.

Favorite artists/albums.

Metadata graph.

ListenBrainz recommendations.

Last.fm-style similarity if configured.

Discogs release metadata.

MusicBrainz relationships.

Pasted RYM/chart lists.

Agent reasoning.

Candidate score dimensions:

Taste match.

Novelty.

Already owned status.

Era match.

Country/scene match.

Genre/style match.

Artist similarity.

Release reputation/rank source.

Availability from configured sources.

Metadata confidence.

Quality availability.

Playlist fit.

Example discovery workflow:

User asks: “Find top Japanese disco albums from 1980 and make me a playlist.”

Agent plan:

Parse request into constraints.

Search metadata/list sources for candidate albums.

Resolve candidates to canonical metadata.

Compare candidates to local library.

Mark already-owned albums.

Search configured external connector for missing albums if user approves.

Stage completed files.

Run import pipeline.

Create playlist from imported and existing tracks.

Propose tags.

Show final operation batch.

The app should separate “candidate discovery” from “file acquisition.” Discovery can happen without downloading anything.

---

## 17. slskd Connector Specification

The slskd connector should be optional.

MVP assumption:

The user already has slskd running locally or on the network.

The app stores connector settings:

Base URL.

API key/token.

Download folder.

Staging folder mapping.

Connection enabled/disabled.

The connector should support:

Test connection.

Search.

Fetch result details if available.

Queue download.

Monitor download jobs.

Detect completed downloads.

Create import from completed download.

The connector must not:

Bypass staging.

Write directly to library.

Automatically download without user approval.

Assume all results are legal or desired.

Expose raw credentials to renderer.

Later option:

Bundle slskd as a sidecar for personal use, but only after the external-connection flow works.

---

## 18. RYM / Chart Input Specification

Do not make automated RYM scraping a core dependency.

MVP should support:

User pastes chart/list text.

User pastes manually copied album rows.

User enters structured list manually.

App parses artist, album, year, ranking, descriptors where possible.

App resolves parsed items against MusicBrainz/Discogs.

App stores parsed list as a discovery source.

Example pasted-list workflow:

User pastes list of albums.

App parses rows.

App asks user to confirm parsed entities.

App resolves candidates.

Agent compares with local library.

Agent can search configured connector if user approves.

This avoids brittle scraping and keeps the architecture source-agnostic.

---

## 19. Background Jobs

Use a DB-backed job queue initially.

Do not add Redis unless needed.

Job types:

library_scan.

file_scan.

fingerprint_file.

metadata_lookup.

duplicate_analysis.

import_analysis.

apply_operation_batch.

connector_search.

download_monitor.

agent_run.

playlist_generation.

Jobs should support:

Status.

Progress.

Cancellation if safe.

Retries.

Logs.

Errors.

UI subscription through WebSocket or SSE.

Long-running jobs must not block the renderer.

---

## 20. Security and Integrity

Renderer security:

No direct Node integration in renderer.

Use preload bridge for limited APIs.

No raw filesystem access from UI.

No direct shell execution from UI.

Backend security:

Bind local API to localhost only.

Require a local app token if HTTP server is exposed.

Store connector credentials securely if possible.

Never log secrets.

File safety:

Do not delete files in MVP.

Use trash/quarantine instead of permanent deletion later.

For moves/renames, capture before/after paths.

Avoid overwriting existing files.

On collision, generate unique path or require review.

Database safety:

Use migrations.

Use transactions for operation batches.

Back up SQLite before high-risk migrations.

Support export of operation log.

---

## 21. Configuration

Settings:

Library roots.

Staging folder.

Final import folder template.

File naming template.

Preferred formats.

Preferred metadata sources.

Connector settings.

Agent model settings.

Cloud/local model provider.

Approval thresholds.

Dangerous operation toggles.

Default import behavior.

Tag writing behavior.

Suggested default folder template:

```text
{albumArtist}/{year} - {album}/{discTrack} - {title}
```

Suggested compilation template:

```text
Various Artists/{year} - {album}/{discTrack} - {artist} - {title}
```

---

## 22. Development Roadmap

## Phase 0: Project Setup

Goal:

Create the monorepo, desktop shell, backend process, SQLite migrations, and basic UI skeleton.

Deliverables:

Electron app boots.

React UI renders shell.

Backend process starts.

SQLite database initializes.

Renderer can call backend health endpoint.

Jobs table exists.

Docs folder exists.

Acceptance criteria:

App opens without errors.

Backend health visible in UI.

Database file created.

Typecheck passes.

## Phase 1: Local Library Scanner

Goal:

Scan local music folders into SQLite.

Deliverables:

Add library root.

Recursive scan.

Extract file metadata.

Extract embedded tags.

Display track/file grid.

Manual rescan.

Basic search.

Acceptance criteria:

User can add a folder.

Files appear in library view.

Metadata columns populate.

Repeated scan updates changed files without duplicating records.

## Phase 2: Playback

Goal:

Play local files from the app.

Deliverables:

mpv adapter.

Play/pause/seek/next/previous.

Queue.

Now playing bar.

Play count and skip tracking.

Acceptance criteria:

User can play a track.

User can play an album.

User can play a playlist.

Playback state updates in UI.

## Phase 3: Import Inbox

Goal:

Create staged import workflow.

Deliverables:

Staging folder.

Manual file drop/import.

Import records.

Import item states.

Technical scan.

Embedded tag scan.

Basic metadata proposal from tags/filename.

Approve import.

Move file to library path.

Acceptance criteria:

User can drop files into staging.

App creates import proposal.

User approves import.

File moves into library.

Library index updates.

## Phase 4: Metadata and Fingerprinting

Goal:

Improve import confidence.

Deliverables:

Acoustic fingerprint generation.

Metadata lookup adapter.

MusicBrainz resolver.

Candidate scoring.

Duplicate detection v1.

Confidence warnings.

Acceptance criteria:

Badly named files can be matched.

Low-confidence matches require review.

Duplicates are detected and shown.

## Phase 5: Operation Batch System

Goal:

Route mutations through operation batches.

Deliverables:

Operation batch schema.

Operation executor.

Create playlist operation.

Set internal tags operation.

Move/rename operation.

Import operation.

Approval UI.

Operation history UI.

Acceptance criteria:

Mutations are reviewable before applying.

Applied operations are logged.

Failed operations fail safely.

## Phase 6: Agent v1 Read-Only + Playlists

Goal:

Add first useful agent.

Deliverables:

Agent chat panel.

Library search tool.

Playlist proposal tool.

Playback tool.

Operation batch proposal for playlist creation.

Acceptance criteria:

User can ask agent to find tracks.

User can ask agent to make a playlist from existing library.

Agent proposes playlist operation batch.

User approves and playlist is created.

## Phase 7: slskd Connector

Goal:

Search and stage external files through configured slskd.

Deliverables:

Connector settings.

Test connection.

Search UI.

Search results normalization.

Queue download with approval.

Monitor completed downloads.

Create import from completed download.

Acceptance criteria:

User can search connector.

User can queue selected result.

Completed files appear in import inbox.

No completed file bypasses staging.

## Phase 8: Agent v2 Discovery

Goal:

Agent can discover, compare, and stage candidates.

Deliverables:

Metadata search tools.

Connector search tools.

Compare-to-library tool.

Download proposal tool.

Import proposal tool.

RYM pasted-list parser.

Acceptance criteria:

User can ask for a genre/era/country playlist.

Agent finds candidates.

Agent identifies already-owned music.

Agent proposes searches/downloads.

Agent creates playlist after import approval.

## Phase 9: Cleanup and Power Tools

Goal:

Make library management strong.

Deliverables:

Duplicate albums view.

Quality upgrade suggestions.

Missing metadata view.

Bulk tag proposal.

Bulk rename proposal.

Album merge.

Alternate edition support.

Taste profile editor.

Acceptance criteria:

User can clean messy library areas safely.

Agent can propose but not silently apply high-risk changes.

## Phase 10: Advanced Agent Harness

Goal:

Move long-running agent workflows into durable graph execution if needed.

Deliverables:

Optional LangGraph service.

Persistent agent runs.

Human approval checkpoints.

Tool call replay/debugging.

Workflow resume.

Acceptance criteria:

Long workflows can pause for approval and resume.

Agent state survives app restart.

Tool calls are auditable.

---

## 23. Initial MVP Scope

Build this first:

Electron + React shell.

Backend + SQLite.

Add library root.

Scan files.

Display library grid.

Play files via mpv.

Create playlists manually.

Import inbox with basic tag/filename matching.

Operation batch system for playlist creation and imports.

Agent v1 that can search library and propose playlists.

Do not build first:

Full RYM integration.

Bundled slskd.

Complex recommendation engine.

Embedded tag bulk rewrite.

File deletion.

Advanced audio DSP.

Cloud sync.

Mobile app.

---

## 24. Coding Agent Instructions

The coding agent must follow these rules:

Do not implement raw filesystem mutation in the renderer.

Do not add a mutation path that bypasses operation batches.

Do not import external files directly into the library.

Do not store secrets in frontend code.

Do not create untyped API payloads.

Do not skip migrations for database changes.

Do not hardcode user-specific paths.

Do not assume filenames are canonical metadata.

Do not delete files in MVP.

Do not use an LLM response as trusted structured data without schema validation.

Prefer boring, typed, testable code.

When adding a feature:

Add or update types.

Add or update database schema/migration if needed.

Add service-layer implementation.

Add API endpoint.

Add UI.

Add tests where practical.

Update docs if architecture changes.

Use Zod or equivalent schemas at API/tool boundaries.

Keep connector-specific code isolated behind adapter interfaces.

Keep metadata-source-specific logic isolated behind adapter interfaces.

Keep agent tools thin and deterministic.

---

## 25. Key Implementation Interfaces

### 25.1 Connector Interface

```ts
interface MusicSourceConnector {
  name: string;
  testConnection(): Promise<ConnectorHealth>;
  search(query: SourceSearchQuery): Promise<SourceSearchResult[]>;
  getResult?(id: string): Promise<SourceSearchResultDetail>;
  queueDownload?(resultId: string, options: DownloadOptions): Promise<DownloadJobRef>;
  getDownloadStatus?(jobId: string): Promise<DownloadJobStatus>;
}
```

### 25.2 Metadata Adapter Interface

```ts
interface MetadataAdapter {
  name: string;
  searchRelease(query: ReleaseSearchQuery): Promise<ReleaseCandidate[]>;
  searchRecording(query: RecordingSearchQuery): Promise<RecordingCandidate[]>;
  lookupByFingerprint?(fingerprint: AudioFingerprint): Promise<FingerprintMatch[]>;
  lookupReleaseById?(id: string): Promise<ReleaseDetail>;
}
```

### 25.3 Playback Adapter Interface

```ts
interface PlaybackAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  playFile(path: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setQueue(paths: string[], startIndex?: number): Promise<void>;
  getState(): Promise<PlaybackState>;
}
```

### 25.4 Agent Tool Interface

```ts
interface AgentTool<TArgs, TResult> {
  name: string;
  description: string;
  permission: "read" | "playback" | "propose" | "mutate" | "dangerous";
  schema: ZodSchema<TArgs>;
  execute(args: TArgs, context: AgentToolContext): Promise<TResult>;
}
```

### 25.5 Operation Definition Interface

```ts
interface OperationDefinition<TPayload> {
  type: string;
  riskLevel: "low" | "medium" | "high" | "dangerous";
  schema: ZodSchema<TPayload>;
  captureBefore(payload: TPayload): Promise<unknown>;
  validate(payload: TPayload): Promise<ValidationResult>;
  apply(payload: TPayload): Promise<unknown>;
  revert?(payload: TPayload, before: unknown): Promise<unknown>;
}
```

---

## 26. Acceptance Tests by Product Behavior

The following product behaviors should eventually be covered by tests.

Library:

Adding a folder indexes files.

Rescanning does not duplicate files.

Renaming a file marks old path missing and new path detected or reconciled.

Search returns expected tracks.

Playback:

Playing a track starts mpv.

Skipping records a skip.

Completing enough playback records a listen.

Import:

Staged files do not appear as library tracks until approved.

Approved import moves file to final path.

Rejected import remains out of library.

Duplicate detection identifies identical fingerprint or hash.

Operations:

Operation batch cannot apply without approval.

Failed operation marks batch partially failed.

Operation captures before/after state.

Revert works for supported operation types.

Agent:

Agent cannot mutate without operation batch.

Agent playlist request creates proposed batch.

Agent uses search_library tool before claiming library contents.

Agent download request requires approval.

Connector:

Connector search results normalize correctly.

Completed downloads create import items.

Downloads never bypass staging.

---

## 27. Example Agent Workflows

### 27.1 Playlist from Existing Library

User:

“Make a playlist of Japanese disco and city pop from 1979 to 1982.”

Agent:

Searches library for matching tags, metadata, years, artists, and genres.

Ranks tracks.

Creates playlist proposal.

Shows tracks and rationale.

User approves.

Backend creates playlist.

### 27.2 Metadata Cleanup

User:

“Find albums with missing years and fix them if you can.”

Agent:

Searches library for albums with missing release_year.

Queries metadata adapters.

Creates metadata update proposals.

Separates high-confidence from low-confidence.

User approves high-confidence changes.

Backend applies internal metadata updates.

Embedded tag writes require separate approval.

### 27.3 External Discovery

User:

“Find top Japanese disco albums from 1980 that I do not have.”

Agent:

Parses constraints.

Searches metadata/list sources.

Compares candidates to local albums.

Shows owned/missing candidates.

Optionally asks approval to search external source connector.

Queues selected downloads if approved.

Completed downloads go to import inbox.

Agent proposes imports after staging analysis.

### 27.4 Duplicate Cleanup

User:

“Find duplicates and keep the best copies.”

Agent:

Searches duplicate candidates.

Groups by fingerprint, recording ID, and fuzzy title/artist/duration.

Ranks file quality.

Proposes preferred copy.

Marks lower-quality copies as duplicates.

Does not delete files.

User can later approve move to quarantine.

---

## 28. Product Tone and UX Feel

The product should feel like a local control center for music.

Dense.

Fast.

Specific.

Technical when needed.

Not streaming-service glossy.

Not minimal to the point of hiding data.

The app should expose why it made decisions:

Why this metadata match?

Why this duplicate?

Why this recommendation?

Why this playlist order?

Why this file is preferred?

The agent should be useful and direct. It should not over-talk. It should show plans, evidence, and diffs.

---

## 29. Critical Rules

These are non-negotiable:

No direct-to-library downloads.

No silent agent mutations.

No destructive deletes in MVP.

No renderer filesystem access.

No untyped tool calls.

No hidden bulk changes.

No import without audit trail.

No treating filenames as truth.

No assuming external search result quality.

No operation without before-state capture when mutation is involved.

---

## 30. Short Build Prompt for Coding Agent

Build Music OS, a local-first Electron + React + TypeScript desktop app with a Node backend and SQLite database. It is a power-user music player/library manager with staged imports, metadata cleanup, external source connectors, and an AI agent that can inspect and propose changes to the library.

Prioritize the following architecture:

Renderer is UI only.

Backend owns database, filesystem, jobs, imports, playback, connectors, and agent tools.

SQLite is source of truth.

All mutations go through operation batches.

All external files go through staging/import inbox.

Use mpv as initial playback engine.

Use slskd as an optional connector later, not as a core dependency.

Start with library scan, playback, import inbox, operation batches, and a read-only/playlist agent.

Do not implement destructive file deletion.

Do not allow the agent to mutate files directly.

Keep all APIs typed and schema-validated.

Update docs when behavior changes.

[1]: https://electronjs.org/docs/latest/tutorial/process-model?utm_source=chatgpt.com "Process Model"
