# Now Playing screen motion

Opening Now Playing assembles nine surfaces with a shared fade and directional slide at a fixed size. Artwork enters from the left; the song card and queue enter from the right; transport and spectrogram rise from below; the waveform drops from above; the meters approach from their outside edges. The spectrum completes the assembly. All sections start immediately with a fast ease-out; slightly different durations stagger their arrival within 220–250 ms. Scaling, rotation and overshoot are removed so panel sizes remain stable. Narrow windows shorten the travel distances.

Closing sends the same surfaces back toward their origins in 140 ms, with immediate movement and fade instead of an accelerating start or hold. If dismissal interrupts the entrance, each surface continues from its current visible pose. Repeated dismissal requests complete once; unmount cancels pending callbacks. The backdrop continues intercepting pointer input while its controls are inert during the exit. Escape remains available to the record layout picker and record preview before closing Now Playing.

During motion, the overlay, cockpit and focus containers suppress transient scrollbars while preserving any existing vertical scrollbar gutter. Their original scrolling styles return after entry or disposal.

The motion uses the browser's Web Animations API and releases all animated transforms after entry. Existing centering transforms remain intact. Visualizer canvases use their layout dimensions so moving/scaling the containers does not repeatedly resize and clear their backing buffers. Reduced motion skips both spatial movement and the dismissal delay; changing that preference during an animation finishes it immediately.

The choreography and lifecycle live in `apps/desktop/src/renderer/now-playing-motion.ts`; the modal creates and disposes the controller in a layout effect. It does not change playback state, the queue, album ritual timing or settled layout.

## Validation

With the managed Vite renderer already running, run the isolated browser regression fixture using an available Playwright installation:

```bash
source ~/.nvm/nvm.sh
# Omit PLAYWRIGHT_MODULE if playwright is installed in the workspace.
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs npm run now-playing-motion:smoke --workspace @music-os/desktop
```

`MUSIC_OS_RENDERER_ORIGIN` optionally overrides `http://127.0.0.1:5173`. The test uses an intercepted fixture page with the motion module and a React scene fixture whose GPU constructor is replaced. It never mounts the app, calls the backend, or controls playback. It covers interrupted-entry continuity, duplicate closes, inert controls, transform cleanup, waveform centering, unmount cancellation, reduced motion and changes to that preference while closing.

Dream-loop targets, sampled entry/exit frames and the full-app interaction harness are ignored local artifacts in `.dream-loop/now-playing-motion/`. The reference was generated with the built-in image tool from the existing screen; its prompt preserves the entire layout and palette and specifies a nearly settled directional assembly at 260 ms. Browser interaction QA covers desktop, 390-pixel phone and 900-pixel short-landscape windows. Native Electron GPU performance requires verification in the user's running desktop; software WebGL timings are not representative of it.

The completed pass passed backend and desktop typechecks; desktop record-player, playback-progress and motion smoke tests; interrupted-close and nested Escape checks; responsive browser inspection; and canvas-buffer stability across five animation samples. The independent dream-loop visual review scored 9.5/10. Software browser runs showed variable long frame gaps even with the 3D scene substituted, so they do not establish native GPU smoothness. The exact image-generation prompt and review evidence are saved with the local dream-loop artifacts.

The follow-up removes scale, tilt, overshoot and start delays. Regression coverage now also checks unchanged content dimensions with and without existing scrollbars, restoration of normal scrolling, and visible motion during the first 16 ms. Seven animation samples at 1720x1080, 1440x900, 390x844 and 900x480 passed fixed-panel-size and scrollbar-stability assertions with no browser errors.

Inline turntable initialization now waits for the entrance animation to become ready and paint moving frames before starting GPU setup. This removes synchronous 3D initialization from the first entrance frame without changing the 250 ms entrance or 140 ms exit. The record-player area keeps its fixed aspect ratio while initializing. Focused record exchanges still initialize immediately on their existing timeline; quick dismissal cancels deferred work. The browser regression fixture covers this ordering, StrictMode, cancellation and focused-scene initialization.

The visualizer performance follow-up keeps one stationary compositor layer on the open overlay after the individual entrance animations finish. Canvas sizing lives in `visualizer-canvas.ts`: each mounted canvas caches its context and layout dimensions, updates them through `ResizeObserver`, and checks device pixel density without measuring layout in its drawing loop. The existing resolution cap, drawing cadence, pause behavior, and entrance/exit timing remain unchanged.

`npm run visualizer-canvas:smoke --workspace @music-os/desktop` uses the same `PLAYWRIGHT_MODULE` and `MUSIC_OS_RENDERER_ORIGIN` options as the motion smoke. Its isolated fixture covers stable buffers during transforms, preserved paused history, actual resizing, display-density changes, and disposal. Full-modal native Windows browser checks at 1440x900 and 390x844 recorded zero canvas sizing reads over 120 steady animation frames and correctly sized buffers after resizing. Simulated playing audio and the real turntable remained active in the desktop check. Backend/desktop typechecks and the canvas, motion, progress, and record-player smoke checks passed.

The reported sustained frame-rate drop did not reproduce in the isolated native GPU fixture: before and after the change, its animation-frame callbacks ran at approximately 165 Hz. The test confirms reduced sizing work and stable behavior, not that the user's live Electron slowdown has been reproduced or conclusively resolved. Software WebGL profiling and hidden-window throttling were excluded as evidence about native performance. Profiling results and desktop/narrow screenshots are saved under `.dream-loop/now-playing-motion/`.

Quick reopenings now reuse a cached inline turntable engine for up to 30 seconds after closing. The scene is detached and does no rendering while cached; the rest of the modal unmounts normally. Reattachment draws the updated scene before the first reopening paint. Cache expiry, context loss and hot reload release or invalidate retained resources. First-time initialization keeps its existing entrance deferral. See `docs/record-player.md` and `turntable-cache:smoke` for lifecycle details and focused validation.
