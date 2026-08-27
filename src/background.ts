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
  const id = `${REGISTERED_ID_PREFIX}:${origin}`;
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
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
  const origins = await getStoredOrigins();
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const staleIds = registered
    .map((s) => s.id)
    .filter((id) => id.startsWith(REGISTERED_ID_PREFIX) && !origins.some((o) => id.includes(o)));
  if (staleIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: staleIds });
  }
  for (const origin of origins) {
    await registerForOrigin(origin);
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
    void registerForOrigin(message.origin).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'seerr-search-filter:remove-origin') {
    void unregisterForOrigin(message.origin).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
