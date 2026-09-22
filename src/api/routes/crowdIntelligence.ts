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
    let scrapeErr: unknown;
    try {
      scraped = body.place_id ? await scrapePoiByPlaceId(body.place_id) : await scrapePoi(`${body.poi_name}, ${body.city}`);
    } catch (err) {
      scrapeErr = err;
    }

    if (!scraped && body.place_id && body.poi_name) {
      try {
        scraped = await scrapePoi(`${body.poi_name}, ${body.city}`);
      } catch (err) {
        scrapeErr = err;
      }
    }

    if (!scraped) {
      // Both real-scrape attempts (or the only one possible) failed — AI is
      // the last resort. Only viable with `poi_name`: an unresolved
      // `place_id` alone gives the AI no human-readable name to research.
      if (!body.poi_name) {
        res.status(502).json({
          error: "scrape_failed",
          message:
            "Failed to scrape Google Maps for this place_id, and there's no poi_name to fall back to an AI estimate with (an unresolved place_id alone gives the AI nothing to research). Retry with poi_name + city instead, or verify the place_id.",
          detail: scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr),
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
    // providersUsed (which AI vendors were queried internally) deliberately
    // left out of this externally-sold response — internal implementation
    // detail, not something a paying API consumer needs.
    let dataSource: { type: "google_scrape" } | { type: "ai_estimated"; confidence: number; caveats: string[] } = {
      type: "google_scrape",
    };

    if (isEmptyWeek(popularTimesByDay)) {
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
        confidence: aiEstimate.confidence,
        caveats: aiEstimate.caveats,
      };
    }

    // Explicit caller input always wins — this only fills in what's missing
    // (see DOCUMENTATION.md on the festival/event calendar).
    const todayOverrides = await getTodayCalendarOverrides(body.city, reliablePlaceId);
    const autoWeather = body.weather ? undefined : await getAutoWeather(scraped.lat, scraped.lng);
    const aiEstimatedAnchor =
      body.anchor_override !== undefined
        ? undefined
        : (await getEstimatedAnchor({
            placeId: reliablePlaceId,
            mdCategoryRaw: body.md_category,
            placeName: reliablePlaceName,
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

    // `formula` (the internal Livecrowd.md math as a string) deliberately
    // left out of this externally-sold response — see DOCUMENTATION.md
    // internally if you need it, not something a paying API consumer needs.
    const { formula: _formula, ...calculationForResponse } = outcome.calculation;

    res.json({
      crowd_intelligence: outcome.crowd_intelligence,
      calculation: calculationForResponse,
      place: {
        // reliablePlaceId/reliablePlaceName, not the raw scraped.* — when
        // the real scrape(s) landed on an unreliable match (see
        // isUnreliableMatch above), scraped.placeId/placeName point at the
        // WRONG entity (e.g. the city itself); echoing those back would
        // misrepresent what was actually found. In that case this honestly
        // reflects the caller's own poi_name and a null place_id rather than
        // a confident-looking but wrong resolved place.
        place_id: reliablePlaceId,
        name: reliablePlaceName,
        category: scraped.category,
        address: scraped.address,
        live_status_text: scraped.liveStatusText,
        live_score: scraped.liveScore,
        data_source: dataSource,
      },
    });
  })
);
