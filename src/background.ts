// Service worker: registers the content scripts for each configured Seerr
// instance origin, so we only inject on domains the user has explicitly
// added (instead of requesting <all_urls> up front).

const REGISTERED_ID_PREFIX = 'seerr-search-filter';

interface StoredState {
  instanceOrigins: string[];
}

async function getStoredOrigins(): Promise<string[]> {
  const { instanceOrigins } = (await chrome.storage.sync.get('instanceOrigins')) as Partial<StoredState>;
  return instanceOrigins ?? [];
}

async function registerForOrigin(origin: string): Promise<void> {
  if (!/^https?:\/\//.test(origin)) {
    // Content scripts can only match http/https pages. Skip anything else
    // (e.g. a stale chrome-extension:// entry left over from an older build)
    // so registerContentScripts doesn't reject with "Invalid scheme".
    return;
  }

  const id = `${REGISTERED_ID_PREFIX}:${origin}`;
  const panelId = `${id}:panel`;

  // registerContentScripts rejects the entire call if *any* of the IDs is
  // already registered. We register two scripts per origin (id + `${id}:panel`),
  // so both must be cleared first — checking only `id` leaves the panel script
  // behind and the retry throws "Duplicate script ID '…:panel'".
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const stale = registered.filter((s) => s.id === id || s.id === panelId).map((s) => s.id);
  if (stale.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: stale });
  }

  // Search results (paginated) and a person's filmography page (a single
  // combined_credits call) — see detectPageMode in panel.ts.
  const matches = [`${origin}/search*`, `${origin}/person/*`];

  await chrome.scripting.registerContentScripts([
    {
      id,
      matches,
      js: ['content/inject-main.js'],
      world: 'MAIN',
      runAt: 'document_start',
    },
    {
      id: `${id}:panel`,
      matches,
      js: ['content/panel.js'],
      world: 'ISOLATED',
      runAt: 'document_idle',
    },
  ]);
}

async function unregisterForOrigin(origin: string): Promise<void> {
  const id = `${REGISTERED_ID_PREFIX}:${origin}`;
  await chrome.scripting.unregisterContentScripts({ ids: [id, `${id}:panel`] }).catch(() => {
    // no-op: scripts may not have been registered yet
  });
}

async function syncAllRegistrations(): Promise<void> {
  const stored = await getStoredOrigins();
  const origins = stored.filter((o) => /^https?:\/\//.test(o));
  if (origins.length !== stored.length) {
    // Drop entries that can never back a content script (bad scheme) so they
    // stop throwing on every service-worker startup.
    await chrome.storage.sync.set({ instanceOrigins: origins } satisfies StoredState);
  }

  const registered = await chrome.scripting.getRegisteredContentScripts();
  const staleIds = registered
    .map((s) => s.id)
    .filter((id) => id.startsWith(REGISTERED_ID_PREFIX) && !origins.some((o) => id.includes(o)));
  if (staleIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: staleIds });
  }
  for (const origin of origins) {
    // Isolate failures so one bad origin can't block the rest.
    try {
      await registerForOrigin(origin);
    } catch (err) {
      console.error(`[${REGISTERED_ID_PREFIX}] failed to register ${origin}:`, err);
    }
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  void syncAllRegistrations();
  if (details.reason === 'install') {
    void chrome.runtime.openOptionsPage();
  }
});
chrome.runtime.onStartup.addListener(() => {
  void syncAllRegistrations();
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

// Messages from options.ts after it adds/removes an instance URL.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'seerr-search-filter:add-origin') {
    registerForOrigin(message.origin)
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => sendResponse({ ok: false, error: errorMessage(err) }));
    return true;
  }
  if (message?.type === 'seerr-search-filter:remove-origin') {
    unregisterForOrigin(message.origin)
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => sendResponse({ ok: false, error: errorMessage(err) }));
    return true;
  }
  return false;
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
