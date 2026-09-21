import { Router } from "express";
import { z } from "zod";
import { login, refresh } from "../../auth/authService";
import { asyncHandler } from "../asyncHandler";
import { authRefreshRequestSchema, authTokenRequestSchema } from "../validation";
import { validateBody } from "../validate";

export const authRouter = Router();

type TokenBody = z.infer<typeof authTokenRequestSchema>;
type RefreshBody = z.infer<typeof authRefreshRequestSchema>;

/**
 * Public — no auth required (this IS how a client gets auth). See
 * src/db/createApiClient.ts for how a client_id/client_secret pair actually
 * gets created; there's no self-service registration here on purpose.
 */
authRouter.post(
  "/api/auth/token",
  validateBody(authTokenRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as TokenBody;
    const result = await login(body.client_id, body.client_secret);

    if (!result.ok) {
      res.status(401).json({ error: "invalid_credentials", message: "Invalid client_id or client_secret." });
      return;
    }

    res.json({
      access_token: result.tokens.accessToken,
      refresh_token: result.tokens.refreshToken,
      expires_in: result.tokens.expiresIn,
      token_type: "Bearer",
    });
  })
);

/**
 * Rotation: the refresh_token sent here is consumed immediately (deleted
 * from the DB) whether this call succeeds or not — see authService.ts's
 * refresh(). The response carries a NEW refresh_token; the one just sent
 * cannot be reused.
 */
authRouter.post(
  "/api/auth/refresh",
  validateBody(authRefreshRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as RefreshBody;
    const result = await refresh(body.refresh_token);

    if (!result.ok) {
      res.status(401).json({
        error: "invalid_refresh_token",
        message: "This refresh token is invalid, expired, or has already been used. Get a new token pair from POST /api/auth/token.",
      });
      return;
    }

    res.json({
      access_token: result.tokens.accessToken,
      refresh_token: result.tokens.refreshToken,
      expires_in: result.tokens.expiresIn,
      token_type: "Bearer",
    });
  })
);
