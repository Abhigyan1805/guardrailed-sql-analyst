import { describe, it, expect } from 'vitest';
import { percentile, summarize, latencyByDecision } from './latency';

describe('latency', () => {
  it('interpolates percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([], 95)).toBe(0);
  });

  it('summarizes p50/p95/p99', () => {
    const s = summarize(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(s.p50).toBeCloseTo(50.5, 5);
    expect(s.p95).toBeCloseTo(95.05, 5);
    expect(s.p99).toBeCloseTo(99.01, 5);
    expect(s.max).toBe(100);
  });

  it('splits by decision and reports ALLOW-only p95 separately', () => {
    const r = latencyByDecision([
      { decision: 'ALLOW', latencyMs: 100 },
      { decision: 'ALLOW', latencyMs: 200 },
      { decision: 'CLARIFY', latencyMs: 900 },
      { decision: 'BLOCK', latencyMs: 50 },
    ]);
    expect(r.ALLOW.n).toBe(2);
    expect(r.p95Allow).toBeCloseTo(195, 5);
    expect(r.CLARIFY.n).toBe(1);
    expect(r.BLOCK.n).toBe(1);
    expect(r.overall.n).toBe(4);
  });
});
