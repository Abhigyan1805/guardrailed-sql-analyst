// Gemini backend for the eval LLM engine. Goes through the app's own Gemini
// client (lib/gemini.ts), so the nightly run measures the provider the live
// demo actually uses. Throttled to stay under free-tier RPM limits.
import { geminiGenerate } from '../../lib/gemini';
import type { BackendResult, LlmBackend } from './llm';

export const GEMINI_MODEL = process.env.EVAL_GEMINI_MODEL ?? 'gemini-2.5-flash';

export function geminiConfigured(): boolean {
  return !!process.env.GOOGLE_API_KEY;
}

export class GeminiBackend implements LlmBackend {
  readonly provider = 'google-gemini';
  readonly model: string;
  readonly temperature = 0;
  readonly effort = 'thinking-off';
  private last = 0;

  constructor(model: string = GEMINI_MODEL) { this.model = model; }

  async generate(prompt: string): Promise<BackendResult> {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw new Error('GOOGLE_API_KEY is not set');
    const gap = Number(process.env.EVAL_GEMINI_MIN_INTERVAL_MS ?? 6500);
    const wait = gap - (Date.now() - this.last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const r = await geminiGenerate({
      prompt, model: this.model, apiKey: key, timeoutMs: 60_000, maxOutputTokens: 4096,
      system: 'You are a deterministic Postgres SQL generator. Return a single JSON object only.',
    });
    // Token counts are provider-reported; cost is not, so cost falls back to the
    // published per-token table (labelled estimated).
    return { text: r.text, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: null, usageSource: 'provider' };
  }
}
