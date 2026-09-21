import {
  CATEGORY_EXPONENT,
  DEFAULT_PEAK_ANCHOR,
  EVENT_MULTIPLIER,
  EVENT_VENUE_DAY_MULTIPLIER,
  HOLIDAY_MULTIPLIER,
  MARKET_WEATHER_MULTIPLIER,
  MARKET_WEEKEND_MULTIPLIER,
  MEAL_MULTIPLIER,
  RESTAURANT_WEEKEND_MULTIPLIER,
  SALE_MULTIPLIER,
  VENUE_EVENT_MULTIPLIER,
  WEATHER_MULTIPLIER,
  WEEKEND_MULTIPLIER,
  resolveRange,
} from "./categories";
import {
  CrowdEstimateInput,
  CrowdEstimateResult,
  CrowdLevel,
  EventVenueInput,
  MarketInput,
  ReligiousSiteInput,
  RestaurantInput,
} from "./types";

/** Livecrowd.md #5: never show an exact number — always a +-20% range. */
function toRange(midpoint: number): { low: number; high: number } {
  return {
    low: Math.round(midpoint * 0.8),
    high: Math.round(midpoint * 1.2),
  };
}

/**
 * Livecrowd.md #5: level is derived from how close the estimate sits to the
 * venue's own peak capacity/anchor, so the same thresholds work whether the
 * anchor is 100,000 (temple) or 50 (restaurant).
 */
function levelFromRatio(estimated: number, anchor: number): CrowdLevel {
  const ratio = anchor > 0 ? estimated / anchor : 0;
  if (ratio >= 0.6) return "peak";
  if (ratio >= 0.3) return "moderate";
  return "quiet";
}

const LEVEL_LABEL: Record<CrowdLevel, string> = {
  quiet: "🟢 Quiet",
  moderate: "🟡 Moderate Crowd",
  peak: "🔴 Peak Crowd",
};

function calculateReligiousSite(
  input: ReligiousSiteInput
): CrowdEstimateResult {
  const anchor = input.peakAnchor ?? DEFAULT_PEAK_ANCHOR.religious_site;
  const exponent = CATEGORY_EXPONENT.religious_site;

  const dWeekend = WEEKEND_MULTIPLIER[input.dayOfWeek];
  const dHoliday = resolveRange(
    HOLIDAY_MULTIPLIER[input.holiday?.type ?? "none"],
    input.holiday?.intensity
  );
  const dEvent = resolveRange(
    EVENT_MULTIPLIER[input.event?.type ?? "none"],
    input.event?.intensity
  );
  const dWeather = resolveRange(
    WEATHER_MULTIPLIER[input.weather?.type ?? "pleasant"],
    input.weather?.intensity
  );

  const midpoint =
    anchor *
    Math.pow(input.score / 100, exponent) *
    dWeekend *
    dHoliday *
    dEvent *
    dWeather;

  return {
    category: "religious_site",
    estimatedMidpoint: Math.round(midpoint),
    range: toRange(midpoint),
    level: levelFromRatio(midpoint, anchor),
    levelLabel: LEVEL_LABEL[levelFromRatio(midpoint, anchor)],
    multipliersApplied: {
      D_weekend: dWeekend,
      D_holiday: dHoliday,
      D_event: dEvent,
      D_weather: dWeather,
    },
    score: input.score,
    formulaUsed: "P x (Score/100)^1.5 x D_weekend x D_holiday x D_event x D_weather",
  };
}

function calculateRestaurant(input: RestaurantInput): CrowdEstimateResult {
  const anchor = input.seatingCapacity;
  const exponent = CATEGORY_EXPONENT.restaurant_cafe;

  const dMeal = MEAL_MULTIPLIER[input.meal];
  const dWeekend = RESTAURANT_WEEKEND_MULTIPLIER[input.dayOfWeek];

  const midpoint =
    anchor * Math.pow(input.score / 100, exponent) * dMeal * dWeekend;

  return {
    category: "restaurant_cafe",
    estimatedMidpoint: Math.round(midpoint),
    range: toRange(midpoint),
    level: levelFromRatio(midpoint, anchor),
    levelLabel: LEVEL_LABEL[levelFromRatio(midpoint, anchor)],
    multipliersApplied: { D_meal: dMeal, D_weekend: dWeekend },
    score: input.score,
    formulaUsed: "C x (Score/100)^1.2 x D_meal x D_weekend",
  };
}

function calculateMarket(input: MarketInput): CrowdEstimateResult {
  const anchor = input.peakAnchor ?? DEFAULT_PEAK_ANCHOR.market_shopping;
  const exponent = CATEGORY_EXPONENT.market_shopping;

  const dWeekend = MARKET_WEEKEND_MULTIPLIER[input.dayOfWeek];
  const dSale = resolveRange(
    SALE_MULTIPLIER[input.sale?.type ?? "none"],
    input.sale?.intensity
  );
  const dWeather = resolveRange(
    MARKET_WEATHER_MULTIPLIER[input.weather?.type ?? "pleasant"],
    input.weather?.intensity
  );

  const midpoint =
    anchor *
    Math.pow(input.score / 100, exponent) *
    dWeekend *
    dSale *
    dWeather;

  return {
    category: "market_shopping",
    estimatedMidpoint: Math.round(midpoint),
    range: toRange(midpoint),
    level: levelFromRatio(midpoint, anchor),
    levelLabel: LEVEL_LABEL[levelFromRatio(midpoint, anchor)],
    multipliersApplied: {
      D_weekend: dWeekend,
      D_sale: dSale,
      D_weather: dWeather,
    },
    score: input.score,
    formulaUsed: "P x (Score/100)^1.3 x D_weekend x D_sale x D_weather",
  };
}

function calculateEventVenue(input: EventVenueInput): CrowdEstimateResult {
  const anchor = input.capacity;

  const dEvent = resolveRange(
    VENUE_EVENT_MULTIPLIER[input.eventState.type],
    input.eventState.intensity
  );
  const dDay = EVENT_VENUE_DAY_MULTIPLIER[input.dayOfWeek];

  const midpoint = anchor * dEvent * dDay;

  return {
    category: "event_venue",
    estimatedMidpoint: Math.round(midpoint),
    range: toRange(midpoint),
    level: levelFromRatio(midpoint, anchor),
    levelLabel: LEVEL_LABEL[levelFromRatio(midpoint, anchor)],
    multipliersApplied: { D_event: dEvent, D_day: dDay },
    score: 0,
    formulaUsed: "Capacity x D_event x D_day",
  };
}

export function calculateCrowdEstimate(
  input: CrowdEstimateInput
): CrowdEstimateResult {
  switch (input.category) {
    case "religious_site":
      return calculateReligiousSite(input);
    case "restaurant_cafe":
      return calculateRestaurant(input);
    case "market_shopping":
      return calculateMarket(input);
    case "event_venue":
      return calculateEventVenue(input);
  }
}
