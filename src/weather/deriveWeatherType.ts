import { RangedInput, WeatherType } from "../formulas/types";
import { NormalizedConditions } from "./googleWeatherClient";

/** Matches DOCUMENTATION.md §15.2's explicit "Extreme Heat (45°C+)" cutoff — the one bucket with a hard number already on record. */
const EXTREME_HEAT_THRESHOLD_C = 45;

/**
 * Not documented anywhere by the team (DOCUMENTATION.md only defines the
 * extreme-heat cutoff) — a reasonable default for India ("hot and muggy"),
 * not a measured/confirmed number. Adjust these two if the real-world
 * results feel off.
 */
const HOT_HUMID_TEMP_THRESHOLD_C = 32;
const HOT_HUMID_HUMIDITY_THRESHOLD_PCT = 60;

// Google's WeatherCondition.type enum uses names like RAIN, HEAVY_RAIN,
// RAIN_SHOWERS, WIND_AND_RAIN, plus separate thunderstorm/snow/hail variants
// — matched by substring rather than an exhaustive allowlist, since Google's
// own docs note new condition codes can be added over time.
const RAIN_STORM_TYPE_RE = /RAIN|THUNDERSTORM|SNOW|HAIL|SLEET/;
const HIGH_PRECIPITATION_PROBABILITY_PCT = 50;

/**
 * Maps a normalized Google Weather reading to one of the four buckets the
 * `weather.type` field actually accepts. Priority order matters since these
 * are mutually exclusive (one dropdown value, not independent flags):
 * extreme heat is checked first (most severe/overrides everything), then
 * rain/storm, then hot/humid, with "pleasant" as the untriggered default.
 */
export function deriveWeatherType(conditions: NormalizedConditions): RangedInput<WeatherType> {
  const {
    temperatureCelsius,
    relativeHumidity,
    weatherConditionType,
    precipitationProbabilityPercent,
    thunderstormProbabilityPercent,
  } = conditions;

  if (temperatureCelsius !== null && temperatureCelsius >= EXTREME_HEAT_THRESHOLD_C) {
    return { type: "extreme_heat" };
  }

  const highPrecipitationChance =
    (precipitationProbabilityPercent ?? 0) >= HIGH_PRECIPITATION_PROBABILITY_PCT ||
    (thunderstormProbabilityPercent ?? 0) >= HIGH_PRECIPITATION_PROBABILITY_PCT;

  if (RAIN_STORM_TYPE_RE.test(weatherConditionType) || highPrecipitationChance) {
    return { type: "heavy_rain" };
  }

  if (
    temperatureCelsius !== null &&
    relativeHumidity !== null &&
    temperatureCelsius >= HOT_HUMID_TEMP_THRESHOLD_C &&
    relativeHumidity >= HOT_HUMID_HUMIDITY_THRESHOLD_PCT
  ) {
    return { type: "hot_humid" };
  }

  return { type: "pleasant" };
}
