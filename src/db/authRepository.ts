import { Collection } from "mongodb";
import bcrypt from "bcryptjs";
import { getDb } from "./mongo";

/**
 * Pre-issued API clients (see createApiClient.ts) — deliberately NOT a
 * public self-service signup system. Each row is one trusted team/partner
 * (e.g. "frontend-team"). `client_secret_hash` is bcrypt-hashed, same as a
 * password would be, so a DB leak never exposes a usable secret directly.
 */
export interface ApiClientDoc {
  client_id: string;
  client_secret_hash: string;
  name: string;
  active: boolean;
  created_at: string;
}

/**
 * One row per currently-valid, unused refresh token — identified by its
 * JWT's own `jti`, not the raw token (the JWT signature already proves
 * authenticity; this collection exists purely so a token can be REVOKED,
 * which a stateless JWT can't do on its own). Deleted the moment it's used
 * to refresh (rotation) — a row existing at all means "this exact refresh
 * has not been redeemed yet."
 */
export interface RefreshTokenDoc {
  jti: string;
  client_id: string;
  expires_at: Date;
  created_at: Date;
}

const CLIENTS_COLLECTION = "api_clients";
const REFRESH_TOKENS_COLLECTION = "refresh_tokens";

async function getClientsCollection(): Promise<Collection<ApiClientDoc>> {
  const db = await getDb();
  return db.collection<ApiClientDoc>(CLIENTS_COLLECTION);
}

async function getRefreshTokensCollection(): Promise<Collection<RefreshTokenDoc>> {
  const db = await getDb();
  return db.collection<RefreshTokenDoc>(REFRESH_TOKENS_COLLECTION);
}

/** Bcrypt-compares the raw secret against the stored hash — never returns or logs the raw secret. */
export async function validateClientCredentials(clientId: string, clientSecret: string): Promise<boolean> {
  const collection = await getClientsCollection();
  const client = await collection.findOne({ client_id: clientId, active: true });
  if (!client) return false;
  return bcrypt.compare(clientSecret, client.client_secret_hash);
}

export async function saveRefreshToken(jti: string, clientId: string, expiresAt: Date): Promise<void> {
  const collection = await getRefreshTokensCollection();
  await collection.insertOne({ jti, client_id: clientId, expires_at: expiresAt, created_at: new Date() });
}

/** Returns true if this exact refresh token (by jti) is still valid/unused — the DB half of refresh validation, alongside the JWT signature check in tokens.ts. */
export async function isRefreshTokenActive(jti: string): Promise<boolean> {
  const collection = await getRefreshTokensCollection();
  const doc = await collection.findOne({ jti });
  return doc !== null && doc.expires_at.getTime() > Date.now();
}

/** Deletes a refresh token by jti — called both on rotation (old token consumed) and explicit logout/revocation. */
export async function deleteRefreshToken(jti: string): Promise<void> {
  const collection = await getRefreshTokensCollection();
  await collection.deleteOne({ jti });
}

export async function createIndexes(): Promise<void> {
  const clients = await getClientsCollection();
  await clients.createIndex({ client_id: 1 }, { unique: true });

  const refreshTokens = await getRefreshTokensCollection();
  await refreshTokens.createIndex({ jti: 1 }, { unique: true });
  // TTL index — MongoDB itself garbage-collects expired refresh token rows,
  // so a flood of never-refreshed tokens doesn't grow this collection
  // forever even if a client just stops calling /refresh.
  await refreshTokens.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
}
