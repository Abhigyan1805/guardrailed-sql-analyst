// Gemini backend for the eval LLM engines. Goes through the app's own Gemini
// client (lib/gemini.ts), so the eval measures the provider the live demo
// actually uses. Built for a shared free-tier key:
//   - every response is cached on disk, keyed by a hash of (model, system,
//     prompt, temperature, sample index), so a re-run costs no calls;
//   - calls are spaced to stay under the per-minute limit, and a per-minute
//     429 backs off and retries;
//   - a per-day 429 throws QuotaExhausted(daily) so the runner can stop and
//     resume from the cache the next day instead of recording failures.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { geminiGenerate, QuotaExhausted } from '../../lib/gemini';
import type { BackendResult, GenerateOptions, LlmBackend } from './llm';

export const GEMINI_MODEL = process.env.EVAL_GEMINI_MODEL ?? 'gemini-2.5-flash';
export const GEMINI_SYSTEM = 'You are a deterministic Postgres SQL generator. Return a single JSON object only.';

export function geminiConfigured(): boolean {
  return !!process.env.GOOGLE_API_KEY;
}

export function defaultCacheDir(): string {
  return process.env.EVAL_LLM_CACHE_DIR ?? join(process.cwd(), 'eval', '.llm-cache');
}

export function cacheKey(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export interface CachedEntry {
  text: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  latencyMs: number;
  model: string;
  at: string;
}

/** Read a cached response, or null. Shared by every eval backend. */
export function readCache(dir: string | null, key: string): CachedEntry | null {
  if (!dir) return null;
  const path = join(dir, key.slice(0, 2), `${key}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as CachedEntry) : null;
}

export function writeCache(dir: string | null, key: string, entry: CachedEntry): void {
  if (!dir) return;
  mkdirSync(join(dir, key.slice(0, 2)), { recursive: true });
  writeFileSync(join(dir, key.slice(0, 2), `${key}.json`), JSON.stringify(entry));
}

export interface GeminiBackendStats {
  calls: number;
  cacheHits: number;
  retries429: number;
}

export type GenerateFn = typeof geminiGenerate;

export class GeminiBackend implements LlmBackend {
  readonly provider = 'google-gemini';
  readonly model: string;
  readonly temperature = 0;
  readonly effort = 'thinking-off';
  readonly stats: GeminiBackendStats = { calls: 0, cacheHits: 0, retries429: 0 };
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    model: string = GEMINI_MODEL,
    private readonly cacheDir: string | null = defaultCacheDir(),
    private readonly call: GenerateFn = geminiGenerate,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.model = model;
  }

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<BackendResult> {
    const temperature = opts.temperature ?? 0;
    const key = cacheKey({ model: this.model, system: GEMINI_SYSTEM, prompt, temperature, sample: opts.sample ?? 0 });
    const c = readCache(this.cacheDir, key);
    if (c) {
      this.stats.cacheHits++;
      return { text: c.text, tokensIn: c.tokensIn, tokensOut: c.tokensOut, cachedTokens: c.cachedTokens, costUsd: null, usageSource: 'provider', latencyMs: c.latencyMs, cached: true };
    }
    // Serialize live calls so the minimum gap holds even when drafts run in parallel.
    const run = this.chain.then(() => this.live(prompt, temperature));
    this.chain = run.catch(() => undefined);
    const r = await run;
    writeCache(this.cacheDir, key, { text: r.text, tokensIn: r.tokensIn, tokensOut: r.tokensOut, cachedTokens: r.cachedTokens ?? 0, latencyMs: r.latencyMs ?? 0, model: this.model, at: new Date().toISOString() });
    return r;
  }

  private async live(prompt: string, temperature: number): Promise<BackendResult> {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw new Error('GOOGLE_API_KEY is not set');
    const gap = Number(process.env.EVAL_GEMINI_MIN_INTERVAL_MS ?? 6500);
    const maxTries = Number(process.env.EVAL_GEMINI_MAX_429_RETRIES ?? 6);
    for (let attempt = 0; ; attempt++) {
      const wait = gap - (Date.now() - this.last);
      if (wait > 0) await this.sleep(wait);
      this.last = Date.now();
      const t0 = Date.now();
      try {
        this.stats.calls++;
        const r = await this.call({
          prompt, model: this.model, apiKey: key, timeoutMs: 60_000, maxOutputTokens: 4096, temperature, system: GEMINI_SYSTEM,
        });
        // Token counts are provider-reported; cost is not, so cost falls back to the
        // published per-token table (labelled estimated).
        return { text: r.text, tokensIn: r.tokensIn, tokensOut: r.tokensOut, cachedTokens: r.cachedTokens, costUsd: null, usageSource: 'provider', latencyMs: Date.now() - t0, cached: false };
      } catch (e) {
        if (!(e instanceof QuotaExhausted) || e.daily || attempt + 1 >= maxTries) throw e;
        this.stats.retries429++;
        await this.sleep(e.retryAfterMs ?? Math.min(120_000, 15_000 * 2 ** attempt));
      }
    }
  }
}
