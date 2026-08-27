# Privacy Policy — Seerr Search Filter

**Last updated: 2026-08-26**

Seerr Search Filter is a browser extension that adds a filter toolbar to the search and person pages of a Seerr instance you configure.

## What this extension does

- Reads the content already loaded on your Seerr instance's `/search` and `/person/*` pages, entirely within your browser, to decide which result cards to show or hide based on the filters you choose.
- Fetches a small amount of additional data directly from your own Seerr instance (genre names, and per-title cast/content-rating details) only when needed to support a filter you've turned on.
- Stores the list of Seerr instance URLs you add on the extension's options page, using Chrome's built-in `chrome.storage.sync`, so the toolbar knows which sites to run on.

## What this extension does not do

- It does not collect, transmit, sell, or share any of your data with the developer or any third party.
- It does not use analytics, tracking, or advertising of any kind.
- It does not send anything to a server other than your own Seerr instance (the one you explicitly configure).
- It does not use remote code — everything it runs ships inside the extension package.

## Permissions

- **storage** — to remember the Seerr URLs you've added, locally in your browser.
- **scripting** — to run the toolbar only on the specific Seerr instance(s) you've added, not on other websites.
- **Host access** (requested per-site, only when you add that site) — so the toolbar can run on your Seerr instance.

## Contact

Questions about this extension can be raised via its GitHub repository.
