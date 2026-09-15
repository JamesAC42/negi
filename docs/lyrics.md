# Now Playing lyrics

The compact **Lyrics** toggle sits beside Layout, Album ritual, and Preview in the info card's bottom control row. Its pressed state indicates that lyrics are showing; Enter or Space toggles it, and the chosen view is remembered locally. The record and lyrics fill the available area above the controls. The row spans the card width to keep controls together on narrow windows. Record controls and lyrics status occupy one reserved footprint beside the toggle, using the same right alignment and height in both modes; inactive controls stay hidden and unfocusable. The lyrics reading column and record share a centerline and 22rem maximum width within the right panel. The record scene is fitted to both the available width and height; inactive panels are inert. The record player keeps its layout state, suspends its hidden scene, and reports an inactive ritual presence while Lyrics is selected.

Timestamped lyrics follow the playing line with a soft highlight and smooth scrolling. The active line rests at the viewport center, with enough leading and trailing space to center the first and last lines too. Pause, seek, track changes, and intro/instrumental timestamps update the active line. Select a timestamped line to seek. Scrolling by touch, wheel, or keyboard pauses following; **Back to current line** restores it. Untimed lyrics scroll uniformly through their full scroll range according to elapsed time divided by song duration, reaching the bottom at the end. The footer labels this **Estimated scroll**: no line or word timestamps are invented. Pause holds the position, seeking moves to the corresponding fraction, and resizing recalculates the scroll range. Manual scrolling pauses following, with **Resume scrolling** to return to song progress. If song duration is also unavailable, the text remains manually scrollable and says **Timing unavailable**. Empty, searching, instrumental, not-found, and retryable-error states have separate messages. A missing backend route is identified as requiring an app restart; a removed library file, unreachable music service, and unavailable provider each have their own explanation. Reduced motion disables transitions, pulsing, and smooth follow scrolling.

## Provider and local storage

The backend uses [LRCLIB](https://lrclib.net/) without an API key. `GET /library/files/:fileId/lyrics` resolves the library file's title, artist, album, and duration on the server. The first lookup sends those fields to LRCLIB's `/api/get`, with at most one `/api/search` fallback and a four-second total deadline. The [current provider router](https://github.com/tranxuanthang/lrclib/blob/main/server/src/router.rs) does not expose `/api/get-cached`; `/api/get` already queries the provider's database.

Migration `0017_lyrics_cache.sql` adds `lyrics_cache` to the existing local music database. A normalized metadata hash identifies the song, so duplicate files with the same tags/duration share cached results. Synced, untimed, instrumental, and confirmed not-found results persist with no expiry. Replay and app restarts do not repeat provider requests. Retagging a track changes its lookup identity. The renderer also reuses up to 64 session results to make toggling/reopening immediate.

A lookup can make up to two external requests to resolve one song; it is performed only once per metadata identity after a definitive result. Connection errors, timeouts, malformed responses, rate limits, and provider outages are never stored as missing lyrics. They return a retry cooldown, normally 15 seconds, respecting `Retry-After` up to five minutes. The UI offers **Try again** after the cooldown. Requests for the same uncached song share one lookup.

Matching preserves Unicode, symbol-only names, and edition qualifiers. Artist, title, album (when supplied), and duration (within two seconds when known) must agree; ambiguous results are rejected. LRC parsing supports fractional timestamps, repeated timestamps, offsets, duplicate timestamps, untimed fallback, and instrumental gaps. Synchronization is by line, as provided by LRCLIB, rather than estimated word timings.

## Implementation and validation

- `packages/core/src/lyrics.ts`: response schema and shared types.
- `apps/backend/src/services/lyrics-service.ts`: provider, parsing, matching, and durable cache.
- `apps/desktop/src/renderer/lyrics-resource.ts`: session request reuse and retry state.
- `apps/desktop/src/renderer/lyrics-state.ts`: timestamp search and bounded playback interpolation.
- `apps/desktop/src/renderer/ui/NowPlayingViews.tsx`: switch and lyrics interactions.
- `lyrics-transitions.css` and `transitions-tokens.css`: the verbatim [transitions.dev](https://github.com/Jakubantalik/transitions.dev) panel-reveal recipe and shared tokens. `lyrics.css` applies the Music OS theme and compact layout.

Run from the authoritative WSL checkout with NVM loaded:

```bash
npm run lyrics:smoke --workspace @music-os/backend
npm run lyrics:smoke --workspace @music-os/desktop
npm run typecheck --workspace @music-os/backend
npm run typecheck --workspace @music-os/desktop
npm run typecheck --workspace @music-os/core
npm run typecheck --workspace @music-os/db
npm run record-player:smoke --workspace @music-os/desktop
```

Backend fixtures use temporary databases and mock provider responses. Tests cover persistence across database reopening, concurrent requests, definitive misses, plain/instrumental lyrics, metadata changes, strict matching, Unicode, LRC parsing, and transient errors/recovery. Renderer smoke tests cover timestamp boundaries, seek reversal, stale/wrong-song audio frames, pause, errors, and bounded extrapolation. They also distinguish a stale backend route from a removed file or unavailable service, validate response identity, and verify request cancellation signals.

Dream Loop target and browser QA artifacts live in the ignored `.dream-loop/` folder with the `lyrics-` prefix. The browser harness uses the actual React components and original sample lyrics, with isolated playback callbacks and intercepted lyrics requests; it does not control live playback or send library metadata to the provider. Browser checks cover loading, switching, keyboard navigation, request reuse, seeks, pause, follow scrolling, all result states, retry, reduced motion, and 390×844, 844×390, 1100×700, and 1920×1080 layouts.

A public Adele / Hello fixture verified the real provider: synchronized results in 258 ms, followed by 1 ms local cache reads including database reopening, with one external request total. A live lookup using the user's current library song was not run because automatic approval review blocked that metadata transfer. Native Electron GPU performance is not established by the headless Chromium check.

Final visual review scored the desktop at 9/10 against the generated target. The phone-specific metadata overlap was corrected by giving the views their own first grid row. An isolated lyrics test with repeated line transitions measured 60 fps (16.7 ms p95 frame gap). The full headless software-rendered overlay measured about 12 fps during simulated playback; this is a broader overlay measurement, not evidence of native Electron performance.

The follow-up repair narrowed inactive-panel visibility to direct tab panels. A descendant aria-hidden selector had also hidden the decorative WebGL canvas and SVG icons. The repair browser harness explicitly checks that the canvas is visible before and after toggling and that status icons remain visible.

The managed stack was restarted through the approved development command after the old backend failed to reload the new endpoint. Live verification now receives the route-specific file-not-found response instead of the old generic 404; both service health checks pass. The restart cleared the in-memory paused queue. Its prior state was saved in `.dream-loop/lyrics-before-activation.json`; playback was not automatically restarted.

The compact-layout follow-up also checks footer/button containment and usable canvas height at 390, 844, 1100, 1264, and 1920 pixel widths. Untimed fixtures verify top/midpoint/end positions, forward and backward seeks, pause, manual override/resume, resize, and unknown duration. Phone Preview opens and closes with zero playback actions. These are isolated Chromium checks using the real renderer components, not native Electron GPU benchmarks.
