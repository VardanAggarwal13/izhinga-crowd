import { env } from "../config/env";

const REQUEST_TIMEOUT_MS = 8_000;

export interface NormalizedConditions {
  /** Google's WeatherCondition.type enum, e.g. "CLEAR", "RAIN", "HEAVY_RAIN", "THUNDERSTORM". */
  weatherConditionType: string;
  temperatureCelsius: number | null;
  relativeHumidity: number | null;
  precipitationProbabilityPercent: number | null;
  thunderstormProbabilityPercent: number | null;
}

/**
 * `currentConditions:lookup`, not `forecast/days:lookup` — D_weather needs
 * what's happening right now, not today's forecast min/max, and this
 * endpoint returns exactly that as one flat object. Takes lat/lng directly
 * (no separate location-key resolution step, unlike AccuWeather), so this is
 * a single network call. Never throws: any failure (missing key, network
 * error, bad response) returns null — callers treat that as "auto
 * weather-detection unavailable right now", never a request-breaking error.
 */
export async function fetchCurrentConditions(lat: number, lng: number): Promise<NormalizedConditions | null> {
  if (!env.googleWeather.apiKey) return null;

  try {
    const url =
      `https://weather.googleapis.com/v1/currentConditions:lookup` +
      `?key=${encodeURIComponent(env.googleWeather.apiKey)}` +
      `&location.latitude=${lat}&location.longitude=${lng}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return null;

    const data = await res.json();

    return {
      weatherConditionType: typeof data?.weatherCondition?.type === "string" ? data.weatherCondition.type : "",
      temperatureCelsius: typeof data?.temperature?.degrees === "number" ? data.temperature.degrees : null,
      relativeHumidity: typeof data?.relativeHumidity === "number" ? data.relativeHumidity : null,
      precipitationProbabilityPercent:
        typeof data?.precipitation?.probability?.percent === "number"
          ? data.precipitation.probability.percent
          : null,
      thunderstormProbabilityPercent:
        typeof data?.thunderstormProbability === "number" ? data.thunderstormProbability : null,
    };
  } catch {
    return null;
  }
}
