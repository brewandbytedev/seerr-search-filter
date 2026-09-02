# Seerr Search Filter

[![Release](https://img.shields.io/github/v/tag/brewandbytedev/seerr-search-filter?filter=v*&sort=semver&label=release)](https://github.com/brewandbytedev/seerr-search-filter/releases)

A Chrome extension (Manifest V3) that adds a filter toolbar to
[Seerr](https://github.com/seerr-team/seerr)'s search results page and to a
person's filmography page — filter by media type, genre, year, score,
language, availability, content rating, and cast — without adding extra API
calls beyond what's strictly needed.

## What it does

- **`/search?query=...`** — a horizontal toolbar appears above the results
  grid with: Movies/TV toggle chips, Genre, Year range, minimum Score,
  Language, Availability, Content rating, and an Actor text field. Matching
  is entirely client-side against data Seerr's own search API already
  returns.
- **`/person/{id}`** — the same toolbar (minus the type toggle, since that
  page already has its own Movie/TV filter per section) appears once, above
  the first filmography grid, and filters every grid on the page (e.g. both
  "Appearances" and "Crew").
- Filtered-out cards are hidden by collapsing their grid cell, so the layout
  reflows instead of leaving gaps.

### Filter data sources

Most filters (type, genre, year, score, language, availability) use fields
already present on each search result / credit — no extra requests.

Two fields aren't in that data and need a follow-up call to
`/api/v1/movie/{id}` or `/api/v1/tv/{id}` (which already include
`credits.cast` and release/content-rating info) per title:

- **Actor** — matches against `credits.cast`.
- **Content rating** — US certification (movies: `releases.results`; TV:
  `contentRatings.results`).

On `/search`, that lookup is lazy and viewport-scoped: only cards currently
on screen (plus a margin) get fetched, since results grow unbounded via
infinite scroll. On `/person/{id}` it eagerly fetches for the *entire*
filmography instead, since `combined_credits` is a single bounded response
(rarely more than a couple hundred titles) — otherwise sections below the
fold (typically "Crew") would silently stay unfiltered until scrolled to.

Genre names and the two enrichment endpoints above are the only requests
this extension makes on its own initiative; everything else is read from
responses Seerr's own frontend already triggers.

## How it works

- **`src/content/inject-main.ts`** runs in the page's **MAIN** world at
  `document_start` and patches `window.fetch`/`XMLHttpRequest` to capture the
  JSON responses of `/api/v1/search` as Seerr's own frontend fetches them,
  relaying each page via `postMessage` — no duplicate network call for
  search itself.
- **`src/content/panel.ts`** runs in the **ISOLATED** world and owns
  everything else:
  - Fetches `/api/v1/genres/{movie,tv}` and, on the person page,
    `/api/v1/person/{id}/combined_credits` directly (Seerr's own UI doesn't
    call the genre endpoint on these pages, and `combined_credits` is a
    single one-shot call either way).
  - Maps rendered cards to that data (`src/content/dom-map.ts`): Seerr's
    `TitleCard` only renders a real `<a href="/movie/{id}">` on hover or when
    a title has no poster, so most cards are matched by their poster
    image's TMDB filename instead (which encodes the same `posterPath` the
    API returns), with the type badge as a tiebreaker for a shared poster.
    Person cards always have a stable `<a href="/person/{id}">` and are
    matched directly.
  - Builds the toolbar in a Shadow DOM (`buildUi`), so it can't clash with
    Seerr's own Tailwind styles, and shows/hides cards to match the active
    filters.
  - Handles Seerr being a client-routed SPA: navigating to a title and back,
    or between two people's pages, never re-injects this script — the same
    long-lived instance keeps running under whatever URL is now current.
    `syncPageMode` (checked on every DOM mutation) detects that: it tears
    the toolbar down on an unrelated page, resets all state when the person
    id changes, and creates a fresh toolbar reading the same
    (correctly-persisted) filter state when navigating back to a page it
    already tracks.
  - Because Seerr's own infinite-scroll trigger reacts to the *unfiltered*
    DOM height, a narrow filter can leave the page shorter than the
    viewport with no more pages ever loading. `scheduleLoadMoreCheck`
    nudges scroll position periodically in that case (search page only) —
    a best-effort heuristic, not a guarantee.
- **`src/background.ts`** registers `inject-main.js`/`panel.js` as content
  scripts (matching `<origin>/search*` and `<origin>/person/*`) only for
  Seerr instance origins the user has explicitly added via the options
  page, instead of requesting broad host permissions up front.
- **`src/options/`** — settings page for adding/removing Seerr instance
  URLs; opens automatically on first install.

## Build

```bash
npm install
npm run build   # outputs dist/
# or: npm run watch
```

## Load into Chrome

1. Go to `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this project's `dist/` folder.
4. The options page opens automatically on install (or click the toolbar
   icon / right-click → Options any time) — add your Seerr instance's base
   URL, e.g. `https://seerr.example.com`. Chrome will prompt you to grant
   that site access; the extension only runs on its `/search` and
   `/person/*` pages.
5. Visit `<your-seerr-url>/search?query=...` or a person's page — the
   filter toolbar should appear above the results grid.

## Known limitations

- **Card-to-data matching** relies on poster image filenames and the type
  badge as a tiebreaker; two different titles sharing an identical poster
  image is a real but rare edge case where the wrong one could be picked.
- **Actor / Content rating** require the lazy per-title enrichment described
  above — on `/search` specifically, results outside the viewport won't be
  filtered by these two fields until scrolled into view.
- **Infinite-scroll nudging** (see above) is a heuristic; if you hit a case
  where results stop loading under a narrow filter, `scheduleLoadMoreCheck`
  in `panel.ts` is the first place to look.
- No extension icon is bundled; Chrome will show a generic default icon.

## Project layout

```
manifest.json
build.mjs                 # esbuild bundler (ESM for background/options, IIFE for content scripts)
src/
  types.ts                  # shapes mirroring Seerr's server/models/Search.ts + MediaStatus enum
  background.ts              # registers content scripts per configured instance origin
  options/options.{html,css,ts}  # add/remove Seerr instance URLs, requests host permission
  content/
    inject-main.ts            # MAIN world: captures /api/v1/search responses
    panel.ts                  # ISOLATED world: filter UI, SPA route tracking, DOM show/hide
    dom-map.ts                 # maps rendered cards -> {mediaType, id} via poster/href/person link
```
