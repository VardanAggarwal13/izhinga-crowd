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

/**
 * Ensures all necessary database indices exist for optimal query performance.
 * Called once at server startup. Idempotent — safe to call multiple times.
 *
 * Index strategy:
 * - poi_anchor_estimates: normalized_key (unique, lookup by name+city),
 *   place_id (lookup by Google place ID)
 * - calendar_events: compound index on (start_date, end_date, city) for
 *   range queries by date and city
 * - poi_event_overrides: compound index on (place_id, event_id) for
 *   fast POI-specific override lookups
 */
export async function ensureIndices(): Promise<void> {
  try {
    const db = await getDb();

    // poi_anchor_estimates indices
    const anchorCollection = db.collection("poi_anchor_estimates");
    await anchorCollection.createIndex({ normalized_key: 1 }, { unique: true });
    await anchorCollection.createIndex({ place_id: 1 });
    await anchorCollection.createIndex({ city: 1 });

    // calendar_events indices — compound index for the main range query
    const calendarCollection = db.collection("calendar_events");
    await calendarCollection.createIndex(
      { start_date: 1, end_date: 1, city: 1 },
      { name: "calendar_range_city_idx" }
    );
    // Additional index for distinct("city") queries
    await calendarCollection.createIndex({ city: 1 });

    // poi_event_overrides indices — compound for fast POI-specific lookups
    const overridesCollection = db.collection("poi_event_overrides");
    await overridesCollection.createIndex(
      { place_id: 1, event_id: 1 },
      { name: "poi_event_override_idx" }
    );

    console.log("[mongo] All database indices created/verified");
  } catch (err) {
    console.error("[mongo] Failed to ensure indices:", err);
    // Non-fatal — queries will still work, just slower
  }
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
