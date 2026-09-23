import { RangedInput, WeatherType } from "../formulas/types";
import { fetchCurrentConditions } from "./googleWeatherClient";
import { deriveWeatherType } from "./deriveWeatherType";

/**
 * Weather caching strategy (two-tier):
 *
 * Tier 1: Persistent cache (5 minutes)
 *   - Stores fetched weather for 5 minutes
 *   - 5 minutes is safe because weather APIs update every 15-20 minutes
 *   - Reduces API calls for repeated requests to same location
 *
 * Tier 2: In-flight dedup (prevents concurrent duplicate API calls)
 *   - When multiple concurrent requests hit same location
 *   - First request starts API call, stores promise
 *   - Subsequent concurrent requests await same promise
 *   - Result: 10 concurrent users to same location = 1 API call (not 10)
 *
 * Coordinate rounding: 3 decimals (~111m precision)
 *   - Nearby requests share one lookup
 *   - Example: 28.632, 77.214 and 28.633, 77.215 use same cache
 */
const CONDITIONS_TTL_MS = 5 * 60 * 1000; // 5 minutes
const conditionsCache = new Map<string, { value: RangedInput<WeatherType>; expiresAt: number }>();

// In-flight dedup: stores promise while API call is in progress
// Prevents duplicate concurrent API calls to same location
const inFlightCache = new Map<string, Promise<RangedInput<WeatherType> | undefined>>();

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/**
 * Auto-detects `weather` from Google Weather for a POI's real scraped
 * coordinates — the same "caller-supplied always wins, this only fills in
 * what's missing" pattern as the festival/event calendar (see
 * calendarRepository.ts's getTodayCalendarOverrides). Never throws: no API
 * key configured, missing coordinates, or the weather API being unreachable
 * all degrade to `undefined` — `weather` simply stays unset rather than the
 * request failing.
 *
 * Uses two-tier caching:
 * - Persistent: 5-minute TTL (aligns with weather API update cycles)
 * - In-flight dedup: Prevents concurrent duplicate API calls
 *
 * Concurrency example:
 *   10 users request weather for same location simultaneously
 *   Before: 10 API calls (wasteful)
 *   After: 1 API call, 10 concurrent requests await same promise (efficient)
 */
export async function getAutoWeather(
  lat: number | null,
  lng: number | null
): Promise<RangedInput<WeatherType> | undefined> {
  if (lat === null || lng === null) return undefined;

  try {
    const key = coordKey(lat, lng);
    const now = Date.now();

    // Tier 1: Check persistent cache (5-minute TTL)
    const cached = conditionsCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    // Tier 2: Check in-flight dedup (prevent concurrent duplicate calls)
    const inFlight = inFlightCache.get(key);
    if (inFlight) {
      // Another request is already fetching this location
      // Await its result and return (no duplicate API call)
      return inFlight;
    }

    // Tier 3: Create new API call and store promise for in-flight dedup
    const promise = (async () => {
      try {
        const conditions = await fetchCurrentConditions(lat, lng);
        if (!conditions) return undefined;

        const value = deriveWeatherType(conditions);
        // Store in persistent cache for 5 minutes
        conditionsCache.set(key, { value, expiresAt: now + CONDITIONS_TTL_MS });
        return value;
      } catch (err) {
        console.error("[weather] Auto-detection failed:", err);
        return undefined;
      } finally {
        // Remove from in-flight cache after call completes
        inFlightCache.delete(key);
      }
    })();

    // Store promise in in-flight cache so concurrent requests can await it
    inFlightCache.set(key, promise);

    return promise;
  } catch (err) {
    console.error("[weather] Lookup failed:", err);
    return undefined;
  }
}
