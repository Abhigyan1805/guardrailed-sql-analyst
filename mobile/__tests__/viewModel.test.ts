import { buildBars, CLARIFY_FOLLOW_UPS, formatCell, MAX_ROWS, toResultView } from '../lib/viewModel';
import type { QueryResponse } from '../lib/types';

const allow: QueryResponse = {
  decision: 'ALLOW', sql: 'SELECT 1', executedSql: 'SELECT name, revenue FROM analytics_products LIMIT 5',
  columns: ['name', 'revenue'],
  rows: [{ name: 'Widget', revenue: '1200.5000' }, { name: 'Gadget', revenue: 900 }],
  chartSpec: { type: 'bar', x: 'name', y: 'revenue', title: 'Top products by revenue' },
  caveats: ['Revenue excludes cancelled orders'], confidence: 0.91, latencyMs: 42, engine: 'offline-template',
};

describe('toResultView', () => {
  it('maps ALLOW to an answer with table, chart, sql and caveats', () => {
    const v = toResultView(allow);
    expect(v.kind).toBe('answer');
    expect(v.tone).toBe('success');
    expect(v.headline).toBe('Top products by revenue');
    expect(v.sql).toBe(allow.executedSql);
    expect(v.rows).toEqual([['Widget', '1200.50'], ['Gadget', '900']]);
    expect(v.chart?.bars).toEqual([{ label: 'Widget', value: 1200.5 }, { label: 'Gadget', value: 900 }]);
    expect(v.caveats).toEqual(allow.caveats);
    expect(v.meta).toBe('Confidence 0.91 · 42ms · engine offline-template');
  });

  it('maps BLOCK to a danger banner with the reason and no data', () => {
    const v = toResultView({ decision: 'BLOCK', blockReason: 'PII / restricted-column request refused', blockStage: 'prescreen', caveats: [], confidence: 0 });
    expect(v).toMatchObject({ kind: 'blocked', tone: 'danger', banner: 'BLOCKED', blockReason: 'PII / restricted-column request refused', rows: [], sql: null, chart: null });
    expect(v.meta).toContain('nothing was executed');
  });

  it('maps CLARIFY to follow-up chips and no sql', () => {
    const v = toResultView({ decision: 'CLARIFY', clarifyingQuestions: ['Which metric?'], caveats: [], confidence: 0.4 });
    expect(v).toMatchObject({ kind: 'clarify', tone: 'warning', sql: null, clarifyingQuestions: ['Which metric?'], followUps: CLARIFY_FOLLOW_UPS });
  });

  it('caps stored rows but keeps the total, and falls back to row-count headline', () => {
    const rows = Array.from({ length: MAX_ROWS + 10 }, (_, i) => ({ n: i }));
    const v = toResultView({ decision: 'ALLOW', rows, caveats: [], confidence: 1 });
    expect(v.rows).toHaveLength(MAX_ROWS);
    expect(v.totalRows).toBe(MAX_ROWS + 10);
    expect(v.headline).toBe('60 rows returned');
    expect(v.columns).toEqual(['n']);
  });

  it('tolerates a missing BLOCK reason', () => {
    expect(toResultView({ decision: 'BLOCK', caveats: [], confidence: 0 }).blockReason).toMatch(/blocked/i);
  });
});

describe('buildBars', () => {
  it('returns null for table specs, empty rows or non-numeric values', () => {
    expect(buildBars({ type: 'table', x: 'a', y: 'b', title: '' }, [{ a: 'x', b: 1 }])).toBeNull();
    expect(buildBars({ type: 'bar', x: 'a', y: 'b', title: '' }, [])).toBeNull();
    expect(buildBars({ type: 'bar', x: 'a', y: 'b', title: '' }, [{ a: 'x', b: 'n/a' }])).toBeNull();
    expect(buildBars(undefined, [{ a: 1 }])).toBeNull();
  });
  it('limits to 12 bars', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ a: `c${i}`, b: i }));
    expect(buildBars({ type: 'line', x: 'a', y: 'b', title: '' }, rows)).toHaveLength(12);
  });
});

describe('formatCell', () => {
  it('formats nulls, floats and numeric strings', () => {
    expect(formatCell(null)).toBe('—');
    expect(formatCell(3.14159)).toBe('3.14');
    expect(formatCell('12.34567')).toBe('12.35');
    expect(formatCell('SKU-1')).toBe('SKU-1');
  });
});
