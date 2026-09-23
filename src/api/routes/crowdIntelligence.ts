import { Router } from "express";
import { z } from "zod";
import { getEstimatedAnchor } from "../../ai/anchorEstimate";
import { estimateCrowdPatternWithAi } from "../../ai/crowdPatternEstimate";
import { getTodayCalendarOverrides } from "../../db/calendarRepository";
import { averageOpenHoursScore, buildCrowdIntelligence } from "../../formulas/crowdIntelligence";
import { resolveMdCategory } from "../../formulas/mdCategories";
import { scrapePoi, scrapePoiByPlaceId } from "../../scraper/googleMaps";
import { PopularTimesByDay } from "../../scraper/types";
import { autoDetectDayOfWeek } from "../../time/autoDetectDayOfWeek";
import { getAutoWeather } from "../../weather/autoDetectWeather";
import { asyncHandler } from "../asyncHandler";
import { crowdIntelligenceRequestSchema } from "../validation";
import { validateBody } from "../validate";

export const crowdIntelligenceRouter = Router();

const FAILURE_STATUS: Record<string, number> = {
  unknown_category: 400,
  not_created: 422,
  manual_allotment_missing_override: 400,
  missing_score: 400,
  unsupported_category: 400,
};

type Body = z.infer<typeof crowdIntelligenceRequestSchema>;

function isEmptyWeek(week: PopularTimesByDay): boolean {
  return Object.values(week).every((day) => day.length === 0);
}

/**
 * The frontend's contract: identify a place by Google `place_id` (preferred
 * — no search-ambiguity risk) or, when the caller doesn't have one yet, by
 * `poi_name` (a free-text name/search string). When both are given,
 * `place_id` wins. Returns the exact `crowd_intelligence` shape they
 * specified (current status/level/wait time, a recommended entry slot, a
 * 7-day trend, and an hourly breakdown for one selected day) — all derived
 * from the real Livecrowd.md formula per hour, not a separate invented
 * scoring system.
 *
 * When Google has no Popular Times data at all for this place, falls back to
 * asking OpenAI and Gemini to independently estimate a plausible pattern and
 * cross-checks their two answers (see ai/crowdPatternEstimate.ts) — clearly
 * flagged in the response via `place.data_source`, never silently presented
 * as real scraped data.
 */
crowdIntelligenceRouter.post(
  "/api/crowd/intelligence",
  validateBody(crowdIntelligenceRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as Body;

    // event_venue (Stadium, Events_entertainment) has no hourly busyness
    // curve at all — buildCrowdIntelligence rejects it further down
    // regardless, but checking here FIRST avoids wasting a real scrape and a
    // real AI-fallback call on a request that can never succeed. Confirmed
    // live: without this check, a Stadium POI with no Popular Times data
    // burned a full OpenAI+Gemini call before ever reaching the rejection.
    const { resolution } = resolveMdCategory(body.md_category);
    const resolvedEngineCategory =
      resolution?.kind === "profile"
        ? resolution.profile.engineCategory
        : resolution?.kind === "manual"
          ? body.manual?.engineCategory
          : undefined;
    if (resolvedEngineCategory === "event_venue") {
      res.status(400).json({
        ok: false,
        reason: "unsupported_category",
        message: `mdCategory "${body.md_category}" maps to the "event_venue" formula, which has no hourly busyness curve to build crowd_intelligence from. Use /api/crowd/estimate or /api/crowd/live instead.`,
      });
      return;
    }

    // Three-tier fallback, in order — same shape as the holiday/event/weather/
    // anchor overrides elsewhere in this codebase:
    //   1. place_id (primary, when given) — unambiguous, no search-ambiguity risk.
    //   2. poi_name + city (when given) — a REAL second scrape attempt via
    //      Google Maps search, not an AI guess. Only reached if (1) was given
    //      and failed, or (1) wasn't given at all.
    //   3. AI estimate — only when both real-scrape attempts are exhausted
    //      (or impossible), via the synthetic-stub path below, which reuses
    //      the exact same isEmptyWeek() AI-fallback branch already used for
    //      "Google resolved the place but had no Popular Times data".
    let scraped;
    try {
      scraped = body.place_id ? await scrapePoiByPlaceId(body.place_id) : await scrapePoi(`${body.poi_name}, ${body.city}`);
    } catch (err) {
      // Silently continue to fallback
    }

    if (!scraped && body.place_id && body.poi_name) {
      try {
        scraped = await scrapePoi(`${body.poi_name}, ${body.city}`);
      } catch (err) {
        // Silently continue to fallback
      }
    }

    if (!scraped) {
      // Both real-scrape attempts (or the only one possible) failed — AI is
      // the last resort. Only viable with `poi_name`: an unresolved
      // `place_id` alone gives the AI no human-readable name to research.
      if (!body.poi_name) {
        res.status(502).json({
          ok: false,
          error: "unable_to_resolve_location",
          message: "Unable to resolve this location. Please provide poi_name with city for a new search.",
        });
        return;
      }

      scraped = {
        query: `${body.poi_name}, ${body.city}`,
        placeId: body.place_id ?? null,
        url: "",
        lat: null,
        lng: null,
        category: null,
        address: null,
        liveStatusText: null,
        liveScore: null,
        popularTimesByDay: {
          sunday: [],
          monday: [],
          tuesday: [],
          wednesday: [],
          thursday: [],
          friday: [],
          saturday: [],
        },
        placeName: body.poi_name,
        scrapedAt: new Date().toISOString(),
      };
    }

    // Resolved once, up front — the AI-fallback score lookup below indexes
    // into popularTimesByDay by this same value, so it needs the real
    // (auto-detected, if the caller omitted it) day, not the raw optional body field.
    const dayOfWeek = body.day_of_week ?? autoDetectDayOfWeek();

    // Confirmed live: a search-by-name scrape that can't find the actual POI
    // doesn't always throw — for a garbage/fictional name Google Maps search
    // can silently fall back to matching just the CITY as the "best" result
    // (a genuinely valid place page, e.g. "Amritsar" itself as a maps
    // entity), which extracts fine (empty Popular Times, but no error) and
    // would otherwise feed the AI, the anchor lookup, and the calendar
    // lookup the wrong research target entirely. `category === null` is the
    // tell: a real POI match always carries a category from Google, even
    // when it has no Popular Times data; only this bad-match/synthetic-stub
    // case leaves it null. Every downstream lookup below uses these
    // "reliable" values instead of trusting `scraped.*` directly.
    const isUnreliableMatch = scraped.category === null;
    const reliablePlaceName = isUnreliableMatch && body.poi_name ? body.poi_name : scraped.placeName;
    const reliablePlaceId = isUnreliableMatch ? null : scraped.placeId;

    let popularTimesByDay = scraped.popularTimesByDay;
    let score = body.score ?? scraped.liveScore ?? undefined;

    // ─────────────────────────────────────────────────────────────────────────
    // OPTIMIZED PARALLELIZATION STRATEGY
    // ─────────────────────────────────────────────────────────────────────────
    // Priority 1: Crowd pattern AI (if needed) — gets this first
    // Priority 2: Anchor + Calendar + Weather (parallelized)
    // This avoids concurrent OpenAI calls when both need AI
    // ─────────────────────────────────────────────────────────────────────────

    // Step 1: Check if crowd pattern needs AI
    const crowdPatternNeedsAi = isEmptyWeek(popularTimesByDay);

    // Step 2: If crowd pattern needs AI, get it FIRST (priority)
    if (crowdPatternNeedsAi) {
      const aiEstimate = await estimateCrowdPatternWithAi({
        placeName: reliablePlaceName,
        category: body.md_category,
        // Without location context a common place name (e.g. "Hoppers") can
        // get the AI researching an entirely different, more prominent venue
        // with the same name in another city — confirmed live. `body.city`
        // (required — see validation.ts) is cleaner and more authoritative
        // than the old fallback of guessing from the scraped address.
        city: body.city,
        placeId: reliablePlaceId,
      });

      if (!aiEstimate) {
        res.status(502).json({
          ok: false,
          error: "unable_to_analyze",
          message: "Unable to analyze crowd patterns for this location at this time. Please try again later.",
        });
        return;
      }

      popularTimesByDay = aiEstimate.popularTimesByDay;
      score = score ?? averageOpenHoursScore(popularTimesByDay[dayOfWeek]);
    }

    // Step 3: After crowd pattern, parallelize metadata + anchor
    // All three are independent DB/API queries, no dependencies on each other
    // Explicit caller input always wins — this only fills in what's missing
    // (see DOCUMENTATION.md on the festival/event calendar).
    const [todayOverrides, autoWeather, aiEstimatedAnchor] = await Promise.all([
      // Calendar: DB lookup by (city, place_id)
      getTodayCalendarOverrides(body.city, reliablePlaceId),

      // Weather: API call by (lat, lng) — safe if either is null (returns undefined)
      body.weather ? Promise.resolve(undefined) : getAutoWeather(scraped.lat, scraped.lng),

      // Anchor: DB lookup or AI estimation (based on availability)
      body.anchor_override !== undefined
        ? Promise.resolve(undefined)
        : getEstimatedAnchor({
            placeId: reliablePlaceId,
            mdCategoryRaw: body.md_category,
            placeName: reliablePlaceName,
            // Google's resolved name can embed the city into the name
            // itself ("Gateway Of India Mumbai") — confirmed live this
            // misses a seed row keyed by the clean "Gateway of India". Try
            // the caller's own original search term too.
            alternateNames: body.poi_name ? [body.poi_name] : undefined,
            city: body.city,
          }).then((result) => result ?? undefined),
    ]);

    const outcome = buildCrowdIntelligence(body.md_category, popularTimesByDay, {
      dayOfWeek,
      selectedDay: body.selected_day,
      score,
      anchorOverride: body.anchor_override,
      aiEstimatedAnchor,
      holiday: body.holiday ?? todayOverrides.holiday,
      event: body.event ?? todayOverrides.event,
      weather: body.weather ?? autoWeather,
      sale: body.sale,
      meal: body.meal,
      eventState: body.event_state,
      manual: body.manual,
    });

    if (!outcome.ok) {
      res.status(FAILURE_STATUS[outcome.reason] ?? 400).json({ ...outcome, scraped });
      return;
    }

    // Clean response: only return crowd_intelligence data
    // Internal details (calculation, formula, place info) are not needed by API consumers
    res.json({
      crowd_intelligence: outcome.crowd_intelligence,
    });
  })
);
