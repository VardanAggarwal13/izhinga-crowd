import { calculateCrowdEstimateForMdCategory, MdCrowdEstimateContext } from "./mdCategoryEngine";
import { PopularTimesBar, PopularTimesByDay } from "../scraper/types";
import { Category, DayOfWeek } from "./types";

export type FourTierLevel = "Low" | "Moderate" | "High" | "Very High";

/**
 * A single representative "how busy is this place today" score from a day's
 * hourly bars — used as a `score` fallback wherever we don't reliably know
 * the current hour (see DOCUMENTATION.md §9: Google gives no stable signal
 * for "this is the current hour" bar). Averages only open hours (percentage
 * > 0) so closed overnight hours don't drag down a place's typical daytime
 * busyness.
 */
export function averageOpenHoursScore(bars: PopularTimesBar[]): number {
  const open = bars.filter((b) => b.percentage > 0);
  const pool = open.length > 0 ? open : bars;
  if (pool.length === 0) return 0;
  return Math.round(pool.reduce((sum, b) => sum + b.percentage, 0) / pool.length);
}

/**
 * A 4-tier scale for this presentation layer only — separate from the engine's
 * own 3-tier quiet/moderate/peak (Livecrowd.md §5), which stays as-is since
 * /api/crowd/estimate already documents and returns that. Thresholds here are
 * a judgment call, not from Livecrowd.md; tune freely.
 */
function toFourTierLevel(ratio: number): FourTierLevel {
  if (ratio >= 0.75) return "Very High";
  if (ratio >= 0.5) return "High";
  if (ratio >= 0.25) return "Moderate";
  return "Low";
}

/**
 * Estimated queue/entry wait, scaled linearly by how close the estimate sits
 * to this POI's own busiest-hour-of-the-week. This is NOT in Livecrowd.md —
 * there is no ground-truth wait-time data anywhere in this pipeline. It's a
 * heuristic introduced specifically to satisfy the frontend's
 * `current_wait_time` field; tune `MAX_WAIT_MINUTES` per engine category as
 * real data comes in.
 */
const MAX_WAIT_MINUTES: Record<Category, number> = {
  religious_site: 90,
  restaurant_cafe: 30,
  market_shopping: 15,
  event_venue: 45,
};

function estimateWaitMinutes(engineCategory: Category, ratio: number): number {
  return Math.round(Math.min(1, Math.max(0, ratio)) * MAX_WAIT_MINUTES[engineCategory]);
}

/**
 * "current_status" label — also not in Livecrowd.md. Prioritizes whichever
 * special multiplier is actually active in the request context (so it stays
 * traceable to real input, not invented), falling back to a generic
 * level-based label otherwise.
 */
function deriveCurrentStatus(level: FourTierLevel, ctx: MdCrowdEstimateContext): string {
  if (ctx.holiday && ctx.holiday.type !== "none") {
    return ctx.holiday.type === "extreme_event" ? "Extreme Event Surge" : "Festival Surge";
  }
  if (ctx.event && ctx.event.type !== "none") {
    return ctx.event.type === "city_wide" ? "City Event Surge" : "Event Surge";
  }
  switch (level) {
    case "Very High":
      return "Peak Rush";
    case "High":
      return "Busy";
    case "Moderate":
      return "Moderate Crowd";
    case "Low":
      return "Normal";
  }
}

// --- Hour parsing/formatting -------------------------------------------

/** "6 am" / "12 pm" -> 0-23. Returns null if unparseable (Google occasionally drops a label). */
function parseHour(label: string): number | null {
  const match = label.trim().match(/^(\d{1,2})\s*(am|pm)$/i);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[2].toLowerCase() === "pm") hour += 12;
  return hour;
}

/** Fills any unparseable labels by walking neighbors — each block is sequential hours. */
function inferHours(bars: PopularTimesBar[]): number[] {
  const parsed = bars.map((b) => parseHour(b.hourLabel));
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i] !== null) continue;
    const prev = i > 0 ? parsed[i - 1] : null;
    if (prev !== null) {
      parsed[i] = (prev + 1) % 24;
      continue;
    }
    const next = parsed.slice(i + 1).find((h) => h !== null) ?? null;
    parsed[i] = next !== null ? (next - (parsed.slice(i + 1).indexOf(next) + 1) + 24) % 24 : i;
  }
  return parsed as number[];
}

function formatHour24(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** "7 PM" — no minutes, used for range boundaries like "7 PM - 9 PM". */
function formatHourShort(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "AM" : "PM"}`;
}

/** "5:00 PM" — with minutes, used for a specific recommended clock time. */
function formatClockTime(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * Peak window(s) for a day: contiguous runs of hours within 80% of that day's
 * own busiest hour (relative to itself, not a global severity tier — matches
 * the frontend's example, where even a "Low" day still gets a peak_hours
 * window). Multiple separate qualifying runs are joined with a comma (e.g. a
 * bimodal "8 AM - 11 AM, 6 PM - 10 PM" day). Based on raw Google scores, not
 * derived visitor counts, so this is unaffected by which calculation model
 * (daily-footfall vs peak-capacity) is used below.
 */
function computePeakHours(bars: PopularTimesBar[]): string {
  if (bars.length === 0) return "No data";
  const hours = inferHours(bars);
  const maxPct = Math.max(...bars.map((b) => b.percentage));
  if (maxPct <= 0) return "No data";
  const threshold = maxPct * 0.8;

  const ranges: Array<[number, number]> = [];
  let runStart: number | null = null;

  for (let i = 0; i <= bars.length; i++) {
    const qualifies = i < bars.length && bars[i].percentage >= threshold;
    if (qualifies && runStart === null) {
      runStart = i;
    } else if (!qualifies && runStart !== null) {
      ranges.push([hours[runStart], (hours[i - 1] + 1) % 24]);
      runStart = null;
    }
  }

  return ranges.map(([start, end]) => `${formatHourShort(start)} - ${formatHourShort(end)}`).join(", ");
}

// --- Calculation models --------------------------------------------------

/**
 * Categories where the anchor represents a DAILY total (footfall over the
 * whole day) rather than a simultaneous/instantaneous ceiling. Decided
 * 2026-09 after finding that Livecrowd.md's original peak-hour-capacity
 * model needs a number (max simultaneous visitors) that's almost never
 * publicly known for temples/markets/etc — daily footfall is the number
 * that's actually sourceable for these. Eateries (seating count) and
 * event_venue (venue capacity) keep the original model: their anchor IS a
 * real simultaneous ceiling, so distributing a "daily total" across hours
 * would fight against a hard physical limit that already applies per-hour.
 */
export const DAILY_FOOTFALL_CATEGORIES: ReadonlySet<Category> = new Set(["religious_site", "market_shopping"]);

interface HourEstimate {
  hour: number;
  percentage: number;
  estimate: number;
}

/**
 * One day's hourly visitor-count estimates, using whichever model fits the
 * resolved engine category:
 *
 * - Daily-footfall categories: `adjustedDailyTotal × (hour_score ÷ day_score_sum)`.
 *   `adjustedDailyTotal` is `anchor × D_weekend × D_holiday × D_event × D_weather`
 *   for that specific day — gotten for free by calling the normal formula
 *   with score=100, since (100/100)^exponent = 1 regardless of exponent, which
 *   cancels the power curve out and leaves exactly anchor × multipliers. This
 *   also means the exponent is moot for this model — Google's raw per-hour
 *   scores are used directly as proportional weights for splitting a known
 *   total, which is a linear operation by nature.
 * - Everything else (restaurant_cafe): the original Livecrowd.md formula,
 *   applied independently per hour exactly as before.
 */
function computeDayEstimates(
  mdCategoryRaw: string,
  engineCategory: Category,
  bars: PopularTimesBar[],
  day: DayOfWeek,
  ctx: MdCrowdEstimateContext
): HourEstimate[] {
  const hours = inferHours(bars);

  if (DAILY_FOOTFALL_CATEGORIES.has(engineCategory)) {
    const daySum = bars.reduce((sum, b) => sum + b.percentage, 0);
    const atPeak = calculateCrowdEstimateForMdCategory(mdCategoryRaw, { ...ctx, dayOfWeek: day, score: 100 });
    if (!atPeak.ok) throw new Error(`Unexpected failure on a probed-good category: ${atPeak.reason}`);
    const adjustedDailyTotal = atPeak.estimatedMidpoint;

    return bars.map((bar, i) => ({
      hour: hours[i],
      percentage: bar.percentage,
      estimate: daySum > 0 ? adjustedDailyTotal * (bar.percentage / daySum) : 0,
    }));
  }

  return bars.map((bar, i) => {
    const result = calculateCrowdEstimateForMdCategory(mdCategoryRaw, {
      ...ctx,
      dayOfWeek: day,
      score: bar.percentage,
    });
    if (!result.ok) throw new Error(`Unexpected failure on a probed-good category: ${result.reason}`);
    return { hour: hours[i], percentage: bar.percentage, estimate: result.estimatedMidpoint };
  });
}

// --- Main builder --------------------------------------------------------

export type CrowdIntelligenceFailure =
  | { ok: false; reason: "unsupported_category"; message: string }
  | { ok: false; reason: string; message: string };

export interface CrowdIntelligenceSuccess {
  ok: true;
  crowd_intelligence: {
    current_status: string;
    current_level: FourTierLevel;
    current_wait_time: string;
    recommended_entry_slot: { time: string; reason: string };
    weekly_trend: Array<{ day: string; overall_crowd_level: FourTierLevel; peak_hours: string }>;
    hourly_live_trend: {
      selected_day: string;
      time_slots: Array<{
        time: string;
        crowd_level: FourTierLevel;
        crowd_score: number;
        visitor_count: number;
      }>;
    };
  };
  /**
   * The exact math behind `current_status`/`current_level`/`current_wait_time`
   * above — not part of the frontend's original contract, but exposed so the
   * calculation is traceable/verifiable rather than a black box. Every
   * `hourly_live_trend` entry was computed the same way, just with that
   * hour's own score instead of `score_used`.
   */
  calculation: {
    formula: string;
    engine_category: Category;
    score_used: number;
    anchor_used: number;
    anchor_source: "default" | "override" | "manual" | "database" | "ai_estimated";
    /** Present when anchor_source is "database" or "ai_estimated" (see ai/anchorEstimate.ts). */
    anchor_estimate?: { confidence: number; caveats: string[]; verificationTier?: string; sourceType?: string };
    multipliers_applied: Record<string, number>;
    estimated_midpoint: number;
    range: { low: number; high: number };
  };
}

const WEEKLY_TREND_ORDER: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const CAPITALIZED_DAY: Record<DayOfWeek, string> = {
  sunday: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};

export function buildCrowdIntelligence(
  mdCategoryRaw: string,
  popularTimesByDay: PopularTimesByDay,
  ctx: MdCrowdEstimateContext & { selectedDay?: DayOfWeek }
): CrowdIntelligenceSuccess | CrowdIntelligenceFailure {
  const selectedDay = ctx.selectedDay ?? ctx.dayOfWeek;

  // Probe once to resolve category/anchor and catch unknown/not_created/manual
  // errors up front, using a neutral score.
  const probe = calculateCrowdEstimateForMdCategory(mdCategoryRaw, { ...ctx, score: 0 });
  if (!probe.ok) return probe;

  // event_venue (Stadium, Events_entertainment) has no per-hour score curve at
  // all — its formula (Capacity x D_event x D_day) ignores `score` entirely,
  // so the probe above always "succeeds" with a meaningless constant value
  // regardless of category fit. Must check the resolved engine category
  // directly rather than relying on a missing_score failure, since event_venue
  // never produces one (confirmed live: passing "Stadium" here silently
  // returned an all-"Low"/"No data" response instead of rejecting it).
  if (probe.category === "event_venue") {
    return {
      ok: false,
      reason: "unsupported_category",
      message: `mdCategory "${mdCategoryRaw}" maps to the "event_venue" formula, which has no hourly busyness curve to build crowd_intelligence from. Use /api/crowd/estimate or /api/crowd/live instead.`,
    };
  }

  // Compute every day's hourly estimates up front. Needed regardless of
  // model: for the daily-footfall categories, "Very High" can no longer mean
  // "close to the anchor" (a single hour's slice of a daily total will never
  // approach that total) — it has to mean "close to this POI's own busiest
  // hour of the whole week", which requires seeing all 7 days before any
  // single hour can be classified.
  const estimatesByDay = {} as Record<DayOfWeek, HourEstimate[]>;
  for (const day of WEEKLY_TREND_ORDER) {
    estimatesByDay[day] = computeDayEstimates(mdCategoryRaw, probe.category, popularTimesByDay[day], day, ctx);
  }

  const weekMaxEstimate = Math.max(
    0,
    ...Object.values(estimatesByDay)
      .flat()
      .map((h) => h.estimate)
  );
  const levelFor = (estimate: number): FourTierLevel =>
    toFourTierLevel(weekMaxEstimate > 0 ? estimate / weekMaxEstimate : 0);

  const weekly_trend = WEEKLY_TREND_ORDER.map((day) => {
    const hrs = estimatesByDay[day];
    if (hrs.length === 0) {
      return { day: CAPITALIZED_DAY[day], overall_crowd_level: "Low" as FourTierLevel, peak_hours: "No data" };
    }
    const dayMax = Math.max(...hrs.map((h) => h.estimate));
    return {
      day: CAPITALIZED_DAY[day],
      overall_crowd_level: levelFor(dayMax),
      peak_hours: computePeakHours(popularTimesByDay[day]),
    };
  });

  const selectedHrs = estimatesByDay[selectedDay];
  const hourly_live_trend = {
    selected_day: CAPITALIZED_DAY[selectedDay],
    time_slots: selectedHrs.map((h) => ({
      time: formatHour24(h.hour),
      crowd_level: levelFor(h.estimate),
      crowd_score: h.percentage, // Busyness percentage (0-100) — user-facing metric
      visitor_count: h.estimate, // Expected visitor count at this time — user-facing metric
    })),
  };

  const todayBars = popularTimesByDay[ctx.dayOfWeek];
  // Falling back to a hard 0 here would silently claim "totally empty" for a
  // place that's simply missing a live reading right now (confirmed
  // reachable: Google can have full historical Popular Times data for a POI
  // but no current "busy now" text at all) — averageOpenHoursScore reuses
  // today's own already-scraped hourly shape instead, an honest best guess
  // rather than a fabricated zero.
  const currentScore = ctx.score ?? averageOpenHoursScore(todayBars);

  let currentEstimate: number;
  let calcAnchorUsed: number;
  let calcAnchorSource: "default" | "override" | "manual" | "database" | "ai_estimated";
  let calcAnchorEstimate: { confidence: number; caveats: string[]; verificationTier?: string; sourceType?: string } | undefined;
  let calcFormula: string;
  let calcMultipliers: Record<string, number>;

  if (DAILY_FOOTFALL_CATEGORIES.has(probe.category)) {
    const daySum = todayBars.reduce((sum, b) => sum + b.percentage, 0);
    const atPeak = calculateCrowdEstimateForMdCategory(mdCategoryRaw, { ...ctx, score: 100 });
    if (!atPeak.ok) throw new Error("Unexpected failure on a probed-good category (current, at-peak).");
    currentEstimate = daySum > 0 ? atPeak.estimatedMidpoint * (currentScore / daySum) : 0;
    calcAnchorUsed = atPeak.anchorUsed;
    calcAnchorSource = atPeak.anchorSource;
    calcAnchorEstimate = atPeak.anchorEstimate;
    calcFormula = `Daily Footfall x D_weekend x D_holiday x D_event x D_weather, then distributed across hours as (hour_score / day_score_sum) — see DOCUMENTATION.md`;
    calcMultipliers = atPeak.multipliersApplied;
  } else {
    const result = calculateCrowdEstimateForMdCategory(mdCategoryRaw, { ...ctx, score: currentScore });
    if (!result.ok) throw new Error("Unexpected failure on a probed-good category (current).");
    currentEstimate = result.estimatedMidpoint;
    calcAnchorUsed = result.anchorUsed;
    calcAnchorSource = result.anchorSource;
    calcAnchorEstimate = result.anchorEstimate;
    calcFormula = result.formulaUsed;
    calcMultipliers = result.multipliersApplied;
  }

  const currentRatio = weekMaxEstimate > 0 ? currentEstimate / weekMaxEstimate : 0;
  const currentLevel = toFourTierLevel(currentRatio);

  let recommended_entry_slot = { time: "N/A", reason: "No Popular Times data available for this POI" };
  if (todayBars.length > 0) {
    const hours = inferHours(todayBars);
    const openBars = todayBars
      .map((b, i) => ({ ...b, hour: hours[i] }))
      .filter((b) => b.percentage > 0);
    const pool = openBars.length > 0 ? openBars : todayBars.map((b, i) => ({ ...b, hour: hours[i] }));
    const quietest = pool.reduce((min, b) => (b.percentage < min.percentage ? b : min), pool[0]);
    recommended_entry_slot = { time: formatClockTime(quietest.hour), reason: "Expected lower crowd" };
  }

  return {
    ok: true,
    crowd_intelligence: {
      current_status: deriveCurrentStatus(currentLevel, ctx),
      current_level: currentLevel,
      current_wait_time: `${estimateWaitMinutes(probe.category, currentRatio)} min`,
      recommended_entry_slot,
      weekly_trend,
      hourly_live_trend,
    },
    calculation: {
      formula: calcFormula,
      engine_category: probe.category,
      score_used: currentScore,
      anchor_used: calcAnchorUsed,
      anchor_source: calcAnchorSource,
      ...(calcAnchorEstimate ? { anchor_estimate: calcAnchorEstimate } : {}),
      multipliers_applied: calcMultipliers,
      estimated_midpoint: Math.round(currentEstimate),
      range: { low: Math.round(currentEstimate * 0.8), high: Math.round(currentEstimate * 1.2) },
    },
  };
}
