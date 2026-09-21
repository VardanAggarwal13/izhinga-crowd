import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env";
import { RawGenerateResult } from "./openai";

// Google's own servers occasionally return this for a few seconds under load
// (confirmed live: "This model is currently experiencing high demand... try
// again later", UNAVAILABLE) — a transient condition, not a real failure.
// Worth one quick retry: when OpenAI is also down (e.g. exhausted credits),
// Gemini is the ONLY provider estimateCrowdPatternWithAi/historicalAnalysis
// has left, so giving up on the first brief hiccup fails the whole request
// for no good reason.
function isTransientGeminiError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("UNAVAILABLE") || message.includes("503") || message.includes("high demand");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Raw prompt-in, text-out call to Gemini — shared by any feature that needs
 * a Gemini answer (historical analysis, AI crowd-pattern fallback, etc.).
 * Uses the `googleSearch` grounding tool (current Gemini 2.x mechanism — the
 * older `googleSearchRetrieval` param only works on 1.5 models and isn't
 * compatible with 2.x) so answers are grounded in a live web search rather
 * than only the model's training data.
 */
export async function generateWithGemini(prompt: string): Promise<RawGenerateResult> {
  const start = Date.now();

  if (!env.gemini.apiKey) {
    return { ok: false, text: null, error: "GEMINI_API_KEY is not configured", latencyMs: 0 };
  }

  const client = new GoogleGenAI({ apiKey: env.gemini.apiKey });
  const MAX_ATTEMPTS = 2;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: env.gemini.model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      return { ok: true, text: response.text ?? "", error: null, latencyMs: Date.now() - start };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS && isTransientGeminiError(err)) {
        await sleep(1500);
        continue;
      }
      break;
    }
  }

  return {
    ok: false,
    text: null,
    error: lastError instanceof Error ? lastError.message : "Unknown Gemini error",
    latencyMs: Date.now() - start,
  };
}
