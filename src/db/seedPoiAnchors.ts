/**
 * One-time (or re-run-whenever-the-source-file-changes) loader for
 * `poi_anchor_estimates` — see poiAnchorRepository.ts. Run with
 * `npm run seed:anchors`.
 *
 * Reads the raw ChatGPT-researched seed file and applies corrections worked
 * out by hand against the real formula engine before import:
 * - `md_category` values that don't match any of the 30 real MD-category
 *   labels (`"Market"`, `"Events and Entertainment"`) are resolved per-POI,
 *   not just relabeled — see CATEGORY_CORRECTIONS below for the reasoning
 *   behind each one.
 * - Text confidence labels ("High" / "Medium-High" / ...) are mapped to the
 *   same 0-1 numeric scale the live AI path already uses, so both origins
 *   (`seed_import` and `ai_runtime`) are comparable.
 *
 * Upserts by `normalized_key`, preserving any `place_id` a previous request
 * already backfilled — never a blind deleteMany+insertMany (unlike
 * seedCalendar.ts), specifically because place_id backfills happen from
 * live traffic between seed re-runs and must not be thrown away.
 */
import { getDb } from "./mongo";
import { normalizePoiKey, PoiAnchorDoc } from "./poiAnchorRepository";

const SEED_FILE = "../../poi-seed-data/india_poi_anchor_seed_400_v3_metric_safe.json";

interface RawRow {
  poi_name: string;
  city: string;
  state_ut?: string;
  md_category: string;
  anchor_metric_type: "average_daily_footfall" | "peak_simultaneous_capacity";
  anchor_value: number;
  verification_tier: string;
  confidence: string;
  source_type: string;
  primary_source_url: string;
  estimated_at: string;
}

const CONFIDENCE_LABEL_TO_NUMBER: Record<string, number> = {
  High: 0.85,
  "Medium-High": 0.65,
  Medium: 0.5,
  "Low-Medium": 0.35,
};

/**
 * Per-POI corrections for rows whose `md_category` doesn't resolve against
 * `normalizeMdCategory()` — worked out by hand, see the chat history for
 * the reasoning behind each: general bazaars -> Shops, produce/wholesale
 * markets -> Food Market, and the two "Events and Entertainment" rows split
 * because only one of them actually fits the capacity-bound event_venue
 * model (India Expo Mart); the other (Attari-Wagah, a daily, non-ticketed
 * draw) fits the daily-footfall model much better.
 */
const CATEGORY_CORRECTIONS: Record<string, { mdCategory: string; anchorValue?: number; anchorMetricType?: RawRow["anchor_metric_type"] }> = {
  "crawford_market__mumbai": { mdCategory: "Food Market" },
  "kr_market_bengaluru__bengaluru": { mdCategory: "Food Market" },
  "colaba_causeway__mumbai": { mdCategory: "Shops" },
  "bandra_linking_road__mumbai": { mdCategory: "Shops" },
  "johari_bazaar_jaipur__jaipur": { mdCategory: "Shops" },
  "bapu_bazaar_jaipur__jaipur": { mdCategory: "Shops" },
  "hazratganj__lucknow": { mdCategory: "Shops" },
  "chandni_chowk__delhi": { mdCategory: "Shops" },
  "new_market_kolkata__kolkata": { mdCategory: "Shops" },
  "laad_bazaar__hyderabad": { mdCategory: "Shops" },
  "mall_road_shimla__shimla": { mdCategory: "Shops" },
  "hall_bazaar_amritsar__amritsar": { mdCategory: "Shops" },
  "manek_chowk__ahmedabad": { mdCategory: "Food Market" },
  // India Expo Mart: genuinely fits the capacity-bound event_venue model
  // (empty except during actual expos) — but its seed value (5500) was a
  // daily-footfall estimate, wrong unit for that model. Replaced with a
  // real venue capacity figure ("up to 20,000 people" for conferences/
  // exhibitions), cross-corroborated across multiple independent venue
  // listings (tradeindia.com, 10times.com, the venue's own site).
  "india_expo_mart__greater_noida": {
    mdCategory: "Events_entertainment",
    anchorValue: 20000,
    anchorMetricType: "peak_simultaneous_capacity",
  },
  // Attari-Wagah: happens daily at a fixed time, crowd driven by normal
  // weekday/weekend/season patterns — not "empty except event nights".
  // Culture and Art Tradition (daily-footfall model) fits this far better
  // than the capacity-bound event_venue model.
  "attari_wagah_border_ceremony__amritsar": { mdCategory: "Culture and Art Tradition" },
};

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const raw: RawRow[] = require(SEED_FILE);

  const docs: Omit<PoiAnchorDoc, "place_id">[] = raw.map((row) => {
    const key = normalizePoiKey(row.poi_name, row.city);
    const correction = CATEGORY_CORRECTIONS[key];

    return {
      normalized_key: key,
      poi_name: row.poi_name,
      city: row.city,
      state_ut: row.state_ut,
      md_category: correction?.mdCategory ?? row.md_category,
      anchor_metric_type: correction?.anchorMetricType ?? row.anchor_metric_type,
      anchor_value: correction?.anchorValue ?? row.anchor_value,
      confidence: CONFIDENCE_LABEL_TO_NUMBER[row.confidence] ?? 0.3,
      caveats: row.source_type === "modeled_seed_unverified" ? ["AI-modeled estimate, no public source located"] : [],
      origin: "seed_import",
      verification_tier: row.verification_tier,
      source_type: row.source_type,
      primary_source_url: row.primary_source_url || undefined,
      estimated_at: row.estimated_at,
    };
  });

  const db = await getDb();
  const collection = db.collection<PoiAnchorDoc>("poi_anchor_estimates");
  await collection.createIndex({ normalized_key: 1 }, { unique: true });
  await collection.createIndex({ place_id: 1 });

  let upserted = 0;
  for (const doc of docs) {
    // $set never touches place_id — a re-seed must never wipe out a
    // place_id a previous live request already backfilled.
    await collection.updateOne(
      { normalized_key: doc.normalized_key },
      { $set: doc, $setOnInsert: { place_id: null } },
      { upsert: true }
    );
    upserted++;
  }

  console.log(`Upserted ${upserted} POI anchor rows into poi_anchor_estimates (place_id backfills preserved).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
