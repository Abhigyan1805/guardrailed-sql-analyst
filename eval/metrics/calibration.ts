// Confidence calibration (spec 6.2): reliability table, ECE/MCE, and a
// dev-only threshold sweep. Calibration is measured on executed ALLOW answers,
// which is the only place a confidence value maps to an observable outcome.

export interface CalibrationPoint {
  id: string;
  confidence: number;
  /** Row-multiset match. Only defined for points that were actually executed. */
  correct: boolean | null;
  expected: 'ALLOW' | 'CLARIFY' | 'BLOCK';
}

export interface ReliabilityBin {
  label: string;
  low: number;
  high: number;
  count: number;
  meanConfidence: number;
  accuracy: number;
}

const EPS = 1e-9;

/** Bin executed points into 10 equal-width confidence bins (spec 6.2). */
export function reliability(points: CalibrationPoint[], bins = 10): ReliabilityBin[] {
  const out: ReliabilityBin[] = [];
  for (let i = 0; i < bins; i++) {
    const low = i / bins;
    const high = (i + 1) / bins;
    out.push({ label: `${low.toFixed(2)}-${high.toFixed(2)}`, low, high, count: 0, meanConfidence: 0, accuracy: 0 });
    out[i].count = 0;
  }
  const sums = out.map(() => ({ conf: 0, correct: 0, n: 0 }));
  for (const p of points) {
    if (p.correct === null) continue; // not executed -> no observable outcome
    const c = Math.min(1, Math.max(0, p.confidence));
    let idx = Math.floor(c * bins);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    sums[idx].conf += c;
    sums[idx].n += 1;
    if (p.correct) sums[idx].correct += 1;
  }
  for (let i = 0; i < bins; i++) {
    const s = sums[i];
    out[i].count = s.n;
    out[i].meanConfidence = s.n ? s.conf / s.n : 0;
    out[i].accuracy = s.n ? s.correct / s.n : 0;
  }
  return out;
}

/** Expected calibration error weighted by bin population. */
export function ece(bins: ReliabilityBin[]): number {
  const total = bins.reduce((s, b) => s + b.count, 0);
  if (!total) return 0;
  return bins.reduce((s, b) => s + (b.count / total) * Math.abs(b.accuracy - b.meanConfidence), 0);
}

/** Maximum calibration error across populated bins. */
export function mce(bins: ReliabilityBin[]): number {
  let m = 0;
  for (const b of bins) {
    if (!b.count) continue;
    m = Math.max(m, Math.abs(b.accuracy - b.meanConfidence));
  }
  return m;
}

export interface SweepRow {
  threshold: number;
  executed: number;
  accuracy: number;
  falseClarifyRate: number;
}

/**
 * Pick a fresh ALLOW threshold on dev only (R2): questions whose confidence is
 * below the threshold become CLARIFY, so raising it trades executions for
 * false-clarify. Accuracy is computed over the executed subset (only points
 * actually executed contribute; points never executed have no observable
 * correctness and are excluded from that denominator).
 */
export function thresholdSweep(points: CalibrationPoint[], thresholds: number[]): SweepRow[] {
  const expectedAllow = points.filter((p) => p.expected === 'ALLOW');
  return thresholds.map((threshold) => {
    const executed = expectedAllow.filter((p) => p.confidence >= threshold && p.correct !== null);
    const correct = executed.filter((p) => p.correct).length;
    const fc = expectedAllow.filter((p) => p.confidence < threshold).length;
    return {
      threshold,
      executed: executed.length,
      accuracy: executed.length ? correct / executed.length : 0,
      falseClarifyRate: expectedAllow.length ? fc / expectedAllow.length : 0,
    };
  });
}

/** Threshold values from 0.40 to 0.90 in 0.05 steps (spec 6.2). */
export function defaultThresholds(): number[] {
  const out: number[] = [];
  for (let t = 0.4; t <= 0.9 + EPS; t += 0.05) out.push(Number(t.toFixed(2)));
  return out;
}
