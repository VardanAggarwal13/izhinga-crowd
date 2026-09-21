export type Category =
  | "religious_site"
  | "restaurant_cafe"
  | "market_shopping"
  | "event_venue";

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type HolidayType =
  | "none"
  | "long_weekend"
  | "major_festival"
  | "extreme_event";

export type EventType = "none" | "local" | "poi_ceremony" | "city_wide";

export type WeatherType =
  | "pleasant"
  | "hot_humid"
  | "heavy_rain"
  | "extreme_heat";

export type MealTime = "lunch" | "dinner" | "off_peak";

export type SaleType = "none" | "sale_event";

export type VenueEventState = "none" | "event_night";

/**
 * intensity (0-1) lets the caller pick where within a documented multiplier
 * range (e.g. "Major Religious Festival: 2.0x-3.0x") the real-world case falls.
 * Omitting it uses the midpoint of the range.
 */
export interface RangedInput<T extends string> {
  type: T;
  intensity?: number;
}

export interface ReligiousSiteInput {
  category: "religious_site";
  peakAnchor?: number;
  score: number;
  dayOfWeek: DayOfWeek;
  holiday?: RangedInput<HolidayType>;
  event?: RangedInput<EventType>;
  weather?: RangedInput<WeatherType>;
}

export interface RestaurantInput {
  category: "restaurant_cafe";
  seatingCapacity: number;
  score: number;
  dayOfWeek: DayOfWeek;
  meal: MealTime;
}

export interface MarketInput {
  category: "market_shopping";
  peakAnchor?: number;
  score: number;
  dayOfWeek: DayOfWeek;
  sale?: RangedInput<SaleType>;
  weather?: RangedInput<WeatherType>;
}

export interface EventVenueInput {
  category: "event_venue";
  capacity: number;
  dayOfWeek: DayOfWeek;
  eventState: RangedInput<VenueEventState>;
}

export type CrowdEstimateInput =
  | ReligiousSiteInput
  | RestaurantInput
  | MarketInput
  | EventVenueInput;

export type CrowdLevel = "quiet" | "moderate" | "peak";

export interface CrowdEstimateResult {
  category: Category;
  estimatedMidpoint: number;
  range: {
    low: number;
    high: number;
  };
  level: CrowdLevel;
  levelLabel: string;
  multipliersApplied: Record<string, number>;
  score: number;
  formulaUsed: string;
}
