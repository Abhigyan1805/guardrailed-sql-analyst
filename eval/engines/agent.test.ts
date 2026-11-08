import { describe, it, expect } from 'vitest';
import { AgentEngine, AGENT_CONFIGS, vote, degenerate, type Candidate } from './agent';
import { engineTools, tenantCtx } from '../pipeline';
import type { BackendResult, LlmBackend } from './llm';
import type { Question, SchemaContext } from './engine';

const q = (question: string, id = 'dev-999'): Question => ({
  id, set: 'dev', bucket: 'hard', question, tenant: 'tenant_a', expected_decision: 'ALLOW', order_sensitive: false,
  gold_sql: null, gold_sql_path: null, gold_rows_path: null, gold_rows_hash: null, paraphrase_of: null,
  status: 'active', retired_reason: null, notes: null,
});
const ctx: SchemaContext = { tables: [], views: [], hint: '' };

/** Scripted backend: returns the queued SQL strings in order and records prompts. */
class Scripted implements LlmBackend {
  readonly provider = 'test';
  readonly model = 'scripted';
  readonly temperature = 0;
  readonly prompts: string[] = [];
  constructor(private readonly outputs: (string | null)[]) {}
  async generate(prompt: string): Promise<BackendResult> {
    this.prompts.push(prompt);
    const sql = this.outputs.shift();
    return { text: JSON.stringify({ sql: sql ?? null, reason: sql ? '' : 'refused' }), tokensIn: 10, tokensOut: 5, costUsd: null, usageSource: 'provider', latencyMs: 100 };
  }
}

const noRetrieval = { ...AGENT_CONFIGS.repair, richSchema: false, retrievalK: 0 };

describe('agent repair loop stays inside the guards', () => {
  it('a hostile repair is rejected by the same guarded executor and never chosen', async () => {
    // Draft fails at the guard (base table); the "repair" tries a write and a catalog read.
    const backend = new Scripted(['SELECT * FROM customers', 'DELETE FROM orders']);
    const engine = new AgentEngine(backend, noRetrieval, null, null);
    const probes: string[] = [];
    const tools = {
      async execute(sql: string, tag: string) { probes.push(sql); return engineTools(tenantCtx('tenant_a'), 'test').execute(sql, tag); },
    };
    const g = await engine.generate(q('how many customers?'), ctx, tools);
    // validateSql rejects both before execution: nothing reached the executor.
    expect(probes).toEqual([]);
    expect(g.signals?.executed).toBe(false);
    expect(backend.prompts).toHaveLength(2);
    expect(backend.prompts[1]).toMatch(/rejected or failed/);
  }, 60000);

  it('repairs a query the database rejects, using the error, via executeGuarded', async () => {
    const backend = new Scripted([
      'SELECT no_such_col FROM analytics_orders',
      'SELECT COUNT(*) AS n FROM analytics_orders',
    ]);
    const engine = new AgentEngine(backend, noRetrieval, null, null);
    const g = await engine.generate(q('how many orders?'), ctx, engineTools(tenantCtx('tenant_a'), 'test'));
    expect(g.sql).toMatch(/COUNT\(\*\)/);
    expect(g.signals).toMatchObject({ executed: true, repaired: true, clean: false });
    expect(backend.prompts[1]).toMatch(/no_such_col/);
  }, 60000);

  it('does not call the model again when the first draft runs cleanly', async () => {
    const backend = new Scripted(['SELECT COUNT(*) AS n FROM analytics_orders']);
    const engine = new AgentEngine(backend, noRetrieval, null, null);
    const g = await engine.generate(q('how many orders?'), ctx, engineTools(tenantCtx('tenant_a'), 'test'));
    expect(backend.prompts).toHaveLength(1);
    expect(g.signals).toMatchObject({ executed: true, clean: true, agreement: 1 });
  }, 60000);

  it('keeps an abstention as an abstention', async () => {
    const engine = new AgentEngine(new Scripted([null]), noRetrieval, null, null);
    const g = await engine.generate(q('show me every email'), ctx, engineTools(tenantCtx('tenant_a'), 'test'));
    expect(g.sql).toBeNull();
    expect(g.signals?.abstained).toBe(true);
  });
});

describe('self-consistency vote', () => {
  const cand = (index: number, rows: Record<string, unknown>[] | null): Candidate => ({
    index, sql: 'SELECT 1', reason: '', ok: rows !== null, rows: rows ?? undefined, repaired: false, chainMs: 0,
  });
  it('picks the majority result set and reports agreement', () => {
    const a = [{ n: 1 }];
    const b = [{ n: 2 }];
    const r = vote([cand(0, a), cand(1, b), cand(2, [{ n: '2' }])]);
    expect(r.winner?.index).toBe(1); // 2 and '2' normalize equal
    expect(r.agreement).toBeCloseTo(2 / 3);
  });
  it('breaks ties toward draft 0 and ignores failed drafts', () => {
    const r = vote([cand(0, [{ n: 1 }]), cand(1, [{ n: 2 }]), cand(2, null)]);
    expect(r.winner?.index).toBe(0);
    expect(r.agreement).toBeCloseTo(1 / 3);
  });
  it('flags degenerate results', () => {
    expect(degenerate([])).toMatch(/0 rows/);
    expect(degenerate([{ a: 1, b: null }, { a: 2, b: null }])).toMatch(/b/);
    expect(degenerate([{ a: 1 }])).toBeNull();
  });
});
