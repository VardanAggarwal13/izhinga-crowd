import { Router } from "express";
import { scrapePoi, scrapePoiByPlaceId } from "../../scraper/googleMaps";
import { asyncHandler } from "../asyncHandler";
import { scrapeRequestSchema } from "../validation";
import { validateBody } from "../validate";

export const scrapeRouter = Router();

/**
 * Scrapes a POI's Google Maps "Popular times" panel and returns raw data (no
 * formula applied). Pass `place_id` when you have one (more reliable, no
 * search-ambiguity risk) or `query` (a name/search string) otherwise.
 */
scrapeRouter.post(
  "/api/scrape",
  validateBody(scrapeRequestSchema),
  asyncHandler(async (req, res) => {
    const { query, place_id } = req.body as { query?: string; place_id?: string };

    try {
      const data = place_id ? await scrapePoiByPlaceId(place_id) : await scrapePoi(query as string);
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: "Failed to scrape Google Maps for this request",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  })
);
