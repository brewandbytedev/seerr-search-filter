// Runs in the MAIN world (document_start) so it can patch window.fetch
// before Seerr's own app code issues its first request. Captures the JSON
// bodies of /api/v1/search responses Seerr's own UI already fetches, and
// relays them to the isolated-world panel script via postMessage — no
// extra network call for search itself.
//
// (Genre names are NOT fetched by Seerr's search page at all — the panel
// script fetches /api/v1/genres/{movie,tv} directly and once, since there's
// nothing to intercept here.)

import { BRIDGE_MESSAGE_SOURCE, type BridgeMessage } from '../types';

function post(message: BridgeMessage): void {
  window.postMessage(message, window.location.origin);
}

async function inspectSearchResponse(url: string, response: Response): Promise<void> {
  if (!response.ok || !url.includes('/api/v1/search')) return;
  try {
    const payload = await response.clone().json();
    post({ source: BRIDGE_MESSAGE_SOURCE, kind: 'search', payload });
  } catch {
    // non-JSON or unexpected shape; ignore
  }
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const response = await originalFetch(...args);
  const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url ?? String(args[0]);
  void inspectSearchResponse(url, response);
  return response;
};

// Fallback in case Seerr ever issues this via XHR instead of fetch.
const originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function patchedOpen(
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  const href = typeof url === 'string' ? url : url.toString();
  if (href.includes('/api/v1/search')) {
    this.addEventListener('load', () => {
      try {
        const payload = JSON.parse(this.responseText);
        post({ source: BRIDGE_MESSAGE_SOURCE, kind: 'search', payload });
      } catch {
        // ignore
      }
    });
  }
  // @ts-expect-error - spreading through to the native signature
  return originalOpen.call(this, method, url, ...rest);
};
