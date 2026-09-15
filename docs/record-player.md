# Now Playing record player

The title card contains a real-time Three.js turntable: a walnut plinth, machined silver platter, grooved black vinyl, artwork label, chrome tonearm, and a dimensional album jacket. The instrument shares the existing song-details card and keeps the 720:466 scene proportions. Local album artwork remains the source of the sleeve and record label; the current and next album textures preload through the existing artwork request cache.

**Layout** in the title-card footer opens six arrangements. **Classic** puts the sleeve behind the right side of the deck; **Side by side** gives the album and player separate space; **Gallery** centers the cover behind the platter; **Floating** lifts the composition; **Stacked** puts artwork above the player; **Angled** gives the scene a stronger perspective. Selecting a layout animates the arrangement in place and saves it locally under `music-os:record-layout:v1`. Missing, invalid, or inaccessible storage falls back to Classic. Layout changes never issue playback commands. The picker supports arrow keys, Home/End, Enter, outside click, and Escape, and returns focus to Layout after a selection or Escape.

Use **Preview** to watch the record exchange without changing the queue or interrupting audio. **Album ritual** enables or disables automatic exchanges; its local preference still defaults to on. The inline scene suspends while the full-screen ceremony is presenting, so only the visible player needs to render. If WebGL is unavailable or loses its context, a static sleeve, grooved record, and walnut deck preserve the player area and local artwork. Compact phone layouts keep metadata and player controls across the bottom.

The **Record / Lyrics** switch toggles this instrument with [locally cached synchronized lyrics](lyrics.md). The hidden instrument suspends rendering and releases its active ritual presence; returning to Record restores the selected layout.

## Listening behavior

- The record rotates while playing and stops while paused. The tonearm follows the current album's elapsed duration, including disc and track order, and responds to seeking. Missing durations use the mean known track duration; the position tooltip discloses the estimate. The progress represents the album files currently known to the renderer.
- Natural EOF within the same album advances immediately. A natural change to another named album holds the next track while a visible Now Playing window performs the exchange. A queue repeat from the last album to a different first album also performs the exchange.
- Manual Next, Previous, direct selection, repeat-song, untagged tracks, a closed Now Playing window, and a disabled ritual do not impose a ceremony.
- The screen dims and the instrument moves to the center. In the 3D scene the tonearm lifts, the old vinyl returns to its sleeve, and the outgoing record makes room for the incoming album. The new vinyl emerges, changes orientation, settles onto the platter, and receives the needle. The jacket, record, and tonearm share the same scene, so perspective, lighting, and depth remain coherent during the exchange. The needle drops at 3.9 seconds, the record spins for one second, and the renderer releases playback at 4.9 seconds. The instrument returns over 0.25 seconds as playback begins. Early acknowledgements remain retryable until playback confirms the handoff, instead of leaving the renderer waiting for the fallback.
- **Play now** or **Escape** skips the remaining ceremony. **Stop** cancels it. A playback pause during an exchange holds the next album until explicitly resumed. Queue changes invalidate the old transition ID before a replacement is shown.
- Reduced motion removes record rotation, animated layout changes, and spatial choreography, using a brief static album handoff instead. The ceremony traps keyboard focus and restores it afterward. Preview never issues playback commands.

## Playback contract

`PlaybackState.albumTransition` is optional and nullable for compatibility with existing state consumers. During an exchange, status is `paused`, the current file and queue index still identify the completed outgoing track, and `albumTransition` carries a unique ID, outgoing/incoming album descriptions, start time, paused flag, and reduced-motion flag.

`POST /playback/record-player/presence` accepts `{ clientId, active, reducedMotion }`. Now Playing refreshes its visibility lease every four seconds; it expires after twelve. Closing/hiding the last view releases an unpaused exchange immediately. An expired or crashed renderer cannot indefinitely block the queue.

`POST /playback/record-player/action` accepts `{ id, action }`, with `begin`, `complete`, or `skip`. Begin is idempotent and starts the backend hold clock. The renderer starts a separate monotonic animation clock from its first frame after acknowledgement, just like Preview. Network delay, an already-started transition, and Windows/WSL wall-clock differences cannot skip the opening movement. Pausing freezes the local clock. Complete rejects premature or stale acknowledgements. Pending exchanges have a four-second claim timeout and a twelve-second animation timeout (2.5 seconds for reduced motion). The timeout is independent of the playback operation queue; Stop and other controls remain responsive.

Playback history records the outgoing completion exactly once at EOF, before the delay. A renderer history refresh observes that boundary. No listen is recorded for the next album until playback actually loads it.

## Verification

Run with NVM loaded in the WSL checkout:

```bash
npm run typecheck --workspace @music-os/backend
npm run typecheck --workspace @music-os/desktop
npm run typecheck --workspace @music-os/core
npm run record-player:smoke --workspace @music-os/backend
npm run playback-failure:smoke --workspace @music-os/backend
npm run record-player:smoke --workspace @music-os/desktop
npm run playback-progress:smoke --workspace @music-os/desktop
npm run record-player-live:smoke --workspace @music-os/backend
```

The isolated service suite exercises natural boundaries, exact-once history, early/duplicate/stale acknowledgements, queue edits, pause, stop, repeat, missing metadata, errors, multi-window visibility, and fallback. Renderer tests cover duration/disc ordering, compilation artists, alternate copies, seeking, missing durations, and history refresh. The 3D choreography sweep additionally verifies finite poses every five milliseconds, needle clearance before disc movement, upright sleeve insertion, invisible records only when fully sleeved, smooth phase joins, empty-player behavior, and the settled 3.9-second pose through the 4.9-second playback handoff.

The live smoke uses a separate `/usr/bin/mpv` process with `--ao=null`, silent WAV files, a unique socket, and a temporary directory. It exercises real decoding, progress, EOF, and the needle-drop hold without altering the desktop's Windows player or the live music library. It requires Linux mpv.

The layout picker was exercised in an isolated Chromium fixture using the actual React component and inert playback callbacks: all six selections, arrow-key navigation, Enter, Escape and focus restoration, outside dismissal, preference persistence, invalid and blocked storage, zero playback calls, and viewport containment at 390×844, 900×480, and 320×300. This interaction fixture substitutes the scene and does not verify 3D rendering.

Before the Three.js replacement, browser QA covered 2200, 1920, 1720, 1440, 1280, 1050, 980, 768, and 390 pixel widths; short 900 by 480 windows; real local artwork; compact footer controls; single-row ratings; full-size vinyl and sleeve/deck occlusion; long titles; light/dark surfaces; preview isolation; focus/keyboard dismissal; local entrance timing with delayed/already-started backend responses; one-second post-drop timing; early/no-op acknowledgement recovery; pause/stop before and after the needle drop; and reduced motion. That earlier SVG sleeve pass also sampled 491 animation states for valid projections and clipping references, checked contact-shadow fade, and ran complete previews at desktop, phone, and short landscape sizes. The native desktop inspection tool was unavailable, so visual and interaction QA used Chromium against the running Vite renderer with isolated playback callbacks.

Screenshots are in [screenshots/record-player](screenshots/record-player/).

## 3D redesign verification (September 12, 2026)

The Three.js redesign passed backend and desktop typechecks, the desktop record-player smoke including sampled 3D choreography, the 17-case isolated backend record-player suite, and diff whitespace checks. Picker QA covered all six choices, keyboard navigation/focus return, persistence, blocked/invalid storage, and small/short viewports. Static browser renders covered every layout and twelve key exchange poses. These checks do not establish production GPU frame rate or photoreal visual quality. The current render remains less realistic than the Dream Loop reference; further visual refinement is outstanding.

The follow-up pass fixes enlargement blur by allocating the WebGL backing buffer from the stage's untransformed layout size, with device pixel ratio up to 2. Isolated browser checks confirmed a stable 780 x 505 buffer on a standard display and 1560 x 1010 on a 2x display throughout the centered entrance. The vinyl shader keeps a dark body at every orientation while preserving directional groove highlights. Shadow maps update when the instrument pose changes rather than for label rotation alone.

Jackets sit clear of the chassis in every resting layout and rise above the instrument before traveling. Vinyl first clears the spindle, then rotates and approaches the jacket opening from in front until its entire edge has cleared the sleeve. The camera frames the working movement as well as the resting arrangement. A geometry regression sweep independently checks sleeve/chassis, vinyl/platter, and unsleeved vinyl/jacket clearance in all six layouts every 10 milliseconds. Backend and desktop typechecks and the desktop record-player smoke passed. Software WebGL renders covered all six resting layouts and thirteen exchange poses, with no page or shader errors; the centered preview also passed Escape dismissal. Native Electron GPU performance remains unmeasured.

The focus entrance now initializes its first frame with the fitted inline camera, uses easing with no center overshoot, and moves through a compositor transform with fixed layout coordinates. The flight arc eases to zero velocity at both ends. The resting player sits 6 pixels lower; the focused entrance measures that adjusted anchor. Isolated Chromium checks for Classic and Angled confirmed matching first-frame camera and anchor bounds, no camera drift while the opening was held, no size overshoot during flight, Escape dismissal, and zero playback commands or browser errors.

Runtime generated material sources and prompts are documented in `apps/desktop/public/textures/README.md`. Review assets and test harnesses are local to `.dream-loop/` and ignored by Git.

### Fast reopening

Closing Now Playing parks one inline turntable scene for up to 30 seconds. Its WebGL canvas, compiled shaders, geometry, lighting environment and bounded artwork textures are reused on a quick reopen. The scene draws with the current album, progress, layout and canvas dimensions in a layout effect before the reopening paint. First-time opens and opens after cache expiry retain the deferred initialization path so GPU setup does not block the first entrance frame.

The cache contains GPU scene resources only. The modal and record-player React component still unmount on close, so backend presence, focus dialogs and visualizer loops retain their normal cleanup. A parked engine detaches its canvas, cancels rendering, disconnects resize/intersection observers and removes host/window listeners. One 30-second timer disposes its resources; focused exchange scenes are disposed normally and cannot take the cached inline scene. Lost contexts and old engine code after hot reload cannot be reused.

Run `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs npm run turntable-cache:smoke --workspace @music-os/desktop` against the running Vite server. This uses the real WebGL engine in an isolated page and covers StrictMode, immediate same-canvas reopening, no rendering while parked, current playback/layout on the first draw, focused-scene independence, expiry and lost-context replacement. `BROWSER_EXECUTABLE` optionally selects a native browser. Native Windows checks measured roughly 1-14 ms for reattachment and synchronous drawing; a full-modal close/reopen fixture reused the same canvas in 9.3 ms and also passed at a 390-pixel viewport. These are fixture timings, not a guarantee for every desktop configuration.

### Shared lyrics control row

Now Playing keeps Layout, Album ritual, Preview, and the compact Lyrics toggle together in a bottom row spanning the info card. `RecordPlayer` can portal its existing controls into that row while retaining layout and ceremony state; standalone uses retain the original controls. The inline scene fits the available width and height above the row, so it cannot push controls outside the card. Lyrics occupy the same available space and share the centered content width. Both modes reserve the same footer footprint, keeping the toggle and control baseline fixed when the mode changes. Phone browser verification covers a visible record after toggling and Preview/Escape with no playback calls.

## Sleeve center occlusion (September 14, 2026)

The jacket now encloses the vinyl's raised center details as well as its flat surface. Previously the tiny center cap extended beyond the front artwork while the record was partially inside the sleeve. Increasing the paperboard depth from .05 to .08 scene units gives the complete record clearance behind both faces; the edge highlight and collision envelope match that depth. The insertion path and timing stay the same.

`npm run record-player-sleeve:smoke --workspace @music-os/desktop` checks actual mesh vertices against the jacket faces in all six layouts, during both insertion and removal. It requires the running Vite renderer and Playwright (`PLAYWRIGHT_MODULE` can point to an installed module). It uses an isolated browser fixture without playback or library changes. The regression failed before the fix and passed afterward, checking 423,510 covered vertices with at least .006 front clearance and .016 back clearance. Backend and desktop typechecks, existing record-player smoke tests, and before/after Chromium renders of both directions also passed.
