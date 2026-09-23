export type CrowdLevelWord = "low" | "moderate" | "high" | "very_high";

export interface HistoricalAnalysisInput {
  poi_name: string;
  place_id?: string;
  md_category?: string;
  city?: string;
}

/** Strict JSON shape both providers are instructed to return. */
export interface ProviderAnalysis {
  summary: string;
  peakDays: string[];
  peakHours: string[];
  seasonalTrends: string[];
  notableRecurringEvents: string[];
  typicalCrowdLevel: CrowdLevelWord;
  confidence: number;
  caveats: string[];
}

export interface ProviderOutcome {
  provider: "openai" | "gemini";
  ok: boolean;
  data: ProviderAnalysis | null;
  error: string | null;
  latencyMs: number;
}

export interface MergedListField {
  agreed: string[];
  openaiOnly: string[];
  geminiOnly: string[];
  merged: string[];
}

export interface HistoricalAnalysisResult {
  poi_name: string;
  place_id: string | null;
  sources: {
    openai: ProviderOutcome;
    gemini: ProviderOutcome;
  };
  singleSource: boolean;
  consensus: {
    summary: string;
    peakDays: MergedListField;
    peakHours: MergedListField;
    seasonalTrends: MergedListField;
    notableRecurringEvents: MergedListField;
    typicalCrowdLevel: {
      openai: CrowdLevelWord | null;
      gemini: CrowdLevelWord | null;
      agreed: boolean;
      /** On disagreement, OpenAI (primary) wins rather than going blank. */
      value: CrowdLevelWord | null;
    };
    caveats: string[];
    confidence: number;
  } | null;
  generatedAt: string;
}
