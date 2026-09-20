import { describe, it, expect } from 'vitest';
import { HybridEngine } from './hybrid';
import type { Engine, Generation, Question, SchemaContext } from './engine';

const q: Question = {
  id: 'x', set: 'dev', bucket: 'easy', question: 'q', tenant: 'tenant_a',
  expected_decision: 'ALLOW', order_sensitive: false, gold_sql: null, gold_sql_path: null, gold_rows_path: null,
  gold_rows_hash: null, paraphrase_of: null, status: 'active', retired_reason: null, notes: null,
};
const ctx: SchemaContext = { tables: [], views: [], hint: '' };

function stub(name: Engine['name'], gen: Generation): Engine {
  return { name, generate: async () => gen };
}

const gen = (o: Partial<Generation>): Generation => ({ sql: null, confidence: 0, tokensIn: 0, tokensOut: 0, retries: 0, latencyMs: 0, ...o });

describe('HybridEngine', () => {
  it('uses the template when it hits with sufficient confidence', async () => {
    const t = stub('templates', gen({ sql: 'SELECT 1', confidence: 0.9 }));
    let llmCalled = false;
    const l = { name: 'llm' as const, generate: async () => { llmCalled = true; return gen({ sql: 'SELECT 2', confidence: 0.9 }); } };
    const h = new HybridEngine(t, l);
    const r = await h.generate(q, ctx);
    expect(r.sql).toBe('SELECT 1');
    expect(llmCalled).toBe(false);
  });

  it('falls through to the LLM on a template miss', async () => {
    const t = stub('templates', gen({ sql: null, confidence: 0 }));
    const l = stub('llm', gen({ sql: 'SELECT 2', confidence: 0.8, tokensIn: 100, tokensOut: 20, retries: 1, usageSource: 'provider', costUsd: 0.002 }));
    const h = new HybridEngine(t, l);
    const r = await h.generate(q, ctx);
    expect(r.sql).toBe('SELECT 2');
    expect(r.tokensIn).toBe(100);
    expect(r.retries).toBe(1);
  });

  it('falls through when template confidence is below the threshold but keeps LLM result', async () => {
    const t = stub('templates', gen({ sql: 'SELECT 1', confidence: 0.4 }));
    const l = stub('llm', gen({ sql: 'SELECT 2', confidence: 0.8 }));
    const h = new HybridEngine(t, l, 0.55);
    const r = await h.generate(q, ctx);
    expect(r.sql).toBe('SELECT 2');
  });
});
