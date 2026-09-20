import { describe, it, expect } from 'vitest';
import {
  validateRecordShape,
  normalizeRow,
  compareMultisets,
  invariantErrors,
  degeneracyError,
  timeAnchoringError,
  substitute,
  hashRows,
  EVAL_NOW,
  type GoldRow,
} from './validate-golds';

function rec(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dev-001', set: 'dev', bucket: 'easy', question: 'Q?', tenant: 'tenant_a',
    expected_decision: 'ALLOW', order_sensitive: false,
    gold_sql_path: 'golds/dev/dev-001.sql', gold_rows_hash: 'sha256:x',
    paraphrase_of: null, status: 'active', retired_reason: null, notes: '',
    ...overrides,
  };
}

describe('validate-golds schema', () => {
  it('accepts a well-formed record', () => {
    expect(validateRecordShape(rec(), 'dev')).toEqual([]);
  });
  it('fails loudly on a missing field', () => {
    const r = rec();
    delete (r as Record<string, unknown>).tenant;
    expect(validateRecordShape(r, 'dev')).toContain('missing field "tenant"');
  });
  it('rejects wrong types', () => {
    expect(validateRecordShape(rec({ order_sensitive: 'yes' }), 'dev')).toContain('field "order_sensitive" must be boolean');
  });
  it('rejects a mismatched set', () => {
    expect(validateRecordShape(rec(), 'heldout')).toContain('record set "dev" != file set "heldout"');
  });
  it('requires both a gold path and a null hash for non-ALLOW records', () => {
    expect(validateRecordShape(rec({ expected_decision: 'BLOCK', bucket: 'hostile' }), 'dev')).toContain('non-ALLOW record must have gold_sql_path = null');
    expect(validateRecordShape(rec({ expected_decision: 'BLOCK', bucket: 'hostile', gold_sql_path: null }), 'dev')).toEqual([]);
  });
  it('requires a gold path for ALLOW records', () => {
    expect(validateRecordShape(rec({ gold_sql_path: null }), 'dev')).toContain('ALLOW record must have gold_sql_path');
  });
  it('enforces the id format', () => {
    expect(validateRecordShape(rec({ id: 'E1' }), 'dev').some((e) => e.includes('does not match'))).toBe(true);
  });
});

describe('row normalization + multiset comparison', () => {
  const rowsA: GoldRow[] = [
    { category: 'Books', revenue: '10.50000001' },
    { category: 'Toys', revenue: 20 },
  ];
  const rowsB: GoldRow[] = [
    { category: 'Toys', revenue: 20.0 },
    { category: 'Books', revenue: 10.5 },
  ];
  it('rounds floats to 6dp and canonicalizes numeric strings', () => {
    expect(normalizeRow({ revenue: '10.50000049' })).toEqual(['revenue=10.5']);
    expect(normalizeRow({ revenue: 10.50000049 })).toEqual(['revenue=10.5']);
  });
  it('treats NULL distinctly', () => {
    expect(normalizeRow({ x: null })).toEqual(['x=\u0000NULL']);
  });
  it('matches order-insensitively by default', () => {
    expect(compareMultisets(rowsA, rowsB, false).equal).toBe(true);
  });
  it('respects order when order_sensitive', () => {
    expect(compareMultisets(rowsA, rowsB, true).equal).toBe(false);
  });
  it('detects multiset differences', () => {
    const c = compareMultisets(rowsA, [rowsB[0]], false);
    expect(c.equal).toBe(false);
    expect(c.onlyA.length).toBe(1);
  });
  it('hashes deterministically', () => {
    expect(hashRows(rowsA)).toBe(hashRows([...rowsA]));
    expect(hashRows(rowsA)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('invariants', () => {
  it('flags negative counts and revenue', () => {
    expect(invariantErrors([{ orders: -1 }])).toContain('column orders has a negative value (-1)');
  });
  it('allows negative growth but bounds it', () => {
    expect(invariantErrors([{ mom_growth: -0.5 }])).toEqual([]);
    expect(invariantErrors([{ mom_growth: -150 }]).length).toBe(1);
  });
  it('bounds percentages to [0,100]', () => {
    expect(invariantErrors([{ cancelled_pct: 0.42 }])).toEqual([]);
    expect(invariantErrors([{ cancelled_pct: 140 }]).length).toBe(1);
  });
  it('checks partition shares sum to ~1', () => {
    expect(invariantErrors([{ category: 'a', share: 0.6 }, { category: 'b', share: 0.4 }])).toEqual([]);
    expect(invariantErrors([{ category: 'a', share: 0.6 }, { category: 'b', share: 0.1 }]).length).toBe(1);
  });
});

describe('non-degeneracy', () => {
  it('rejects empty unless allowed', () => {
    expect(degeneracyError([], false)).toBe('empty result set');
    expect(degeneracyError([], true)).toBeNull();
  });
  it('rejects a single all-NULL row unless allowed', () => {
    expect(degeneracyError([{ x: null }], false)).toBe('single all-NULL row');
    expect(degeneracyError([{ x: null }], true)).toBeNull();
    expect(degeneracyError([{ x: 0 }], false)).toBeNull();
  });
});

describe('time anchoring', () => {
  it('rejects now(), CURRENT_DATE and random()', () => {
    expect(timeAnchoringError('SELECT now()', 'SELECT 1')).toMatch(/forbidden/);
    expect(timeAnchoringError('SELECT 1', 'SELECT CURRENT_DATE')).toMatch(/forbidden/);
    expect(timeAnchoringError('SELECT random()', 'SELECT 1')).toMatch(/forbidden/);
  });
  it('accepts an injected EVAL_NOW literal', () => {
    expect(timeAnchoringError("SELECT date_trunc('month', TIMESTAMPTZ '2025-09-01T00:00:00Z')", 'SELECT 1')).toBeNull();
  });
});

describe('adapter substitution', () => {
  it('injects EVAL_NOW and tenant as literals', () => {
    const out = substitute('WHERE o.ordered_at >= :eval_now AND o.tenant_id = :tenant', 'tenant_b');
    expect(out).toContain(`TIMESTAMPTZ '${EVAL_NOW}'`);
    expect(out).toContain("'tenant_b'");
    expect(out).not.toContain(':eval_now');
  });
});
