# Player performance: first pass

The existing development work was published as `8d2cad1` before this pass. These changes target renderer CPU/GPU work without changing playback or library data.

## Changes

- Waveform canvases retain played/unplayed raster layers for each canvas, size, display density, theme, and peak set. Progress only composites the layers and cursor. Layers are weakly keyed to the canvas so unmounted views can be collected. Progress changes smaller than a quarter CSS pixel do not repaint.
- Spectrum, level meters, spectrogram, waveform, and album glow use visibility-aware scheduling. Offscreen/CSS-hidden canvases and hidden documents stop scheduling frames; visible surfaces resume. Paused meters/glow settle then stop. Spectrogram history survives pause/resume.
- Album glow animates opacity and transform with a fixed blur kernel.
- Static turntable meshes with matching materials and shadow settings are combined inside their existing animation groups. Independent arm, label, and sleeve movement is preserved. Layout vectors/quaternions are retained instead of allocated every frame.
- Synced lyrics dispatch React state only when the active line changes. Plain lyrics measure scroll geometry on resize/reflow instead of in every animation frame.

## Evidence

Isolated Chromium fixture, 600 x 80 CSS pixel waveform at 2x density, 180 draws:

| Measurement | Before | After |
| --- | ---: | ---: |
| Waveform rectangle fills | 107,880 | 780 |
| Draw submission time (one run) | 43.6 ms | 3.6 ms |
| Classic turntable draw calls | 89 | 33 |
| Turntable geometries | 85 | 29 |
| Turntable triangles | 59,728 | 59,728 |

Waveform pixel comparison matched exactly across rail/hero variants and four progress positions. Cache invalidation covers changed peaks, size, density, and theme. Scheduler checks cover pause, CSS hiding, document hiding, resume, and disposal. Turntable before/after comparison changed 11 of 630,000 pixels, with mean channel difference 0.00008/255. Sleeve collision checks still cover six layouts and 423,510 vertices. Warm scene caching continues to render zero frames while parked.

The live browser UI was inspected at 1440 x 1000 and 390 x 844 with playback paused, without changing playback. These timings measure isolated drawing work, not end-to-end native Electron frame pacing or a promise that every frame meets its deadline. Native GPU contention, large-library React updates, and backend analysis remain candidates for future profiling.

## Checks

From the WSL checkout, load NVM. Browser scripts use the existing renderer and an installed Playwright module, e.g. `PLAYWRIGHT_MODULE=/tmp/negi-appearance-qa/node_modules/playwright/index.mjs`.

- Backend and desktop `typecheck`.
- Desktop `visualizer-performance:smoke` (uses commit `8d2cad1` as its before reference; requires that Git object).
- Desktop `visualizer-canvas:smoke`, `now-playing-motion:smoke`, and `lyrics:smoke`.
- Desktop `turntable-batching:smoke`, `record-player-sleeve:smoke`, and `turntable-cache:smoke`.

The performance fixtures do not start playback or modify the music library. Screenshots and ad hoc profiling outputs are kept in ignored `.music-os/`.

## Second pass: library, artists, and artwork (2026-09-16)

- Library artists use a variable-height window, preserving wrapped names, filters, letter jumps, and arrow/Home/End/Page navigation. A 5,000-artist fixture mounted 15 rows; the live 470-artist library mounted 22 at 1440 x 1000. Filtering is deferred so typing can update ahead of list work.
- Shared artwork components observe viewport proximity continuously. Scrolling away cancels pending work and releases displayed Blob URL leases; returning reuses retained artwork or reloads evicted artwork. Failed-cover retry timers only run near the viewport. Gallery covers no longer preload each section's first six images regardless of visibility.
- Renderer artwork storage uses a 128-entry / 64 MiB LRU budget. Active consumers are protected from eviction until their cleanup signal aborts; actively displayed images can exceed this budget. Explicit invalidation retires URLs safely. Queue priority promotes urgent duplicate requests, and a 20-second transfer/body timeout releases stalled slots.
- Artist resource reads share a two-request budget, cancel transports when their final reader leaves, and cancel queued/hover work on departure. Together with the two artwork slots, this leaves room for the visualizer stream and control requests in Chromium's usual six-connection HTTP/1 pool. Similar-artist enrichment waits for viewport proximity. Collections initially mount 24 albums with explicit Show more controls; release lists reuse filtered results and merge pages with a Set.
- Backend file and album image caches each retain at most 64 MiB. Local extraction/sidecar work is limited to four jobs and remote resolution to three. Oversized images can be served without retaining them.
- Artwork queries no longer aggregate playback history: file lookup reads only path/mtime; the album index shares the normal grouping logic without playback statistics. The existing 10-second index freshness remains. In a 500-file / 20,000-history-event fixture, file lookup measured 2.23 ms -> 0.015 ms and album indexing 9.70 ms -> 5.22 ms (timings vary by run).
- Home shares the parent's album snapshot. Development effect replay no longer duplicates the initial album read. Observed request counts: one initial full-library request, zero additional full-library requests for a listening-period change, one for manual refresh. Removed the unused recent-albums shelf request.

Additional checks: both application typechecks; desktop `artwork-requests:smoke`, `artist-resource:smoke`, `library-performance:smoke`, `turntable-cache:smoke`, and `visualizer-performance:smoke`; backend `artwork-performance:smoke`, `artwork-index:smoke`, and `album-artwork-override:smoke`. Fixtures cover cache pressure/lifetimes, stalled transfers, shared cancellation, 5,000-artist navigation, fast scrolling through 120 slow covers, 24/48/60-album collection pagination, offscreen connections, album identity/order, and persisted artwork overrides. No live library mutations or playback controls are exercised by these checks.

Live library filtering and artist navigation were inspected at desktop and narrower widths while playback continued, with no browser errors. The existing multi-column workbench still has limited space at narrow desktop widths. Shared loading paths are improved across pages; native Electron frame pacing and every possible large-library/GPU workload are not exhaustively measured. Unrelated concurrent Discovery edits were preserved.


## Follow-up: Home scroll retention and favorites toggle

A background Home refresh replaced the whole body with a loading message, collapsing its height and resetting scroll to zero. Existing content now stays mounted during refresh and on refresh failure; the loading message is only used before the first snapshot. Isolated browser coverage verifies success, failure, recovery, DOM continuity, and scroll retention. A live refresh preserved scrollTop 900 before, during, and after the request (previously 0 during and after).

Library favorites now normalize saved entries once and memoize matched album IDs. All historical matching forms (ID, artist/title, artist/title/year, title, Unicode/whitespace/dash normalization) are retained. Album sorting is reused across filter toggles, and locale-aware numeric sorting reuses one Intl.Collator. The live 881-album library still produced 498 favorite albums; enabling the filter measured 1160-1179 ms before and 25-31 ms after. Isolated 1001-album/504-entry matching measured 487 ms for the prior scan and 1.49 ms for the index. Timings are browser/fixture measurements and vary by workload.

Regression scripts: desktop `home-refresh:smoke` and `album-favorites:smoke`. Both application typechecks and the existing library performance regression also pass.

## Follow-up: artwork scroll anchoring and repeated sort/search work

The refresh-retention fix did not cover a second scroll jump: offscreen artwork switches between loaded images and placeholders. Chromium applied automatic scroll anchoring during these swaps despite unchanged final page height. A controlled wheel event from scrollTop 360 advanced only to 403 instead of 540. Home now sets `overflow-anchor: none` on its scroll container, preserving normal wheel movement while keeping artwork cancellation and cache limits. The populated-cover `home-scroll:smoke` test fails with the previous anchoring behavior and passes with the fix; it reaches the footer, returns to the top, and verifies covers reload. Live wheel scrolling also reached the bottom without reversals at 1100, 1440, and 1920 pixel widths. No native Electron restart was performed.

Album and artist sorts now calculate the selected metric once per album/artist rather than scanning tracks during each comparator call. Library-manager year ties, album-weighted artist ratings, stable ties, and fresh metadata behavior are preserved. Artist grouping also appends to newly allocated groups instead of copying the accumulated group for every album. The 5,000-album / 60,000-track recent-sort fixture measured a median 143.1 ms -> 9.8 ms; date parses fell from 1,313,016 to 60,000.

Command search stops after the six matches shown in the palette, allocating result objects only for matches. The 60,000-track fixture reads seven titles for its early-match query rather than all 60,000. Late/no-match queries still scan the library; title, filename, artist fallback, album matching, and ordering are equivalent.

Checks: both application typechecks, `album-sort:smoke`, `command-search:smoke`, `home-scroll:smoke`, `home-refresh:smoke`, and diff whitespace validation. The isolated fixtures exercise no live playback or library mutations.


## Additional page audit

Reviewed Home, Library/artist/album views, Library Manager, Discovery/Explore and
YouTube, Playlists, Agent, Settings/Appearance, Imports, Duplicates, Operations,
Jobs, and the shared player paths. The clearest remaining changes were:

- Stable empty file/playlist snapshots prevent playback-index memo invalidation
  while a resource has not loaded or has no retained snapshot. Previously a new
  empty array could cause the loaded album collection to be indexed each tick.
- Playlist duration totals are computed once per playlist snapshot and reused
  in the sidebar/header. Filtering and playback position updates reuse totals;
  filtering itself is memoized independently of playback. The isolated 10,000-track
  browser fixture reads durations 10,000 times initially, zero times for a playback
  rerender and filter typing, and 10,000 times after a replacement snapshot.
- Explore job polling preserves identical snapshots, coalesces simultaneous
  successful completions into one library-change event, and aborts on unmount.
  The fixture verifies eight unchanged polls produce zero job-array updates,
  progress changes remain visible, two completions emit one refresh event, and
  errors/recovery still work.
- Multi-disc release track rows reuse the existing disc count, removing the
  per-row scan of the entire track list.

Validation: backend/desktop typechecks; playlist-performance, explore-jobs,
home-scroll, and home-refresh browser smokes; git diff --check. Browser fixtures
are isolated from live library mutations. Native Electron frame pacing was not
measured and the managed runtime was not restarted.

## Library letter navigation and queued visualizer colors

Library letter clicks select A–Z for both artists and albums before scrolling.
The jump waits for the virtual list to commit its new ordering; search and
favorites remain active.

The app prepares artwork palettes for the current track, the next track, and
the first upcoming track from a different album, even with Now Playing closed.
Lookahead follows the current queue (including repeat-queue wrapping), and
uses mode-specific, artwork-versioned keys. Extraction shares in-flight work,
retains the artwork Blob only until decoding finishes, and keeps at most 128
palettes. Fetch/decode failures are not permanently cached.

Now Playing reads an already prepared palette during the track-change render.
Its layout effect invalidates the canvases' 250 ms color cache and redraws
waveforms/meters before paint, including settled canvases. Cold or unavailable
artwork uses the theme fallback until extraction succeeds; an immediate skip
to artwork that has not finished loading cannot use a prepared color.

Focused isolated browser coverage: `library-letter:smoke` and
`queue-palette:smoke`. These exercise real renderer components and intercept
artwork/API traffic without changing live playback or library data.
