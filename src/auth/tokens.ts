import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";

/**
 * Two deliberately DIFFERENT token types, signed with two DIFFERENT secrets:
 * - Access tokens: short-lived (default 1h), stateless — verified purely by
 *   signature + expiry, no DB lookup on every API call (that's the whole
 *   point — fast, no per-request DB round-trip). If one leaks, the exposure
 *   window is small by design.
 * - Refresh tokens: long-lived (default 7d), carry a unique `jti` that's
 *   ALSO persisted in `refresh_tokens` (see authRepository.ts) — so beyond
 *   the JWT signature/expiry check, refreshing also requires the token's
 *   jti to still exist in the DB. Rotation (authService.ts) deletes the old
 *   jti and issues a new one, so a stolen refresh token can be replayed at
 *   most once before the legitimate client's next refresh invalidates it.
 */

export interface AccessTokenPayload {
  sub: string; // client_id
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string; // client_id
  jti: string;
  type: "refresh";
}

function requireSecret(secret: string | undefined, envVarName: string): string {
  if (!secret) {
    throw new Error(`${envVarName} is not configured — API authentication cannot function without it.`);
  }
  return secret;
}

export function signAccessToken(clientId: string): string {
  const secret = requireSecret(env.auth.accessTokenSecret, "JWT_ACCESS_SECRET");
  const payload: AccessTokenPayload = { sub: clientId, type: "access" };
  return jwt.sign(payload, secret, { expiresIn: env.auth.accessTokenTtl as jwt.SignOptions["expiresIn"] });
}

/** Returns the signed token plus its `jti`, since the caller needs the jti to persist it (see authService.ts). */
export function signRefreshToken(clientId: string): { token: string; jti: string } {
  const secret = requireSecret(env.auth.refreshTokenSecret, "JWT_REFRESH_SECRET");
  const jti = randomUUID();
  const payload: RefreshTokenPayload = { sub: clientId, jti, type: "refresh" };
  const token = jwt.sign(payload, secret, { expiresIn: env.auth.refreshTokenTtl as jwt.SignOptions["expiresIn"] });
  return { token, jti };
}

/** Returns null on ANY failure (expired, bad signature, malformed, wrong type) — never throws, callers just treat null as "invalid token". */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const secret = requireSecret(env.auth.accessTokenSecret, "JWT_ACCESS_SECRET");
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === "string" || decoded.type !== "access" || typeof decoded.sub !== "string") return null;
    return decoded as AccessTokenPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const secret = requireSecret(env.auth.refreshTokenSecret, "JWT_REFRESH_SECRET");
    const decoded = jwt.verify(token, secret);
    if (
      typeof decoded === "string" ||
      decoded.type !== "refresh" ||
      typeof decoded.sub !== "string" ||
      typeof decoded.jti !== "string"
    ) {
      return null;
    }
    return decoded as RefreshTokenPayload;
  } catch {
    return null;
  }
}
