export type CrowdLevelWord = "low" | "moderate" | "high" | "very_high";

export interface HistoricalAnalysisInput {
  placeName: string;
  placeId?: string;
  category?: string;
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
  placeName: string;
  placeId: string | null;
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
