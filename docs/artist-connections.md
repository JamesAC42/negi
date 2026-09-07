# Artist connections

Library artist headings and Discovery search results open the same artist profile. The “Where to next?” section links to related artist profiles, with an expandable set of connection cards, filters for artists outside the local collection, listener connections, and shared tags. “Surprise me” chooses from the returned connections, preferring artists without a local name match.

Each visit adds a breadcrumb. Earlier crumbs and Previous artist return through the trail; revisiting a known catalogue identity collapses the cycle. Verified MusicBrainz identities connect Apple and MusicBrainz breadcrumb entries. The Library/Discovery crumb exits to the originating view. Related profiles import under the related artist's name, rather than the original artist's library alias.

## Data sources

`GET /explore/similar-artists?artistId=…&artist=…` combines public [ListenBrainz similar-artist recommendations](https://labs.api.listenbrainz.org/similar-artists) with [MusicBrainz tags and artist relationships](https://musicbrainz.org/doc/MusicBrainz_API). No additional API key is required.

ListenBrainz results describe artists played in the same listening sessions. MusicBrainz adds shared tags, band membership, subgroups, collaborations, and founders. These are different reasons to explore an artist, not interchangeable claims of sonic similarity. Cards expose the reasons and sources. No similarity percentage is presented as a confidence score.

Apple seeds resolve through verified MusicBrainz links already used by artist profiles. If there is no verified link, the UI offers a MusicBrainz artist lookup instead of merging an arbitrary name match. Recommendation entries retain their exact MusicBrainz IDs. Featured portraits load independently using the existing profile service and show source/credit links; missing images retain monograms.

Remote recommendations are cached and deduplicated. Local ownership counts refresh from the library for every response and remain explicitly name-based. Partial source failures keep successful results available, with source status and retry controls. Empty results do not prevent browsing releases.

## Verification

- `npm run similar-artists:smoke --workspace @music-os/backend`: isolated identity, source merge, deduplication, outage, cache, ownership refresh, and route-validation fixtures.
- `npm run artist-profile:smoke --workspace @music-os/backend`: existing sourced-profile coverage.
- Backend, desktop, and core typechecks.
- Browser fixtures verify Library and Discovery entry points, multi-hop breadcrumbs, cross-provider cycle collapse, new-to-library filtering, responsive layouts, retry recovery, and surprise navigation. Fixtures intercept external API calls and do not start downloads.

A live backend Radiohead lookup also returned recommendations with both ListenBrainz and MusicBrainz evidence during implementation. Coverage and availability vary by artist and provider.

## Fast loading and album highlights

Music-Map public artist pages now provide the first connections independently of MusicBrainz identity resolution. This is a best-effort HTML adapter, not a documented Music-Map API: it validates the requested artist, parses only public artist links, applies a 3-second timeout and daily cache, and links back to the original map. Name-only recommendations go through catalogue search when opened; their source IDs are never sent to catalogue/download endpoints.

Profile, similarity, and album-highlight endpoints return immediate snapshots with `pending: true` while bounded background work runs. Music-Map and ListenBrainz publish independently; Wikipedia does not gate identity resolution. Background enrichment has a 20-second snapshot budget and job limits. Previously returned useful results remain visible when a source stalls. The renderer polls only pending snapshots, reuses visited responses, invalidates ownership data on library changes, warms hovered artists, and defers offscreen discography sections. The previous six-artist metadata/portrait fan-out and redundant initial full-catalogue request have been removed.

“Community favorites” highlights up to six highest-rated studio albums with at least three MusicBrainz votes, displaying scores, vote counts, and provenance. A single capped 100-entry request supplies the scores; coverage limits are disclosed. This is a community rating list, not a streaming popularity chart or RYM ranking. Rating requests do not block browsing. RYM direct search links are provided: a normal public RYM request returned HTTP 403 during implementation, so no RYM data scraping or access-barrier bypass was added.

Additional regression scripts:

- `npm run artist-progressive:smoke --workspace @music-os/backend`
- `npm run music-map:smoke --workspace @music-os/backend`
- `npm run album-highlights:smoke --workspace @music-os/backend`
- `npm run artist-resource:smoke --workspace @music-os/desktop`

Measured local cold snapshot responses after implementation: profile 27 ms, recommendations 10 ms, album highlights 2 ms. These measure initial usable response delivery, not completion of remote enrichment. A real Music-Map Radiohead lookup returned 48 artists in 283 ms; the running app also served a successful Beatles map. Browser fixtures verified connections before biography completion, independently arriving ratings, Music-Map name resolution, cached breadcrumb returns, and narrow layouts.
