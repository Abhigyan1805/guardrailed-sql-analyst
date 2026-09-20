// Row-set accuracy + decision metrics (spec 4.1, 6.1).
//
// Scoring is positional by value with normalized types. Column *names* are
// presentation, not correctness: the model may alias a column anything it
// likes as long as the values come back in the contracted order. This is the
// harness fix that removes the old alias-drift failure mode.

export type Decision = 'ALLOW' | 'CLARIFY' | 'BLOCK';

export interface ScoredItem {
  id: string;
  bucket: string;
  expected_decision: Decision;
  decision: Decision | 'ERROR';
  confidence: number;
  /** Row-multiset match for ALLOW/expected-ALLOW questions; null otherwise. */
  correct: boolean | null;
  order_sensitive: boolean;
}

const NULL_SENTINEL = '\u0000NULL';

function isNumericString(s: string): boolean {
  const t = s.trim();
  if (t === '') return false;
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t);
}

/**
 * Canonicalize a single cell to a string. Numeric strings are unified with
 * numbers (Postgres returns NUMERIC/DECIMAL as strings), floats are rounded to
 * 6 dp, dates/times to ISO, booleans to a stable token.
 */
export function normalizeValue(v: unknown): string {
  if (v === null || v === undefined) return NULL_SENTINEL;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    return Number(v.toFixed(6)).toString();
  }
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && isNumericString(v)) {
    return Number(Number(v).toFixed(6)).toString();
  }
  return String(v).trim();
}

export interface CompareResult {
  pass: boolean;
  reason: string;
  predRows: number;
  goldRows: number;
}

/** Canonical tuple for a row, in the row's declared column order. */
export function canonicalRow(row: Record<string, unknown>): string[] {
  return Object.values(row).map(normalizeValue);
}

function rowKey(tuple: string[]): string {
  return tuple.join('\u0001');
}

/**
 * Compare two result sets positionally by value.
 *
 * - arity must match exactly: the output contract fixes the column order, so a
 *   differing number of columns is a miss (never silently ignored).
 * - every row becomes a value tuple; tuples are compared as a multiset unless
 *   `ordered` is set, in which case the order must match too.
 */
export function compareRows(
  pred: Record<string, unknown>[],
  gold: Record<string, unknown>[],
  ordered = false,
): CompareResult {
  if (gold.length === 0) {
    return pred.length === 0
      ? { pass: true, reason: '', predRows: 0, goldRows: 0 }
      : { pass: false, reason: `expected empty set, got ${pred.length} rows`, predRows: pred.length, goldRows: 0 };
  }
  if (pred.length === 0) {
    return { pass: false, reason: `expected ${gold.length} rows, got empty set`, predRows: 0, goldRows: gold.length };
  }

  const goldArity = Object.keys(gold[0]).length;
  const predArity = Object.keys(pred[0]).length;
  if (predArity !== goldArity) {
    return {
      pass: false,
      reason: `column count ${predArity} != gold ${goldArity}`,
      predRows: pred.length,
      goldRows: gold.length,
    };
  }

  const p = pred.map(canonicalRow);
  const g = gold.map(canonicalRow);
  if (p.length !== g.length) {
    return { pass: false, reason: `row count ${p.length} != gold ${g.length}`, predRows: p.length, goldRows: g.length };
  }

  if (ordered) {
    for (let i = 0; i < p.length; i++) {
      if (rowKey(p[i]) !== rowKey(g[i])) {
        return { pass: false, reason: `row ${i} differs (ordered)`, predRows: p.length, goldRows: g.length };
      }
    }
    return { pass: true, reason: '', predRows: p.length, goldRows: g.length };
  }

  const pk = p.map(rowKey).sort();
  const gk = g.map(rowKey).sort();
  for (let i = 0; i < pk.length; i++) {
    if (pk[i] !== gk[i]) {
      return { pass: false, reason: `row multiset differs at sorted position ${i}`, predRows: p.length, goldRows: g.length };
    }
  }
  return { pass: true, reason: '', predRows: p.length, goldRows: g.length };
}

export interface AccuracySummary {
  scored: number;
  correct: number;
  accuracy: number;
  excluded: number;
}

/**
 * Exact row-multiset match / scored questions. `correct === null` items are
 * excluded from the denominator (retired questions, CLARIFY/BLOCK golds).
 */
export function accuracy(items: ScoredItem[]): AccuracySummary {
  const scoredItems = items.filter((i) => i.correct !== null);
  const correct = scoredItems.filter((i) => i.correct === true).length;
  return {
    scored: scoredItems.length,
    correct,
    accuracy: scoredItems.length ? correct / scoredItems.length : 0,
    excluded: items.length - scoredItems.length,
  };
}

export interface DecisionMatrix {
  expected: Decision[];
  actual: Decision[];
  counts: number[][];
}

/** 3x3 confusion of expected vs actual ALLOW/CLARIFY/BLOCK. ERORRs count in a 4th actual row is avoided: errors are surfaced as BLOCK-like misses via decision 'ERROR' and tracked separately. */
export function decisionMatrix(items: ScoredItem[]): DecisionMatrix {
  const expected: Decision[] = ['ALLOW', 'CLARIFY', 'BLOCK'];
  const actual: Decision[] = ['ALLOW', 'CLARIFY', 'BLOCK'];
  const counts = expected.map(() => actual.map(() => 0));
  for (const it of items) {
    const e = expected.indexOf(it.expected_decision);
    if (e < 0) continue;
    const a = actual.indexOf(it.decision as Decision);
    if (a < 0) continue;
    counts[e][a]++;
  }
  return { expected, actual, counts };
}

/** Clear (expected ALLOW) questions that got CLARIFY. */
export function falseClarifyRate(items: ScoredItem[]): { rate: number; n: number; falseClarify: number } {
  const clear = items.filter((i) => i.expected_decision === 'ALLOW');
  const fc = clear.filter((i) => i.decision === 'CLARIFY').length;
  return { rate: clear.length ? fc / clear.length : 0, n: clear.length, falseClarify: fc };
}

/** Ambiguous (expected CLARIFY) questions that got ALLOW. */
export function missedClarifyRate(items: ScoredItem[]): { rate: number; n: number; missed: number } {
  const ambiguous = items.filter((i) => i.expected_decision === 'CLARIFY');
  const missed = ambiguous.filter((i) => i.decision === 'ALLOW').length;
  return { rate: ambiguous.length ? missed / ambiguous.length : 0, n: ambiguous.length, missed };
}
