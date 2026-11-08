// Confidence from observable signals instead of model self-report.
//
// The agent engine records, per question, what actually happened: whether the
// drafts agreed on a result set, whether the query ran cleanly or needed a
// repair, whether the result looks degenerate, and how close the question was
// to a solved dev example. A small L2-regularised logistic regression maps
// those signals to P(correct). It is fitted on DEV only (R2); dev ECE is
// reported from leave-one-out predictions so it is not an in-sample number.

export interface Signals {
  /** Model returned sql:null (refusal / clarify). */
  abstained: boolean;
  /** Number of drafts generated. */
  drafts: number;
  /** Fraction of drafts whose result set matches the chosen one (1 with one draft). */
  agreement: number;
  /** Chosen SQL executed through the guard on its first attempt (no repair). */
  clean: boolean;
  /** A repair round was used for the chosen SQL. */
  repaired: boolean;
  /** Chosen SQL executed successfully at all. */
  executed: boolean;
  /** Result had zero rows. */
  empty: boolean;
  /** Some column is NULL in every row (degenerate result). */
  nullColumn: boolean;
  /** Highest retrieval similarity to a solved dev question (0 when retrieval is off). */
  topSimilarity: number;
  /** Rough structural complexity of the SQL in 0..1 (CTEs, joins, windows). */
  complexity: number;
}

export const FEATURES = ['agreement', 'clean', 'empty_or_null', 'top_similarity', 'complexity'] as const;

export function featureVector(s: Signals): number[] {
  return [
    s.agreement,
    s.clean ? 1 : 0,
    s.empty || s.nullColumn ? 1 : 0,
    s.topSimilarity,
    s.complexity,
  ];
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export function sqlComplexity(sql: string): number {
  // Plain function, not a closure over `sql`: the Next/SWC production minifier inlined
  // the closure into its caller and dropped the binding (ReferenceError: sql is not defined).
  const score = countMatches(sql, /\bwith\b|\),\s*\w+\s+as\s*\(/gi) + countMatches(sql, /\bjoin\b/gi)
    + countMatches(sql, /\bover\s*\(/gi) + countMatches(sql, /\bhaving\b/gi);
  return Math.min(1, score / 4);
}

export interface Calibrator {
  kind: 'logistic';
  features: readonly string[];
  weights: number[];
  bias: number;
  l2: number;
  /** Confidence assigned when the model abstains or nothing executed. */
  abstainConfidence: number;
  fitted_on: string;
  n: number;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Fit logistic regression by Newton's method with an L2 penalty on the weights (not the bias). */
export function fitLogistic(X: number[][], y: number[], l2 = 1, iters = 50): { weights: number[]; bias: number } {
  const d = X[0]?.length ?? 0;
  let w = new Array(d + 1).fill(0); // w[0] = bias
  for (let it = 0; it < iters; it++) {
    const grad = new Array(d + 1).fill(0);
    const H = Array.from({ length: d + 1 }, () => new Array(d + 1).fill(0));
    for (let i = 0; i < X.length; i++) {
      const x = [1, ...X[i]];
      const p = sigmoid(x.reduce((s, v, j) => s + v * w[j], 0));
      for (let j = 0; j <= d; j++) {
        grad[j] += (p - y[i]) * x[j];
        for (let k = 0; k <= d; k++) H[j][k] += p * (1 - p) * x[j] * x[k];
      }
    }
    for (let j = 1; j <= d; j++) {
      grad[j] += l2 * w[j];
      H[j][j] += l2;
    }
    H[0][0] += 1e-6;
    const step = solve(H, grad);
    if (!step) break;
    w = w.map((v, j) => v - step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return { bias: w[0], weights: w.slice(1) };
}

/** Gaussian elimination with partial pivoting; null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function predict(cal: Calibrator, s: Signals): number {
  if (s.abstained || !s.executed) return cal.abstainConfidence;
  const x = featureVector(s);
  return sigmoid(cal.bias + x.reduce((acc, v, j) => acc + v * cal.weights[j], 0));
}

export interface LabelledSignals {
  id: string;
  signals: Signals;
  correct: boolean;
}

export function fitCalibrator(points: LabelledSignals[], fittedOn: string, l2 = 1): Calibrator {
  const usable = points.filter((p) => !p.signals.abstained && p.signals.executed);
  const { weights, bias } = fitLogistic(usable.map((p) => featureVector(p.signals)), usable.map((p) => (p.correct ? 1 : 0)), l2);
  return { kind: 'logistic', features: FEATURES, weights, bias, l2, abstainConfidence: 0.1, fitted_on: fittedOn, n: usable.length };
}

/** Leave-one-out predictions: each point scored by a calibrator fitted without it. */
export function leaveOneOut(points: LabelledSignals[], l2 = 1): { id: string; confidence: number; correct: boolean }[] {
  return points.map((p, i) => {
    const cal = fitCalibrator(points.filter((_, j) => j !== i), 'loo', l2);
    return { id: p.id, confidence: predict(cal, p.signals), correct: p.correct };
  });
}
