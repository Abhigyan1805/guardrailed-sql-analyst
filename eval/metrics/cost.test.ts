import { describe, it, expect, afterEach } from 'vitest';
import { costPer100q, estimatedCostUsd, type UsageRecord } from './cost';

const rec = (o: Partial<UsageRecord>): UsageRecord => ({ tokensIn: 0, tokensOut: 0, costUsd: null, usageSource: 'provider', ...o });

describe('costPer100q', () => {
  afterEach(() => { delete process.env.EVAL_PRICES_JSON; });

  it('prefers exact provider cost when available', () => {
    const records = [rec({ costUsd: 0.01 }), rec({ costUsd: 0.03 })];
    const r = costPer100q(records, 2, 'some-model');
    expect(r.source).toBe('provider');
    expect(r.value).toBeCloseTo((0.04 * 100) / 2, 10); // $2 / 100q
    expect(r.totalUsd).toBeCloseTo(0.04, 10);
  });

  it('estimates when provider cost is missing but pricing is pinned', () => {
    const r = costPer100q([rec({ tokensIn: 1_000_000, tokensOut: 1_000_000, usageSource: 'estimated' })], 10, 'gpt-4o-mini');
    expect(r.source).toBe('estimated');
    // 1M * 0.15 + 1M * 0.6 = 0.75 ; * 100 / 10 = 7.5
    expect(r.value).toBeCloseTo(7.5, 6);
  });

  it('honours EVAL_PRICES_JSON overrides', () => {
    process.env.EVAL_PRICES_JSON = JSON.stringify({ 'my-model': { inputPer1M: 1, outputPer1M: 0 } });
    const r = costPer100q([rec({ tokensIn: 1_000_000, tokensOut: 500, usageSource: 'estimated' })], 100, 'my-model');
    expect(r.source).toBe('estimated');
    expect(r.value).toBeCloseTo(1, 6);
  });

  it('reports unavailable with a reason instead of a fabricated number', () => {
    const r = costPer100q([rec({ tokensIn: 100 })], 1, 'unpriced-model');
    expect(r.value).toBeNull();
    expect(r.source).toBe('unavailable');
    expect(r.reason).toMatch(/no published pricing/);
  });

  it('estimatedCostUsd applies per-1M prices', () => {
    expect(estimatedCostUsd({ tokensIn: 2_000_000, tokensOut: 0 }, { inputPer1M: 0.5, outputPer1M: 2 })).toBeCloseTo(1, 9);
  });
});
