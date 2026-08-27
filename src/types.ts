// Mirrors shapes returned by Seerr's server/models/Search.ts and
// server/constants/media.ts. Kept minimal to just the fields the filter
// panel actually reads.

export type MediaType = 'movie' | 'tv' | 'person' | 'collection';

export enum MediaStatus {
  UNKNOWN = 1,
  PENDING,
  PROCESSING,
  PARTIALLY_AVAILABLE,
  AVAILABLE,
  BLOCKLISTED,
  DELETED,
}

export interface MediaInfo {
  status?: MediaStatus;
}

export interface SearchResultBase {
  id: number;
  mediaType: MediaType;
  genreIds?: number[];
  voteAverage?: number;
  voteCount?: number;
  popularity?: number;
  originalLanguage?: string;
  posterPath?: string;
  mediaInfo?: MediaInfo;
}

export interface MovieResult extends SearchResultBase {
  mediaType: 'movie';
  title: string;
  releaseDate?: string;
}

export interface TvResult extends SearchResultBase {
  mediaType: 'tv';
  name: string;
  firstAirDate?: string;
}

export interface PersonResult extends SearchResultBase {
  mediaType: 'person';
  name: string;
}

export interface CollectionResult extends SearchResultBase {
  mediaType: 'collection';
  title: string;
}

export type SearchResult = MovieResult | TvResult | PersonResult | CollectionResult;

export interface SearchApiResponse {
  page: number;
  totalPages: number;
  totalResults: number;
  results: SearchResult[];
}

// GET /api/v1/person/{id}/combined_credits — not paginated, movie/tv only.
export interface PersonCreditsResponse {
  id: number;
  cast: SearchResult[];
  crew: SearchResult[];
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface CastMember {
  name: string;
}

export interface DetailWithCredits {
  id: number;
  credits?: {
    cast?: CastMember[];
  };
}

// Key used across maps to uniquely identify a result regardless of type.
export function resultKey(mediaType: MediaType, id: number): string {
  return `${mediaType}:${id}`;
}

export function yearOf(item: SearchResult): number | undefined {
  const raw =
    item.mediaType === 'movie'
      ? item.releaseDate
      : item.mediaType === 'tv'
        ? item.firstAirDate
        : undefined;
  if (!raw) return undefined;
  const year = Number(raw.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

// Messages passed from the MAIN-world fetch hook (inject-main.ts) to the
// ISOLATED-world panel script (panel.ts) via window.postMessage.
export const BRIDGE_MESSAGE_SOURCE = 'seerr-search-filter';

export type BridgeMessage = { source: typeof BRIDGE_MESSAGE_SOURCE; kind: 'search'; payload: SearchApiResponse };
