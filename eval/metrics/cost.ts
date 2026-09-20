// Cost per 100 questions (spec 6.1), retries included because the engine
// accumulates token counts across retry attempts.
//
// Amended R5: exact provider usage is preferred. When a backend cannot expose
// exact usage, figures may be estimated from a pinned tokenizer and the
// pinned model's published prices, but they must be labelled `estimated`
// everywhere and never mixed with measured numbers.

export type UsageSource = 'provider' | 'estimated' | 'unavailable';

export interface UsageRecord {
  tokensIn: number;
  tokensOut: number;
  /** Exact provider-reported cost when the backend exposes it. */
  costUsd: number | null;
  usageSource: UsageSource;
}

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

/**
 * Reference price sheet for cost_per_100q when the served model is free (so its
 * own provider cost is $0 and would mislead). DeepSeek V4.1 Flash is the
 * pricing reference for the eval LLM engine. Source + snapshot are recorded in
 * reports. Off-peak is the default; peak is 2x.
 */
export const REFERENCE_PRICING = {
  label: 'DeepSeek V4.1 Flash off-peak published rates ($0.15/$0.60 per 1M in/out)',
  source: 'https://api-docs.deepseek.com/quick_start/pricing',
  retrieved: '2026-09-20',
  offPeak: { inputPer1M: 0.15, outputPer1M: 0.6 } satisfies ModelPricing,
  peakMultiplier: 2,
  caveat: 'peak hours (01:00-04:00 and 06:00-10:00 UTC Mon-Fri) are 2x these rates',
};

/**
 * Published per-1M-token prices for pinned models, used only for the estimated
 * fallback. Extend via EVAL_PRICES_JSON (e.g. {"model":{"inputPer1M":..,"outputPer1M":..}}).
 */
export const PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gemini-2.5-flash': { inputPer1M: 0.3, outputPer1M: 2.5 },
};

export function pricingFor(model: string): ModelPricing | null {
  const raw = process.env.EVAL_PRICES_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.[model]) return parsed[model] as ModelPricing;
    } catch {
      // fall through to the built-in table
    }
  }
  return PRICING[model] ?? null;
}

export function estimatedCostUsd(usage: Pick<UsageRecord, 'tokensIn' | 'tokensOut'>, pricing: ModelPricing): number {
  return (usage.tokensIn * pricing.inputPer1M + usage.tokensOut * pricing.outputPer1M) / 1_000_000;
}

export interface CostPer100q {
  value: number | null;
  source: UsageSource;
  reason?: string;
  totalUsd: number | null;
}

export interface CostOptions {
  /** Price the reported tokens at this sheet even when the backend cost is $0
   *  (free model). Always labelled `estimated`. */
  referencePricing?: ModelPricing;
  referenceLabel?: string;
}

/**
 * cost_per_100q = (tokensIn*inPrice + tokensOut*outPrice) * 100 / n, retries
 * included. Uses exact provider cost when every record carries it; otherwise
 * falls back to estimate-only if pricing is known; otherwise reports
 * `unavailable` with a reason (never a fabricated number).
 */
export function costPer100q(
  records: UsageRecord[],
  count: number,
  model: string,
  opts: CostOptions = {},
): CostPer100q {
  if (count <= 0) return { value: 0, source: 'unavailable', reason: 'no scored questions', totalUsd: 0 };
  if (opts.referencePricing) {
    const total = records.reduce((s, r) => s + estimatedCostUsd(r, opts.referencePricing as ModelPricing), 0);
    return {
      value: (total * 100) / count,
      source: 'estimated',
      reason: opts.referenceLabel ?? 'reference prices; not the provider-reported cost',
      totalUsd: total,
    };
  }
  const withCost = records.filter((r) => r.costUsd !== null);
  if (withCost.length === records.length && withCost.length > 0) {
    const total = withCost.reduce((s, r) => s + (r.costUsd as number), 0);
    return { value: (total * 100) / count, source: 'provider', totalUsd: total };
  }
  const pricing = pricingFor(model);
  if (!pricing) {
    return {
      value: null,
      source: 'unavailable',
      reason: `backend did not expose token cost and no published pricing is pinned for model "${model}"`,
      totalUsd: null,
    };
  }
  const total = records.reduce((s, r) => s + estimatedCostUsd(r, pricing), 0);
  return { value: (total * 100) / count, source: 'estimated', totalUsd: total };
}
