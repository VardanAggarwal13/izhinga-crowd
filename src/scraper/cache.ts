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
