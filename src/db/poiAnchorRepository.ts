import { Collection } from "mongodb";
import { getDb } from "./mongo";

/**
 * Persistent, POI-specific anchor values (see DOCUMENTATION.md §13 and
 * ai/anchorEstimate.ts) — replaces re-hitting OpenAI for the same place
 * every few days. Two ways a row gets here:
 * - `origin: "seed_import"` — bulk-curated data (see seedPoiAnchors.ts),
 *   mostly AI-researched by the calling team via ChatGPT but reviewed/
 *   corrected before import, with real per-row provenance (`verification_tier`,
 *   `source_type`, `primary_source_url`) preserved for transparency.
 * - `origin: "ai_runtime"` — this server computed it live (no seed match)
 *   and persisted the result so the SAME POI never needs a fresh AI call
 *   again. No expiry — the team refreshes rows manually, same philosophy as
 *   the festival calendar (calendarRepository.ts).
 *
 * Keyed by `normalized_key` (POI name + city, slugified), NOT `place_id` —
 * the seed data was researched by an LLM that has no concept of Google's
 * place_id, so name+city is the only identity available at import time.
 * `place_id` starts null and gets backfilled the first time a real request
 * resolves this same POI via scraping (see backfillPlaceId below) — from
 * then on, lookups for that POI can go straight to the fast, unambiguous
 * place_id path instead of repeating the fuzzy name+city match.
 */
export interface PoiAnchorDoc {
  normalized_key: string;
  place_id: string | null;
  poi_name: string;
  city: string;
  state_ut?: string;
  md_category: string;
  anchor_metric_type: "average_daily_footfall" | "peak_simultaneous_capacity";
  anchor_value: number;
  confidence: number; // 0-1, normalized regardless of origin
  caveats: string[];
  origin: "seed_import" | "ai_runtime";
  /** Only present for origin === "seed_import" — the seed file's own provenance fields. */
  verification_tier?: string;
  source_type?: string;
  primary_source_url?: string;
  estimated_at: string; // YYYY-MM-DD
}

const COLLECTION = "poi_anchor_estimates";

async function getCollection(): Promise<Collection<PoiAnchorDoc>> {
  const db = await getDb();
  return db.collection<PoiAnchorDoc>(COLLECTION);
}

/**
 * Same slugification the seed data's own `normalized_key` uses (confirmed
 * against real samples, including ones with apostrophes/ampersands/hyphens):
 * lowercase, collapse every run of non-alphanumeric characters to a single
 * underscore, trim edge underscores, join name+city with a double
 * underscore. Must match exactly, or a scraped POI can never find its seed
 * row.
 */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizePoiKey(poiName: string, city: string): string {
  return `${slug(poiName)}__${slug(city)}`;
}

/**
 * Looks up a persisted anchor for this POI — `place_id` first (fast,
 * unambiguous, only works once backfilled), falling back to the normalized
 * name+city key. Tries EVERY name in `candidateNames`, not just one:
 * confirmed live that Google's own resolved place name can embed the city
 * into the name itself ("Gateway Of India Mumbai" vs. the seed data's clean
 * "Gateway of India"), so a caller's original search term and Google's
 * resolved display name can each match a seed row the other one misses —
 * trying both catches either case. Never throws: a DB hiccup or missing
 * MONGODB_URI degrades to "nothing found", same as every other DB-backed
 * fallback in this app.
 */
export async function getPoiAnchor(
  candidateNames: string[],
  city: string,
  placeId: string | null
): Promise<PoiAnchorDoc | null> {
  try {
    const collection = await getCollection();

    if (placeId) {
      const byPlaceId = await collection.findOne({ place_id: placeId });
      if (byPlaceId) return byPlaceId;
    }

    for (const name of candidateNames) {
      const key = normalizePoiKey(name, city);
      const byKey = await collection.findOne({ normalized_key: key });
      if (!byKey) continue;

      // Found by name+city but not yet linked to this place_id — link it
      // now so the next lookup for this exact POI can skip straight to
      // place_id.
      if (placeId && !byKey.place_id) {
        await collection.updateOne({ normalized_key: key }, { $set: { place_id: placeId } }).catch(() => {});
      }
      return byKey;
    }

    return null;
  } catch (err) {
    console.error("[poiAnchorRepository] Lookup failed:", err);
    return null;
  }
}

/**
 * Persists a freshly AI-computed anchor (origin: "ai_runtime") so this same
 * POI never needs another AI call. Upserts by normalized_key — safe to call
 * even if a row already exists (e.g. a race between two concurrent requests
 * for a brand-new POI), and never overwrites an existing `place_id` with
 * null.
 */
export async function saveAiRuntimeAnchor(input: {
  placeName: string;
  city: string;
  placeId: string | null;
  mdCategory: string;
  anchorMetricType: PoiAnchorDoc["anchor_metric_type"];
  value: number;
  confidence: number;
  caveats: string[];
}): Promise<void> {
  try {
    const collection = await getCollection();
    const key = normalizePoiKey(input.placeName, input.city);

    const fields: Omit<PoiAnchorDoc, "place_id"> = {
      normalized_key: key,
      poi_name: input.placeName,
      city: input.city,
      md_category: input.mdCategory,
      anchor_metric_type: input.anchorMetricType,
      anchor_value: input.value,
      confidence: input.confidence,
      caveats: input.caveats,
      origin: "ai_runtime",
      estimated_at: new Date().toISOString().slice(0, 10),
    };

    // $set never touches place_id — only $setOnInsert does, so a concurrent
    // save racing an existing backfilled place_id can never null it out.
    await collection.updateOne(
      { normalized_key: key },
      { $set: fields, $setOnInsert: { place_id: input.placeId } },
      { upsert: true }
    );
  } catch (err) {
    console.error("[poiAnchorRepository] Save failed:", err);
  }
}
