// Latency percentiles, split by decision (spec 6.1). End-to-end latency is
// measured around the full pipeline, so LLM retries are already included.

export type Decision = 'ALLOW' | 'CLARIFY' | 'BLOCK';

export interface LatencySample {
  decision: Decision | 'ERROR';
  latencyMs: number;
}

/** Linear-interpolation percentile (standard method). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

export interface LatencySummary {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function summarize(values: number[]): LatencySummary {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length ? Math.max(...values) : 0,
  };
}

export interface LatencyByDecision {
  overall: LatencySummary;
  ALLOW: LatencySummary;
  CLARIFY: LatencySummary;
  BLOCK: LatencySummary;
  /** ALLOW-only p95, reported separately from the overall p95 (spec 6.1). */
  p95Allow: number;
}

export function latencyByDecision(samples: LatencySample[]): LatencyByDecision {
  const by = (d: Decision) => samples.filter((s) => s.decision === d).map((s) => s.latencyMs);
  const allow = by('ALLOW');
  return {
    overall: summarize(samples.map((s) => s.latencyMs)),
    ALLOW: summarize(allow),
    CLARIFY: summarize(by('CLARIFY')),
    BLOCK: summarize(by('BLOCK')),
    p95Allow: percentile(allow, 95),
  };
}
