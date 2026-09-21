import { Router } from "express";
import { assertAiKeysConfigured } from "../../config/env";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    aiProvidersConfigured: assertAiKeysConfigured(),
    time: new Date().toISOString(),
  });
});
