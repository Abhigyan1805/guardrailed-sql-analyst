import { describe, it, expect } from 'vitest';
import { parseModelJson, parseOpencodeOutput, LlmEngine, type LlmBackend, type BackendResult } from './llm';
import type { Question, SchemaContext } from './engine';

describe('parseModelJson', () => {
  it('parses a plain JSON object', () => {
    const r = parseModelJson('{"sql":"SELECT 1","columns":[],"confidence":0.8}');
    expect(r.sql).toBe('SELECT 1');
    expect(r.confidence).toBe(0.8);
  });

  it('tolerates code fences and surrounding prose', () => {
    const r = parseModelJson('Here you go:\n```json\n{"sql":"SELECT 2","confidence":0.7}\n```');
    expect(r.sql).toBe('SELECT 2');
  });

  it('treats sql:null as an abstention', () => {
    const r = parseModelJson('{"sql":null,"confidence":0.2,"reason":"too vague"}');
    expect(r.sql).toBeNull();
    expect(r.confidence).toBe(0.2);
    expect(r.reason).toBe('too vague');
  });

  it('clamps confidence and defaults it', () => {
    expect(parseModelJson('{"sql":"SELECT 1","confidence":5}').confidence).toBe(1);
    expect(parseModelJson('{"sql":"SELECT 1"}').confidence).toBe(0.5);
  });

  it('throws on non-JSON', () => {
    expect(() => parseModelJson('not json at all')).toThrow(/not valid JSON/);
  });
});

describe('parseOpencodeOutput', () => {
  it('concatenates text and sums provider usage', () => {
    const stdout = [
      JSON.stringify({ type: 'text', part: { text: '{"sql":' } }),
      JSON.stringify({ type: 'text', part: { text: '"SELECT 1"}' } }),
      JSON.stringify({ type: 'step_finish', part: { tokens: { input: 100, output: 5 }, cost: 0.001 } }),
    ].join('\n');
    const r = parseOpencodeOutput(stdout);
    expect(r.text).toBe('{"sql":"SELECT 1"}');
    expect(r.tokensIn).toBe(100);
    expect(r.tokensOut).toBe(5);
    expect(r.costUsd).toBeCloseTo(0.001, 9);
    expect(r.usageSource).toBe('provider');
  });

  it('marks usage estimated when the backend omits tokens', () => {
    const stdout = JSON.stringify({ type: 'text', part: { text: 'hello' } });
    const r = parseOpencodeOutput(stdout);
    expect(r.usageSource).toBe('estimated');
    expect(r.costUsd).toBeNull();
  });

  it('surfaces error events', () => {
    const stdout = JSON.stringify({ type: 'error', error: { name: 'APIError', data: { message: 'boom' } } });
    expect(parseOpencodeOutput(stdout).error).toBe('boom');
  });
});

class FakeBackend implements LlmBackend {
  provider = 'fake';
  model = 'fake-model';
  temperature = 0;
  calls = 0;
  constructor(private readonly responses: BackendResult[]) {}
  async generate(): Promise<BackendResult> {
    const r = this.responses[Math.min(this.calls, this.responses.length - 1)];
    this.calls++;
    return r;
  }
}

const q: Question = {
  id: 'x', set: 'dev', bucket: 'easy', question: 'How many orders?', tenant: 'tenant_a',
  expected_decision: 'ALLOW', order_sensitive: false, gold_sql: null, gold_sql_path: null, gold_rows_path: null,
  gold_rows_hash: null, paraphrase_of: null, status: 'active', retired_reason: null, notes: null,
};
const ctx: SchemaContext = { tables: [], views: [], hint: '' };

const br = (text: string, tokensIn = 10, tokensOut = 5): BackendResult => ({ text, tokensIn, tokensOut, costUsd: 0.001, usageSource: 'provider' });

describe('LlmEngine retries', () => {
  it('feeds a guardrail error back and retries, counting tokens/retries', async () => {
    const backend = new FakeBackend([
      br(JSON.stringify({ sql: 'SELECT FROM WHERE', confidence: 0.7 })),
      br(JSON.stringify({ sql: 'SELECT order_id FROM analytics_orders', columns: [], confidence: 0.7 })),
    ]);
    const engine = new LlmEngine(backend);
    const g = await engine.generate(q, ctx);
    expect(g.sql).toMatch(/analytics_orders/);
    expect(g.retries).toBe(1);
    expect(backend.calls).toBe(2);
    expect(g.tokensIn).toBe(20);
    expect(g.tokensOut).toBe(10);
  });

  it('gives up after MAX_RETRIES and returns sql null', async () => {
    const invalid = () => br(JSON.stringify({ sql: 'SELECT FROM WHERE', confidence: 0.7 }));
    const backend = new FakeBackend([invalid(), invalid(), invalid(), invalid()]);
    const engine = new LlmEngine(backend);
    const g = await engine.generate(q, ctx);
    expect(g.sql).toBeNull();
    expect(g.retries).toBe(2);
    expect(backend.calls).toBe(3); // initial + 2 retries
  });

  it('does not retry an explicit abstention', async () => {
    const backend = new FakeBackend([br(JSON.stringify({ sql: null, confidence: 0.2, reason: 'vague' }))]);
    const engine = new LlmEngine(backend);
    const g = await engine.generate(q, ctx);
    expect(g.sql).toBeNull();
    expect(g.retries).toBe(0);
    expect(backend.calls).toBe(1);
    expect(g.error).toBe('vague');
  });
});
