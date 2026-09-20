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

/**
 * One point of the two-threshold grid (spec 6.2). `allow` is the high-confidence
 * edge of the caveat band; `clarify` is the execution boundary. Only `clarify`
 * changes whether a question executes, so only it moves accuracy and
 * false-clarify. `allow` sets how many executed clear questions carry a caveat
 * banner (`caveat`), which is a UX cost rather than a scoring one.
 */
export interface GridCell {
  allow: number;
  clarify: number;
  /** expected-ALLOW questions with an observable outcome that executed. */
  executed: number;
  correct: number;
  accuracy: number;
  /** expected-ALLOW questions pushed to CLARIFY (no execution). */
  falseClarify: number;
  falseClarifyRate: number;
  /** expected-ALLOW questions executed inside the caveat band [clarify, allow). */
  caveat: number;
  caveatRate: number;
  /** expected-CLARIFY questions that executed instead of clarifying. */
  missedClarify: number;
  missedClarifyRate: number;
}

/** Evaluate the two-threshold gate at one (allow, clarify) point. */
export function thresholdCell(points: CalibrationPoint[], allow: number, clarify: number): GridCell {
  const clear = points.filter((p) => p.expected === 'ALLOW');
  const ambiguous = points.filter((p) => p.expected === 'CLARIFY');
  const executedItems = clear.filter((p) => p.confidence >= clarify - EPS && p.correct !== null);
  const correct = executedItems.filter((p) => p.correct === true).length;
  const falseClarify = clear.filter((p) => p.confidence < clarify - EPS).length;
  const caveat = clear.filter((p) => p.confidence >= clarify - EPS && p.confidence < allow - EPS).length;
  const missed = ambiguous.filter((p) => p.confidence >= clarify - EPS).length;
  return {
    allow,
    clarify,
    executed: executedItems.length,
    correct,
    accuracy: executedItems.length ? correct / executedItems.length : 0,
    falseClarify,
    falseClarifyRate: clear.length ? falseClarify / clear.length : 0,
    caveat,
    caveatRate: clear.length ? caveat / clear.length : 0,
    missedClarify: missed,
    missedClarifyRate: ambiguous.length ? missed / ambiguous.length : 0,
  };
}

/**
 * Sweep BOTH gate thresholds independently across the given values (spec 6.2).
 * Only points with `allow >= clarify` are a valid band; others are omitted.
 */
export function thresholdGrid(
  points: CalibrationPoint[],
  allowThresholds: number[] = defaultThresholds(),
  clarifyThresholds: number[] = defaultThresholds(),
): GridCell[] {
  const cells: GridCell[] = [];
  for (const allow of allowThresholds) {
    for (const clarify of clarifyThresholds) {
      if (allow < clarify - EPS) continue;
      cells.push(thresholdCell(points, allow, clarify));
    }
  }
  return cells;
}

export interface OperatingPointOptions {
  /** Max dev false-clarify rate the chosen point may have. */
  falseClarifyBudget?: number;
  /** Max dev caveat rate the chosen point may have. */
  caveatBudget?: number;
  /**
   * The pre-registered point. Retained unless a dev-tuned alternative improves
   * executed accuracy by more than `tolerance`, so a flat sweep cannot silently
   * move the production gate.
   */
  preferred?: { allow: number; clarify: number };
  tolerance?: number;
}

/**
 * Pick a dev-only operating point (R2). Eligible points respect the
 * false-clarify and caveat budgets; among them we maximise executed accuracy,
 * breaking ties toward more executions, then toward the pre-registered clarify
 * threshold, then toward a narrower caveat band. The pre-registered point is
 * retained unless an alternative beats it by more than `tolerance`, so a flat
 * or noisy dev sweep cannot silently move the production gate. The default
 * tolerance (0.05) is about two dev questions, i.e. larger than single-question
 * sampling noise.
 */
export function chooseOperatingPoint(cells: GridCell[], opts: OperatingPointOptions = {}): GridCell {
  const fcBudget = opts.falseClarifyBudget ?? 0.15;
  const caveatBudget = opts.caveatBudget ?? 0.25;
  const tolerance = opts.tolerance ?? 0.05;
  const eligible = cells.filter((c) => c.falseClarifyRate <= fcBudget + EPS && c.caveatRate <= caveatBudget + EPS);
  const pool = eligible.length ? eligible : cells;
  const clarifyDistance = (c: GridCell): number =>
    opts.preferred ? Math.abs(c.clarify - opts.preferred.clarify) : c.clarify;
  const ranked = [...pool].sort(
    (a, b) =>
      b.accuracy - a.accuracy ||
      b.executed - a.executed ||
      clarifyDistance(a) - clarifyDistance(b) ||
      a.allow - b.allow,
  );
  const best = ranked[0];
  if (opts.preferred) {
    const pref = pool.find(
      (c) => Math.abs(c.allow - opts.preferred!.allow) < EPS && Math.abs(c.clarify - opts.preferred!.clarify) < EPS,
    );
    if (pref && best.accuracy - pref.accuracy <= tolerance + EPS) return pref;
  }
  return best;
}
