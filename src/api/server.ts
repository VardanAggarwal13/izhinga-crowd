import compression from "compression";
import cors from "cors";
import express from "express";
import { crowdRouter } from "./routes/crowd";
import { crowdIntelligenceRouter } from "./routes/crowdIntelligence";
import { healthRouter } from "./routes/health";
import { historicalRouter } from "./routes/historical";
import { scrapeRouter } from "./routes/scrape";

export function createServer() {
  const app = express();

  app.use(cors());
  // The Popular Times payloads (full 7-day hourly data) are sizeable JSON —
  // gzip cuts real network transfer time for every response, especially over
  // slower connections. No downside: it's CPU-cheap relative to the seconds
  // a scrape itself already takes, and Express/compression only compress
  // responses above a size threshold by default, so tiny responses (like
  // /health) skip it automatically.
  app.use(compression());
  app.use(express.json());

  app.use(healthRouter);
  app.use(scrapeRouter);
  app.use(crowdRouter);
  app.use(crowdIntelligenceRouter);
  app.use(historicalRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      error: "Internal server error",
      detail: err instanceof Error ? err.message : String(err),
    });
  });

  return app;
}
