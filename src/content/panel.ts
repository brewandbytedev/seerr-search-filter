// Runs in the ISOLATED world. Listens for search data relayed by
// inject-main.ts (MAIN world), watches the DOM for rendered result cards,
// and renders a filter panel that shows/hides cards in place — no
// re-fetching, no interference with Seerr's own React tree.

import {
  TITLE_CARD_SELECTOR,
  PERSON_CARD_SELECTOR,
  extractHrefId,
  extractPersonId,
  extractPosterFile,
  extractBadgeMediaType,
} from './dom-map';
import {
  BRIDGE_MESSAGE_SOURCE,
  MediaStatus,
  resultKey,
  yearOf,
  type BridgeMessage,
  type MediaType,
  type PersonCreditsResponse,
  type SearchApiResponse,
  type SearchResult,
  type TmdbGenre,
} from '../types';

// Fixed, not derived from loaded results — unlike genre/language, we don't
// know a card's certification until we've fetched its detail endpoint, so
// there's nothing to build this list from until enrichment has happened.
const CERTIFICATIONS = ['G', 'PG', 'PG-13', 'R', 'NC-17', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA', 'Unrated'];

// Two pages this extension runs on: search results (paginated, data arrives
// via the intercepted /api/v1/search fetches) and a person's filmography
// (a single, non-paginated /api/v1/person/{id}/combined_credits call that
// this script fetches directly). The person page already has its own
// Movie/TV filter per filmography section, so the toolbar skips that chip
// group there — see buildUi.
type PageMode = { kind: 'search' } | { kind: 'person'; personId: number };

function detectPageMode(): PageMode | null {
  if (window.location.pathname.startsWith('/search')) return { kind: 'search' };
  const match = /^\/person\/(\d+)/.exec(window.location.pathname);
  if (match) return { kind: 'person', personId: Number(match[1]) };
  return null;
}

interface Filters {
  mediaTypes: Set<MediaType>;
  genres: Set<number>;
  yearMin: number | null;
  yearMax: number | null;
  scoreMin: number;
  languages: Set<string>;
  statuses: Set<MediaStatus>;
  actorQuery: string;
  certifications: Set<string>;
}

function defaultFilters(): Filters {
  return {
    mediaTypes: new Set(),
    genres: new Set(),
    yearMin: null,
    yearMax: null,
    scoreMin: 0,
    languages: new Set(),
    statuses: new Set(),
    actorQuery: '',
    certifications: new Set(),
  };
}

function isDefault(f: Filters): boolean {
  return (
    f.mediaTypes.size === 0 &&
    f.genres.size === 0 &&
    f.yearMin === null &&
    f.yearMax === null &&
    f.scoreMin === 0 &&
    f.languages.size === 0 &&
    f.statuses.size === 0 &&
    f.actorQuery.trim() === '' &&
    f.certifications.size === 0
  );
}

// True when the active filters need per-title detail data (cast and/or
// certification) that isn't in the search results themselves.
function needsDetailData(f: Filters): boolean {
  return f.actorQuery.trim() !== '' || f.certifications.size > 0;
}

const STATUS_LABELS: Record<MediaStatus, string> = {
  [MediaStatus.UNKNOWN]: 'Unknown',
  [MediaStatus.PENDING]: 'Pending',
  [MediaStatus.PROCESSING]: 'Processing',
  [MediaStatus.PARTIALLY_AVAILABLE]: 'Partially available',
  [MediaStatus.AVAILABLE]: 'Available',
  [MediaStatus.BLOCKLISTED]: 'Blocklisted',
  [MediaStatus.DELETED]: 'Deleted',
};

const FILTER_ID_ATTR = 'filterId';
const FILTER_UNRESOLVED_ATTR = 'filterUnresolved';

interface DetailInfo {
  cast: string[];
  certification: string;
}

function extractCertification(mediaType: MediaType, detail: Record<string, unknown>): string {
  if (mediaType === 'movie') {
    const releases = detail.releases as { results?: { iso_3166_1: string; release_dates: { certification: string }[] }[] } | undefined;
    const us = releases?.results?.find((r) => r.iso_3166_1 === 'US');
    const cert = us?.release_dates.map((d) => d.certification).find((c) => c);
    return cert || 'Unrated';
  }
  if (mediaType === 'tv') {
    const contentRatings = detail.contentRatings as { results?: { iso_3166_1: string; rating: string }[] } | undefined;
    const us = contentRatings?.results?.find((r) => r.iso_3166_1 === 'US');
    return us?.rating || 'Unrated';
  }
  return 'Unrated';
}

class FilterEngine {
  resultsById = new Map<string, SearchResult>();
  genresById = new Map<number, string>();
  detailCache = new Map<string, DetailInfo | 'loading' | 'unavailable'>();
  filters = defaultFilters();
  private posterIndex = new Map<string, SearchResult[]>();
  private cardObserver: MutationObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private fetchQueue: { element: HTMLElement; mediaType: MediaType; id: number }[] = [];
  private activeFetches = 0;
  private readonly MAX_CONCURRENT_FETCHES = 4;
  // A single toolbar, shown above the first results grid on the page — on
  // the person page that's above "Appearances", and it filters both that
  // and "Crew" below, since filtering itself already runs page-wide
  // regardless of how many toolbars exist. Kept as an array (0 or 1 items)
  // because ensureToolbarInserted rebuilds it fresh across SPA route
  // changes — see syncPageMode.
  private uis: ReturnType<typeof buildUi>[] = [];
  private mounted = false;
  private loadMoreTimer: number | null = null;
  private scanTimer: number | null = null;

  // Not readonly: Seerr is a client-routed SPA, so navigating to a title
  // and back (or between two people's pages) never re-injects this script —
  // the same long-lived instance keeps running under whatever URL the user
  // is now on. See syncPageMode, which keeps this in step with reality.
  constructor(public pageMode: PageMode) {}

  async loadGenres(): Promise<void> {
    for (const mediaType of ['movie', 'tv'] as const) {
      try {
        const res = await fetch(`${window.location.origin}/api/v1/genres/${mediaType}`, {
          credentials: 'same-origin',
        });
        if (!res.ok) continue;
        const genres = (await res.json()) as TmdbGenre[];
        for (const genre of genres) this.genresById.set(genre.id, genre.name);
      } catch {
        // Genre names are a nice-to-have; fall back to numeric ids on failure.
      }
    }
    this.uis.forEach((ui) => ui.refreshFacetOptions(this));
  }

  ingestSearch(payload: SearchApiResponse): void {
    for (const item of payload.results ?? []) {
      this.resultsById.set(resultKey(item.mediaType, item.id), item);
    }
    this.rebuildPosterIndex();
    this.uis.forEach((ui) => ui.refreshFacetOptions(this));
    this.tagAndTrackCards();
  }

  // Person filmography page: one non-paginated call covering both grids
  // (acting "Appearances" and crew "Production" sections both render from
  // the same combined_credits response) — fetched directly rather than
  // intercepted, since it's a single one-time call either way.
  async loadPersonCredits(personId: number): Promise<void> {
    try {
      const res = await fetch(`${window.location.origin}/api/v1/person/${personId}/combined_credits`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const payload = (await res.json()) as PersonCreditsResponse;
      for (const item of [...(payload.cast ?? []), ...(payload.crew ?? [])]) {
        this.resultsById.set(resultKey(item.mediaType, item.id), item);
      }
      this.rebuildPosterIndex();
      this.uis.forEach((ui) => ui.refreshFacetOptions(this));
      this.tagAndTrackCards();
    } catch {
      // If this fails, cards simply stay unresolved/visible — fail open.
    }
  }

  private rebuildPosterIndex(): void {
    this.posterIndex.clear();
    for (const item of this.resultsById.values()) {
      const posterPath = item.posterPath;
      if (!posterPath) continue;
      const file = posterPath.split('/').pop();
      if (!file) continue;
      const list = this.posterIndex.get(file) ?? [];
      list.push(item);
      this.posterIndex.set(file, list);
    }
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    void this.loadGenres();
    if (this.pageMode.kind === 'person') void this.loadPersonCredits(this.pageMode.personId);
    this.startObservingCards();
    window.addEventListener('scroll', () => this.scheduleVisibleScan(), { passive: true });
  }

  // A single toolbar is inserted right above the first results grid on the
  // page, and filters every grid on the page (tagAndTrackCards/applyFilters
  // already operate across the whole document, not per-grid). Re-run on
  // every DOM mutation so the toolbar reappears (as a fresh instance) if
  // Seerr's own re-render ever swaps out that grid element, e.g. navigating
  // to a title and back.
  private ensureToolbarsInserted(): void {
    this.uis = this.uis.filter((ui) => ui.host.isConnected);
    if (this.uis.length > 0) return;
    const grid = document.querySelector<HTMLElement>('ul.cards-vertical');
    if (!grid?.parentElement) return;
    const ui = buildUi(this);
    this.uis.push(ui);
    grid.parentElement.insertBefore(ui.host, grid);
    // The toolbar is built and laid out correctly from the start, but on a
    // still-settling page (fonts/images/layout not finished) it can paint
    // for a moment before that settles, visibly wrapping oddly before
    // snapping into place. ui.host starts hidden (see buildUi) — reveal it
    // once, shortly after insertion, so it only ever paints in its final,
    // stable layout.
    window.setTimeout(() => ui.reveal(), 350);
  }

  private startObservingCards(): void {
    this.tagAndTrackCards();
    this.cardObserver = new MutationObserver(() => this.tagAndTrackCards());
    this.cardObserver.observe(document.body, { childList: true, subtree: true });

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const key = el.dataset[FILTER_ID_ATTR];
          if (key) this.maybeEnqueueDetailFetch(el, key);
        }
      },
      { rootMargin: '200px' },
    );
  }

  // Seerr client-routes between pages without a full navigation, so this
  // script keeps running as the user browses to a title and back, or from
  // one person's page to another's. Called on every DOM mutation (i.e.
  // every route change too) to notice when that's happened:
  //  - navigated to a page we don't handle (e.g. /movie/{id}): tear the
  //    toolbar(s) down and stop touching the page entirely, so they don't
  //    linger on an unrelated page showing stale state.
  //  - navigated to a *different* person's page: reset all engine state
  //    (results, filters, toolbars) and re-fetch that person's credits,
  //    same as a fresh page load would.
  //  - navigated back to the page this engine is already tracking: no-op —
  //    tagAndTrackCards proceeds normally and ensureToolbarsInserted
  //    creates a fresh toolbar instance above whatever grid React just
  //    re-rendered, still reading the (unchanged, correctly persisted)
  //    filter state.
  // Returns false when the page isn't one we should be acting on.
  private syncPageMode(): boolean {
    const current = detectPageMode();
    if (!current) {
      this.teardownToolbars();
      return false;
    }
    const samePerson = current.kind === 'person' && this.pageMode.kind === 'person' && current.personId === this.pageMode.personId;
    const sameKind = current.kind === this.pageMode.kind;
    if (sameKind && (current.kind !== 'person' || samePerson)) return true;

    this.teardownToolbars();
    this.pageMode = current;
    this.resultsById.clear();
    this.posterIndex.clear();
    this.detailCache.clear();
    this.filters = defaultFilters();
    if (current.kind === 'person') void this.loadPersonCredits(current.personId);
    return true;
  }

  private teardownToolbars(): void {
    this.uis.forEach((ui) => ui.host.remove());
    this.uis = [];
  }

  // Resolves each rendered card to a data key where possible, tags it, and
  // (re-)applies the current filters. Cards that can't be resolved yet
  // (poster still loading, or no poster and href not yet mounted) are left
  // untagged and retried on the next DOM mutation.
  private tagAndTrackCards(): void {
    if (!this.syncPageMode()) return;
    let resolvedAny = false;

    document.querySelectorAll<HTMLElement>(TITLE_CARD_SELECTOR).forEach((el) => {
      if (el.dataset[FILTER_ID_ATTR]) return;

      const direct = extractHrefId(el);
      if (direct) {
        this.tag(el, resultKey(direct.mediaType, direct.id));
        resolvedAny = true;
        return;
      }

      const posterFile = extractPosterFile(el);
      if (!posterFile) {
        el.dataset[FILTER_UNRESOLVED_ATTR] = 'true';
        return;
      }
      const candidates = this.posterIndex.get(posterFile);
      if (!candidates || candidates.length === 0) {
        el.dataset[FILTER_UNRESOLVED_ATTR] = 'true';
        return;
      }
      // Not destructive: on the person page, the same title can render as
      // its own card in both the "Appearances" and "Production" grids, so
      // more than one DOM card legitimately resolves to the same result.
      let item = candidates[0];
      if (candidates.length > 1) {
        const badgeType = extractBadgeMediaType(el);
        const match = badgeType ? candidates.find((c) => c.mediaType === badgeType) : undefined;
        if (match) item = match;
      }
      this.tag(el, resultKey(item.mediaType, item.id));
      resolvedAny = true;
    });

    document.querySelectorAll<HTMLAnchorElement>(PERSON_CARD_SELECTOR).forEach((anchor) => {
      if (anchor.dataset[FILTER_ID_ATTR]) return;
      const id = extractPersonId(anchor);
      if (id === null) return;
      this.tag(anchor, resultKey('person', id));
      resolvedAny = true;
    });

    this.ensureToolbarsInserted();
    if (resolvedAny) this.applyFilters();
    this.scheduleLoadMoreCheck();
    if (needsDetailData(this.filters)) this.scheduleVisibleScan();
  }

  private tag(el: HTMLElement, key: string): void {
    el.dataset[FILTER_ID_ATTR] = key;
    delete el.dataset[FILTER_UNRESOLVED_ATTR];
    this.intersectionObserver?.observe(el);
    this.applyCardVisibility(el, key);
  }

  // IntersectionObserver only fires on enter/exit transitions, so it won't
  // tell us about cards that are already sitting in the viewport at the
  // moment a detail-requiring filter (actor / certification) is switched
  // on. This does a one-off manual sweep to catch those, in addition to the
  // IntersectionObserver picking up anything scrolled into view afterward.
  //
  // On the person page this sweeps the *entire* filmography (Appearances +
  // Crew), not just what's on screen: unlike search, it's a single bounded
  // combined_credits response (rarely more than a couple hundred titles),
  // so eagerly enriching everything keeps the whole page consistently
  // filtered instead of the Crew section (usually below the fold) silently
  // staying unfiltered until scrolled to. Search stays viewport-only since
  // it grows unbounded via infinite scroll.
  private scheduleVisibleScan(): void {
    if (this.scanTimer !== null) return;
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null;
      if (!needsDetailData(this.filters)) return;
      const scanEverything = this.pageMode.kind === 'person';
      const margin = 200;
      document.querySelectorAll<HTMLElement>(`[data-${toDatasetAttr(FILTER_ID_ATTR)}]`).forEach((el) => {
        const key = el.dataset[FILTER_ID_ATTR];
        if (!key) return;
        if (scanEverything) {
          this.maybeEnqueueDetailFetch(el, key);
          return;
        }
        const rect = el.getBoundingClientRect();
        const inView = rect.bottom > -margin && rect.top < window.innerHeight + margin;
        if (inView) this.maybeEnqueueDetailFetch(el, key);
      });
    }, 150);
  }

  private maybeEnqueueDetailFetch(el: HTMLElement, key: string): void {
    if (!needsDetailData(this.filters)) return;
    if (this.detailCache.get(key) !== undefined) return;
    const [mediaType, idStr] = key.split(':');
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      this.detailCache.set(key, 'unavailable');
      return;
    }
    this.detailCache.set(key, 'loading');
    el.classList.add('ssf-loading');
    this.fetchQueue.push({ element: el, mediaType: mediaType as MediaType, id: Number(idStr) });
    this.drainFetchQueue();
  }

  private drainFetchQueue(): void {
    while (this.activeFetches < this.MAX_CONCURRENT_FETCHES && this.fetchQueue.length > 0) {
      const next = this.fetchQueue.shift();
      if (!next) break;
      this.activeFetches++;
      void this.fetchDetail(next).finally(() => {
        this.activeFetches--;
        this.drainFetchQueue();
      });
    }
  }

  private async fetchDetail(ref: { element: HTMLElement; mediaType: MediaType; id: number }): Promise<void> {
    const key = resultKey(ref.mediaType, ref.id);
    try {
      const res = await fetch(`${window.location.origin}/api/v1/${ref.mediaType}/${ref.id}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        this.detailCache.set(key, 'unavailable');
      } else {
        const detail = (await res.json()) as Record<string, unknown> & { credits?: { cast?: { name: string }[] } };
        const cast = (detail.credits?.cast ?? []).map((c) => c.name);
        const certification = extractCertification(ref.mediaType, detail);
        this.detailCache.set(key, { cast, certification });
      }
    } catch {
      this.detailCache.set(key, 'unavailable');
    }
    ref.element.classList.remove('ssf-loading');
    // Full applyFilters (not just this one card's visibility) so the "N /
    // M shown" count stays accurate as each async detail fetch resolves —
    // otherwise it's frozen at whatever it read when the filter was first
    // applied, before any detail data existed.
    this.applyFilters();
  }

  private matches(item: SearchResult, key: string): boolean {
    const f = this.filters;
    if (f.mediaTypes.size > 0 && !f.mediaTypes.has(item.mediaType)) return false;
    if (f.genres.size > 0) {
      const has = (item.genreIds ?? []).some((g) => f.genres.has(g));
      if (!has) return false;
    }
    if (f.yearMin !== null || f.yearMax !== null) {
      const year = yearOf(item);
      if (year === undefined) return false;
      if (f.yearMin !== null && year < f.yearMin) return false;
      if (f.yearMax !== null && year > f.yearMax) return false;
    }
    if (f.scoreMin > 0 && (item.voteAverage ?? 0) < f.scoreMin) return false;
    if (f.languages.size > 0) {
      if (!item.originalLanguage || !f.languages.has(item.originalLanguage)) return false;
    }
    if (f.statuses.size > 0) {
      const status = item.mediaInfo?.status ?? MediaStatus.UNKNOWN;
      if (!f.statuses.has(status)) return false;
    }
    if (f.actorQuery.trim() !== '') {
      const cached = this.detailCache.get(key);
      if (cached === undefined || cached === 'loading') return true; // pass through while resolving
      if (cached === 'unavailable') return false;
      const q = f.actorQuery.trim().toLowerCase();
      if (!cached.cast.some((name) => name.toLowerCase().includes(q))) return false;
    }
    if (f.certifications.size > 0) {
      const cached = this.detailCache.get(key);
      if (cached === undefined || cached === 'loading') return true; // pass through while resolving
      if (cached === 'unavailable') return false;
      if (!f.certifications.has(cached.certification)) return false;
    }
    return true;
  }

  // Hides the enclosing <li> (not just the inner card element) so the
  // results grid reflows and closes the gap, instead of leaving a blank
  // cell where a filtered-out card used to be. Returns whether the card
  // ended up visible, since that's what the (differently-targeted) inline
  // style ends up living on.
  private applyCardVisibility(el: HTMLElement, key: string): boolean {
    const target = (el.closest('li') as HTMLElement | null) ?? el;
    const item = this.resultsById.get(key);
    if (!item) {
      target.style.removeProperty('display');
      return true;
    }
    const visible = this.matches(item, key);
    target.style.display = visible ? '' : 'none';
    return visible;
  }

  applyFilters(): void {
    const cards = document.querySelectorAll<HTMLElement>(`[data-${toDatasetAttr(FILTER_ID_ATTR)}]`);
    let shown = 0;
    const unresolved = document.querySelectorAll(`[data-${toDatasetAttr(FILTER_UNRESOLVED_ATTR)}]`).length;
    cards.forEach((el) => {
      const key = el.dataset[FILTER_ID_ATTR]!;
      if (this.applyCardVisibility(el, key)) shown++;
    });
    this.uis.forEach((ui) => ui.updateCount(shown, cards.length, unresolved));
    this.scheduleLoadMoreCheck();
    if (needsDetailData(this.filters)) this.scheduleVisibleScan();
  }

  // Seerr's own infinite-scroll trigger reacts to the unfiltered DOM's
  // scroll position. When our filtering hides most cards, the page can end
  // up shorter than the viewport with no scroll event ever firing, so more
  // pages never load. Best-effort mitigation: while filters are active and
  // the page doesn't fill the viewport, nudge scroll position periodically
  // so any scroll- or IntersectionObserver-based loader gets a chance to
  // fire. This is a heuristic, not a guarantee.
  private scheduleLoadMoreCheck(): void {
    // Only search results are paginated/infinite-scrolled; the person page's
    // combined_credits call returns everything in one shot.
    if (this.pageMode.kind !== 'search') return;
    if (this.loadMoreTimer !== null) return;
    if (isDefault(this.filters)) return;
    const needsMore = document.documentElement.scrollHeight <= window.innerHeight + 100;
    if (!needsMore) return;
    this.loadMoreTimer = window.setTimeout(() => {
      this.loadMoreTimer = null;
      window.scrollTo(0, document.documentElement.scrollHeight);
      window.dispatchEvent(new Event('scroll'));
      document.dispatchEvent(new Event('scroll'));
      window.scrollTo(0, 0);
    }, 400);
  }

  setFilters(next: Filters): void {
    this.filters = next;
    this.applyFilters();
    // Keep every toolbar instance's controls in sync — a change made in the
    // Appearances toolbar must be reflected in the Crew toolbar too, since
    // they share this one filter state.
    this.uis.forEach((ui) => ui.applyState(this));
  }
}

function toDatasetAttr(camelCase: string): string {
  return camelCase.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function buildUi(engine: FilterEngine) {
  // Inserted inline in the page flow (right above the results grid — see
  // ensureToolbarInserted), not fixed/floating.
  const host = document.createElement('div');
  host.id = 'seerr-search-filter-root';
  // Starts hidden; ensureToolbarsInserted reveals it shortly after
  // insertion, once the page has had a moment to settle (see there).
  host.style.visibility = 'hidden';
  // Seerr's person-page header has a decorative backdrop layer
  // (position: absolute, ~448px tall, crossfading) sized for the header
  // area. On a page with a short bio, "Appearances" — and this toolbar —
  // can end up rendered inside that same vertical span. Per CSS stacking
  // rules, a positioned element always paints above normal-flow content
  // regardless of DOM order, so a plain `position: static` toolbar there
  // would lose to the backdrop mid-fade even though it comes later in the
  // DOM. Making the toolbar positioned too — with a z-index — puts it in
  // that same stacking layer, where later DOM order (ours) wins.
  host.style.position = 'relative';
  host.style.zIndex = '1';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; display: block; margin: 0 0 16px; }
    .toolbar { font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px; background: #1a202c; color: #e2e8f0; border: 1px solid #2d3748; border-radius: 8px; }
    .group { display: flex; align-items: center; gap: 6px; }
    .group-label { color: #a0aec0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    .chip { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border: 1px solid #4a5568; border-radius: 999px; cursor: pointer; user-select: none; background: #2d3748; }
    .chip.active { background: #3b82f6; border-color: #3b82f6; color: white; }
    .dropdown { position: relative; }
    .dropdown-btn { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border: 1px solid #4a5568; border-radius: 6px; background: #2d3748; color: #e2e8f0; cursor: pointer; font: inherit; }
    .dropdown-btn.active { border-color: #3b82f6; color: #93c5fd; }
    .dropdown-panel { position: absolute; top: 100%; left: 0; margin-top: 4px; background: #1a202c; border: 1px solid #2d3748; border-radius: 6px; padding: 8px; min-width: 170px; max-height: 260px; overflow-y: auto; z-index: 20; display: none; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    .dropdown-panel.open { display: block; }
    .dropdown-panel .empty { color: #718096; font-size: 12px; }
    label.opt { display: flex; align-items: center; gap: 6px; padding: 2px 0; cursor: pointer; white-space: nowrap; }
    input[type='number'] { width: 60px; background: #2d3748; border: 1px solid #4a5568; color: #e2e8f0; border-radius: 4px; padding: 3px 5px; }
    input[type='text'] { width: 150px; background: #2d3748; border: 1px solid #4a5568; color: #e2e8f0; border-radius: 4px; padding: 4px 6px; box-sizing: border-box; }
    input[type='range'] { width: 100px; vertical-align: middle; }
    .count { font-size: 11px; color: #a0aec0; margin-left: auto; white-space: nowrap; }
    .clear { background: transparent; border: 1px solid #4a5568; color: #e2e8f0; border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; }
    .clear:hover { background: #2d3748; }
    .loading-hint { font-style: italic; color: #a0aec0; font-size: 11px; padding: 4px 0 2px; border-top: 1px solid #2d3748; margin-top: 4px; }
  `;
  shadow.appendChild(style);

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = `
    <div class="group" data-group="mediaTypes"></div>
    <div class="dropdown" data-dropdown="genres"><button class="dropdown-btn" type="button">Genre</button><div class="dropdown-panel"></div></div>
    <div class="group">
      <span class="group-label">Year</span>
      <input type="number" data-field="yearMin" placeholder="Min" />
      <span>–</span>
      <input type="number" data-field="yearMax" placeholder="Max" />
    </div>
    <div class="group">
      <span class="group-label">Score</span>
      <input type="range" min="0" max="10" step="0.5" value="0" data-field="scoreMin" />
      <span class="score-value">Any</span>
    </div>
    <div class="dropdown" data-dropdown="languages"><button class="dropdown-btn" type="button">Language</button><div class="dropdown-panel"></div></div>
    <div class="dropdown" data-dropdown="statuses"><button class="dropdown-btn" type="button">Availability</button><div class="dropdown-panel"></div></div>
    <div class="dropdown" data-dropdown="certifications"><button class="dropdown-btn" type="button">Content rating</button><div class="dropdown-panel"><div class="loading-hint">Fills in as matching cards scroll into view.</div></div></div>
    <div class="group">
      <span class="group-label">Actor</span>
      <input type="text" data-field="actorQuery" placeholder="Cast member name…" />
    </div>
    <button class="clear">Clear filters</button>
    <span class="count"></span>
  `;
  shadow.appendChild(toolbar);

  const countEl = toolbar.querySelector('.count') as HTMLElement;
  const yearMinEl = toolbar.querySelector('[data-field="yearMin"]') as HTMLInputElement;
  const yearMaxEl = toolbar.querySelector('[data-field="yearMax"]') as HTMLInputElement;
  const scoreEl = toolbar.querySelector('[data-field="scoreMin"]') as HTMLInputElement;
  const scoreValueEl = toolbar.querySelector('.score-value') as HTMLElement;
  const actorEl = toolbar.querySelector('[data-field="actorQuery"]') as HTMLInputElement;
  const clearBtn = toolbar.querySelector('.clear') as HTMLButtonElement;
  const mediaTypeGroup = toolbar.querySelector('[data-group="mediaTypes"]') as HTMLElement;

  const MEDIA_TYPES: MediaType[] = ['movie', 'tv'];
  const MEDIA_LABELS: Record<MediaType, string> = { movie: 'Movies', tv: 'TV', person: 'Person', collection: 'Collection' };

  function commit(mutator: (f: Filters) => void) {
    const next: Filters = {
      mediaTypes: new Set(engine.filters.mediaTypes),
      genres: new Set(engine.filters.genres),
      yearMin: engine.filters.yearMin,
      yearMax: engine.filters.yearMax,
      scoreMin: engine.filters.scoreMin,
      languages: new Set(engine.filters.languages),
      statuses: new Set(engine.filters.statuses),
      actorQuery: engine.filters.actorQuery,
      certifications: new Set(engine.filters.certifications),
    };
    mutator(next);
    engine.setFilters(next);
  }

  // Type: just two toggle chips (Movies / TV), no dropdown needed. Skipped
  // on the person page, which already has its own Movie/TV filter per
  // filmography section.
  if (engine.pageMode.kind === 'search') {
    for (const t of MEDIA_TYPES) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = MEDIA_LABELS[t];
      chip.classList.toggle('active', engine.filters.mediaTypes.has(t));
      chip.addEventListener('click', () => {
        const active = !chip.classList.contains('active');
        chip.classList.toggle('active', active);
        commit((f) => {
          if (active) f.mediaTypes.add(t);
          else f.mediaTypes.delete(t);
        });
      });
      mediaTypeGroup.appendChild(chip);
    }
  } else {
    mediaTypeGroup.remove();
  }

  // Dropdowns: a button that toggles a checkbox panel beneath it; only one
  // open at a time, closed by clicking elsewhere (including outside the
  // shadow root, on the host page).
  const dropdowns = new Map<string, { btn: HTMLButtonElement; panel: HTMLElement }>();
  toolbar.querySelectorAll<HTMLElement>('[data-dropdown]').forEach((el) => {
    const name = el.dataset.dropdown!;
    const btn = el.querySelector('.dropdown-btn') as HTMLButtonElement;
    const panel = el.querySelector('.dropdown-panel') as HTMLElement;
    dropdowns.set(name, { btn, panel });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !panel.classList.contains('open');
      closeAllDropdowns();
      if (willOpen) panel.classList.add('open');
    });
  });
  function closeAllDropdowns() {
    dropdowns.forEach(({ panel }) => panel.classList.remove('open'));
  }
  shadow.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.dropdown-panel')) closeAllDropdowns();
  });
  document.addEventListener('click', closeAllDropdowns);

  function updateDropdownLabel(name: string, baseLabel: string, count: number) {
    const entry = dropdowns.get(name);
    if (!entry) return;
    entry.btn.textContent = count > 0 ? `${baseLabel} (${count})` : baseLabel;
    entry.btn.classList.toggle('active', count > 0);
  }

  function buildCheckboxGroup(
    panel: HTMLElement,
    options: { value: string; label: string }[],
    selected: Set<string>,
    onChange: (value: string, checked: boolean) => void,
  ) {
    panel.querySelectorAll('label.opt, span.empty').forEach((l) => l.remove());
    for (const opt of options) {
      const label = document.createElement('label');
      label.className = 'opt';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(opt.value);
      cb.dataset.value = opt.value;
      cb.addEventListener('change', () => onChange(opt.value, cb.checked));
      label.appendChild(cb);
      label.append(opt.label);
      panel.appendChild(label);
    }
    if (options.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'empty';
      empty.textContent = 'No data yet';
      panel.appendChild(empty);
    }
  }

  // Static list, inserted once (unlike genre/language/status which depend
  // on loaded data) — insert before the hint text already in the panel.
  const certificationPanel = dropdowns.get('certifications')!.panel;
  const certHint = certificationPanel.querySelector('.loading-hint') as HTMLElement;
  for (const c of CERTIFICATIONS) {
    const label = document.createElement('label');
    label.className = 'opt';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = engine.filters.certifications.has(c);
    cb.dataset.value = c;
    cb.addEventListener('change', () =>
      commit((f) => {
        if (cb.checked) f.certifications.add(c);
        else f.certifications.delete(c);
      }),
    );
    label.appendChild(cb);
    label.append(c);
    certificationPanel.insertBefore(label, certHint);
  }

  yearMinEl.addEventListener('change', () =>
    commit((f) => {
      f.yearMin = yearMinEl.value ? Number(yearMinEl.value) : null;
    }),
  );
  yearMaxEl.addEventListener('change', () =>
    commit((f) => {
      f.yearMax = yearMaxEl.value ? Number(yearMaxEl.value) : null;
    }),
  );
  scoreEl.addEventListener('input', () => {
    scoreValueEl.textContent = Number(scoreEl.value) > 0 ? `${scoreEl.value}+` : 'Any';
    commit((f) => {
      f.scoreMin = Number(scoreEl.value);
    });
  });
  actorEl.addEventListener('input', () => {
    commit((f) => {
      f.actorQuery = actorEl.value;
    });
  });
  clearBtn.addEventListener('click', () => {
    // setFilters syncs every toolbar instance's controls (including this
    // one) back to the cleared state — see applyState below.
    engine.setFilters(defaultFilters());
  });

  function refreshFacetOptions(e: FilterEngine): void {
    const genreIds = new Set<number>();
    const languages = new Set<string>();
    const statuses = new Set<MediaStatus>();
    for (const item of e.resultsById.values()) {
      (item.genreIds ?? []).forEach((g) => genreIds.add(g));
      if (item.originalLanguage) languages.add(item.originalLanguage);
      statuses.add(item.mediaInfo?.status ?? MediaStatus.UNKNOWN);
    }

    buildCheckboxGroup(
      dropdowns.get('genres')!.panel,
      [...genreIds]
        .map((id) => ({ value: String(id), label: e.genresById.get(id) ?? `#${id}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      new Set([...e.filters.genres].map(String)),
      (value, checked) =>
        commit((f) => {
          if (checked) f.genres.add(Number(value));
          else f.genres.delete(Number(value));
        }),
    );
    updateDropdownLabel('genres', 'Genre', e.filters.genres.size);

    buildCheckboxGroup(
      dropdowns.get('languages')!.panel,
      [...languages].sort().map((l) => ({ value: l, label: l.toUpperCase() })),
      e.filters.languages,
      (value, checked) =>
        commit((f) => {
          if (checked) f.languages.add(value);
          else f.languages.delete(value);
        }),
    );
    updateDropdownLabel('languages', 'Language', e.filters.languages.size);

    buildCheckboxGroup(
      dropdowns.get('statuses')!.panel,
      [...statuses]
        .sort((a, b) => a - b)
        .map((s) => ({ value: String(s), label: STATUS_LABELS[s] })),
      new Set([...e.filters.statuses].map(String)),
      (value, checked) =>
        commit((f) => {
          if (checked) f.statuses.add(Number(value) as MediaStatus);
          else f.statuses.delete(Number(value) as MediaStatus);
        }),
    );
    updateDropdownLabel('statuses', 'Availability', e.filters.statuses.size);
    updateDropdownLabel('certifications', 'Content rating', e.filters.certifications.size);
  }

  refreshFacetOptions(engine);
  // A freshly built toolbar (e.g. re-created after navigating to a title
  // and back) must reflect whatever filters are already active — genre,
  // language, status, and certification get initialized correctly above
  // since refreshFacetOptions builds their checkboxes straight from
  // engine.filters, but year/score/actor/media-type controls default to
  // their blank HTML state until applyState runs.
  applyState(engine);

  // Reflects engine.filters onto this toolbar's own controls without
  // rebuilding the checkbox lists — used to keep multiple toolbar instances
  // in sync when a filter changes, and (see above) to initialize a
  // freshly built one.
  function applyState(e: FilterEngine): void {
    mediaTypeGroup.querySelectorAll<HTMLElement>('.chip').forEach((chip) => {
      const t = MEDIA_TYPES.find((mt) => MEDIA_LABELS[mt] === chip.textContent);
      chip.classList.toggle('active', t ? e.filters.mediaTypes.has(t) : false);
    });
    yearMinEl.value = e.filters.yearMin === null ? '' : String(e.filters.yearMin);
    yearMaxEl.value = e.filters.yearMax === null ? '' : String(e.filters.yearMax);
    scoreEl.value = String(e.filters.scoreMin);
    scoreValueEl.textContent = e.filters.scoreMin > 0 ? `${e.filters.scoreMin}+` : 'Any';
    actorEl.value = e.filters.actorQuery;

    const checkboxSync: [string, Set<string>][] = [
      ['genres', new Set([...e.filters.genres].map(String))],
      ['languages', e.filters.languages],
      ['statuses', new Set([...e.filters.statuses].map(String))],
      ['certifications', e.filters.certifications],
    ];
    for (const [name, selected] of checkboxSync) {
      const panel = dropdowns.get(name)?.panel;
      panel?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
        cb.checked = selected.has(cb.dataset.value ?? '');
      });
    }
    updateDropdownLabel('genres', 'Genre', e.filters.genres.size);
    updateDropdownLabel('languages', 'Language', e.filters.languages.size);
    updateDropdownLabel('statuses', 'Availability', e.filters.statuses.size);
    updateDropdownLabel('certifications', 'Content rating', e.filters.certifications.size);
  }

  return {
    host,
    updateCount(shown: number, total: number, unresolved: number) {
      countEl.textContent =
        unresolved > 0
          ? `${shown} / ${total} shown (${unresolved} pending)`
          : `${shown} / ${total} shown`;
    },
    refreshFacetOptions,
    applyState,
    reveal() {
      host.style.visibility = '';
    },
  };
}

const pageMode = detectPageMode();
if (pageMode) {
  const engine = new FilterEngine(pageMode);
  engine.mount();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as BridgeMessage | undefined;
    if (!data || data.source !== BRIDGE_MESSAGE_SOURCE) return;
    if (data.kind === 'search') engine.ingestSearch(data.payload);
  });
}
