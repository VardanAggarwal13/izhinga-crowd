import { RangedInput, WeatherType } from "../formulas/types";
import { fetchCurrentConditions } from "./googleWeatherClient";
import { deriveWeatherType } from "./deriveWeatherType";

// Current conditions genuinely change through the day — short TTL keeps
// this responsive without hitting Google Weather on every single request
// for a popular POI. Rounded to 3 decimals (~111m) so nearby requests for
// the same place share one lookup.
const CONDITIONS_TTL_MS = 15 * 60 * 1000;
const conditionsCache = new Map<string, { value: RangedInput<WeatherType>; expiresAt: number }>();

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
 */
export async function getAutoWeather(
  lat: number | null,
  lng: number | null
): Promise<RangedInput<WeatherType> | undefined> {
  if (lat === null || lng === null) return undefined;

  try {
    const key = coordKey(lat, lng);
    const cached = conditionsCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const conditions = await fetchCurrentConditions(lat, lng);
    if (!conditions) return undefined;

    const value = deriveWeatherType(conditions);
    conditionsCache.set(key, { value, expiresAt: Date.now() + CONDITIONS_TTL_MS });
    return value;
  } catch (err) {
    console.error("[weather] Auto-detection failed:", err);
    return undefined;
  }
}
