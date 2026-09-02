# Releasing

Publishing to the Chrome Web Store is automated. You never build or upload a
zip by hand.

## How it works

1. **You commit to `main`** using [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat: …`, `fix: …`, `chore: …`, `feat!: …` for a breaking change). PRs are
   squash-merged and the **PR title** must follow the same convention — the
   `Lint PR title` check enforces it.
2. **release-please** (`.github/workflows/release-please.yml`) watches `main` and
   keeps a single open PR titled `chore(main): release x.y.z`. That PR bumps the
   version in `package.json`, `package-lock.json` and `manifest.json`, and
   updates `CHANGELOG.md`. The version bump (patch/minor/major) is derived from
   the commit types since the last release.
3. **You merge the release PR.** release-please then creates the GitHub release
   and the `vx.y.z` tag.
4. Creating that tag triggers `publish-extension.yml`, which checks out the tag,
   runs `npm ci && npm run typecheck && npm run build && npm run package`, then
   uploads `extension.zip` to the Chrome Web Store and submits it for review
   (`chrome-webstore-upload-cli upload` + `publish`). The zip is also attached to
   the workflow run as an artifact.

Nothing reaches the store until the release PR is merged, so day-to-day commits
are safe.

## Other workflows

- `ci.yml` — typecheck + build on every PR and every push to `main`.
- `pr-title-lint.yml` — enforces a Conventional Commit PR title.

## Required repository secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret | What it is |
| --- | --- |
| `CHROME_EXTENSION_ID` | The extension's ID from the Developer Dashboard (the long string in its dashboard URL / store URL). |
| `CHROME_CLIENT_ID` | OAuth client ID (see below). |
| `CHROME_CLIENT_SECRET` | OAuth client secret. |
| `CHROME_REFRESH_TOKEN` | OAuth refresh token for the account that owns the listing. |
| `CHROME_PUBLISHER_ID` | Your publisher account ID (Developer Dashboard → ⚙ Account → "Publisher ID"). Required by `chrome-webstore-upload-cli` v4. |

### Getting the OAuth credentials

The Chrome Web Store Publish API uses a Google Cloud OAuth client
(`client ID` + `client secret`) plus a `refresh token` minted from it. Do this
as the Google account that owns the store listing.

#### 1. Project + API

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and pick an
   existing project or create one (**Select a project → New project**), e.g.
   `seerr-search-filter-publish`.
2. Enable the API: go to
   [Chrome Web Store API](https://console.cloud.google.com/apis/library/chromewebstore.googleapis.com),
   confirm the right project is selected in the top bar, and click **Enable**.

#### 2. OAuth consent screen

Only needed once per project. **APIs & Services → OAuth consent screen** (newer
consoles label this **Google Auth Platform**, split into *Branding* / *Audience*
/ *Clients*):

1. If prompted, choose user type **External** and **Create**.
2. Fill the required fields under *Branding* (app name, your email for both
   support and developer contact). No scopes or test users needed. Save.
3. Under *Audience*, set publishing status to **In production** ("Publish app" →
   confirm). If you leave it **Testing**, refresh tokens expire after 7 days and
   every release starts failing a week later. This scope needs no Google
   verification, so going to production is instant.

#### 3. OAuth client ID + secret

**APIs & Services → Credentials → Create credentials → OAuth client ID** (new
console: **Clients → Create client**):

1. Application type: **Desktop app**.
2. Name it (e.g. `web-store-publish-cli`) and click **Create**.
3. In the dialog, copy the **Client ID** and **Client secret** — or click
   **Download JSON**. These are the `CHROME_CLIENT_ID` / `CHROME_CLIENT_SECRET`
   secret values.

Regenerating credentials: to rotate a leaked secret, open the client and use
**Reset secret** (keeps the same client ID), or delete the client and create a
new one. Either way you must mint a fresh refresh token (step 4) and update the
GitHub secrets.

#### 4. Refresh token

With the client ID and secret from step 3, run the interactive helper
([`chrome-webstore-upload-keys`](https://github.com/fregante/chrome-webstore-upload-keys)):

```
npx chrome-webstore-upload-keys
```

Paste the client ID and secret when prompted, open the URL it prints, sign in as
the listing owner, approve the "unverified app" screen (**Advanced → Go to …**),
and paste the resulting code back. It prints the **refresh token** —
that's `CHROME_REFRESH_TOKEN`.

#### 5. Save the secrets

Put the five values in **Settings → Secrets and variables → Actions**:
`CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`,
`CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`.

The CLI has no dry-run. To verify the credentials before trusting a release, do
one real local upload of a draft (see [Manual publish](#manual-publish-fallback)
below) — `upload` without `publish` just stages the zip in the dashboard without
pushing it live.

### Doing it from Google Cloud Shell

Cloud Shell has `gcloud`, `gh`, `node`/`npm` and `python3` preinstalled. Only the
consent screen and the OAuth client itself must be created in the browser console
— there is no `gcloud` command for either.

**1. Project + API (Cloud Shell):**

```bash
gcloud projects create seerr-swf-publish --name="Seerr Search Filter Publish"   # or reuse one
gcloud config set project seerr-swf-publish
gcloud services enable chromewebstore.googleapis.com
```

**2. Consent screen + client (browser console, ~2 min):** do steps 2 and 3 above
— set publishing status to **In production**, create a **Desktop app** client,
copy its ID and secret.

**3. Refresh token (Cloud Shell):**

```bash
CLIENT_ID='xxxxx.apps.googleusercontent.com'
CLIENT_SECRET='xxxxx'
REDIRECT='http://localhost'

python3 - <<EOF
import urllib.parse
print("https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
  "client_id": "$CLIENT_ID", "redirect_uri": "$REDIRECT", "response_type": "code",
  "scope": "https://www.googleapis.com/auth/chromewebstore",
  "access_type": "offline", "prompt": "consent",
}))
EOF
```

Open that URL in your **laptop** browser, approve it (**Advanced → Go to …** on
the unverified-app screen). The browser redirects to
`http://localhost/?code=4/0A...&...` and shows a connection error — that's
expected; copy the `code` value out of the address bar.

```bash
AUTH_CODE='4/0A...'   # paste it here

curl -s https://oauth2.googleapis.com/token \
  --data-urlencode client_id="$CLIENT_ID" \
  --data-urlencode client_secret="$CLIENT_SECRET" \
  --data-urlencode code="$AUTH_CODE" \
  --data-urlencode grant_type=authorization_code \
  --data-urlencode redirect_uri="$REDIRECT" | python3 -m json.tool
```

Copy `refresh_token` from the JSON.

**4. Push the secrets (Cloud Shell):**

```bash
gh auth login        # once, if gh isn't already authenticated
REPO=brewandbytedev/seerr-search-filter
gh secret set CHROME_CLIENT_ID     --repo "$REPO" --body "$CLIENT_ID"
gh secret set CHROME_CLIENT_SECRET --repo "$REPO" --body "$CLIENT_SECRET"
gh secret set CHROME_REFRESH_TOKEN --repo "$REPO" --body "<refresh_token>"
gh secret set CHROME_EXTENSION_ID  --repo "$REPO" --body "<extension id>"
gh secret set CHROME_PUBLISHER_ID  --repo "$REPO" --body "<publisher id>"
```

**5. Verify (Cloud Shell):**

```bash
git clone https://github.com/$REPO && cd seerr-search-filter
npm ci && npm run build && npm run package
EXTENSION_ID=<id> CLIENT_ID=$CLIENT_ID CLIENT_SECRET=$CLIENT_SECRET \
  REFRESH_TOKEN=<refresh_token> PUBLISHER_ID=<publisher id> \
  npx --yes chrome-webstore-upload-cli@4.0.1 upload --source extension.zip
```

A successful `upload` (no `publish`) stages a draft in the dashboard without
pushing it live — proof the credentials work.

## Manual publish (fallback)

If you ever need to publish without cutting a release, run the
`Publish extension to Chrome Web Store` workflow's steps locally: `npm run build`,
`npm run package`, then `npx chrome-webstore-upload-cli@4.0.1 upload --source extension.zip`
with the five env vars set. Bump `manifest.json`'s version first — the store
rejects an upload whose version isn't higher than the published one.
