import { DAILY_FOOTFALL_CATEGORIES } from "../formulas/crowdIntelligence";
import { resolveMdCategory } from "../formulas/mdCategories";
import { getPoiAnchor, saveAiRuntimeAnchor } from "../db/poiAnchorRepository";
import { generateWithOpenAI } from "./providers/openai";

/**
 * Resolves `anchorOverride` (see mdCategoryEngine.ts) for a POI when the
 * caller omits it — the same "caller-supplied always wins, this only fills
 * in what's missing" pattern as weather/day/festival auto-detection, but for
 * the one input that's multiplicative through every formula, so a wrong
 * value doesn't average out the way a wrong hourly shape does.
 *
 * Two-tier: `poi_anchor_estimates` (see db/poiAnchorRepository.ts) first —
 * a persistent store covering both bulk-curated data and any POI a past
 * request already resolved via AI — falling through to a live OpenAI call
 * (deliberately no Gemini cross-check here — explicit product decision,
 * judged not worth the extra cost for this specific feature) only when
 * truly nothing exists yet, with the result persisted immediately so the
 * SAME POI never triggers a second AI call. No TTL/expiry at all — the team
 * refreshes rows manually (same philosophy as the festival calendar), which
 * also sidesteps a real risk: auto-refreshing specifically around festivals/
 * weekends could bake that day's surge into the "stable" baseline number,
 * double-counting it once D_holiday/D_weekend/D_event apply on top.
 */

export interface AiEstimatedAnchor {
  value: number;
  confidence: number;
  caveats: string[];
  origin: "database" | "ai_estimated";
  verificationTier?: string;
  sourceType?: string;
}

interface ParsedAnchor {
  value: number | null;
  confidence: number;
  caveats: string[];
}

function metricDescription(isDailyFootfall: boolean): string {
  return isDailyFootfall
    ? "the TOTAL average number of people who visit this place across a WHOLE DAY (not a simultaneous/at-once count) — its typical daily footfall"
    : "the realistic PEAK/SIMULTANEOUS capacity — how many people could reasonably be there AT ONCE at its absolute busiest (e.g. seating capacity for a restaurant, venue capacity for a stadium or event space)";
}

function buildAnchorPrompt(
  placeName: string,
  mdCategoryLabel: string,
  city: string | undefined,
  isDailyFootfall: boolean
): string {
  const context = [`Place: ${placeName}`, `Category: ${mdCategoryLabel}`, city ? `City: ${city}` : null]
    .filter(Boolean)
    .join("\n");

  return `You are a venue-scale research analyst. Research and estimate ${metricDescription(isDailyFootfall)}
for a specific real place. You have live web search available — use it ACTIVELY and THOROUGHLY.

${context}

RESEARCH STRATEGY (in priority order):
1. OFFICIAL sources: venue's own website, Wikipedia, tourism boards, government sites (especially for
   temples/shrines/govt facilities), published annual reports, booking platforms (e.g. ticketing sites
   showing capacity).
2. VISITOR STATISTICS: news articles about visitor counts, academic papers on tourism, Tripadvisor/
   Google reviews mentioning volumes/crowds, pilgrim/visitor countss.
3. PHYSICAL CAPACITY: seating counts, building layouts, fire code limits, architectural specs if
   available.
4. COMPARABLE VENUES: if this exact place has no data, find similar venues (same category, same city,
   similar size/tier) and report their figures + explain the comparison in caveats.
5. LOCAL CONTEXT: city population, region's tourist density, local economic size — helps calibrate
   expectations.

CRITICAL — give the STABLE, TYPICAL figure for an ordinary day:
- NOT peak festival figures (ignore Durga Puja spikes, Diwali surges, etc.)
- NOT weekend-specific or weekend averages — give the annualized typical day
- NOT "capacity when fully booked" — give realistic occupancy/throughput
- This system applies surge multipliers separately, so a raw stable number only.

Respond with ONLY a single JSON object (no markdown fences, no commentary):
{
  "low": number | null,        // low end of plausible range for typical day
  "high": number | null,       // high end of plausible range for typical day
  "estimate": number | null,   // your best single-point guess for typical day
  "confidence": number,        // 0-1 — see calibration below
  "caveats": string[]          // e.g., "extrapolated from annual visitor data", "based on similar temples"
}

Confidence calibration:
- 0.9-1.0: explicit official figure (published visitor count, stated capacity)
- 0.7-0.9: solid cross-checked data (multiple news sources, booking platform specs)
- 0.5-0.7: reasonable inference (review volume, physical size, local context)
- 0.3-0.5: moderate reasoning (comparable venues, category norms)
- 0.15-0.3: low confidence but a committed guess based on any available signal
- Below 0.15: abandon the guess — this would just add noise`;
}

function buildFollowUpPrompt(
  placeName: string,
  mdCategoryLabel: string,
  city: string | undefined,
  isDailyFootfall: boolean
): string {
  const metric = isDailyFootfall ? "average total daily footfall" : "peak simultaneous capacity";
  const place = `${placeName} (${mdCategoryLabel}${city ? `, ${city}` : ""})`;

  return `Your previous attempt to estimate ${place}'s ${metric} did not include a usable number.
You MUST provide a specific numeric estimate this time — do not leave "estimate" null.

Even under high uncertainty, commit to your single best reasoned guess. Reflect the uncertainty
honestly via a lower "confidence" value and clear "caveats" — not by omitting the estimate.

FALLBACK reasoning if you have no direct data:
- Extract population of ${city || "the city"} (if available)
- Estimate what % might visit this type of venue daily
- Use comparable successful venues of the same type as anchors
- A guess grounded in ANY available signal + honest uncertainty is better than null

Respond with ONLY the same JSON shape as before:
{ "low": number | null, "high": number | null, "estimate": number, "confidence": number, "caveats": string[] }`;
}

function parseAnchorResponse(raw: string): ParsedAnchor | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      // The model occasionally writes large numbers with underscore digit
      // separators (e.g. "5_000") — valid in JS/Python numeric literals,
      // NOT valid JSON, and enough to fail JSON.parse() outright. Confirmed
      // live: this silently discarded an otherwise-good first-pass answer
      // and forced a wasted second AI call to recover. Strip separators
      // between digits before parsing.
      .replace(/(\d)_(?=\d)/g, "$1")
      .trim();
    const parsed = JSON.parse(cleaned);

    const estimate =
      typeof parsed.estimate === "number" && Number.isFinite(parsed.estimate) && parsed.estimate > 0
        ? parsed.estimate
        : null;
    const low = typeof parsed.low === "number" && Number.isFinite(parsed.low) && parsed.low > 0 ? parsed.low : null;
    const high =
      typeof parsed.high === "number" && Number.isFinite(parsed.high) && parsed.high > 0 ? parsed.high : null;
    // Prefer the model's own single best-guess; fall back to the midpoint of
    // its range when it gave a range but not a committed number.
    const value = estimate ?? (low !== null && high !== null ? Math.round((low + high) / 2) : null);

    return {
      value,
      confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.2,
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((c: unknown) => typeof c === "string") : [],
    };
  } catch {
    return null;
  }
}

/**
 * Auto-estimates `anchorOverride` for a POI when the caller omits it. This is
 * an on-demand, dynamic research system:
 *
 * 1. Check database first (any pre-seeded or previously-researched POI)
 * 2. If missing, call AI to research the POI's actual daily footfall/capacity
 * 3. Save the result to database immediately (for future lookups)
 * 4. Return the value to the caller
 *
 * The fallback to category default (e.g. 100,000 for religious sites) only
 * happens if ALL three tiers fail — never use a generic default when we can
 * research the specific POI's actual data.
 *
 * Never throws: any failure (unknown category, no OpenAI key, unparseable)
 * returns null — callers fall through to the existing category default, same
 * as before this existed. `city` is required — matching against
 * `poi_anchor_estimates` needs it (see normalizePoiKey), and every caller
 * already has it (required on both scrape-backed routes).
 */
export async function getEstimatedAnchor(input: {
  placeId: string | null;
  mdCategoryRaw: string;
  placeName: string;
  /** Alternate names to also try against the seed/persisted DB (e.g. the caller's original search term when `placeName` is Google's resolved display name, or vice versa) — see getPoiAnchor. */
  alternateNames?: string[];
  city: string;
}): Promise<AiEstimatedAnchor | null> {
  const { resolution } = resolveMdCategory(input.mdCategoryRaw);
  if (!resolution || resolution.kind !== "profile") return null;

  const engineCategory = resolution.profile.engineCategory;
  const isDailyFootfall = DAILY_FOOTFALL_CATEGORIES.has(engineCategory);
  const mdCategoryLabel = resolution.profile.label;

  // Tier 1: Database lookup (seeded data + previously-researched POIs)
  const candidateNames = [input.placeName, ...(input.alternateNames ?? [])];
  const existing = await getPoiAnchor(candidateNames, input.city, input.placeId);
  if (existing) {
    return {
      value: existing.anchor_value,
      confidence: existing.confidence,
      caveats: existing.caveats,
      origin: "database",
      verificationTier: existing.verification_tier,
      sourceType: existing.source_type,
    };
  }

  // Tier 2: AI research (on-demand, with immediate save to DB)
  try {
    const firstPrompt = buildAnchorPrompt(input.placeName, mdCategoryLabel, input.city, isDailyFootfall);
    const firstRaw = await generateWithOpenAI(firstPrompt, input.city);
    let parsed = firstRaw.ok && firstRaw.text ? parseAnchorResponse(firstRaw.text) : null;

    // If first pass returns null value, ask AI to commit to a number (even if uncertain)
    if (!parsed || parsed.value === null) {
      const followUpPrompt = buildFollowUpPrompt(input.placeName, mdCategoryLabel, input.city, isDailyFootfall);
      const secondRaw = await generateWithOpenAI(followUpPrompt, input.city);
      parsed = secondRaw.ok && secondRaw.text ? parseAnchorResponse(secondRaw.text) : null;
    }

    // Save ANY result with value >= 100 and reasonable confidence (>= 0.15)
    // Lower threshold ensures we capture researched data even if confidence is moderate.
    // This prevents falling back to generic 100,000 defaults for unique POIs.
    if (parsed && parsed.value !== null && parsed.value >= 100 && parsed.confidence >= 0.15) {
      const value = Math.round(parsed.value);
      await saveAiRuntimeAnchor({
        placeName: input.placeName,
        city: input.city,
        placeId: input.placeId,
        mdCategory: mdCategoryLabel,
        anchorMetricType: isDailyFootfall ? "average_daily_footfall" : "peak_simultaneous_capacity",
        value,
        confidence: parsed.confidence,
        caveats: parsed.caveats,
      });

      return { value, confidence: parsed.confidence, caveats: parsed.caveats, origin: "ai_estimated" };
    }

    // If AI confidence is too low (< 0.15) or value invalid, return null to allow category fallback
    return null;
  } catch (err) {
    console.error("[anchorEstimate] Failed:", err);
    return null;
  }
}
