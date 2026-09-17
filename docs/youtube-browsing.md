# YouTube browsing in Discovery

Discovery → YouTube combines a music feed based on the taste shown in Settings, genre shortcuts, text search, channel uploads, playlists, local saved lists, and persistent playback. Downloads still enter the editable review inbox before an explicit import.

## Browsing

- For you uses your effective saved taste, including learned preferences. Genre chips follow that profile; blocked artists and genres are excluded from recommendation seeds. An empty profile shows an honest setup state.
- Search by text or paste a video, playlist, channel URL, channel ID, or @handle. Strong channel matches appear above matching videos. Clicking a channel name opens uploads.
- Load more appends deduplicated videos. Back restores results and scroll position. Browsing is bounded to 20 pages per source.
- Length filters and Newest loaded apply to loaded results. Channel uploads and playlists preserve source order.
- Watch later and Recently opened are local lists of up to 100 videos each. These do not synchronize with a YouTube account; recently opened means the player was opened, not verified playback.

## Playback and queue

Opening a video resolves a playable media stream through the backend. Starting or resuming YouTube pauses library music first. Starting library playback releases the YouTube source. Resolution and source changes guard against stale requests starting old audio.

Discovery keeps its selected source, searches, results and scroll position when you leave and return; hidden job polling pauses. The player stays mounted across Discovery navigation and popup closing. Closing a playing video asks **Keep listening in background?** Cancel leaves it open and playing; Yes closes the popup and continues the same video. Reopening the current item from the sidebar or browsing allows closing directly back to background playback. Closing while an initial stream is still loading cancels that pending start.

While YouTube is active, the top transport controls its play/pause, seeking, volume and queue navigation. The right sidebar shows the video thumbnail, title, channel and available video metadata. Its thumbnail reopens the ongoing video without restarting it. The popup has an opaque information panel and a queue on the right, which stacks at narrow widths.

Browse cards offer Play next and Add to end of queue only while YouTube is the active source. The queue advances when a video ends; a failed item shows an actionable error rather than silently skipping. Clear releases the source. Copy link copies the video URL from the sidebar. The queue is session-only. Drag the queue handle or use its arrow keys or move buttons to reorder. Removing the current item advances to the following one, preserving paused/playing intent; removing the final current item clears playback. The fullscreen button also exits fullscreen.

## Optional YouTube session

Settings → YouTube playback accepts a user-supplied Netscape-format cookies.txt file and supports removing it. The backend stores it privately with owner-only permissions and uses temporary snapshots for extraction. Session changes invalidate stream tokens and in-flight resolution. Tests use synthetic cookie fixtures; no real account cookies were imported during development.

Cookies can help with videos requiring a permitted signed-in session, but cannot guarantee every video: removed, private, region-limited or otherwise inaccessible videos can still fail. Audio is the default mode and prefers an audio stream. The Audio / Video switch keeps queue, position and playing or paused intent; current media continues while the alternate source resolves, followed by a brief media load at the same position. Video requests a browser-compatible combined video/audio stream. If unavailable, playback pauses until Audio is selected or another item is chosen. This can provide lower resolution than YouTube's separate adaptive streams. Copy link is the last popup action, with a temporary checkmark also used in the sidebar. This integration does not synchronize account recommendations, subscriptions, comments or watch history.

## Integration and validation

- GET /explore/youtube/preferences and /home expose personalized topics and interleaved results.
- GET /explore/youtube/browse validates public YouTube source URLs and uses bounded, cached yt-dlp metadata extraction.
- POST /explore/youtube/playback resolves a video; GET/HEAD /explore/youtube/stream supports range requests using bounded expiring tokens. Proxy destinations and redirects are restricted to HTTPS Google video hosts.
- GET/POST/DELETE /explore/youtube/session manage the optional local session.

Run core, backend and desktop typechecks, backend youtube-browse:smoke, youtube-personalization:smoke and youtube-playback:smoke, plus desktop youtube-browser:smoke and youtube-playback:smoke. Desktop checks use the running Vite renderer and Playwright; PLAYWRIGHT_MODULE and PLAYWRIGHT_CHANNEL can select the available runtime.

Browser fixtures cover actual media playback, handoff ordering, queue progression, background playback, reopening the same media element, seek/volume, failure/cancellation, settings and responsive layout. Actual App integration was also exercised with isolated mutation fixtures. A real public YouTube video was separately resolved, range-proxied, decoded and advanced in a muted browser video without changing library playback. Native Windows Electron playback and real authenticated cookie playback were not directly verified.

Dream-loop references and screenshots are in the ignored .dream-loop directory. The complete requested follow-up is tracked in docs/youtube-follow-up-checklist.md.
