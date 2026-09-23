import { ScrapedPoiData } from "./types";

/**
 * In-memory cache for scraped POI data, keyed by query/place_id. The whole
 * scrape (browser launch + navigation + waits) is the expensive part of every
 * request (~10-20s) — this exists to avoid paying that cost again for the
 * same place, which is the realistic traffic pattern for a real product
 * (many users checking the same popular POI within a short window of each
 * other). Not a substitute for genuinely faster scraping — see withPage()'s
 * shared-browser reuse in googleMaps.ts for that.
 *
 * Two-tier (stale-while-revalidate), not a single TTL:
 * - FRESH (first `freshTtlMs`): served instantly, no other work happens.
 * - STALE (the `staleTtlMs` window after that): still served instantly —
 *   the caller gets last-known data immediately rather than waiting — but
 *   the caller is expected to kick off a background re-scrape so the NEXT
 *   request gets fresh data. This means real users essentially never wait
 *   on a live scrape except the very first time a given POI is ever
 *   requested (or after it hasn't been asked about in over a day).
 * - Past both windows: a genuine miss: no data at all, a real scrape is
 *   unavoidable.
 *
 * Process-local and in-memory by design: fine for a single instance, resets
 * on restart, and does not survive across multiple server instances. If this
 * gets deployed behind a load balancer with multiple instances, swap this
 * for a shared store (Redis etc.) — the shape here is intentionally small so
 * that swap is a one-file change.
 */
interface CacheEntry {
  data: ScrapedPoiData;
  freshUntil: number;
  staleUntil: number;
}

export type CacheLookup =
  | { status: "fresh"; data: ScrapedPoiData }
  | { status: "stale"; data: ScrapedPoiData }
  | { status: "miss" };

const cache = new Map<string, CacheEntry>();

export function lookupCachedScrape(key: string): CacheLookup {
  const entry = cache.get(key);
  if (!entry) return { status: "miss" };

  const now = Date.now();
  if (now > entry.staleUntil) {
    cache.delete(key);
    return { status: "miss" };
  }
  if (now > entry.freshUntil) {
    return { status: "stale", data: entry.data };
  }
  return { status: "fresh", data: entry.data };
}

export function setCachedScrape(key: string, data: ScrapedPoiData, freshTtlMs: number, staleTtlMs: number): void {
  const now = Date.now();
  cache.set(key, { data, freshUntil: now + freshTtlMs, staleUntil: now + freshTtlMs + staleTtlMs });
}

// ============================================================================
// POI Anchor Cache (separate from scraper cache)
// ============================================================================

/**
 * In-memory cache for POI anchor values (daily footfall / peak capacity).
 * Anchor values are stable per POI — they don't change hourly/daily like
 * crowd patterns. A single 24-hour TTL is sufficient since:
 * - Anchor values are curated, rarely updated
 * - Manual team updates are expected to be rare
 * - Cache improves most queries without stale-while-revalidate complexity
 *
 * Keyed by normalized_key (poi_name + city) or place_id, same as DB lookups.
 * This cache reduces DB traffic and anchor lookup latency from 5ms to 1ms.
 */
interface AnchorCacheEntry {
  data: unknown; // Accepts PoiAnchorDoc
  expiresAt: number;
}

const anchorCache = new Map<string, AnchorCacheEntry>();

// 24 hours: anchor values are stable, manual updates are rare
const ANCHOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Look up a cached anchor value by key (normalized_key or place_id).
 * Returns the cached entry if still fresh, null otherwise.
 */
export function lookupCachedAnchor(key: string): unknown {
  const entry = anchorCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now > entry.expiresAt) {
    anchorCache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Store an anchor value in cache with 24-hour TTL.
 * Call this after a DB lookup or AI estimation to cache the result.
 */
export function setCachedAnchor(key: string, data: unknown): void {
  const now = Date.now();
  anchorCache.set(key, { data, expiresAt: now + ANCHOR_CACHE_TTL_MS });
}
