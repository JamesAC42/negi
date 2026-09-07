# Home redesign: listening journal

## Brief and visual direction

Retain the interval-based album collage and the compact workbench feel. Replace the rest with useful listening history and routes back into the collection. The reference pages establish thin dividers, square geometry, editorial display headings, monospace metadata, dark surfaces and a single accent. Home inherits the active theme; it does not force cyan or overwrite appearance settings.

The central composition is a five-by-five cover wall on the left, balanced by a listening pulse and two dense ranked lists on the right. Recent playback and a short unplayed shelf sit underneath. There is one scrolling content region and no oversized hero, floating cards, or duplicate charts.

## Data audit

- `playback_events`: timestamped starts, played/skipped endings, recorded listening positions, file IDs. This supports real interval counts, daily activity, hour-of-day distribution, and repeat-preserving history.
- Album groups and files: titles, artists, year, artwork, file IDs, lifetime plays, likes and ratings. Fetch the complete album catalogue rather than relying on the partially loaded Library view.
- Existing artist/album navigation and playback callbacks: reuse these for useful actions.
- The old homepage selected files by their latest play timestamp, then summed lifetime counts and estimated listening from duration. A sparse interval silently fell back to lifetime data. Both behaviors are removed.
- Existing genre, format and rating metadata could support more sections, but their mere availability does not justify a permanent panel.

## Ideas considered

| Idea | Decision | Reason |
| --- | --- | --- |
| 5×5 top album wall | Keep as anchor | Personal, visual, immediately browsable; explicitly requested |
| Daily listening bars | Build | Real dates and zero days reveal bursts and pauses |
| Hour-of-day heat strip | Build | A compact complementary view rather than another ranked histogram |
| Artist rotation with inline bars | Build | Names, artwork and relative counts make the chart actionable |
| Most replayed tracks | Build | One-click way back into current favorites |
| Unplayed albums | Build | Turn library ownership into a next listen; prioritize likes/ratings and artists in rotation |
| Recent events | Build | Preserve repeated listens, display local timestamps, provide replay buttons |
| Genre constellation / tag cloud | Defer | Inconsistent free-text tagging would make the visual more authoritative than the data |
| Release decades | Defer | Nice exploration, but lower priority than playable content; edition dates need care |
| Prior-period movement arrows | Defer | Useful future addition, but requires a comparable prior-window contract and tie rules |
| Newly imported shelf | Defer | File creation time is not a reliable acquisition timestamp |
| Streak badges | Defer | UTC versus local-day boundaries need an explicit user-facing definition |
| Format pie and duplicate distributions | Remove | Technical inventory and repeated rank shapes displaced music without helping choose a listen |

## Implemented layout and interactions

1. Compact page header with 7 / 30 / 90 days and all-time controls. Selection is exposed through `aria-pressed`.
2. Numbered section headers provide rhythm using the existing editorial font and muted mono metadata.
3. Exactly 25 square cover positions in five columns. Fewer results leave numbered empty positions; no unrelated albums fill a quiet interval. Labels default off and appear on hover or keyboard focus, with a persistent-for-the-view toggle. Click opens the existing album detail.
4. Listening pulse: recorded listening, plays, known album artists and active days. Daily bars include zero days, tooltips, keyboard focus, endpoints and peak count. The hourly strip uses 24 labeled, focusable cells.
5. Artist rotation: top six artists with counts, number of played albums and relative bars. Click opens the artist page.
6. On repeat: six ranked tracks; click starts the selected track using the ranked track queue.
7. Recent events: up to eight distinct played events, artwork, metadata, local time and replay controls.
8. Still waiting: up to four albums with no lifetime played events, ordered by likes, ratings, current artist affinity, then title. Album navigation and playback are separate controls.
9. Error states expose Retry. Loading hides stale period content. Empty history keeps zero metrics and the unplayed shelf. Refresh is available; period changes and playback transitions also refresh the data. Superseded requests are aborted.
10. Responsive container rules stack the wall and pulse on narrow content areas, condense history columns and prevent horizontal overflow. All styling is scoped to Home.

## Metric contract

`GET /home/listening?period=7d|30d|90d|all` returns a shared Zod-validated response.

- Finite periods are rolling 7/30/90-day windows, inclusive at the cutoff and bounded by the response timestamp. Calendar bars therefore may include partial days at both ends.
- Counts use `played` endings only. Starts do not count. Skips contribute recorded listening milliseconds but not plays.
- Listening time uses the recorder's `listened_ms`, currently the end position. Seeking can affect it; it is not an exact elapsed wall-clock measure. The redesign does not change playback recording behavior.
- Missing and staged files are excluded. Period totals/daily/hourly charts include the available file history. Album, artist and track panels resolve metadata from tagged album groups; files without an album tag do not appear in those panels.
- Artist attribution follows the existing album-artist grouping.
- Daily and hourly buckets use UTC and are labeled accordingly. Recent timestamps use the user's local display timezone.
- All-time totals/rankings include all available recorded history. Its daily chart displays at most the latest 90 UTC calendar days; hourly activity covers the full selected history.
- The unplayed shelf uses lifetime plays independently of the selected interval. No-play periods never fall back to all time.

## Iterations and verification

- Initial implementation introduced the event-based API, wall, pulse, rankings and lower shelves.
- Visual review corrected the absent data-font token with an explicit monospace stack, improved minimum metadata sizes, and checked the cyan/editorial preset in an isolated browser context without changing user settings.
- Replaced the alphabetic unplayed shelf with artist-affinity ordering so it surfaces relevant albums rather than malformed titles first.
- Numeric `0m` handles empty listening without overflowing the summary.
- Backend and desktop typechecks passed.
- `npx tsx apps/backend/src/scripts/home-listening-smoke.ts` checks cutoff boundaries, all four periods, totals, starts/skips, repeated events, UTC buckets, missing/staged files and empty results against an in-memory database.
- Browser verification uses the live backend and checks rendered period totals against API responses, 25 cells, label/focus behavior, responsive widths, navigation, intercepted playback dispatch, and empty/error/retry states. Playback requests are intercepted to avoid starting music during validation.

## Further iteration

Keep the first viewport focused on the wall and listening pulse. If more information is added, replace a weaker panel rather than appending another dashboard row. The next worthwhile data work would be true elapsed-time recording, timezone-aware day buckets, and prior-period comparison. Each should precede any corresponding visual claim.
## Second iteration: make taste and behavior visible

Added a compact two-by-two section between the main listening wall and the recent/unplayed lists:

- **Sound palette:** genre shares weighted by period plays. Comma/semicolon-separated tags are normalized case-insensitively and duplicate tags removed. Multi-tag tracks split weight equally. Five leading tags plus Other sum to the tagged-play denominator. Metadata coverage is visible; this is observed listening, not a saved preference.
- **Listening eras:** decade buckets from file year/date tags, weighted by plays. Only usable 1900–current-year-plus-one dates contribute. Coverage and the possible reissue-year limitation are shown.
- **New paths & familiar tracks:** SVG collection coverage ring (lifetime played tracks / all album-group tracks), period first-recorded-listen and return-play counts, and separate early skips. One first play is counted per file whose first-ever recorded played event falls in the interval. Every other played event is a return. Skips are not inferred dislikes.
- **Your taste, on record:** saved album favorites, track likes and rating counts, five-star distribution, saved genre preferences, and navigation to Settings. Profile fetch failure affects only this panel. No preference records are modified by viewing Home.

The behavior endpoint now includes `skips` and lifetime `firstPlayedAt` per file, alongside selected-period plays. Regression fixtures cover old first plays, newly heard/repeated files, skip-only files, genre weighting, incomplete metadata, decades and empty data.

Audit of current preference flow: playback endings persist events; file preference rows retain likes/dislikes/ratings; the taste-profile service persists explicit profile entries. AgentService.getPlanningContext reads explicit preferences, liked/high-rated tracks, high rotation, recent plays and skips. No background process was found that rewrites the persisted taste profile from listening history. The homepage now explains this distinction.

Verification: backend and desktop typechecks; `home-listening-smoke.ts`; `apps/desktop/src/scripts/home-insights-smoke.ts`; live browser checks for four sections, all-time and finite periods, empty history, Settings navigation, and no Home overflow at 1719/1280/1000/760 widths. Visual QA used the cyan/editorial theme and replaced a CSS-gradient coverage ring with SVG because the app intentionally disables decorative background gradients. Preview: `home-insights-desktop.png`.