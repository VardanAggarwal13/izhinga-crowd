import { Router } from "express";
import { z } from "zod";
import { getEstimatedAnchor } from "../../ai/anchorEstimate";
import { estimateCrowdPatternWithAi } from "../../ai/crowdPatternEstimate";
import { getTodayCalendarOverrides } from "../../db/calendarRepository";
import { averageOpenHoursScore } from "../../formulas/crowdIntelligence";
import { resolveMdCategory } from "../../formulas/mdCategories";
import { calculateCrowdEstimateForMdCategory } from "../../formulas/mdCategoryEngine";
import { scrapePoi } from "../../scraper/googleMaps";
import { autoDetectDayOfWeek } from "../../time/autoDetectDayOfWeek";
import { getAutoWeather } from "../../weather/autoDetectWeather";
import { asyncHandler } from "../asyncHandler";
import { mdCrowdEstimateRequestSchema, mdLiveCrowdRequestSchema } from "../validation";
import { validateBody } from "../validate";

export const crowdRouter = Router();

const FAILURE_STATUS: Record<string, number> = {
  unknown_category: 400,
  not_created: 422,
  manual_allotment_missing_override: 400,
  missing_score: 400,
};

type MdEstimateBody = z.infer<typeof mdCrowdEstimateRequestSchema>;

/** Pure formula: caller supplies the busyness Score directly, tagged with one of the 30 MD-categories. */
crowdRouter.post(
  "/api/crowd/estimate",
  validateBody(mdCrowdEstimateRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as MdEstimateBody;

    // Explicit caller input always wins — this only fills in what's missing
    // (see DOCUMENTATION.md on the festival/event calendar).
    const todayOverrides = await getTodayCalendarOverrides();
    const dayOfWeek = body.dayOfWeek ?? autoDetectDayOfWeek();

    // Don't gate on `score` here — event_venue MD-categories (Stadium,
    // Events_entertainment) don't need one at all. The resolver's own
    // "missing_score" check applies it only where the formula requires it.
    const outcome = calculateCrowdEstimateForMdCategory(body.mdCategory, {
      dayOfWeek,
      score: body.score,
      anchorOverride: body.anchorOverride,
      holiday: body.holiday ?? todayOverrides.holiday,
      event: body.event ?? todayOverrides.event,
      weather: body.weather,
      sale: body.sale,
      meal: body.meal,
      eventState: body.eventState,
      manual: body.manual,
    });

    if (!outcome.ok) {
      res.status(FAILURE_STATUS[outcome.reason] ?? 400).json(outcome);
      return;
    }

    // `formulaUsed` (the internal per-category math as a string) deliberately
    // left out of this externally-sold response — same reasoning as
    // crowdIntelligence.ts's `calculation.formula`.
    const { formulaUsed: _formulaUsed, ...outcomeForResponse } = outcome;
    res.json(outcomeForResponse);
  })
);

type MdLiveBody = z.infer<typeof mdLiveCrowdRequestSchema>;

/**
 * event_venue MD-categories (Stadium, Events_entertainment) ignore `score`
 * entirely (see crowdIntelligence.ts for the same check) — no point paying
 * for an AI fallback call they'd never use.
 */
function needsScore(mdCategoryRaw: string, manual?: MdLiveBody["manual"]): boolean {
  const { resolution } = resolveMdCategory(mdCategoryRaw);
  if (!resolution) return true;
  if (resolution.kind === "manual") return manual ? manual.engineCategory !== "event_venue" : true;
  if (resolution.kind === "unresolved") return true;
  return resolution.profile.engineCategory !== "event_venue";
}

/**
 * End-to-end: scrapes the live Google Maps "Popular times" score for `query`,
 * then runs it through the MD-category formula engine in one call. If Google
 * has no data for this place at all, falls back to an OpenAI+Gemini estimate
 * (see ai/crowdPatternEstimate.ts) rather than failing outright.
 */
crowdRouter.post(
  "/api/crowd/live",
  validateBody(mdLiveCrowdRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as MdLiveBody;

    let scraped;
    try {
      // `city` disambiguates chains (Burger King, Starbucks, ...) that exist
      // in many Indian cities — a bare name alone has no way to say which
      // outlet is meant (see DOCUMENTATION.md).
      scraped = await scrapePoi(`${body.query}, ${body.city}`);
    } catch (err) {
      // Total scrape failure (Google blocked us, network blip, page didn't
      // resolve) — unlike /api/crowd/intelligence's place_id path, this
      // route always has a human-readable `query`, so the AI fallback below
      // (same one used for "resolved but no Popular Times") can always run
      // off a synthetic stub instead of failing outright. See
      // crowdIntelligence.ts for the fuller version of this same reasoning.
      scraped = {
        query: `${body.query}, ${body.city}`,
        placeId: null,
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
        placeName: body.query,
        scrapedAt: new Date().toISOString(),
      };
    }

    // Resolved once, up front — the AI-fallback score lookup below indexes
    // into popularTimesByDay by this same value, so it needs the real
    // (auto-detected, if the caller omitted it) day, not the raw optional body field.
    const dayOfWeek = body.dayOfWeek ?? autoDetectDayOfWeek();

    let score = scraped.liveScore ?? undefined;

    if (score === undefined && needsScore(body.mdCategory, body.manual)) {
      const estimate = await estimateCrowdPatternWithAi({
        placeName: scraped.placeName,
        category: body.mdCategory,
        city: body.city,
        placeId: scraped.placeId,
      });
      if (estimate) {
        score = averageOpenHoursScore(estimate.popularTimesByDay[dayOfWeek]);
      }
    }

    const todayOverrides = await getTodayCalendarOverrides(body.city, scraped.placeId);
    const autoWeather = body.weather ? undefined : await getAutoWeather(scraped.lat, scraped.lng);
    // Only worth researching when the caller hasn't already pinned it.
    const aiEstimatedAnchor =
      body.anchorOverride !== undefined
        ? undefined
        : (await getEstimatedAnchor({
            placeId: scraped.placeId,
            mdCategoryRaw: body.mdCategory,
            placeName: scraped.placeName,
            // Google's resolved name can embed the city into the name
            // itself ("Gateway Of India Mumbai") — confirmed live this
            // misses a seed row keyed by the clean "Gateway of India". Try
            // the caller's own original search term too.
            alternateNames: [body.query],
            city: body.city,
          })) ?? undefined;

    const outcome = calculateCrowdEstimateForMdCategory(body.mdCategory, {
      dayOfWeek,
      score,
      anchorOverride: body.anchorOverride,
      aiEstimatedAnchor,
      holiday: body.holiday ?? todayOverrides.holiday,
      event: body.event ?? todayOverrides.event,
      weather: body.weather ?? autoWeather,
      sale: body.sale,
      meal: body.meal,
      eventState: body.eventState,
      manual: body.manual,
    });

    if (!outcome.ok) {
      res.status(FAILURE_STATUS[outcome.reason] ?? 400).json({ ...outcome, scraped });
      return;
    }

    // Filter response to only expose user-facing data
    // Hide all internal implementation details (formula, multipliers, anchor, score, estimates, ranges, etc)
    res.json({
      level: outcome.level,
      levelLabel: outcome.levelLabel,
    });
  })
);
