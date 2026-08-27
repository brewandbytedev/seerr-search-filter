import type { MediaType } from '../types';

// Seerr's TitleCard only renders its <a href="/movie/{id}"> (etc) overlay
// link when there's no poster image, or on hover/focus (see the `show={!image
// || showDetail || showRequestModal}` Transition in TitleCard/index.tsx) —
// most cards, most of the time, have NO href in the DOM at all. The one
// element that's always present is `div[data-testid="title-card"]`, so that
// (not an href-based ancestor walk) is what we track and hide.
//
// To identify *which* result a poster-having card is, without an href, we
// match its <img> src (which points at TMDB's poster CDN and encodes the
// same posterPath the search API returns) against the loaded result data.
// Person cards are simpler: PersonCard always renders a real
// <a href="/person/{id}"> with no conditional Transition.

export const TITLE_CARD_SELECTOR = '[data-testid="title-card"]';
export const PERSON_CARD_SELECTOR = 'a[href^="/person/"]';

const HREF_ID_PATTERN = /^\/(movie|tv|collection)\/(\d+)/;
const BADGE_LABELS: Record<string, MediaType> = {
  Movie: 'movie',
  Series: 'tv',
  Collection: 'collection',
};

export interface HrefId {
  mediaType: MediaType;
  id: number;
}

export function extractHrefId(el: Element): HrefId | null {
  const anchor = el.matches('a[href]') ? el : el.querySelector('a[href^="/movie/"], a[href^="/tv/"], a[href^="/collection/"]');
  if (!anchor) return null;
  const match = HREF_ID_PATTERN.exec(anchor.getAttribute('href') ?? '');
  if (!match) return null;
  return { mediaType: match[1] as MediaType, id: Number(match[2]) };
}

export function extractPersonId(anchor: Element): number | null {
  const href = anchor.getAttribute('href') ?? '';
  const match = /^\/person\/(\d+)/.exec(href);
  return match ? Number(match[1]) : null;
}

// Returns just the filename portion of a TMDB poster URL
// (".../w300_and_h450_face/tTWRomgIMOoIB3CJLPlVbqSawEm.jpg" -> the API's
// posterPath is "/tTWRomgIMOoIB3CJLPlVbqSawEm.jpg", so we compare on the
// filename only, ignoring the size/host portion of the URL).
export function extractPosterFile(el: Element): string | null {
  const img = el.querySelector('img');
  const src = img?.getAttribute('src') ?? '';
  if (!src.includes('image.tmdb.org')) return null;
  const match = /\/([^/]+)$/.exec(src.split('?')[0]);
  return match ? match[1] : null;
}

// The type badge ("Movie" / "Series" / "Collection") sits outside the
// conditional Transition, so it's always present — used only as a
// tiebreaker when two different results happen to share a poster image.
export function extractBadgeMediaType(el: Element): MediaType | null {
  const candidates = el.querySelectorAll('div');
  for (const div of candidates) {
    if (div.children.length > 0) continue;
    const text = div.textContent?.trim() ?? '';
    const mapped = BADGE_LABELS[text];
    if (mapped) return mapped;
  }
  return null;
}
