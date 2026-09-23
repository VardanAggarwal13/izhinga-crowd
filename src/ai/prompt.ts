import { HistoricalAnalysisInput } from "./types";

/**
 * Both providers get this exact prompt so their answers are directly
 * comparable field-by-field during reconciliation (historicalAnalysis.ts).
 * Both providers are also given live web search grounding (see
 * providers/openai.ts and providers/gemini.ts) — this prompt explicitly
 * tells them to use it, since a model can otherwise default to answering
 * purely from static training memory even when a search tool is available.
 */
export function buildHistoricalAnalysisPrompt(input: HistoricalAnalysisInput): string {
  const context = [
    `POI name: ${input.poi_name}`,
    input.place_id ? `Place ID: ${input.place_id}` : null,
    input.md_category ? `Category: ${input.md_category}` : null,
    input.city ? `City: ${input.city}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are a crowd/foot-traffic research analyst producing a historical crowd-pattern
report for a specific, real place. You have live web search available — use it. Do not
answer from memorized training data alone; a place's actual visiting patterns change over
time (renovations, new festivals, changed opening hours, viral popularity), and memorized
knowledge can be stale or simply wrong for anything but the most famous landmarks.

${context}

Before answering, search for and weigh signals like these, in roughly this priority order:
1. The place's own official page, Google Maps/Google Business listing, or ticketing site —
   for stated opening hours, capacity, and any published visitor numbers.
2. Recent visitor reviews (Google, TripAdvisor, etc.) that mention crowds, queues, wait
   times, or "best time to visit" — reviews from the last 1-2 years matter more than old ones.
3. Local news, tourism board, or government data about festivals, religious calendars, or
   civic events specifically tied to this place or its city.
4. If this exact POI has little to no coverage, reason from well-documented comparable
   venues (same category, same city or region) rather than inventing specifics for this one
   — and say so explicitly in "caveats" when you do this.

Prefer specific, checkable claims over generic filler. "Busiest on weekends" is true of
almost every public place and adds nothing — instead say something like "Vaisakhi (mid-April)
and Guru Nanak's birthday (Nov) draw the largest surges, per [what you found]" or "reviews
from 2024-2025 consistently mention 30-45 minute waits after 6 PM on Fridays." If your search
comes back with genuinely nothing usable for this specific place, say that plainly in
"caveats" rather than filling the fields with plausible-sounding guesses.

Respond with ONLY a single JSON object (no markdown fences, no commentary) matching exactly this shape:
{
  "summary": string,                     // 2-4 sentence overview of typical crowd behavior at this POI
  "peakDays": string[],                  // e.g. ["Saturday", "Sunday"]
  "peakHours": string[],                 // e.g. ["6:00-8:00 AM", "6:00-8:00 PM"]
  "seasonalTrends": string[],            // e.g. ["Footfall rises sharply Oct-Nov during festival season"]
  "notableRecurringEvents": string[],    // recurring festivals/ceremonies/events historically tied to crowd spikes here
  "typicalCrowdLevel": "low" | "moderate" | "high" | "very_high",
  "confidence": number,                  // 0-1 — see calibration below
  "caveats": string[]                    // known gaps/uncertainty, or that you reasoned from a comparable venue
}

Confidence calibration:
- 0.8-1.0: multiple recent, specific sources directly about this POI.
- 0.5-0.8: some direct signal (e.g. official hours + a handful of reviews), filled in with
  reasonable inference.
- 0.2-0.5: little direct signal — mostly reasoned from category/city norms or comparable venues.
- Below 0.2: essentially guessing; say so in "caveats" instead of presenting it as researched.`;
}
