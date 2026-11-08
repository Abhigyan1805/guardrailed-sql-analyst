// OpenAI-compatible chat backend for the eval engines (DeepSeek's API is
// OpenAI-compatible; the app's `openai` provider speaks the same protocol).
// Same contract as the Gemini backend: disk cache keyed by the full request,
// per-minute 429 backoff, and a spend guard. Cost is computed from the
// provider-reported token usage (cache-hit input priced separately) at the
// published rates in PRICES, and a run refuses to continue once its
// accumulated spend would pass EVAL_LLM_BUDGET_USD.
import type { BackendResult, GenerateOptions, LlmBackend } from './llm';
import { cacheKey, defaultCacheDir, readCache, writeCache } from './gemini';

export const OPENAI_COMPAT_SYSTEM = 'You are a deterministic Postgres SQL generator. Return a single JSON object only.';

export interface CompatPricing { inputMissPer1M: number; inputHitPer1M: number; outputPer1M: number; source: string }

// DeepSeek published list prices (USD per 1M tokens), off-peak.
export const PRICES: Record<string, CompatPricing> = {
  'deepseek-flash': { inputMissPer1M: 0.15, inputHitPer1M: 0.003, outputPer1M: 0.6, source: 'DeepSeek V4.1 Flash published off-peak rates' },
};

export class BudgetExceeded extends Error {
  constructor(spent: number, budget: number) {
    super(`LLM spend $${spent.toFixed(4)} reached the run budget $${budget.toFixed(4)}`);
    this.name = 'QuotaExhausted'; // the runner pauses on this name, never scores it as a miss
  }
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export class OpenAiCompatBackend implements LlmBackend {
  readonly provider: string;
  readonly temperature = 0;
  readonly effort: string;
  spentUsd = 0;
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    opts: { provider?: string; effort?: string; cacheDir?: string | null; budgetUsd?: number; fetchFn?: FetchFn } = {},
  ) {
    this.provider = opts.provider ?? 'openai-compatible';
    this.effort = opts.effort ?? 'low';
    this.cacheDir = opts.cacheDir === undefined ? defaultCacheDir() : opts.cacheDir;
    this.budgetUsd = opts.budgetUsd ?? Number(process.env.EVAL_LLM_BUDGET_USD ?? 0.2);
    this.fetchFn = opts.fetchFn ?? fetch;
  }
  private readonly cacheDir: string | null;
  private readonly budgetUsd: number;
  private readonly fetchFn: FetchFn;

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<BackendResult> {
    const temperature = opts.temperature ?? 0;
    const key = cacheKey({ model: this.model, effort: this.effort, system: OPENAI_COMPAT_SYSTEM, prompt, temperature, sample: opts.sample ?? 0 });
    const c = readCache(this.cacheDir, key);
    if (c) return { text: c.text, tokensIn: c.tokensIn, tokensOut: c.tokensOut, cachedTokens: c.cachedTokens, costUsd: (c as any).costUsd ?? null, usageSource: 'provider', latencyMs: c.latencyMs, cached: true };
    const run = this.chain.then(() => this.live(prompt, temperature));
    this.chain = run.catch(() => undefined);
    const r = await run;
    writeCache(this.cacheDir, key, { text: r.text, tokensIn: r.tokensIn, tokensOut: r.tokensOut, cachedTokens: r.cachedTokens ?? 0, latencyMs: r.latencyMs ?? 0, model: this.model, at: new Date().toISOString(), costUsd: r.costUsd } as any);
    return r;
  }

  cost(tokensIn: number, hit: number, tokensOut: number): number | null {
    const p = PRICES[this.model];
    if (!p) return null;
    return ((tokensIn - hit) * p.inputMissPer1M + hit * p.inputHitPer1M + tokensOut * p.outputPer1M) / 1_000_000;
  }

  private async live(prompt: string, temperature: number): Promise<BackendResult> {
    if (this.spentUsd >= this.budgetUsd) throw new BudgetExceeded(this.spentUsd, this.budgetUsd);
    const gap = Number(process.env.EVAL_COMPAT_MIN_INTERVAL_MS ?? 0);
    for (let attempt = 0; ; attempt++) {
      const wait = gap - (Date.now() - this.last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      const t0 = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 120_000);
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: this.model, temperature, max_tokens: 4096, reasoning_effort: this.effort,
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: OPENAI_COMPAT_SYSTEM }, { role: 'user', content: prompt }],
          }),
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429 && attempt < 5) {
        await new Promise((r) => setTimeout(r, Math.min(60_000, 5_000 * 2 ** attempt)));
        continue;
      }
      if (res.status === 402) throw Object.assign(new Error(`${this.model}: insufficient balance (HTTP 402)`), { name: 'QuotaExhausted' });
      if (!res.ok) throw new Error(`${this.model} HTTP ${res.status}`);
      const data: any = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error(`${this.model} empty response`);
      const tokensIn = data.usage?.prompt_tokens ?? 0;
      const tokensOut = data.usage?.completion_tokens ?? 0;
      const hit = data.usage?.prompt_cache_hit_tokens ?? data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const costUsd = this.cost(tokensIn, hit, tokensOut);
      this.spentUsd += costUsd ?? 0;
      return { text, tokensIn, tokensOut, cachedTokens: hit, costUsd, usageSource: 'provider', latencyMs: Date.now() - t0, cached: false };
    }
  }
}
