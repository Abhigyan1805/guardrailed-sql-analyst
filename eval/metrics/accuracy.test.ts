import { describe, it, expect } from 'vitest';
import {
  compareRows, normalizeValue, accuracy, decisionMatrix, falseClarifyRate, missedClarifyRate,
  type ScoredItem,
} from './accuracy';

describe('normalizeValue', () => {
  it('unifies numeric strings with numbers and rounds floats', () => {
    expect(normalizeValue('123.456')).toBe('123.456');
    expect(normalizeValue(123.456)).toBe('123.456');
    expect(normalizeValue('1.23456789')).toBe('1.234568');
    expect(normalizeValue(null)).not.toBe(normalizeValue(0));
  });

  it('keeps non-numeric strings intact', () => {
    expect(normalizeValue('Electronics')).toBe('Electronics');
    expect(normalizeValue(true)).toBe('true');
  });
});

describe('compareRows (positional by value, never by name)', () => {
  it('passes when values match regardless of column names', () => {
    const pred = [{ total_revenue: 10 }, { total_revenue: 20 }];
    const gold = [{ revenue: 20 }, { revenue: 10 }];
    expect(compareRows(pred, gold).pass).toBe(true);
  });

  it('treats Postgres numeric strings as numbers', () => {
    const pred = [{ v: '10.0' }, { v: '20.50' }];
    const gold = [{ v: 10 }, { v: 20.5 }];
    expect(compareRows(pred, gold).pass).toBe(true);
  });

  it('is order-sensitive only when asked', () => {
    const pred = [{ v: 1 }, { v: 2 }];
    const gold = [{ v: 2 }, { v: 1 }];
    expect(compareRows(pred, gold, false).pass).toBe(true);
    expect(compareRows(pred, gold, true).pass).toBe(false);
  });

  it('fails on differing arity instead of ignoring extra columns', () => {
    const r = compareRows([{ a: 1, b: 2 }], [{ a: 1 }]);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/column count/);
  });

  it('handles empty gold', () => {
    expect(compareRows([], []).pass).toBe(true);
    expect(compareRows([{ a: 1 }], []).pass).toBe(false);
  });

  it('detects a genuinely wrong value in the same position', () => {
    expect(compareRows([{ v: 2 }], [{ v: 1 }]).pass).toBe(false);
  });
});

function item(overrides: Partial<ScoredItem>): ScoredItem {
  return {
    id: 'x', bucket: 'easy', expected_decision: 'ALLOW', decision: 'ALLOW',
    confidence: 0.9, correct: true, order_sensitive: false,
    ...overrides,
  };
}

describe('aggregate metrics', () => {
  it('accuracy excludes unscored items from the denominator', () => {
    const items = [item({ id: 'a', correct: true }), item({ id: 'b', correct: false }), item({ id: 'c', correct: null })];
    const a = accuracy(items);
    expect(a.scored).toBe(2);
    expect(a.correct).toBe(1);
    expect(a.accuracy).toBe(0.5);
    expect(a.excluded).toBe(1);
  });

  it('builds a 3x3 decision matrix', () => {
    const items = [
      item({ expected_decision: 'ALLOW', decision: 'ALLOW' }),
      item({ expected_decision: 'ALLOW', decision: 'CLARIFY' }),
      item({ expected_decision: 'BLOCK', decision: 'CLARIFY' }),
      item({ expected_decision: 'CLARIFY', decision: 'CLARIFY' }),
    ];
    const m = decisionMatrix(items);
    expect(m.expected).toEqual(['ALLOW', 'CLARIFY', 'BLOCK']);
    expect(m.counts[0][0]).toBe(1); // ALLOW -> ALLOW
    expect(m.counts[0][1]).toBe(1); // ALLOW -> CLARIFY
    expect(m.counts[2][1]).toBe(1); // BLOCK -> CLARIFY
    expect(m.counts[1][1]).toBe(1); // CLARIFY -> CLARIFY
  });

  it('computes false-clarify and missed-clarify rates', () => {
    const items = [
      item({ expected_decision: 'ALLOW', decision: 'CLARIFY' }),
      item({ expected_decision: 'ALLOW', decision: 'ALLOW' }),
      item({ expected_decision: 'CLARIFY', decision: 'ALLOW' }),
      item({ expected_decision: 'CLARIFY', decision: 'CLARIFY' }),
    ];
    expect(falseClarifyRate(items)).toEqual({ rate: 0.5, n: 2, falseClarify: 1 });
    expect(missedClarifyRate(items)).toEqual({ rate: 0.5, n: 2, missed: 1 });
  });
});
