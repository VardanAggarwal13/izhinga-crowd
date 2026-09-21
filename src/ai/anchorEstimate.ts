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

const MIN_CONFIDENCE = 0.3;

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

  return `You are a venue-scale research analyst. Estimate ${metricDescription(isDailyFootfall)} for a
specific real place. You have live web search available — use it.

${context}

Search for and weigh signals like these, in roughly this priority order:
1. An official capacity/seating figure — venue website, booking platform listing, tourism board,
   Wikipedia (for larger/well-known venues).
2. Indirect size signals — review volume, price tier, whether it's described as "small/intimate"
   vs. "large", photos of the space, typical queue/wait-time mentions.
3. Comparable venues of the same type and rough size in the same city, if nothing specific to
   this exact place turns up — and say so explicitly in "caveats" when you do this.

CRITICAL — give the STABLE, TYPICAL figure for an ordinary day. Do NOT inflate this number
because of any festival, holiday, weekend, or special event happening around today's date — this
system applies those effects SEPARATELY as multipliers on top of your number, so baking a surge
into your estimate here would double-count it. If your search surfaces festival-specific crowd
figures, treat that as context for what NOT to report, not as the answer.

Respond with ONLY a single JSON object (no markdown fences, no commentary):
{
  "low": number | null,        // low end of a plausible range, if you're estimating a range
  "high": number | null,       // high end of a plausible range, if you're estimating a range
  "estimate": number | null,   // your single best-guess number
  "confidence": number,        // 0-1 — see calibration below
  "caveats": string[]          // e.g. "no official figure found, reasoned from review volume and category norms"
}

Confidence calibration:
- 0.8-1.0: a stated official figure (capacity listing, published visitor stats).
- 0.5-0.8: solid indirect signal (review volume + size description + comparable venues).
- 0.2-0.5: little direct signal — mostly reasoned from category/city norms.
- Below 0.2: essentially guessing with no real grounding — still give a number, but say so plainly.`;
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
You MUST provide a specific numeric estimate this time — do not leave "estimate" null. Even under
high uncertainty, commit to your single best reasoned guess and reflect the uncertainty honestly
via a low "confidence" value and clear "caveats", not by omitting the number.

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
 * Auto-estimates `anchorOverride` for a POI when the caller omits it. Never
 * throws: any failure (unknown category, no OpenAI key, both attempts
 * unparseable, confidence below MIN_CONFIDENCE, DB hiccup) returns null —
 * callers fall through to the existing category default, same as before
 * this existed. `city` is required — matching against `poi_anchor_estimates`
 * needs it (see normalizePoiKey), and every caller already has it (required
 * on both scrape-backed routes — see DOCUMENTATION.md).
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

  try {
    const firstPrompt = buildAnchorPrompt(input.placeName, mdCategoryLabel, input.city, isDailyFootfall);
    const firstRaw = await generateWithOpenAI(firstPrompt, input.city);
    let parsed = firstRaw.ok && firstRaw.text ? parseAnchorResponse(firstRaw.text) : null;

    if (!parsed || parsed.value === null) {
      const followUpPrompt = buildFollowUpPrompt(input.placeName, mdCategoryLabel, input.city, isDailyFootfall);
      const secondRaw = await generateWithOpenAI(followUpPrompt, input.city);
      parsed = secondRaw.ok && secondRaw.text ? parseAnchorResponse(secondRaw.text) : null;
    }

    if (!parsed || parsed.value === null || parsed.value <= 0 || parsed.confidence < MIN_CONFIDENCE) {
      return null;
    }

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
  } catch (err) {
    console.error("[anchorEstimate] Failed:", err);
    return null;
  }
}
