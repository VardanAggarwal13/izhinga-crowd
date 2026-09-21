import OpenAI from "openai";
import { env } from "../../config/env";

export interface RawGenerateResult {
  ok: boolean;
  text: string | null;
  error: string | null;
  latencyMs: number;
}

/**
 * Raw prompt-in, text-out call to OpenAI — shared by any feature that needs
 * an OpenAI answer (historical analysis, AI crowd-pattern fallback, etc.).
 * Uses the Responses API with the `web_search_preview` tool so answers are
 * grounded in a live web search rather than only whatever the model
 * memorized during training.
 */
export async function generateWithOpenAI(prompt: string, city?: string): Promise<RawGenerateResult> {
  const start = Date.now();

  if (!env.openai.apiKey) {
    return { ok: false, text: null, error: "OPENAI_API_KEY is not configured", latencyMs: 0 };
  }

  try {
    // The SDK retries 429/5xx with backoff by default (maxRetries: 2, so 3
    // attempts) — fine normally, but confirmed live that a persistent 429
    // (e.g. an exhausted-credits account) turns every single call into a
    // ~20s wait for a failure that was never going to succeed on retry. We
    // already run OpenAI and Gemini in parallel and handle a single-provider
    // failure gracefully (confidence discount) — there's no reason for one
    // provider's retry storm to be the slowest part of every request.
    const client = new OpenAI({ apiKey: env.openai.apiKey, maxRetries: 1, timeout: 15_000 });

    const response = await client.responses.create({
      model: env.openai.model,
      input: prompt,
      tools: [
        {
          type: "web_search_preview",
          ...(city ? { user_location: { type: "approximate", city } } : {}),
        },
      ],
    });

    return { ok: true, text: response.output_text, error: null, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      text: null,
      error: err instanceof Error ? err.message : "Unknown OpenAI error",
      latencyMs: Date.now() - start,
    };
  }
}
