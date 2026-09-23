import { z } from "zod";

const dayOfWeek = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

const rangedInput = <T extends readonly [string, ...string[]]>(values: T) =>
  z.object({
    type: z.enum(values),
    intensity: z.number().min(0).max(1).optional(),
  });

const holidayType = ["none", "long_weekend", "major_festival", "extreme_event"] as const;
const eventType = ["none", "local", "poi_ceremony", "city_wide"] as const;
const weatherType = ["pleasant", "hot_humid", "heavy_rain", "extreme_heat"] as const;
const saleType = ["none", "sale_event"] as const;
const venueEventState = ["none", "event_night"] as const;

export const scrapeRequestSchema = z
  .object({
    query: z.string().min(2, "query must be a POI name or search string").optional(),
    place_id: z.string().min(1).optional(),
  })
  .refine((data) => data.query || data.place_id, {
    message: "Provide either `query` (a name/search string) or `place_id` (Google's ChIJ... id)",
  });

// --- Public-facing, MD-category-based schemas (accept the product's own 30 categories) ---

const manualOverride = z.object({
  engineCategory: z.enum(["religious_site", "restaurant_cafe", "market_shopping", "event_venue"]),
  anchor: z.number().positive(),
});

const mdCategoryContextFields = {
  mdCategory: z.string().min(1, "mdCategory is required"),
  /** Auto-detected from the POI's real coordinates when omitted (see src/time/autoDetectDayOfWeek.ts) — send it yourself only to override. */
  dayOfWeek: dayOfWeek.optional(),
  anchorOverride: z.number().positive().optional(),
  holiday: rangedInput(holidayType).optional(),
  event: rangedInput(eventType).optional(),
  weather: rangedInput(weatherType).optional(),
  sale: rangedInput(saleType).optional(),
  meal: z.enum(["lunch", "dinner", "off_peak"]).optional(),
  eventState: rangedInput(venueEventState).optional(),
  manual: manualOverride.optional(),
};

/** Pure formula, MD-category driven: caller supplies the busyness Score directly. */
export const mdCrowdEstimateRequestSchema = z.object({
  ...mdCategoryContextFields,
  score: z.number().min(0).max(100).optional(),
});

/** End-to-end: scrapes `query`'s live score, then runs it through the MD-category formula. */
export const mdLiveCrowdRequestSchema = z.object({
  ...mdCategoryContextFields,
  query: z.string().min(2),
  /**
   * Required — a plain POI name is ambiguous for chains (Burger King, Starbucks, ...) that
   * exist in many Indian cities; without a city, the scraper has no way to know which outlet
   * you mean. Folded into the search query itself (see routes/crowd.ts), and used as the
   * authoritative city for the festival/event calendar lookup (skips the messier "guess the
   * city from the scraped address" path). Does NOT affect `dayOfWeek` (single IST timezone,
   * same across all of India) or `weather` (already derived from the POI's real scraped
   * coordinates, not from this string).
   */
  city: z.string().min(1, "city is required"),
});

// --- Frontend crowd_intelligence contract: snake_case, driven by Google's place_id ---

export const crowdIntelligenceRequestSchema = z
  .object({
    /** Preferred — Google's own unique id, no search-ambiguity risk. Takes priority over `poi_name` when both are given. */
    place_id: z.string().min(1).optional(),
    /** Fallback for when the caller doesn't have a place_id yet — a free-text name/search string. */
    poi_name: z.string().min(2).optional(),
    md_category: z.string().min(1, "md_category is required"),
    /**
     * Required in both cases (even alongside `place_id`), for payload consistency. When
     * scraping by `poi_name`, this disambiguates chains (Burger King, Starbucks, ...) that
     * exist in many Indian cities — folded straight into the search query. In both cases,
     * it's also the authoritative city for the festival/event calendar lookup, replacing the
     * old "guess the city from the scraped address" fallback. Does NOT affect `day_of_week`
     * (single IST timezone, same across all of India) or `weather` (already derived from the
     * POI's real scraped coordinates, not from this string).
     */
    city: z.string().min(1, "city is required"),
    /**
     * Which weekday "now" is, for current_status/current_level/current_wait_time/recommended_entry_slot.
     * Auto-detected from the POI's real coordinates when omitted (see src/time/autoDetectDayOfWeek.ts) —
     * send it yourself only to override.
     */
    day_of_week: dayOfWeek.optional(),
    /** Which day's chart hourly_live_trend describes. Defaults to day_of_week. */
    selected_day: dayOfWeek.optional(),
    /** 0-100 "right now" busyness — pass the scraped liveScore, or your own reading. */
    score: z.number().min(0).max(100).optional(),
    anchor_override: z.number().positive().optional(),
    holiday: rangedInput(holidayType).optional(),
    event: rangedInput(eventType).optional(),
    weather: rangedInput(weatherType).optional(),
    sale: rangedInput(saleType).optional(),
    meal: z.enum(["lunch", "dinner", "off_peak"]).optional(),
    event_state: rangedInput(venueEventState).optional(),
    manual: manualOverride.optional(),
  })
  .refine((data) => data.place_id || data.poi_name, {
    message: "Provide either `place_id` (Google's ChIJ... id) or `poi_name` (a name/search string) to identify the place",
  });

export const historicalRequestSchema = z.object({
  poi_name: z.string().min(2),
  place_id: z.string().optional(),
  md_category: z.string().optional(),
  city: z.string().optional(),
});

// --- Auth (see src/auth/) ---

export const authTokenRequestSchema = z.object({
  client_id: z.string().min(1, "client_id is required"),
  client_secret: z.string().min(1, "client_secret is required"),
});

export const authRefreshRequestSchema = z.object({
  refresh_token: z.string().min(1, "refresh_token is required"),
});
