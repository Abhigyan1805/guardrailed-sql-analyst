import { describe, it, expect } from 'vitest';
import { normalizeRecord, parseArgs } from './loader';
import { compareRows } from './metrics/accuracy';

describe('parseArgs', () => {
  it('parses the documented flags', () => {
    const a = parseArgs(['--set', 'heldout', '--engine', 'hybrid', '--repeats', '3', '--strict']);
    expect(a.set).toBe('heldout');
    expect(a.engine).toBe('hybrid');
    expect(a.repeats).toBe(3);
    expect(a.strict).toBe(true);
  });

  it('parses --attacks and --matrix', () => {
    expect(parseArgs(['--attacks']).attacks).toBe(true);
    expect(parseArgs(['--matrix']).matrix).toBe(true);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown flag/);
  });
});

describe('normalizeRecord', () => {
  it('maps a legacy dev record, defaulting to ALLOW', () => {
    const q = normalizeRecord({ id: 'E1', bucket: 'easy', question: 'Q?', gold: 'SELECT 1', ordered: true }, 'dev');
    expect(q.expected_decision).toBe('ALLOW');
    expect(q.order_sensitive).toBe(true);
    expect(q.gold_sql).toBe('SELECT 1');
    expect(q.status).toBe('active');
    expect(q.tenant).toBe('tenant_a');
  });

  it('maps legacy adversarial records to BLOCK and uses input as the question', () => {
    const q = normalizeRecord({ id: 'A1', bucket: 'adversarial', input: 'DROP TABLE orders', notes: 'ddl' }, 'dev');
    expect(q.expected_decision).toBe('BLOCK');
    expect(q.question).toBe('DROP TABLE orders');
  });

  it('carries paraphrase linkage', () => {
    const q = normalizeRecord({ id: 'E1a', bucket: 'easy', question: 'Q', gold: 'SELECT 1', variant_of: 'E1' }, 'paraphrase');
    expect(q.paraphrase_of).toBe('E1');
  });

  it('honours the v2 schema fields', () => {
    const q = normalizeRecord({
      id: 'hd-014', set: 'heldout', bucket: 'hard', question: 'Which products?', tenant: 'tenant_a',
      expected_decision: 'CLARIFY', order_sensitive: false, gold_sql_path: null,
      gold_rows_hash: null, paraphrase_of: null, status: 'retired', retired_reason: 'broken', notes: null,
    }, 'heldout');
    expect(q.expected_decision).toBe('CLARIFY');
    expect(q.status).toBe('retired');
    expect(q.retired_reason).toBe('broken');
  });

  it('fails loudly on a missing question', () => {
    expect(() => normalizeRecord({ id: 'bad' }, 'dev')).toThrow(/missing question/);
  });
});

describe('positional scoring end to end', () => {
  it('passes an alias-drifted row set that has the right values in order', () => {
    const pred = [{ n: '3', money: '120.00' }];
    const gold = [{ orders: 3, revenue: 120 }];
    expect(compareRows(pred, gold).pass).toBe(true);
  });
});
