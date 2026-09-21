import { generateWithGemini } from "./providers/gemini";
import { generateWithOpenAI } from "./providers/openai";
import { WEEK_ORDER } from "../scraper/googleMaps";
import { PopularTimesBar, PopularTimesByDay } from "../scraper/types";
import { DayOfWeek } from "../formulas/types";

/**
 * Fallback for when Google Maps has no Popular Times data for a POI at all
 * (see DOCUMENTATION.md §9 — this is common for smaller/less-visited places).
 * Asks OpenAI and Gemini INDEPENDENTLY to estimate a typical weekly crowd
 * pattern, reconciles the two answers (averaged, same spirit as the
 * historical-analysis cross-check), and expands the result into the same
 * `PopularTimesByDay` shape real scraped data uses — so every downstream
 * formula/route treats it identically, no special-casing required. The
 * caller is responsible for clearly flagging results built this way as
 * AI-estimated rather than scraped (see `source` field in the result).
 */

// LLMs asked for 168 individual hourly numbers (7 days x 24h) tend to
// produce unreliable/inconsistent JSON. Asking for 5 dayparts x 7 days (35
// numbers) is a much more tractable structured-output task, then we expand
// each day's 5 numbers into a smooth 24-hour curve ourselves.
const DAYPARTS = ["late_night", "morning", "afternoon", "evening", "night"] as const;
type Daypart = (typeof DAYPARTS)[number];

// Representative hour (0-23) each daypart is centered on, used to
// interpolate a full 24-hour curve from the 5 daypart values.
const DAYPART_CENTER_HOUR: Record<Daypart, number> = {
  late_night: 2, // ~12am-6am
  morning: 9, // ~6am-12pm
  afternoon: 14.5, // ~12pm-5pm
  evening: 19, // ~5pm-9pm
  night: 22.5, // ~9pm-12am
};

type DaypartScores = Record<Daypart, number>;

interface ParsedEstimate {
  confidence: number;
  caveats: string[];
  days: Record<DayOfWeek, DaypartScores>;
  /** 0-23, typical daily opening hour. */
  opensHour: number;
  /**
   * Typical daily closing hour. > 24 means it closes that many hours past
   * midnight the NEXT day (e.g. closes 1 AM -> 25) — avoids the ambiguity of
   * "1" meaning 1 AM vs. 1 PM when paired with a late opening hour. 24 means
   * open all day.
   */
  closesHour: number;
}

function buildPrompt(placeName: string, category?: string, city?: string): string {
  const context = [`Place: ${placeName}`, category ? `Category: ${category}` : null, city ? `City: ${city}` : null]
    .filter(Boolean)
    .join("\n");

  return `You are a crowd/foot-traffic analyst. Google Maps has no "Popular Times" data for
this specific place, so estimate a plausible typical-week busyness pattern yourself. You have
live web search available — use it. Do not answer from memorized training data alone; a
place's actual busyness pattern depends on specifics (exact opening hours, whether it's a
lunch/dinner spot or all-day, local commute patterns, religious/market timings) that generic
knowledge won't get right.

${context}

Before answering, search for and weigh signals like these, in roughly this priority order:
1. The place's own official page, Google Maps/Google Business listing, or a delivery/booking
   site — for exact opening hours (including which days it's closed, if any) and category.
2. Recent visitor reviews (Google, Zomato, TripAdvisor, etc.) that mention crowds, queues,
   wait times, "best time to visit", or specific busy/quiet hours — reviews from the last 1-2
   years matter more than old ones.
3. This category's well-documented general pattern in this specific city (e.g. a market's
   evening rush, a temple's early-morning and evening prayer-time peaks, a restaurant's lunch
   and dinner windows) if nothing more specific to this exact place turns up.
4. If this exact POI has genuinely no coverage anywhere, reason from comparable venues (same
   category, same city/region) rather than inventing specifics — and say so explicitly in
   "caveats" when you do this.

IMPORTANT — check whether this is a landmark, shrine, gate, tower, or sub-feature located
INSIDE a larger complex (a temple, fort, palace, park, religious site) rather than a
standalone venue. If so, its real accessible hours very likely follow the PARENT complex's
hours (which can be very early-to-late, e.g. a Sikh gurdwara complex open ~4-5 AM to
~10-11 PM), not generic category-typical hours for its own type (e.g. "museum hours" of
9-6). Search for the parent complex's hours specifically if this exact sub-feature's own
hours aren't separately published — defaulting to a generic standalone-venue assumption for
something that's actually just one part of a bigger, longer-hours complex is a common and
avoidable mistake.

Prefer a realistic, non-flat shape over a smooth generic guess — real venues have distinct
peaks and troughs, not gently rising and falling curves. For example: a restaurant/cafe
typically has two separate peaks (lunch and dinner) with a real trough between them, not one
wide midday hump; a religious site often peaks at specific prayer/darshan/aarti times, not just
"more busy in the evening"; a market or shopping venue is usually quiet in the morning and
peaks in the evening/weekend. Use whatever you actually found to shape this — don't force a
venue into a template pattern that contradicts real evidence.

Also find this place's typical DAILY opening/closing hours (most venues are closed for at
least part of every day — this matters a lot, see below). If the place is closed on certain
whole day(s) of the week, additionally set every day-part to 0 for that day rather than
guessing a low-but-nonzero number. If you can't determine hours at all, assume normal hours
for the category rather than defaulting to open 24 hours.

Respond with ONLY a single JSON object (no markdown fences, no commentary):
{
  "confidence": number,      // 0-1 — see calibration below
  "caveats": string[],       // e.g. "no direct data found, reasoned from category norms"
  "opensHour": number,       // 0-23, typical daily opening hour (24-hour clock)
  "closesHour": number,      // typical daily closing hour. If it closes after midnight, ADD 24
                              // (e.g. closes 1 AM -> 25). Use 24 if genuinely open 24 hours.
  "days": {
    "sunday":    { "late_night": number, "morning": number, "afternoon": number, "evening": number, "night": number },
    "monday":    { "late_night": number, "morning": number, "afternoon": number, "evening": number, "night": number },
    "tuesday":   { "late_night": number, "morning": number, "afternoon": number, "evening": number, "night": number },
    "wednesday": { "late_night": number, "morning": number, "afternoon": number, "evening": number, "night": number },
    "thursday":  { "late_night": number, "morning": number, "afternoon": number, "evening": number, "night": number },
    "friday":    { "late_night": number, "morning": number, "afternoon": number, "evening": number, "night": number },
    "saturday":  { "late_night": number, "morning": number, "afternoon": number, "evening": number, "night": number }
  }
}
Every number is 0-100 busyness for that day-part (0 = closed/empty, 100 = as busy as this
place ever gets). "late_night" covers ~12am-6am — use 0 for anything not open overnight.

Confidence calibration:
- 0.8-1.0: multiple recent, specific sources directly about this exact place (stated hours
  plus reviews mentioning actual busy/quiet times).
- 0.5-0.8: some direct signal (e.g. official hours plus a handful of relevant reviews), rest
  filled in with reasonable category/city inference.
- 0.2-0.5: little to no direct signal — mostly reasoned from category/city norms or a
  comparable venue.
- Below 0.2: essentially guessing with no real grounding; still fill in a plausible shape, but
  say so plainly in "caveats" rather than implying this was researched.`;
}

function clamp01to100(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(100, Math.max(0, Math.round(v)));
}

/**
 * Clamps to a sane hour range. `closesHour` <= `opensHour` is nonsensical
 * (e.g. a parse glitch or the model ignoring instructions) — fail safe to
 * "open all day" (0-24) rather than let a bad pair zero out every real hour
 * of the estimate.
 */
function clampOperatingHours(opensRaw: unknown, closesRaw: unknown): { opensHour: number; closesHour: number } {
  const opens = typeof opensRaw === "number" && Number.isFinite(opensRaw) ? Math.round(opensRaw) : 0;
  const closes = typeof closesRaw === "number" && Number.isFinite(closesRaw) ? Math.round(closesRaw) : 24;
  const opensHour = Math.min(23, Math.max(0, opens));
  const closesHour = Math.min(48, Math.max(0, closes));
  if (closesHour <= opensHour) return { opensHour: 0, closesHour: 24 };
  return { opensHour, closesHour };
}

function parseEstimate(raw: string): ParsedEstimate {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    // The model occasionally writes numbers with underscore digit separators
    // (e.g. "5_000") — valid in JS/Python numeric literals, not valid JSON,
    // and enough to fail JSON.parse() outright (confirmed live in
    // anchorEstimate.ts). Strip separators between digits before parsing.
    .replace(/(\d)_(?=\d)/g, "$1")
    .trim();
  const parsed = JSON.parse(cleaned);

  const days = {} as Record<DayOfWeek, DaypartScores>;
  for (const day of WEEK_ORDER) {
    const src = parsed.days?.[day] ?? {};
    days[day] = {
      late_night: clamp01to100(src.late_night),
      morning: clamp01to100(src.morning),
      afternoon: clamp01to100(src.afternoon),
      evening: clamp01to100(src.evening),
      night: clamp01to100(src.night),
    };
  }

  return {
    confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.2,
    caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((c: unknown) => typeof c === "string") : [],
    days,
    ...clampOperatingHours(parsed.opensHour, parsed.closesHour),
  };
}

/**
 * Whether `hour` (0-23) falls within [opensHour, closesHour) — `closesHour`
 * may exceed 24 to represent closing after midnight (see ParsedEstimate).
 */
function isHourOpen(hour: number, opensHour: number, closesHour: number): boolean {
  if (closesHour <= 24) return hour >= opensHour && hour < closesHour;
  return hour >= opensHour || hour < closesHour - 24;
}

/** Circular linear interpolation between the two nearest daypart centers for a given hour. */
function interpolateHour(hour: number, scores: DaypartScores): number {
  const points = DAYPARTS.map((d) => ({ hour: DAYPART_CENTER_HOUR[d], value: scores[d] })).sort(
    (a, b) => a.hour - b.hour
  );

  let before = points[points.length - 1];
  let after = points[0];
  for (let i = 0; i < points.length; i++) {
    if (points[i].hour <= hour) before = points[i];
    if (points[i].hour >= hour && after === points[0]) after = points[i];
  }
  if (before === after) return before.value;

  const span = before.hour < after.hour ? after.hour - before.hour : 24 - before.hour + after.hour;
  const dist = hour >= before.hour ? hour - before.hour : 24 - before.hour + hour;
  const t = span === 0 ? 0 : dist / span;
  return before.value + (after.value - before.value) * t;
}

function formatHourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "am" : "pm"}`;
}

/**
 * Expands 5 daypart scores into a full 24-hour curve, then hard-zeroes any
 * hour outside [opensHour, closesHour) — enforced here in code rather than
 * left to the model to self-censor every daypart correctly. This is what
 * lets `recommended_entry_slot` (crowdIntelligence.ts) correctly exclude
 * closed hours from "quietest hour" — it already filters to `percentage > 0`
 * bars, which only works if closed hours are genuinely 0, not just low.
 */
function daypartsToHourlyBars(scores: DaypartScores, opensHour: number, closesHour: number): PopularTimesBar[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    percentage: isHourOpen(hour, opensHour, closesHour) ? clamp01to100(interpolateHour(hour, scores)) : 0,
    hourLabel: formatHourLabel(hour),
  }));
}

export interface AiEstimatedWeek {
  source: "ai_estimated";
  providersUsed: Array<"openai" | "gemini">;
  confidence: number;
  caveats: string[];
  popularTimesByDay: PopularTimesByDay;
}

// This was previously called fresh on every single request for a POI with
// no Popular Times data — confirmed live, zero caching existed despite
// being a real OpenAI+Gemini call every time. A POI's typical crowd SHAPE
// doesn't change hour to hour, but (unlike the anchor's near-permanent
// physical capacity — see ai/anchorEstimate.ts) its popularity trend can
// genuinely shift over weeks, so this gets a real TTL rather than the
// anchor's permanent DB persistence — a deliberate, explicit product
// choice, not an oversight.
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

interface CachedWeek {
  value: AiEstimatedWeek;
  expiresAt: number;
}

const cache = new Map<string, CachedWeek>();

function cacheKeyFor(placeId: string | null | undefined, placeName: string, city: string | undefined): string {
  if (placeId) return `placeId:${placeId}`;
  return `name:${placeName.trim().toLowerCase()}|${(city ?? "").trim().toLowerCase()}`;
}

export async function estimateCrowdPatternWithAi(input: {
  placeName: string;
  category?: string;
  city?: string;
  placeId?: string | null;
}): Promise<AiEstimatedWeek | null> {
  const cacheKey = cacheKeyFor(input.placeId, input.placeName, input.city);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const prompt = buildPrompt(input.placeName, input.category, input.city);
  const [openaiRaw, geminiRaw] = await Promise.all([
    generateWithOpenAI(prompt, input.city),
    generateWithGemini(prompt),
  ]);

  const openai = openaiRaw.ok && openaiRaw.text ? tryParse(openaiRaw.text) : null;
  const gemini = geminiRaw.ok && geminiRaw.text ? tryParse(geminiRaw.text) : null;

  if (!openai && !gemini) return null;

  const providersUsed: Array<"openai" | "gemini"> = [
    ...(openai ? (["openai"] as const) : []),
    ...(gemini ? (["gemini"] as const) : []),
  ];

  const days = {} as Record<DayOfWeek, DaypartScores>;
  for (const day of WEEK_ORDER) {
    const o = openai?.days[day];
    const g = gemini?.days[day];
    days[day] = {} as DaypartScores;
    for (const part of DAYPARTS) {
      const values = [o?.[part], g?.[part]].filter((v): v is number => v !== undefined);
      days[day][part] = values.length
        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        : 0;
    }
  }

  // Union, not intersection — confirmed live (Ramgarhia Bunga, a landmark
  // inside the Golden Temple complex): OpenAI defaulted to a generic
  // "monument hours" guess (9am-6pm) while Gemini correctly researched the
  // real, much wider hours (5am-10pm) it actually keeps by following its
  // parent complex. Intersection picked the WRONG (narrower, OpenAI's)
  // answer here — taking the safer-sounding option actively made the result
  // worse. When a provider doesn't find real data it tends to default to a
  // too-NARROW generic guess, not a too-wide one, so trusting whichever
  // provider claims the wider window is the better default in practice.
  const estimates = [openai, gemini].filter((p): p is ParsedEstimate => p !== null);
  const opensHour = estimates.length ? Math.min(...estimates.map((e) => e.opensHour)) : 0;
  const closesHour = estimates.length ? Math.max(...estimates.map((e) => e.closesHour)) : 24;
  // Flagged transparently rather than silently resolved — a >2h gap between
  // the two providers' hours means at least one of them is likely guessing,
  // not reporting a confirmed fact.
  const HOURS_DISAGREEMENT_THRESHOLD_HOURS = 2;
  const hoursDisagree =
    estimates.length === 2 &&
    (Math.abs(estimates[0].opensHour - estimates[1].opensHour) > HOURS_DISAGREEMENT_THRESHOLD_HOURS ||
      Math.abs(estimates[0].closesHour - estimates[1].closesHour) > HOURS_DISAGREEMENT_THRESHOLD_HOURS);

  const confidences = [openai?.confidence, gemini?.confidence].filter((c): c is number => c !== undefined);
  const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  // Single-source estimates (only one provider answered) are less trustworthy
  // than a cross-checked one — same discount logic as historicalAnalysis.ts.
  const confidence = providersUsed.length === 2 ? avgConfidence : avgConfidence * 0.7;

  const caveats = [
    ...new Set([...(openai?.caveats ?? []), ...(gemini?.caveats ?? [])]),
    "This is an AI-generated estimate, not scraped from Google Maps — Google has no Popular Times data for this specific place.",
    ...(providersUsed.length === 1 ? [`Only ${providersUsed[0]} responded — treat with lower confidence.`] : []),
    ...(hoursDisagree
      ? [
          `OpenAI and Gemini disagreed on this place's operating hours by more than ${HOURS_DISAGREEMENT_THRESHOLD_HOURS}h — used the wider of the two; verify independently if precision matters.`,
        ]
      : []),
  ];

  const popularTimesByDay = {} as PopularTimesByDay;
  for (const day of WEEK_ORDER) {
    popularTimesByDay[day] = daypartsToHourlyBars(days[day], opensHour, closesHour);
  }

  const result: AiEstimatedWeek = {
    source: "ai_estimated",
    providersUsed,
    confidence: Number(confidence.toFixed(2)),
    caveats,
    popularTimesByDay,
  };
  cache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

function tryParse(text: string): ParsedEstimate | null {
  try {
    return parseEstimate(text);
  } catch {
    return null;
  }
}
