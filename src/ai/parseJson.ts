import { ProviderAnalysis } from "./types";

const VALID_LEVELS = new Set(["low", "moderate", "high", "very_high"]);

/** Strips optional ```json fences and parses/validates the provider's JSON reply. */
export function parseProviderAnalysis(raw: string): ProviderAnalysis {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    // The model occasionally writes numbers with underscore digit separators
    // (e.g. "5_000") — valid in JS/Python numeric literals, not valid JSON,
    // and enough to fail JSON.parse() outright (confirmed live in
    // anchorEstimate.ts). Strip separators between digits before parsing.
    .replace(/(\d)_(?=\d)/g, "$1")
    .trim();

  const parsed = JSON.parse(cleaned);

  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const level = VALID_LEVELS.has(parsed.typicalCrowdLevel)
    ? parsed.typicalCrowdLevel
    : "moderate";

  const confidence =
    typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.3;

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    peakDays: toStringArray(parsed.peakDays),
    peakHours: toStringArray(parsed.peakHours),
    seasonalTrends: toStringArray(parsed.seasonalTrends),
    notableRecurringEvents: toStringArray(parsed.notableRecurringEvents),
    typicalCrowdLevel: level,
    confidence,
    caveats: toStringArray(parsed.caveats),
  };
}
