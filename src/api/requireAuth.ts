import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../auth/tokens";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      clientId?: string;
    }
  }
}

const INVALID_TOKEN_RESPONSE = {
  error: "invalid_token",
  message: "Invalid or missing authentication token. Get one from POST /api/auth/token.",
};

/**
 * Applied to every real API route except /health and the auth endpoints
 * themselves (see server.ts). Expects `Authorization: Bearer <accessToken>`.
 * Deliberately returns the SAME generic "invalid_token" response whether
 * the header is missing, malformed, expired, or has a bad signature — never
 * distinguishes which, same reasoning as authService.ts's login() not
 * distinguishing "unknown client" from "wrong secret": don't hand an
 * attacker a signal about which part of their guess was closer.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;

  if (!token) {
    res.status(401).json(INVALID_TOKEN_RESPONSE);
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json(INVALID_TOKEN_RESPONSE);
    return;
  }

  req.clientId = payload.sub;
  next();
}
