# Artist browsing, album completion, and YouTube audio

## In the app

- In Library, select an album and choose **Browse discography** to explore its artist. The standalone artist detail page has the same action.
- Albums known to be incomplete show **Complete album**. The album agent finds matching missing tracks on Soulseek, prefers lossless sources, downloads them, and imports them automatically. Activity includes progress, failure details, stop, and retry.
- Discovery now has **Artists** (the default), **Soulseek**, and **YouTube** modes.
- Artists defaults to the fast Apple catalogue (US storefront), with album artwork and track lists loaded directly from Apple. Choose **Expanded catalogue (MusicBrainz)** for broader release coverage, edition track lists, Cover Art Archive covers, and community ratings. Switching catalogues keeps the search text and asks you to select the correct artist again; identities are not silently merged. Imports from a library artist retain that library artist's name.
- YouTube accepts a search or a single video link. Audio downloads into the review inbox. Edit artist, title, album, and year, select a library folder, and choose **Import into library**.

## Release ordering

Release browsing defaults to latest first and offers oldest first and title order through the shared app dropdown. Apple retrieves up to 200 artist releases in one request, caches provider responses for 24 hours across backend restarts, and returns sorted display pages of 24. When the provider limit is reached, the app labels the list as limited and offers MusicBrainz expansion. Apple catalogues are storefront-dependent and do not represent every historical release. Empty responses are cached for five minutes.

MusicBrainz remains an explicit alternative: its backend fetches lightweight release-group metadata in batches of 100 and caches the complete index for one hour, then returns sorted display pages of 24. Its first load can still be slow. Neither catalogue fetches track lists until requested. Undated releases appear last in both date orders. Artwork shares a two-request browser budget so slow covers cannot occupy every API connection.

Apple artist and album identifiers use `apple:<id>`; MusicBrainz identifiers remain UUIDs. Selected album acquisitions retain the provider's identity and track listing, including disc positions, without a blocking cross-provider lookup. Partial Apple track lists remain browsable, with the returned and expected counts shown when available. They are cached for five minutes, never establish album completeness, and cannot trigger full-album acquisition. Malformed listings still report an error. Existing unresolved library completion jobs and MusicBrainz jobs retain their existing resolution path. No MusicBrainz dump is downloaded.

Apple requests use the installed `curl` executable with an eight-second timeout. Duplicate requests share work. The service allows at most 20 uncached requests per minute and returns a retry/alternative-catalogue message when busy; cached responses remain available. Apple failures do not silently start slow MusicBrainz requests. A compact Apple Music text link with an external-link arrow accompanies Apple artwork.

## YouTube setup

No YouTube API key is required. The backend runs yt-dlp search directly.

From the authoritative Ubuntu WSL checkout:

    source ~/.nvm/nvm.sh
    npm run setup:youtube

This installs the official yt-dlp zip executable under .music-os/tools/youtube/bin, verifies its SHA-256 checksum, and leaves the system installation alone. Python 3, the app's Node runtime, and FFmpeg are required. Run the same command to update when YouTube changes. Restart the backend after the first installation if it was already running.

Optional overrides:

- MUSIC_OS_YT_DLP_PATH: executable path in the backend environment.
- MUSIC_OS_FFMPEG_PATH: FFmpeg path, already supported by the app.
- MUSIC_OS_MUSICBRAINZ_USER_AGENT: identifying MusicBrainz user agent.
- MUSIC_OS_MUSICBRAINZ_ENABLED=0: disables MusicBrainz access; Apple browsing remains available.

The backend selects bestaudio and extracts the native audio format without forcing a lossy MP3 conversion. YouTube quality is limited by the source. Single videos are imported as single recordings, including full concerts or album videos. Metadata is a suggestion; upload dates are not assumed to be release years.

## Matching and recovery

Album searches wait for completed Soulseek responses instead of using the manual search preview cutoff. Soulseek may report file counts before exposing response bodies; an unfinished search is never interpreted as zero results. Outgoing searches are serialized, and the wait allows up to five minutes of queue delay in addition to the requested search timeout and grace period (`MUSIC_OS_SLSKD_SEARCH_QUEUE_TIMEOUT_MS`). At most two album jobs research sources concurrently; transfer monitoring continues independently. The agent tries the artist/album query, a punctuation-normalized query, the album title alone, and up to two missing-track queries as needed. Results are accumulated across searches. If a matching track is found but the album is incomplete, the agent looks up that peer’s exact album directory. At most three distinct, validated peer folders are expanded per research attempt, ordered by quality and availability. Offline folders are skipped, and every returned file still passes the same artist, album, title, duration, and quality checks. This recovers complete albums when a track query exposes only one file. It prefers a complete folder, then combines confidently matched tracks from multiple peers when necessary.

Every missing audio track must match before a new download is dispatched. Matching requires artist and album path context, compatible titles and durations where available. Track numbering, artist/album filename prefixes or suffixes, and remaster/encoding annotations are handled. Live, remix and instrumental labels remain significant. Parenthesized or bracketed featured-artist credits can be omitted by the catalogue only when the source has the exact disc/track position and a duration within three seconds, and no exact title match is already available. Bonus-track positions and alternate-version labels still prevent substitution. Disc identities are respected; ambiguous identical titles are not assigned to multiple discs. Romanized filenames may match a different-script catalogue listing only when a complete album folder has the exact track count, unique disc/track positions, and every duration agrees within three seconds. Live/remix/alternate-version labels remain significant. Explicit bilingual album labels and Apple’s Single/EP suffixes have matching aliases. Video-only media and recordings marked as videos are excluded from catalogue audio track lists.

Lossless is preferred. MP3 requires at least 256 kbps, or 192 kbps for declared VBR; AAC/M4A/OGG require 192 kbps and Opus 160 kbps. Missing lossy bitrate is estimated from file size and duration when both exist; otherwise its quality is unverified. Locked files are excluded. Failed searches report matched counts, missing titles, and locked/low-quality candidates, distinguishing no results from incomplete matches. Ambiguous artist or release identities still require selection through artist browsing.

Existing tracks are kept. New tracks receive the selected artist and album plus the catalogue title, track/disc number, and target year. These are library metadata overrides; original embedded file tags are not rewritten.

Album requests and transfer/import links are persisted in the jobs table. Active album requests resume when the backend restarts. Once a selected release is validated, its persisted track list is reused for retries and source failover, so a catalogue outage cannot block an already identified album. Partial transfers import their completed tracks, then automatically research alternate sources for the remainder. Source ranking preserves lossless preference, then prioritizes free upload slots, shorter queues, and upload speed before bitrate. Transfer outcome flags are distinguished from the terminal `Completed` flag: a timed-out transfer is a failure, while a timed-out search can still contain valid results. Terminal peer failures also retry alternate sources, excluding already attempted peer/file pairs, for at most two automatic retries. Album transfers whose remaining files stay queued (including mixed queued/failed batches), with no active or completed files for two minutes are cancelled and verified stopped before choosing another source; failed remote cancellation keeps the original transfers monitored. Partial settlement and the overall deadline also require confirmed cancellation before another peer is selected; active or unconfirmed transfers remain monitored. Metadata/import errors retain the successful child batch for idempotent manual retry. Stopping a request stops app monitoring/automatic import; already queued Soulseek peer transfers may continue.

YouTube review batches survive restarts. Interrupted downloads are marked failed and can be retried. Approval is idempotent. Choosing another library folder recalculates the destination inside that folder.

Catalogue coverage is edition-dependent. Library completeness and acquisition share the same live track-ownership matcher. A verified acquisition track list for the selected album/edition takes precedence over embedded totals, and subsequent library completion reuses that edition. Removed files are detected on the next check; duplicate copies do not fill missing positions. Catalogue-derived track-number overrides also supersede stale embedded total aliases. Without a verified track list, disc-aware tag totals are presented as an estimate with **Check album**. The completion panel refreshes when its album request finishes, even if no files were added, and verified missing tracks include their titles and disc positions. Albums without reliable local totals remain unverified; file counts alone are not proof of completeness. MusicBrainz calls are cached, their starts are rate-limited, and temporary failures are retried without serializing unrelated responses.

## Validation

    npm run typecheck --workspace @music-os/backend
    npm run typecheck --workspace @music-os/desktop
    npm run explore:smoke --workspace @music-os/backend
    npm run catalogue-pagination:smoke --workspace @music-os/backend
    npm run apple-catalogue:smoke --workspace @music-os/backend
    npm run catalogue-provider:smoke --workspace @music-os/backend
    npm run typecheck --workspace @music-os/core
    npm run album-acquisition:smoke --workspace @music-os/backend
    npm run album-recovery:smoke --workspace @music-os/backend
    npm run slskd-search-reliability:smoke --workspace @music-os/backend
    npm run discovery-download:smoke --workspace @music-os/backend
    npm run slskd-client:smoke --workspace @music-os/backend

The isolated smoke test verifies source matching, missing-track-only import, artist preservation, duplicate prevention, YouTube search/download/review, corrected display metadata, root selection, and repeated approval. It does not use or modify the live music library.

The acquisition regression suite covers late peer responses, preserved manual search previews, multi-peer coverage, quality thresholds, filename variants, numeric titles, disc identity, diagnostic failures, and video-only bonus media. Search/import smoke tests use isolated temporary fixtures and never download into the live library.

The catalogue pagination suite checks ordering across upstream pages, date ties, undated releases, stable page boundaries, cached sort changes, empty catalogues and retry after a failed metadata fetch.
