import { generateWithOpenAI } from "./providers/openai";
import { generateWithGemini } from "./providers/gemini";
import { buildHistoricalAnalysisPrompt } from "./prompt";
import { parseProviderAnalysis } from "./parseJson";
import {
  HistoricalAnalysisInput,
  HistoricalAnalysisResult,
  MergedListField,
  ProviderAnalysis,
  ProviderOutcome,
} from "./types";

const normalize = (s: string) => s.trim().toLowerCase();

/** Cross-checks the same field from both providers: what they agree on is the trustworthy core. */
function mergeListField(openaiList: string[], geminiList: string[]): MergedListField {
  const setO = new Map(openaiList.map((v) => [normalize(v), v]));
  const setG = new Map(geminiList.map((v) => [normalize(v), v]));

  const agreed: string[] = [];
  const openaiOnly: string[] = [];
  const geminiOnly: string[] = [];

  for (const [key, value] of setO) {
    if (setG.has(key)) agreed.push(value);
    else openaiOnly.push(value);
  }
  for (const [key, value] of setG) {
    if (!setO.has(key)) geminiOnly.push(value);
  }

  return {
    agreed,
    openaiOnly,
    geminiOnly,
    // Primary provider's own items surface first.
    merged: [...agreed, ...openaiOnly, ...geminiOnly],
  };
}

function buildConsensusSummary(
  openai: ProviderAnalysis,
  gemini: ProviderAnalysis,
  peakDays: MergedListField
): string {
  const parts: string[] = [];

  if (peakDays.agreed.length) {
    parts.push(`Both AI sources agree this POI is busiest on ${peakDays.agreed.join(", ")}.`);
  }
  parts.push(`OpenAI (primary): ${openai.summary}`);
  parts.push(`Gemini (secondary): ${gemini.summary}`);

  return parts.join(" ");
}

function reconcile(
  openai: ProviderOutcome,
  gemini: ProviderOutcome
): HistoricalAnalysisResult["consensus"] {
  const bothOk = openai.ok && openai.data && gemini.ok && gemini.data;

  if (bothOk) {
    const o = openai.data as ProviderAnalysis;
    const g = gemini.data as ProviderAnalysis;

    const peakDays = mergeListField(o.peakDays, g.peakDays);
    const peakHours = mergeListField(o.peakHours, g.peakHours);
    const seasonalTrends = mergeListField(o.seasonalTrends, g.seasonalTrends);
    const notableRecurringEvents = mergeListField(o.notableRecurringEvents, g.notableRecurringEvents);

    const levelsAgree = o.typicalCrowdLevel === g.typicalCrowdLevel;
    // Agreement between two independent models is the strongest signal we have
    // that the answer is "genuine" rather than a single model's guess.
    const agreementBoost = levelsAgree ? 0.1 : -0.1;
    const dayAgreementBoost = peakDays.agreed.length > 0 ? 0.05 : 0;
    // OpenAI is the primary/trusted source, so it gets more weight in the blend.
    const weightedConfidence = o.confidence * 0.6 + g.confidence * 0.4;
    const confidence = Math.min(1, Math.max(0, weightedConfidence + agreementBoost + dayAgreementBoost));

    return {
      summary: buildConsensusSummary(o, g, peakDays),
      peakDays,
      peakHours,
      seasonalTrends,
      notableRecurringEvents,
      typicalCrowdLevel: {
        openai: o.typicalCrowdLevel,
        gemini: g.typicalCrowdLevel,
        agreed: levelsAgree,
        // On disagreement, defer to OpenAI (primary) instead of going blank.
        value: o.typicalCrowdLevel,
      },
      caveats: [...new Set([...o.caveats, ...g.caveats])],
      confidence: Number(confidence.toFixed(2)),
    };
  }

  // Exactly one provider succeeded — usable, but flagged as single-source.
  // Prefer OpenAI (primary) as the solo source when both happen to be available
  // but only one has valid data (shouldn't normally happen, but keep the order explicit).
  const solo = openai.ok && openai.data ? openai.data : gemini.ok && gemini.data ? gemini.data : null;
  if (!solo) return null;

  const soloProvider = openai.ok && openai.data ? "openai" : "gemini";
  const empty: MergedListField = { agreed: [], openaiOnly: [], geminiOnly: [], merged: [] };

  return {
    summary: `[Single-source: ${soloProvider} only] ${solo.summary}`,
    peakDays: { ...empty, merged: solo.peakDays },
    peakHours: { ...empty, merged: solo.peakHours },
    seasonalTrends: { ...empty, merged: solo.seasonalTrends },
    notableRecurringEvents: { ...empty, merged: solo.notableRecurringEvents },
    typicalCrowdLevel: {
      openai: openai.ok ? openai.data?.typicalCrowdLevel ?? null : null,
      gemini: gemini.ok ? gemini.data?.typicalCrowdLevel ?? null : null,
      agreed: false,
      value: solo.typicalCrowdLevel,
    },
    caveats: [...solo.caveats, "Only one AI source responded — treat with lower confidence."],
    confidence: Number((solo.confidence * 0.7).toFixed(2)),
  };
}

function toOutcome(
  provider: "openai" | "gemini",
  raw: { ok: boolean; text: string | null; error: string | null; latencyMs: number }
): ProviderOutcome {
  if (!raw.ok || raw.text === null) {
    return { provider, ok: false, data: null, error: raw.error, latencyMs: raw.latencyMs };
  }
  try {
    return {
      provider,
      ok: true,
      data: parseProviderAnalysis(raw.text),
      error: null,
      latencyMs: raw.latencyMs,
    };
  } catch (err) {
    return {
      provider,
      ok: false,
      data: null,
      error: `Failed to parse ${provider} response as JSON: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: raw.latencyMs,
    };
  }
}

export async function getHistoricalAnalysis(
  input: HistoricalAnalysisInput
): Promise<HistoricalAnalysisResult> {
  const prompt = buildHistoricalAnalysisPrompt(input);
  const [openaiRaw, geminiRaw] = await Promise.all([
    generateWithOpenAI(prompt, input.city),
    generateWithGemini(prompt),
  ]);
  const openai = toOutcome("openai", openaiRaw);
  const gemini = toOutcome("gemini", geminiRaw);

  return {
    poi_name: input.poi_name,
    place_id: input.place_id ?? null,
    sources: { openai, gemini },
    singleSource: openai.ok !== gemini.ok,
    consensus: reconcile(openai, gemini),
    generatedAt: new Date().toISOString(),
  };
}
