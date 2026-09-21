import {
  Category,
  DayOfWeek,
  EventType,
  HolidayType,
  MealTime,
  SaleType,
  VenueEventState,
  WeatherType,
} from "./types";

/**
 * Default Peak Anchors, per Livecrowd.md section 3 / 6.
 * These are fallbacks for demos only — in production the anchor must come
 * from the POI's own record (Local Guru field reports / public capacity
 * data), not a hardcoded default, since it varies wildly per venue.
 */
export const DEFAULT_PEAK_ANCHOR: Record<Category, number> = {
  religious_site: 100_000,
  restaurant_cafe: 50,
  market_shopping: 10_000,
  event_venue: 500,
};

export const CATEGORY_EXPONENT: Record<
  Exclude<Category, "event_venue">,
  number
> = {
  religious_site: 1.5,
  restaurant_cafe: 1.2,
  market_shopping: 1.3,
};

export const WEEKEND_MULTIPLIER: Record<DayOfWeek, number> = {
  monday: 1.0,
  tuesday: 1.0,
  wednesday: 1.0,
  thursday: 1.0,
  friday: 1.2,
  saturday: 1.5,
  sunday: 1.4,
};

/** Restaurant/café uses its own, simpler weekend curve (Livecrowd.md #3.2). */
export const RESTAURANT_WEEKEND_MULTIPLIER: Record<DayOfWeek, number> = {
  monday: 1.0,
  tuesday: 1.0,
  wednesday: 1.0,
  thursday: 1.0,
  friday: 1.5,
  saturday: 1.5,
  sunday: 1.0,
};

/** Market/shopping weekend curve (Livecrowd.md #3.3): weekday 1.0x, Sat-Sun 1.4x. */
export const MARKET_WEEKEND_MULTIPLIER: Record<DayOfWeek, number> = {
  monday: 1.0,
  tuesday: 1.0,
  wednesday: 1.0,
  thursday: 1.0,
  friday: 1.0,
  saturday: 1.4,
  sunday: 1.4,
};

/** Event venue day multiplier (Livecrowd.md #3.4): Mon-Thu 0.5x, Fri-Sat 1.0x. */
export const EVENT_VENUE_DAY_MULTIPLIER: Record<DayOfWeek, number> = {
  monday: 0.5,
  tuesday: 0.5,
  wednesday: 0.5,
  thursday: 0.5,
  friday: 1.0,
  saturday: 1.0,
  sunday: 0.5,
};

interface Range {
  min: number;
  max: number;
}

export const HOLIDAY_MULTIPLIER: Record<HolidayType, Range> = {
  none: { min: 1.0, max: 1.0 },
  long_weekend: { min: 1.5, max: 1.5 },
  major_festival: { min: 2.0, max: 3.0 },
  extreme_event: { min: 3.0, max: 5.0 },
};

export const EVENT_MULTIPLIER: Record<EventType, Range> = {
  none: { min: 1.0, max: 1.0 },
  local: { min: 1.2, max: 1.5 },
  poi_ceremony: { min: 1.5, max: 2.5 },
  city_wide: { min: 2.0, max: 4.0 },
};

export const WEATHER_MULTIPLIER: Record<WeatherType, Range> = {
  pleasant: { min: 1.0, max: 1.2 },
  hot_humid: { min: 0.8, max: 0.9 },
  heavy_rain: { min: 0.5, max: 0.7 },
  extreme_heat: { min: 0.6, max: 0.6 },
};

/** Market-specific weather curve (Livecrowd.md #3.3): pleasant 1.1x, rain 0.6x. */
export const MARKET_WEATHER_MULTIPLIER: Record<WeatherType, Range> = {
  pleasant: { min: 1.1, max: 1.1 },
  hot_humid: { min: 0.9, max: 0.9 },
  heavy_rain: { min: 0.6, max: 0.6 },
  extreme_heat: { min: 0.6, max: 0.6 },
};

export const SALE_MULTIPLIER: Record<SaleType, Range> = {
  none: { min: 1.0, max: 1.0 },
  sale_event: { min: 1.5, max: 2.0 },
};

export const MEAL_MULTIPLIER: Record<MealTime, number> = {
  lunch: 1.0,
  dinner: 1.3,
  off_peak: 0.5,
};

export const VENUE_EVENT_MULTIPLIER: Record<VenueEventState, Range> = {
  none: { min: 0.0, max: 0.0 },
  event_night: { min: 0.9, max: 1.0 },
};

/** Resolves a documented min-max multiplier range to a single number. */
export function resolveRange(range: Range, intensity = 0.5): number {
  const clamped = Math.min(1, Math.max(0, intensity));
  return range.min + (range.max - range.min) * clamped;
}
