# Agents: taste-aware catalog planning

The Agents page supports conversational catalog work alongside the existing researched-playlist and library tools. Common catalog requests use a deterministic planner, so artist matching and release planning do not need a hosted model call. When configured, the hosted planner can translate other wording into the same catalog flow.

## Supported starting points

| Task | Example |
| --- | --- |
| Find one song | Find the song "Stand by Me" by Ben E. King |
| Download an album | Download the album Dummy by Portishead |
| Collect an artist | Download the discography of Portishead |
| Fill an artist's gaps | Find missing albums by Portishead |
| Complete a partial album | Complete the album Dummy by Portishead |
| Explore related artists | Find artists similar to Portishead |
| Recommend from taste | Recommend albums based on my taste |
| Curate a playlist | Make a playlist for a rainy evening |
| Find a recent release | Find the latest album by Portishead |
| Explore shorter releases | Find EPs and singles by Portishead |

Artist identities and album editions are selected explicitly. A discography request asks for studio albums, EPs/singles, or the whole catalog. Provider pages are traversed, already-complete releases are omitted, and provider truncation is disclosed. Apple and MusicBrainz IDs are kept separate. Name-only related-artist recommendations go back through artist matching.

Album plans show the exact releases before queueing. Their existing acquisition jobs verify the artist/release relationship and complete track listing, preserve owned tracks, try alternate sources, and import missing tracks. Partial provider track listings cannot authorize a full-album acquisition. There is no mandatory playlist. Song requests match artist directory/credit and exact normalized title, show the source path, and create a normal reviewable download operation; downloaded songs enter the import inbox.

Unquoted names with multiple "by" separators ask for quoted titles rather than guessing the artist. A missing artist clarification remembers the requested title. Exact choice labels also work as text replies; a loose "yes" never silently accepts a download plan.

## Playlist tone and selection

Playlist planning prioritizes the requested sound, artists, mood, and constraints. Similarity and mood requests are collections of matching tracks; a narrative or energy arc is used only when requested or needed for the activity. Familiar songs and deep cuts compete on relevance, without forced novelty or unrelated taste-profile picks.

Generated titles are short, natural, and grounded in the request. Descriptions are one brief plain sentence about the music, without proposed track counts, elaborate metaphors, or a sequencing itinerary. Explicit user-provided titles are respected. These instructions apply to newly planned playlists; existing names and descriptions are not rewritten.

## Preference use

The planner reads `TasteProfileService.getEffectiveProfile()`: explicit saved settings override inferred listening preferences. Taste-led exploration starts with favorite artists; related results exclude blocked artists and genres. Hosted curation receives the compact effective profile, including eras, countries, labels, quality, blocked values, and freeform preferences.

Song source selection and album matching honor preferred formats, lossless preference, MP3 permission, and minimum lossy bitrate. Album jobs persist a quality snapshot. Song acceptance rechecks current quality preferences, so an old source cannot bypass a newly changed setting. Existing default source matching stays unchanged outside agent-created jobs.

## Durable interaction contract

- `GET /agent/capabilities` returns the ten starting prompts.
- `POST /agent/runs` and `POST /agent/message` accept optional `catalogAction: { runId, choiceId }` with the conversation's `threadId`.
- `AgentMessageResponse.catalogPlan` contains status, title, summary, choices, selected items, notes, and acquisition job IDs.
- Choice IDs are resolved against the persisted source run. Cross-conversation or fabricated selections are rejected.
- SQLite acceptance receipts make a repeated accepted choice idempotent, including after restart.
- `GET /agent/catalog/jobs?ids=...` returns current acquisition progress, including completed, failed, and cancelled jobs. It supports a reviewed catalog larger than the normal 100-job activity list.
- Bulk enqueue and its acceptance receipt share a transaction. Workers start in a microtask after synchronous commit, so rolled-back jobs never begin research.

Song-source snapshots are stored with the catalog workflow for later operation review. No download or external research is needed to run the fixture suite.

## Validation

Run from the WSL checkout with NVM loaded:

```bash
npm run agent-catalog:smoke --workspace @music-os/backend
npm run agent-routing:smoke --workspace @music-os/backend
npm run agent-model-provider:smoke --workspace @music-os/backend
npm run agent-run:smoke --workspace @music-os/backend
npm run album-acquisition:smoke --workspace @music-os/backend
npm run album-recovery:smoke --workspace @music-os/backend
npm run typecheck --workspace @music-os/backend
npm run typecheck --workspace @music-os/desktop
```

Catalog fixtures cover artist/scope selection, catalog pagination, owned-release exclusion, review-before-download, durable repeated acceptance, cross-thread rejection, song-source identity, changed quality constraints, title ambiguity, continuation, no playlist side effects, 105 queued releases, and rollback without worker startup. They use temporary databases and stubbed providers; they do not validate current external catalog availability, paid model output, or real downloads.


## Resilient playlist delivery

Playlist workflows serialize concurrent advancement and import approvals share one in-flight move per item. If a move succeeds but final metadata/index promotion fails, the retained destination can be retried without looking for a vanished staging file. Successful imports stay available even when other items fail.

A terminal download creates a playlist from every usable owned/imported track. `partial` means the playlist exists with gaps; delivery counts and per-track states describe what is available. `POST /agent/playlist-workflows/:id/resume` retries pending imports, keeps the same playlist, inserts recovered tracks in requested order, and preserves user-added tracks. It never queues another download. Terminal workflows stop automatic advancement; repeated recovery does not duplicate playlists or success messages.

The Agents result card stays collapsed by default. Its summary shows delivery counts and opens the playlist; expanded tracks identify imported, pending, and missing items. Research sources, source albums, diagnostics, and activity use nested disclosures. Library, album, import, and playlist views refresh when workflow availability changes, including failed/partial delivery, without reloading them on every unchanged poll.

Additional isolated checks:

```bash
npm run import:smoke --workspace @music-os/backend
npm run agent-playlist-download-workflow:smoke --workspace @music-os/backend
npm run agent-playlist-resilience:smoke --workspace @music-os/backend
npm run agent-workspace:smoke --workspace @music-os/desktop
npm run agent-playlist-delivery:smoke --workspace @music-os/desktop
```

Renderer checks require the running local renderer/backend and Playwright (or `PLAYWRIGHT_MODULE` pointing to its module). They intercept agent mutations and exercise partial import refresh, recovery, terminal polling, keyboard disclosures, narrow layouts, and light/dark themes. Backend fixtures cover overlapping import approvals, cross-filesystem moves, genuine missing files, partial delivery, retry ordering, duplicate source filenames, and idempotent recovery.

Chat drafts live in the composer; keystrokes do not update App or rerender the conversation and history rail. A retained ref preserves the draft across page changes. The workspace smoke checks actual React render work during typing, draft restoration, whitespace submission, Shift+Enter, IME Enter, and normal send behavior.
