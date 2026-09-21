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

    let scraped;
    try {
      // `place_id` is already unambiguous, so `city` isn't needed for that
      // path — but for `poi_name`, a bare chain name (Burger King,
      // Starbucks, ...) has no way to say which of many Indian outlets is
      // meant without it (see DOCUMENTATION.md).
      scraped = body.place_id
        ? await scrapePoiByPlaceId(body.place_id)
        : await scrapePoi(`${body.poi_name}, ${body.city}`);
    } catch (err) {
      res.status(502).json({
        error: "scrape_failed",
        message: body.place_id
          ? "Failed to scrape Google Maps for this place_id"
          : "Failed to scrape Google Maps for this poi_name",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Resolved once, up front — the AI-fallback score lookup below indexes
    // into popularTimesByDay by this same value, so it needs the real
    // (auto-detected, if the caller omitted it) day, not the raw optional body field.
    const dayOfWeek = body.day_of_week ?? autoDetectDayOfWeek();

    let popularTimesByDay = scraped.popularTimesByDay;
    let score = body.score ?? scraped.liveScore ?? undefined;
    let dataSource: { type: "google_scrape" } | { type: "ai_estimated"; providersUsed: string[]; confidence: number; caveats: string[] } = {
      type: "google_scrape",
    };

    if (isEmptyWeek(popularTimesByDay)) {
      const aiEstimate = await estimateCrowdPatternWithAi({
        placeName: scraped.placeName,
        category: body.md_category,
        // Without location context a common place name (e.g. "Hoppers") can
        // get the AI researching an entirely different, more prominent venue
        // with the same name in another city — confirmed live. `body.city`
        // (required — see validation.ts) is cleaner and more authoritative
        // than the old fallback of guessing from the scraped address.
        city: body.city,
        placeId: scraped.placeId,
      });

      if (!aiEstimate) {
        res.status(502).json({
          error: "no_data_available",
          message:
            "Google Maps has no Popular Times data for this place, and the AI fallback also failed (check OPENAI_API_KEY/GEMINI_API_KEY are configured and funded).",
          scraped,
        });
        return;
      }

      popularTimesByDay = aiEstimate.popularTimesByDay;
      score = score ?? averageOpenHoursScore(popularTimesByDay[dayOfWeek]);
      dataSource = {
        type: "ai_estimated",
        providersUsed: aiEstimate.providersUsed,
        confidence: aiEstimate.confidence,
        caveats: aiEstimate.caveats,
      };
    }

    // Explicit caller input always wins — this only fills in what's missing
    // (see DOCUMENTATION.md on the festival/event calendar).
    const todayOverrides = await getTodayCalendarOverrides(body.city, scraped.placeId);
    const autoWeather = body.weather ? undefined : await getAutoWeather(scraped.lat, scraped.lng);
    const aiEstimatedAnchor =
      body.anchor_override !== undefined
        ? undefined
        : (await getEstimatedAnchor({
            placeId: scraped.placeId,
            mdCategoryRaw: body.md_category,
            placeName: scraped.placeName,
            // Google's resolved name can embed the city into the name
            // itself ("Gateway Of India Mumbai") — confirmed live this
            // misses a seed row keyed by the clean "Gateway of India". Try
            // the caller's own original search term too.
            alternateNames: body.poi_name ? [body.poi_name] : undefined,
            city: body.city,
          })) ?? undefined;

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

    res.json({
      crowd_intelligence: outcome.crowd_intelligence,
      calculation: outcome.calculation,
      place: {
        // scraped.placeId, not body.place_id — the request may have only
        // given `poi_name`, in which case scraped.placeId is the CID the
        // scraper itself found for the resolved place (see DOCUMENTATION.md
        // on why that's a different id namespace than the Places API
        // place_id you'd pass back in on a future request).
        place_id: scraped.placeId,
        name: scraped.placeName,
        category: scraped.category,
        address: scraped.address,
        live_status_text: scraped.liveStatusText,
        live_score: scraped.liveScore,
        data_source: dataSource,
      },
    });
  })
);
