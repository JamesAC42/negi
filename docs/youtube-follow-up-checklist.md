# YouTube browsing and playback follow-up

Requested requirements (2026-09-17). Preserve unrelated ongoing work.

- [x] Remove the complete “Find your next obsession” featured-channel section.
- [x] Personalize home results using the existing Settings taste profile.
- [x] Build genre tabs from stored preferences, respecting dislikes and empty profiles.
- [x] Improve playback reliability; support optional user-supplied YouTube cookies without claiming every video can be played.
- [x] Show matching channels in search when there is a strong match.
- [x] Make player information opaque/readable using theme surfaces.
- [x] Remove the unnecessary “Some videos only play on YouTube…” message.
- [x] Put Watch on YouTube last, right of Explore similar.
- [x] Pause local music when a YouTube video starts; prevent both playing together.
- [x] On closing a playing video ask “Keep listening in background?”; No cancels closing, Yes closes and continues the same video.
- [x] Keep a persistent YouTube player across browsing/navigation and popup reopen.
- [x] Route top play/pause, volume, seeking, next/previous to active YouTube playback.
- [x] Show a YouTube-specific Now Playing sidebar: thumbnail, title, channel, video metadata; no spectrogram, rating/likes, or local file details.
- [x] Clicking sidebar thumbnail reopens the same playing video without restart.
- [x] Include a queue to the right of the popup video.
- [x] Add Up next / End of queue actions to browse cards, enabled only for the active YouTube source, disabled for local music.
- [x] Verify queue ordering, end-of-video progression, source handoffs, persistence, cancellation, seek/volume, and failure behavior.
- [x] Run focused backend/core/desktop validation and visual checks; document real-provider limitations.

## Verification completed

- Core, backend and desktop TypeScript checks passed.
- Backend browse, personalization and playback smoke checks passed. Personalization covers learned taste, explicit overrides, blocked values, album-only seeds and format tags.
- Desktop browser and persistent-player smoke checks passed with real playable media fixtures, including responsive widths 1440, 900 and 650.
- Actual App integration passed: music-to-video handoff, global transport, YouTube sidebar, popup reopen, cross-view persistence, queue actions and external local-playback takeover. Mutations were isolated fixtures.
- Real saved preferences now produce a personalized feed. Inspected live results and theme-aware player screenshots. Removed technical format labels from recommendation topics without editing stored preferences.
- A real public video resolved through the configured yt-dlp, returned range HTTP 206, decoded and advanced in an isolated muted browser video. Current music was not changed by this check.
- Cookie import/removal uses synthetic fixtures; no real account cookies were used. Authentication cannot guarantee removed, private or region-restricted videos. Native Electron playback was not directly exercised; browser media and actual app-shell behavior were checked.
- git diff --check passed. Unrelated checkout changes were preserved.

See [YouTube browsing](youtube-browsing.md) for operation, API and limitations.
## Player refinements

- [x] Closing a reopened current item returns directly to background playback.
- [x] Replace browser media chrome with themed controls and consistent transport icons.
- [x] Sidebar Copy link and Clear actions; remove artwork text overlay.
- [x] Improve queue heading/row spacing and remove the empty-queue tagline.
- [x] Default Audio mode, animated Audio / Video switch, preserved queue and position, and recoverable video-unavailable pause.
- [x] Preserve Discovery tab, browser state and scroll on leaving and returning.
- [x] Improve confirmation spacing and rename No to Cancel.
Refinement verification: backend and desktop typechecks, playback API smoke, browser retention smoke, and real-media player smoke passed. Coverage includes mode-switch continuity, unavailable-video recovery, pause during delayed resolution, clipboard, custom controls, reopened closing, queue preservation, and responsive layouts. Both audio and video modes decoded and advanced a real public stream in an isolated muted browser. Native Electron remains unverified.

## Queue and finishing refinements

- [x] Bound media height and remove duplicate unavailable error to avoid extra popup scrolling.
- [x] Use a spaced, muted status panel for Now Playing playback notices.
- [x] Shared Copy link action in sidebar and popup; checkmark resets after 2.2 seconds without a success text line.
- [x] Fullscreen control toggles between entering and exiting, following fullscreenchange events.
- [x] Queue drag reorder, keyboard arrows, explicit up/down buttons, and removal, preserving the active duplicate occurrence and playback position.
- [x] Video-card actions sit beside wrapping channel details; compact cards use a two-column action group.
Validation: backend and desktop typechecks and responsive browser smoke passed. Real-media player regression covers fullscreen enter/exit, clipboard icon reset, drag and keyboard reordering with duplicate entries, current-item removal/advance/clear, and unavailable-state geometry. Final player layout was visually inspected.
