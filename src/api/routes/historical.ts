import { Router } from "express";
import { getHistoricalAnalysis } from "../../ai/historicalAnalysis";
import { asyncHandler } from "../asyncHandler";
import { historicalRequestSchema } from "../validation";
import { validateBody } from "../validate";

export const historicalRouter = Router();

/** Dual-AI (OpenAI primary + Gemini secondary) historical crowd analysis for a POI, cross-verified into one consensus. */
historicalRouter.post(
  "/api/historical",
  validateBody(historicalRequestSchema),
  asyncHandler(async (req, res) => {
    const result = await getHistoricalAnalysis(req.body);

    if (!result.consensus) {
      res.status(502).json({
        error: "Both AI providers failed to produce an analysis",
        sources: result.sources,
      });
      return;
    }

    res.json(result);
  })
);
