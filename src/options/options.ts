interface StoredState {
  instanceOrigins: string[];
}

const form = document.getElementById('add-form') as HTMLFormElement;
const input = document.getElementById('origin-input') as HTMLInputElement;
const list = document.getElementById('origin-list') as HTMLUListElement;
const statusEl = document.getElementById('status-msg') as HTMLParagraphElement;
const addBtn = document.getElementById('add-btn') as HTMLButtonElement;
const versionEl = document.getElementById('ext-version') as HTMLSpanElement;

versionEl.textContent = chrome.runtime.getManifest().version;

function showStatus(kind: 'success' | 'error' | 'info', message: string): void {
  statusEl.textContent = message;
  statusEl.className = `status visible ${kind}`;
}

function normalizeOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function getOrigins(): Promise<string[]> {
  const { instanceOrigins } = (await chrome.storage.sync.get('instanceOrigins')) as Partial<StoredState>;
  return instanceOrigins ?? [];
}

async function setOrigins(origins: string[]): Promise<void> {
  await chrome.storage.sync.set({ instanceOrigins: origins } satisfies StoredState);
}

function render(origins: string[]): void {
  list.innerHTML = '';
  for (const origin of origins) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'origin-url';
    span.textContent = origin;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => void removeOrigin(origin));
    li.append(span, removeBtn);
    list.append(li);
  }
}

async function addOrigin(origin: string): Promise<void> {
  addBtn.disabled = true;
  showStatus('info', 'Requesting permission…');
  try {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      showStatus('error', 'Permission was not granted, so the filter toolbar cannot run on that site.');
      return;
    }
    const origins = await getOrigins();
    if (!origins.includes(origin)) {
      origins.push(origin);
      await setOrigins(origins);
    }
    const res = (await chrome.runtime.sendMessage({
      type: 'seerr-search-filter:add-origin',
      origin,
    })) as { ok: boolean; error?: string } | undefined;
    if (!res?.ok) {
      throw new Error(res?.error ?? 'The background script could not register the filter for that site.');
    }
    render(origins);
    showStatus('success', `Added ${origin}.`);
  } catch (err) {
    showStatus('error', `Could not add ${origin}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    addBtn.disabled = false;
  }
}

async function removeOrigin(origin: string): Promise<void> {
  const origins = (await getOrigins()).filter((o) => o !== origin);
  await setOrigins(origins);
  await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => {
    // permission may be shared/already revoked; ignore
  });
  await chrome.runtime.sendMessage({ type: 'seerr-search-filter:remove-origin', origin });
  render(origins);
  showStatus('info', `Removed ${origin}.`);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const origin = normalizeOrigin(input.value.trim());
  if (!origin) {
    showStatus('error', 'Enter a valid http(s) URL, e.g. http://192.168.1.10:5055');
    return;
  }
  input.value = '';
  void addOrigin(origin);
});

void getOrigins().then(render);
