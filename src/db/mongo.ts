import { Db, MongoClient } from "mongodb";
import { env } from "../config/env";

/**
 * One MongoDB client/connection reused across every request — same reasoning
 * as the shared-browser singleton in scraper/googleMaps.ts: connecting has
 * real cost, so pay it once at first use and hold onto it, rather than once
 * per request.
 */
let clientPromise: Promise<MongoClient> | null = null;

async function getClient(): Promise<MongoClient> {
  if (!clientPromise) {
    if (!env.mongodb.uri) {
      throw new Error("MONGODB_URI is not configured");
    }
    clientPromise = new MongoClient(env.mongodb.uri).connect();
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(env.mongodb.dbName);
}

export async function closeMongo(): Promise<void> {
  if (!clientPromise) return;
  const client = await clientPromise.catch(() => null);
  clientPromise = null;
  await client?.close().catch(() => {});
}

// Best-effort — same pattern as the shared browser in scraper/googleMaps.ts.
process.on("SIGINT", () => void closeMongo());
process.on("SIGTERM", () => void closeMongo());
