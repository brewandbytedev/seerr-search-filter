# Chrome Web Store — submission field values

Everything needed to fill out the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) listing for **Seerr Search Filter**. Field names/layout shift a little between dashboard versions — match by purpose, not exact label.

## Package

Upload `seerr-search-filter-1.0.0.zip` (built from `dist/`, see main `README.md`).

## Store listing

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

**Icon** (128×128 PNG)
```
icons/icon128.png
```

## Screenshots

1280×800 or 640×400 PNG/JPEG, up to 5, no alpha channel. See `store-assets/screenshots/`:

1. `01-search-star-wars.png` — search results for "Star Wars" with the Movies filter active (30 / 60 shown).
2. `02-person-mark-hamill.png` — Mark Hamill's filmography page with the toolbar filtering both Appearances and Crew.
3. `03-settings.png` — the options page for adding a Seerr instance.

## Promotional images (optional)

Not included — add later if you want the listing featured. Small tile is 440×280, marquee is 1400×560.

## Privacy practices tab

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

**Data usage**

None of the listed data categories are collected or transmitted. The extension reads the current page's already-loaded content locally (to decide which result cards to show or hide) and reads/writes its own settings (the list of Seerr URLs) to `chrome.storage.sync` — nothing leaves the browser, and nothing is sold or used for advertising.

If the dashboard requires a hosted privacy policy URL, publish `store-assets/PRIVACY_POLICY.md` (plain text is fine) somewhere public — e.g. raw.githubusercontent.com — and link it here.

## Distribution tab

**Visibility**: Unlisted (installable via direct link, not shown in Chrome Web Store search — recommended for a personal/niche tool; switch to Public if you want it discoverable)

**Pricing**: Free

**Regions**: All regions (default)
