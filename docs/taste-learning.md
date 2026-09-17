# Listening-derived taste

The taste endpoint exposes three distinct views:

- `profile` and `entries`: the user's explicit editable settings.
- `learned`: inferred preferences, evidence sources, confidence, sample counts, and listening totals.
- `effectiveProfile`: the profile used for agent planning. Nonempty explicit lists take precedence over inferred lists; blocked artists/genres and overplayed tracks are excluded from relevant positive preferences.

Settings shows learned evidence above the explicit editor. Background playback refreshes update the evidence without replacing an unsaved draft. Agents displays a compact effective-profile summary. Opening either view refreshes the profile.

## Efficient updates

Migrations 0018 and 0019 create durable per-file evidence, a dirty-file queue, a revision counter, change triggers, and a metadata lookup index. A one-time backfill marks files with playback or rating evidence. Playback events, likes, ratings, metadata edits, history repairs, and file deletion invalidate relevant evidence.

The next profile read recomputes only dirty files in a transaction. The aggregate result is cached by revision and UTC day. Unchanged reads do not rescan the music library or rewrite learned records. A new day refreshes time decay; changes rebuild the rollup from compact evidence records, not every indexed file. No model calls or external catalog requests are needed to learn taste.

## Signals and limits

Successful listening lasting at least the smaller of 30 seconds or half the known track duration counts as a qualified play. Completion provides additional weight. Failed starts and negligible playback never become positive preferences. Likes and high ratings contribute explicit positive evidence; dislikes and low ratings remove that file's positive contribution.

Repeated early skips soften preference scores. They do not automatically block an artist or genre. Listening weight is logarithmic, with a 120-day recency half-life. Confidence grows with sample count, capped at 95%; it is a heuristic evidence indicator, not a calibrated probability. A lone casual play remains visible as evidence but does not enter effective preferences unless reinforced by a like or rating.

Existing file metadata supplies artists, albums, tracks, genres, decades, release countries, and labels. Missing metadata stays unknown. Countries describe tagged release country; they are not inferred listener nationality or artist origin. Tagging, folder organization, quality rules, and freeform instructions remain explicit settings because listening cannot reliably establish those choices.

## Validation

```bash
npm run taste-learning:smoke --workspace @music-os/backend
npm run taste-profile:smoke --workspace @music-os/backend
npm run agent-workspace:smoke --workspace @music-os/desktop
npm run typecheck --workspace @music-os/backend
npm run typecheck --workspace @music-os/desktop
npm run typecheck --workspace @music-os/core
npm run typecheck --workspace @music-os/db
```

The browser smoke uses a running renderer and backend for read-only data. It intercepts all agent/operation writes and rejects unexpected mutations. Set `PLAYWRIGHT_MODULE` to an installed Playwright module URL when it is not in the project's dependencies. Browser screenshots and the generated dream-loop target are local artifacts under the gitignored `.dream-loop/` directory.
