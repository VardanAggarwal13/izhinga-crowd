import { DayOfWeek } from "../formulas/types";

export interface PopularTimesBar {
  /** e.g. "9 AM" */
  hourLabel: string;
  /** 0-100 relative busyness for that hour */
  percentage: number;
}

/**
 * One 24ish-hour (venue-hours-dependent) chart per weekday. Google's DOM
 * carries all 7 days' bars simultaneously regardless of which day tab is
 * visually selected (confirmed live), so a single scrape yields the whole
 * week split by weekday — no extra requests or day-selection needed.
 */
export type PopularTimesByDay = Record<DayOfWeek, PopularTimesBar[]>;

export interface ScrapedPoiData {
  /** The search query used, if scraped by name. Null when scraped by placeId. */
  query: string | null;
  /**
   * When scraped by `place_id`, this is that same Google Places API ID
   * (`ChIJ...`), echoed back directly. When scraped by name/`query` instead,
   * this is a best-effort CID parsed from the resulting URL (`0x...:0x...`
   * format) — a DIFFERENT ID namespace than Google's Places API place_id, not
   * interchangeable with it. Always prefer scraping by `place_id` when you
   * have one (see `scrapePoiByPlaceId`) — it's both more precise and skips
   * the whole class of search-ambiguity/redirect-timing bugs query-based
   * scraping has.
   */
  placeId: string | null;
  placeName: string;
  url: string;
  /**
   * Parsed from the "@lat,lng,zoom" segment Google Maps embeds in every
   * resolved place URL. Null only if that segment was ever missing/malformed
   * (shouldn't happen on a genuinely resolved place page, but never blocks
   * extraction if it does).
   */
  lat: number | null;
  lng: number | null;
  category: string | null;
  address: string | null;
  /** e.g. "Not too busy", "As busy as it gets" */
  liveStatusText: string | null;
  /** 0-100 busyness for the current/live hour, used directly as `Score` in the formula engine. */
  liveScore: number | null;
  popularTimesByDay: PopularTimesByDay;
  scrapedAt: string;
}

export interface ScrapeOptions {
  /** Milliseconds to wait for the place panel to render. */
  timeoutMs?: number;
}
