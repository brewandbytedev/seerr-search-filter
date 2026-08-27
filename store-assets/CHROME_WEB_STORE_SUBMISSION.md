# Chrome Web Store — submission guide

Everything needed to submit **Seerr Search Filter** through the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/31dbe66c-7dae-43ab-972a-54fdcc75a0dc), as the **Brew and Byte Development** publisher. Field names/layout shift a little between dashboard versions — match by purpose, not exact label. Everything referenced below lives in this `store-assets/` folder unless noted.

## Before you start

Make sure you're signed into the **Brew and Byte Development** Google account in whichever browser you use for this — the dashboard link above is scoped to that publisher's account.

## 1. Package tab

Upload:
```
store-assets/seerr-search-filter-1.0.0.zip
```
(Built from `dist/` — see the main `README.md` if you need to rebuild it. Contains `manifest.json`, `background.js`, `content/`, `options/`, and `icons/`; no source maps.)

## 2. Store listing tab

**Product name**
```
Seerr Search Filter
```

**Summary** (max 132 characters — shown in search results)
```
Adds a filter toolbar (type, genre, year, score, language, rating, actor) to Seerr's search and person pages.
```

**Description**
```
Seerr Search Filter adds a filter toolbar directly onto your Seerr instance's
search results page and to any person's filmography page — filter by media
type, genre, year, minimum score, language, availability, content rating,
and cast, without leaving the page.

Seerr's own search only lets you type a query. This extension adds the
filtering Discover already has, everywhere search doesn't:

• Movies / TV toggle, genre, year range, minimum score, language, and
  availability — filtered instantly against data already on the page, no
  extra network requests.
• Content rating (G/PG/PG-13/R/NC-17, TV-Y through TV-MA) and actor name —
  filtered by fetching just the title details needed, lazily, only for
  results currently on screen (or, on a person's page, for their whole
  filmography at once, since that's a single bounded request).
• Works on a person's page too (e.g. an actor's filmography), filtering
  every section on the page from one toolbar.

Nothing is sent anywhere. The toolbar runs entirely in your browser against
your own Seerr instance, reading the same data Seerr's page already loaded.

Setup: open the extension's options page and add your Seerr instance's URL
(e.g. https://seerr.example.com). Chrome will ask you to confirm access to
that one site — the toolbar only activates on its /search and /person/*
pages.

This is an unofficial, community-made companion to Seerr and isn't
affiliated with the Seerr project.
```

**Category**
```
Productivity
```
(Alternative if unavailable: Tools / Workflow & Planning)

**Language**
```
English (United States)
```

**Icon** (128×128 PNG — also used at 512×512 for the listing itself)
```
icons/icon128.png
store-assets/icon512.png
```
Design: Seerr's own brand mark (pulled directly from the live instance's `logo_full.svg`, so it's pixel-accurate to the real logo) sits inside a magnifying-glass frame, with a small dark badge of filter sliders layered on top to distinguish this from a plain "search Seerr" icon — see `icons/icon.svg` for the source.

**Screenshots** (1280×800, PNG, no alpha channel — already sized correctly)
```
store-assets/screenshots/01-search-star-wars.png
store-assets/screenshots/02-person-mark-hamill.png
store-assets/screenshots/03-settings.png
```
1. Search results for "Star Wars" with the Movies filter active (44 / 79 shown) — the search-page toolbar in action.
2. Mark Hamill's filmography page with the Genre filter active (190 / 385 shown) — the person-page toolbar, showing his voice-acting/animation roles.
3. The settings page for adding a Seerr instance (shown with a placeholder URL, `192.168.1.42`, not a real address).

**Promotional images** (optional, only needed if you want the listing eligible to be featured)

Not included. Small tile is 440×280, marquee is 1400×560 — generate later if you want them.

## 3. Privacy practices tab

**Single purpose description**
```
Adds a client-side filter toolbar to the search results page and person
(filmography) pages of the user's own Seerr media-request instance, so
results can be narrowed by type, genre, year, score, language,
availability, content rating, and cast.
```

**Permission justifications**

- `storage`
  ```
  Stores the list of Seerr instance URLs the user adds on the options page,
  so the extension knows which sites to activate its content scripts on.
  Stored locally via chrome.storage.sync; never transmitted anywhere.
  ```
- `scripting`
  ```
  Used to register the toolbar's content scripts only on the specific Seerr
  instance origin(s) the user has explicitly added on the options page —
  instead of requesting access to every website up front.
  ```
- Host permission (requested per-origin at runtime via `optional_host_permissions`)
  ```
  The user's Seerr instance is self-hosted and can be any domain or local
  IP address they choose. Access is requested one origin at a time, only
  for the exact URL the user enters on the options page, via Chrome's
  permission prompt — never broadly.
  ```

**Are you using remote code?**
```
No — all JavaScript ships inside the extension package; nothing is loaded
or evaluated from a remote server.
```

**Data usage disclosures**

None of the listed data categories are collected or transmitted. The extension reads the current page's already-loaded content locally (to decide which result cards to show or hide) and reads/writes its own settings (the list of Seerr URLs) to `chrome.storage.sync` — nothing leaves the browser, nothing is sold, nothing is used for advertising or tracking.

**Privacy policy URL**

If the dashboard requires one (likely, since host permissions are requested), publish `store-assets/PRIVACY_POLICY.md` somewhere public and link it — the simplest option, since this repo is already on GitHub, is the raw file URL:
```
https://raw.githubusercontent.com/brewandbytedev/seerr-search-filter/main/store-assets/PRIVACY_POLICY.md
```
(Only works once the repo — or at least that file — is public. If you'd rather keep the repo private, host the same text anywhere else public, e.g. a GitHub Gist or a page on your own site.)

## 4. Distribution tab

**Visibility**: Unlisted (installable via direct link, not shown in Chrome Web Store search — recommended for a personal/niche tool; switch to Public if you want it discoverable)

**Pricing**: Free

**Regions**: All regions (default)

**Developer/publisher shown on listing**: Brew and Byte Development — footer of the extension's own options page links to https://github.com/brewandbytedev to match.

## After submitting

Chrome Web Store review for a new item is typically same-day to a few days. You'll get an email at the account's registered address either way (approved, or with specific rejection reasons to address).
