import compression from "compression";
import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth";
import { crowdRouter } from "./routes/crowd";
import { crowdIntelligenceRouter } from "./routes/crowdIntelligence";
import { healthRouter } from "./routes/health";
import { historicalRouter } from "./routes/historical";
import { scrapeRouter } from "./routes/scrape";
import { requireAuth } from "./requireAuth";

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

  // Unauthenticated on purpose: /health is a standard infra-monitoring
  // convention, and /api/auth/* IS how a client gets credentials in the
  // first place — requiring a token to get a token would be circular.
  app.use(healthRouter);
  app.use(authRouter);

  // Every real API route requires a valid access token from here down.
  app.use(requireAuth);
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
