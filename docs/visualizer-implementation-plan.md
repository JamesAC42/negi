# Visualizer Implementation Plan

## Decision

Music OS will keep `mpv` as the playback engine. The app will not migrate playback to Web Audio for visualizers.

The visualizer system will be built as a separate, performance-bounded data and rendering path around the existing playback engine:

- `mpv` remains responsible for decoding, output, queue playback, seeking, pause/resume, volume, and format support.
- `/playback/state` remains a low-frequency control/status endpoint.
- Visualizer data gets its own API surface and is never mixed into normal playback state polling.
- React owns controls and layout only; high-frequency visual rendering happens in canvas without per-frame React state updates.
- Heavy analysis work is cached, capped, paused when hidden, and isolated from the playback control path.

## Goals

- Add live-feeling waveform, spectrum, and spectrogram UI without slowing library browsing or playback controls.
- Preserve the reliability and codec coverage of `mpv`.
- Keep visualizer rendering smooth on modest hardware.
- Make visualizer features optional by visibility and capability, so the app degrades gracefully.
- Avoid architectural choices that would make future playback work harder.

## Non-goals

- No Web Audio playback engine.
- No browser-side audio decoding for primary playback.
- No sample-accurate visual sync requirement in the first implementation.
- No live FFT rendering in every row or card.
- No visualizer work inside the existing one-second playback polling loop.

## Current Playback Constraints

The current playback path is:

1. Renderer calls local HTTP playback endpoints.
2. Backend `PlaybackService` owns queue state and playback history.
3. Backend launches `mpv` with JSON IPC and `--no-video`.
4. Backend polls `mpv` for `time-pos`, `duration`, `pause`, and `volume`.
5. Renderer polls `/playback/state` once per second and locally interpolates progress every 250 ms.
6. Renderer currently shows metadata, artwork, seek progress, controls, and a decorative animated EQ glyph.

Because `mpv` is out-of-process, the renderer has no direct PCM stream. Visualizers must therefore use cached file analysis, a sidecar analyzer, or an `mpv`-adjacent export path.

## Performance Principles

Every phase must follow these rules:

- Do not send high-frequency frames through React component state.
- Do not add high-frequency fields to `PlaybackState`.
- Do not perform visualizer analysis on the playback command chain.
- Do not block play, pause, seek, next, previous, or stop on waveform/FFT work.
- Do not queue visualizer frames; drop stale frames.
- Cap live visualizer frame rate based on surface size and visibility.
- Pause live analysis when the relevant visualizer is not visible.
- Use cached static data for list rows and background surfaces.
- Use canvas for waveform, spectrum, and spectrogram rendering.
- Use CSS-only placeholder animation when live data is unavailable.
- Treat spectrogram rendering as expanded-view-only.

Recommended budgets:

| Surface | Data Type | Target Rate | Notes |
| --- | --- | ---: | --- |
| Bottom player mini waveform | cached peaks + playhead | UI animation only | No live FFT required. |
| Home now-playing card | cached peaks or low-band meter | 10-15 fps | Only if visible. |
| Now Playing modal waveform | cached peaks + playhead | UI animation only | Can redraw on animation frame. |
| Now Playing modal spectrum | live bands | 15-30 fps | Drop frames under pressure. |
| Now Playing modal spectrogram | live bins | 10-20 fps | Expanded modal only. |
| Album/playlist/library rows | cached peaks only | none | No live stream per row. |

## Phase 1: Visualizer Foundation

### Objective

Create the UI, data contracts, and transport boundaries for visualizers without adding expensive audio analysis yet.

This phase should make it possible to build visualizer surfaces safely while initially feeding them silent, placeholder, or cached-like frames.

### Backend Work

Add visualizer schema types in `packages/core`:

```ts
export const visualizerFrameSchema = z.object({
  version: z.literal(1),
  frameId: z.number().int().nonnegative(),
  emittedAt: z.string(),
  fileId: z.string().nullable(),
  status: z.enum(["stopped", "playing", "paused", "error"]),
  positionMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative().nullable(),
  rms: z.number().min(0).max(1),
  peak: z.number().min(0).max(1),
  bands: z.array(z.number().min(0).max(1)).max(128),
  waveform: z.array(z.number().min(-1).max(1)).max(4096).optional(),
  source: z.enum(["none", "cached", "sidecar", "mpv"])
});
```

Add a lightweight `VisualizerService` in the backend:

- Reads current playback state from `PlaybackService`.
- Maintains a monotonically increasing `frameId`.
- Emits placeholder frames when playback is stopped or no analyzer is active.
- Owns subscriber lifecycle.
- Never blocks playback operations.
- Has explicit `startForCurrentPlayback()` and `stop()` methods for future analyzer wiring.

Add an SSE endpoint:

```text
GET /playback/visualizer/stream
```

SSE behavior:

- Sends an initial frame immediately.
- Sends heartbeat comments every 15-30 seconds.
- Sends frames only while at least one client is connected.
- Closes cleanly when the HTTP request closes.
- Uses `Cache-Control: no-cache` and appropriate event-stream headers.
- Caps placeholder frames to a low rate, e.g. 5 fps or less.

Do not add visualizer frames to `/playback/state`.

### Renderer Work

Add a visualizer stream client:

- `useVisualizerStream(enabled: boolean)` hook.
- Opens SSE only when a visible component needs live visualizer data.
- Stores latest frame in a mutable ref, not React state.
- Uses minimal React state only for connection status or file changes.
- Reconnects with backoff.
- Closes when disabled or component unmounts.

Add canvas components:

- `MiniWaveformCanvas`
- `SpectrumBarsCanvas`
- `SpectrogramCanvas`
- `VisualizerFallbackGlyph`

Rendering rules:

- Components receive playback identity and latest-frame refs.
- Components draw using `requestAnimationFrame` only when visible.
- Components use `ResizeObserver` to adapt resolution.
- Device pixel ratio is capped, e.g. `Math.min(window.devicePixelRatio, 2)`.
- Components avoid expensive shadows, filters, and DOM node churn.

Initial placements:

- Replace or augment the bottom player decorative EQ glyph with a canvas-backed mini meter fallback.
- Add a reserved visualizer area in the Now Playing modal behind or below the artwork/progress area.
- Keep all visuals functional with placeholder frames.

### Acceptance Criteria

- Playback controls behave exactly as before.
- `/playback/state` response shape remains focused on playback state.
- SSE stream connects and disconnects only when visualizer UI is visible.
- No React component rerenders at visualizer frame rate.
- Placeholder visualizers render without measurable UI slowdown.

## Phase 2: Cached Waveform Overview

### Objective

Add useful waveform visuals using cached, low-cost file analysis. This gives the app waveform UI in many places without requiring live PCM access.

### Backend Work

Add a waveform cache service:

```ts
interface WaveformSummary {
  version: 1;
  fileId: string;
  filePath: string;
  fileSize: number;
  fileMtimeMs: number;
  durationMs: number | null;
  channels: number;
  sampleCount: number;
  samplesPerPoint: number;
  peaks: number[];
  rms?: number[];
  createdAt: string;
}
```

Cache storage options:

- Preferred first implementation: filesystem JSON cache under `.music-os/cache/waveforms/`.
- Cache key: `fileId + fileSize + fileMtimeMs + version`.
- SQLite can be added later if cache management becomes important.

Add endpoint:

```text
GET /playback/waveform/:fileId
```

Endpoint behavior:

- Returns cached waveform if available and valid.
- If missing, returns `202 Accepted` with a lightweight pending response and schedules background generation.
- Does not block the request for long files.
- Does not block playback.
- Limits concurrent generation, e.g. one or two jobs at a time.
- Deduplicates concurrent requests for the same file.
- Bounds individual `ffmpeg` waveform jobs with a timeout so broken files cannot occupy a generation slot indefinitely.

Waveform generation source:

- Prefer `ffmpeg` or `ffprobe` if available because it is reliable for broad audio formats.
- If no analyzer binary is available, return unavailable and let the UI show fallback.
- Do not require waveform generation for playback to work.

Generation strategy:

- Decode/downsample to mono peaks.
- Target 1024 or 2048 peak points per track initially.
- Store normalized peak values in `[-1, 1]` or separate positive/negative peak pairs if needed.
- Keep generation priority low.
- Cancel or deprioritize generation for files no longer visible if cancellation is practical.

### Renderer Work

Add `useWaveform(fileId, enabled)`:

- Fetches waveform only when a waveform surface is visible.
- Caches responses in memory by file id and cache version.
- Handles `pending`, `ready`, `unavailable`, and `error` states.
- Retries pending generation with a slow backoff, not rapid polling.

Add waveform rendering surfaces:

- Bottom player progress rail: static waveform shape with progress overlay.
- Now Playing modal: large waveform with playhead and elapsed/remaining context.
- Home now-playing card: compact waveform if space allows.
- Album/playlist detail rows: optional static mini waveform only for current or hovered rows.

Important UI rule:

- Library, album, and playlist rows must not request waveforms for every visible row by default. Use one of these constraints:
  - only current track,
  - only hovered/focused row,
  - only first N visible rows after idle,
  - only expanded details.

### Acceptance Criteria

- Bottom player can show a waveform for the current track without changing playback behavior.
- Missing analyzer binary does not break UI or playback.
- Waveform generation is backgrounded and concurrency-limited.
- Large libraries do not trigger mass waveform generation.
- Cached waveform is reused across app sessions.

## Phase 3: Live Lightweight Analysis

### Objective

Add real live visual data for meters and spectrum while keeping `mpv` as the playback engine.

### Recommended Approach

Use a sidecar analyzer first unless `mpv` export proves simpler and stable across the target environment.

The sidecar analyzer reads the current audio file independently, seeks near the current playback position, and emits lightweight amplitude/spectrum frames. It is visually synchronized closely enough for UI but does not control audio output.

### Backend Work

Add `LiveAnalyzerProvider`:

```ts
interface LiveAnalyzerProvider {
  start(input: {
    fileId: string;
    path: string;
    positionMs: number;
    durationMs: number | null;
  }): Promise<void>;
  pause(): void;
  resume(positionMs: number): void;
  seek(positionMs: number): void;
  stop(): void;
  onFrame(callback: (frame: AnalyzerFrame) => void): Unsubscribe;
}
```

Implementation options:

- Sidecar process using `ffmpeg` to decode a low-rate mono stream and compute RMS/FFT in Node or a worker process.
- Sidecar process that directly emits precomputed band data if a small external tool is adopted later.
- Optional experimental `mpv` provider behind a config flag if an `mpv` filter/export approach is viable.

Initial live frame shape:

```ts
interface AnalyzerFrame {
  fileId: string;
  analyzerPositionMs: number;
  rms: number;
  peak: number;
  bands: number[]; // 32 or 64 bands initially
}
```

Synchronization rules:

- On track change: stop old analyzer immediately, start new analyzer after playback state confirms file id/path.
- On pause: pause frame emission; keep last frame available for decay rendering.
- On resume: resume from current backend playback position.
- On seek: tell analyzer to seek; until it catches up, UI may show cached waveform/fallback.
- On drift: periodically compare analyzer position with playback position and resync when drift exceeds threshold, e.g. 500-1000 ms.

Performance rules:

- Limit analyzer output to 15 fps by default.
- Allow 30 fps only when expanded Now Playing modal is visible.
- Use 32 bands initially; allow 64 for expanded views.
- Kill analyzer process when no subscribers are connected.
- Drop frames if subscribers are slow.
- Never let analyzer errors set playback status to error.
- Surface analyzer errors only as visualizer capability state.

Add capability/config state:

```ts
interface VisualizerCapabilities {
  waveformCache: "available" | "missing_dependency" | "disabled";
  liveAnalyzer: "available" | "missing_dependency" | "disabled" | "error";
  spectrogram: "available" | "disabled";
}
```

Possible endpoint:

```text
GET /playback/visualizer/capabilities
```

### Renderer Work

Add live spectrum/meter rendering:

- Bottom player: tiny live meter or bars only when already connected for a visible surface.
- Now Playing modal: spectrum bars under the main waveform.
- Home now-playing card: low-rate meter only if visible.

Rendering behavior:

- Smooth amplitude with decay in the canvas draw loop.
- Interpolate between frames visually, not by requesting more frames.
- If live frames stop, decay to idle and show cached waveform.
- Avoid per-band DOM nodes for large meters.

### Acceptance Criteria

- Live spectrum/meter works while `mpv` plays audio.
- Playback controls remain responsive during analyzer startup, seek, pause, and track change.
- Analyzer process exits when visualizer surfaces are closed.
- Analyzer failure does not affect playback.
- CPU remains bounded by frame-rate and band-count caps.

## Phase 4: Spectrogram

### Objective

Add an expanded-view spectrogram that feels rich but remains strictly opt-in and performance-bounded.

### Scope

Spectrogram should only appear in expanded visualizer surfaces:

- Now Playing modal.
- Future dedicated visualizer page or mode.

It should not run in:

- Library rows.
- Album rows.
- Playlist rows.
- Always-visible bottom player, except possibly a very small non-spectrogram preview.

### Backend Work

Extend live analyzer frames with FFT bins only when requested:

```ts
interface SpectrogramFrame extends AnalyzerFrame {
  fftBins: number[]; // capped, e.g. 128 or 256 bins
  fftSize: 256 | 512 | 1024;
}
```

Add subscription modes to the visualizer stream:

```text
GET /playback/visualizer/stream?mode=meter
GET /playback/visualizer/stream?mode=spectrum
GET /playback/visualizer/stream?mode=spectrogram
```

Mode rules:

- `meter`: RMS/peak only, lowest cost.
- `spectrum`: RMS/peak + 32-64 bands.
- `spectrogram`: RMS/peak + bands + capped FFT bins.

The backend should select the highest active mode across subscribers, but only while those subscribers are connected.

Performance limits:

- Default spectrogram rate: 10-15 fps.
- Maximum bins initially: 256.
- Maximum active spectrogram subscribers: one or a small fixed number.
- If CPU pressure or frame lag is detected, downgrade rate or bins.

### Renderer Work

Implement `SpectrogramCanvas` as a rolling raster buffer:

- Keep a fixed-width canvas texture.
- Each incoming frame draws one vertical slice.
- Shift or wrap the write column instead of rebuilding the whole image.
- Use a compact color ramp based on app accent/theme.
- Cap internal render resolution.
- Clear/reset on file change, seek, or long pause.

UI behavior:

- Show spectrogram only after the modal/dedicated view is open.
- Provide an automatic fallback to spectrum bars if spectrogram frames are unavailable.
- Let users toggle between waveform, spectrum, and spectrogram in the expanded player.
- Persist the selected expanded visualizer mode in local storage if useful.

### Acceptance Criteria

- Spectrogram runs only when an expanded visualizer is visible.
- Closing the modal stops spectrogram-grade analyzer work.
- Seeking clears or marks the spectrogram discontinuity.
- App remains responsive while spectrogram is running.
- Lower-capability systems automatically fall back to waveform/spectrum.

## Implementation Order

1. Add core schemas and visualizer service skeleton.
2. Add SSE visualizer stream endpoint.
3. Add renderer stream hook and canvas primitives.
4. Add placeholder visualizers to bottom player and Now Playing modal.
5. Add waveform cache service and waveform endpoint.
6. Add current-track waveform rendering in the player rail and modal.
7. Add constrained waveform use to selected/hovered detail rows only.
8. Add live analyzer provider behind capability detection.
9. Add live meter/spectrum to expanded surfaces.
10. Add spectrogram stream mode and expanded modal rendering.
11. Tune frame caps, visibility rules, and fallback behavior.
12. Update docs/progress notes after implementation.

## Testing and Validation Plan

Backend checks:

- Visualizer stream connects and disconnects cleanly.
- Stream does not emit when no subscribers exist.
- Waveform cache key invalidates when file size or mtime changes.
- Waveform generation is concurrency-limited.
- Analyzer errors do not change playback state.
- Track change stops old analyzer work.
- Seek resyncs analyzer position.

Renderer checks:

- Visualizer canvases do not trigger React rerenders per frame.
- Closing Now Playing modal closes high-cost stream modes.
- Bottom player remains usable while waveform is pending.
- Missing visualizer capabilities show fallback UI.
- Reduced-motion or hidden-tab behavior does not waste rendering work.

Manual performance validation:

- Play/pause/seek/next while live spectrum is open.
- Open and close Now Playing modal repeatedly during playback.
- Browse large library while playback and visualizer are active.
- Test long tracks and short tracks.
- Test missing analyzer dependency.
- Test Windows mpv from WSL path setup.

Suggested smoke scripts:

- `visualizer-stream:smoke`: starts backend app, subscribes to SSE, verifies initial/heartbeat/frame behavior.
- `waveform-cache:smoke`: generates waveform for a small fixture, verifies cache reuse and invalidation.
- Lifecycle assertions can live in `visualizer-stream:smoke` unless they grow large enough to justify a dedicated script.

Implemented smoke coverage:

- `visualizer-contract:smoke`: validates visualizer schemas and capability response shapes.
- `visualizer-capabilities:smoke`: constructs the actual visualizer services and verifies capability downgrade/availability behavior with and without `ffmpegPath`.
- `visualizer-stream:smoke`: subscribes to the SSE service with fake playback/analyzer services and verifies frame emission plus analyzer stop on final subscriber disconnect.
- `visualizer-stream:smoke`: asserts the service debug snapshot returns to zero subscribers and no active mode after disconnect.
- `visualizer-stream:smoke`: also verifies per-subscriber payload trimming by ensuring meter subscribers do not receive spectrogram bins when another subscriber requests spectrogram mode.
- `visualizer-analyzer:smoke`: exercises the optional `ffmpeg` sidecar analyzer against a generated WAV fixture, or verifies clean missing-dependency behavior when `ffmpeg` is unavailable.
- `waveform-cache:smoke`: verifies typed pending response semantics, generates and reuses a waveform cache entry for a small WAV fixture when `ffmpeg` is available, and skips cleanly when it is not.
- `waveform-cache:smoke`: asserts waveform service debug state returns to no active generators, pending jobs, queued waiters, or child processes after generation.
- `visualizer:smoke`: runs the visualizer contract, stream, and waveform cache checks together.

Recommended final validation commands:

```bash
npm run typecheck --workspaces --if-present
npm run visualizer:smoke --workspace @music-os/backend
npm run build --workspace @music-os/desktop
```

Completion audit status:

- Phase 1 foundation is implemented through shared schemas, SSE stream, capabilities endpoint, renderer stream hook, and canvas components.
- Phase 2 cached waveform overview is implemented for the current track in the bottom player, Home now-playing card, Now Playing modal, queue rows, library album rows, album detail rows, and playlist detail rows, with disk cache and constrained requests.
- Phase 3 live lightweight analysis is implemented through an optional `ffmpeg` sidecar analyzer while retaining `mpv` playback.
- Phase 4 spectrogram is implemented only in the expanded Now Playing visualizer mode and is subscriber-gated.
- Full completion still requires running the build and smoke scripts in the target environment, plus manual playback validation with real library files.

## Implemented Direction

- Disk JSON waveform cache under `.music-os/cache/waveforms/`.
- Optional `ffmpeg` dependency detection through `MUSIC_OS_FFMPEG_PATH` or common local paths.
- `.env.example` documents `MUSIC_OS_FFMPEG_PATH` for users who need to point the app at a specific ffmpeg binary.
- Pending waveform generation returns HTTP `202` with a typed pending response.
- Failed waveform generation is cached briefly per file fingerprint so broken files do not repeatedly churn decoder work.
- Waveform service shutdown drains queued generation waiters, kills active `ffmpeg` waveform jobs, and rejects new waveform work.
- SSE visualizer stream separate from `/playback/state`.
- Canvas renderer surfaces for the bottom player and Now Playing modal.
- Sidecar analyzer provider using low-rate mono PCM from `ffmpeg` while `mpv` remains the playback engine.
- Sidecar analyzer bounds its PCM sample buffer before and after chunk ingestion to avoid unbounded memory growth.
- Renderer visualizer mode selection is capability-aware: unavailable spectrum/spectrogram modes fall back to the cheapest valid mode and do not request higher-cost stream modes.
- Renderer backend calls, including EventSource visualizer subscriptions, use the same backend origin constant instead of splitting the new visualizer path from existing API helpers.
- Canvas drawing helpers guard zero-size surfaces and clamp progress before drawing.
- Static waveform canvases use `ResizeObserver` redraws so layout changes do not wait for playback progress ticks.
- Renderer visualizer streams close while the document is hidden, stopping subscriber-gated analyzer work until the UI is visible again.
- Renderer current-track waveform fetches are also gated on document visibility to avoid hidden-window cache generation.
- Renderer aborts in-flight current-track waveform fetches when the waveform hook is cleaned up because playback, visibility, or track identity changed.
- Renderer row-level mini waveforms reuse the single current-track waveform object and never trigger per-row waveform fetches.
- Renderer disables live visualizer streams when `prefers-reduced-motion: reduce` is active, keeping static waveform/fallback visuals without sidecar stream work.
- Reduced-motion mode also disables live Spectrum/Spectrogram controls and falls back to Meter visually.
- Reduced-motion detection supports missing `matchMedia`, plus both modern and legacy `MediaQueryList` listener APIs.
- Expanded visualizer mode is persisted in local storage, with capability and reduced-motion fallback remaining authoritative.
- Visualizer panel status text explains reduced-motion fallback or missing `ffmpeg` live analyzer capability.
- Renderer clears latest visualizer frame refs on track and mode changes so stale frames do not drive the next track while the analyzer catches up.
- Backend resets the sidecar analyzer immediately when the highest active subscriber mode changes, so spectrum/spectrogram resource levels are not kept longer than necessary.
- Backend removes broken SSE subscribers on write failures and re-applies the existing timer/analyzer lifecycle.
- Backend resets active stream mode when the final subscriber disconnects, returning the visualizer service to a fully idle state.
- Backend trims per-subscriber visualizer payloads, omitting spectrogram bins for meter/spectrum subscribers even when another subscriber needs spectrogram mode.
- Visualizer canvas layers are presentational and do not receive pointer events, preserving seek and modal control interactions.
- `mpv` export remains intentionally unimplemented; it should stay experimental unless it proves reliable across native Linux and Windows-mpv-from-WSL.

## Remaining Validation Requirements

These are not design decisions; they are the evidence still needed before the implementation should be considered complete:

- Typecheck all workspaces.
- Run the aggregate visualizer smoke suite.
- Build the desktop app.
- Manually exercise real playback with an indexed file:
  - confirm `mpv` playback still starts, pauses, resumes, seeks, skips, and stops;
  - confirm bottom-player waveform/meter appears without blocking controls;
  - confirm Now Playing modal can switch Meter, Spectrum, and Spectrogram modes;
  - confirm missing `ffmpeg` degrades to fallback visuals and does not break playback;
  - confirm closing Now Playing stops spectrogram-grade stream work.
