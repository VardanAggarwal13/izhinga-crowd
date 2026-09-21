import { env } from "../config/env";
import { deleteRefreshToken, isRefreshTokenActive, saveRefreshToken, validateClientCredentials } from "../db/authRepository";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./tokens";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

async function issueTokenPair(clientId: string): Promise<TokenPair> {
  const accessToken = signAccessToken(clientId);
  const { token: refreshToken, jti } = signRefreshToken(clientId);
  await saveRefreshToken(jti, clientId, new Date(Date.now() + env.auth.refreshTokenTtlMs));
  return { accessToken, refreshToken, expiresIn: env.auth.accessTokenTtl };
}

export type LoginResult = { ok: true; tokens: TokenPair } | { ok: false; reason: "invalid_credentials" };

/** Validates client_id/client_secret and issues a fresh access+refresh pair. Deliberately doesn't distinguish "unknown client_id" from "wrong secret" in the response — standard practice, avoids leaking which client_ids exist. */
export async function login(clientId: string, clientSecret: string): Promise<LoginResult> {
  const valid = await validateClientCredentials(clientId, clientSecret);
  if (!valid) return { ok: false, reason: "invalid_credentials" };
  return { ok: true, tokens: await issueTokenPair(clientId) };
}

export type RefreshResult = { ok: true; tokens: TokenPair } | { ok: false; reason: "invalid_refresh_token" };

/**
 * Rotation: the presented refresh token is consumed (deleted from DB)
 * whether or not the rest of this call succeeds — even a signature-valid,
 * DB-confirmed-active token gets deleted the moment it's redeemed, so it
 * can never be used a second time. A brand new refresh token (new jti) is
 * issued alongside the new access token.
 */
export async function refresh(refreshToken: string): Promise<RefreshResult> {
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) return { ok: false, reason: "invalid_refresh_token" };

  const active = await isRefreshTokenActive(payload.jti);
  // Always attempt the delete, even if already inactive/missing — cheap,
  // idempotent, and closes a race where a token expires between the
  // isRefreshTokenActive check and here.
  await deleteRefreshToken(payload.jti);
  if (!active) return { ok: false, reason: "invalid_refresh_token" };

  return { ok: true, tokens: await issueTokenPair(payload.sub) };
}
