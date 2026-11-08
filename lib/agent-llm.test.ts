import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { liveGenerate, getLiveEngine, liveConfig, setLiveDeps } from './agent-llm';
import { llmBudget, resetLlmBudget } from './llm-budget';
import { AgentEngine, AGENT_CONFIGS } from '../eval/engines/agent';
import { tenantCtx } from '../eval/pipeline';
import type { BackendResult, LlmBackend } from '../eval/engines/llm';

class Counting implements LlmBackend {
  readonly provider = 'test';
  readonly model = 'deepseek-flash';
  readonly temperature = 0;
  calls = 0;
  constructor(private readonly sql: string) {}
  async generate(): Promise<BackendResult> {
    this.calls++;
    return { text: JSON.stringify({ sql: this.sql, reason: '' }), tokensIn: 10, tokensOut: 5, costUsd: null, usageSource: 'provider', latencyMs: 1 };
  }
}

const ENV = ['LLM_PROVIDER', 'LLM_API_KEY', 'LLM_DAILY_CAP', 'LLM_MAX_CALLS', 'LLM_DRAFTS'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.LLM_PROVIDER = 'openai';
  process.env.LLM_API_KEY = 'test-key';
  delete process.env.LLM_MAX_CALLS;
  delete process.env.LLM_DRAFTS;
  resetLlmBudget();
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  setLiveDeps({});
});

describe('daily cap on the OpenAI-compatible path', () => {
  it('counts one unit per question (not per model call) and then falls back', async () => {
    process.env.LLM_DAILY_CAP = '2';
    const backend = new Counting('SELECT COUNT(*) AS n FROM analytics_orders');
    setLiveDeps({ backend });
    const ctx = tenantCtx('tenant_a');
    const r1 = await liveGenerate('how many orders are there?', ctx, 'cap-1');
    expect(r1.kind).toBe('generated');
    expect(backend.calls).toBe(3); // 3 self-consistency drafts
    expect(llmBudget().used).toBe(1); // ...but a single cap unit
    expect((await liveGenerate('how many orders are there?', ctx, 'cap-2')).kind).toBe('generated');
    const before = backend.calls;
    expect((await liveGenerate('how many orders are there?', ctx, 'cap-3')).kind).toBe('capped');
    expect(backend.calls).toBe(before); // no model call once the cap is spent
  }, 60000);

  it('LLM_DAILY_CAP=0 disables the model', async () => {
    process.env.LLM_DAILY_CAP = '0';
    const backend = new Counting('SELECT 1');
    setLiveDeps({ backend });
    expect((await liveGenerate('how many orders?', tenantCtx('tenant_a'), 'cap-0')).kind).toBe('capped');
    expect(backend.calls).toBe(0);
  });
});

describe('per-question model-call ceiling', () => {
  it('never exceeds drafts + 1 even when every draft needs a repair', async () => {
    process.env.LLM_DAILY_CAP = '100';
    // Every draft fails in the database, so each would normally ask for a repair.
    const backend = new Counting('SELECT no_such_col FROM analytics_orders');
    setLiveDeps({ backend });
    const r = await liveGenerate('how many orders?', tenantCtx('tenant_a'), 'ceiling-1');
    expect(r.kind).toBe('generated');
    expect(liveConfig().maxCalls).toBe(4);
    expect(backend.calls).toBe(4);
    if (r.kind === 'generated') expect(r.gen.llmCalls).toBe(4);
  }, 60000);

  it('LLM_MAX_CALLS can lower it to the draft count (no repairs)', async () => {
    process.env.LLM_DAILY_CAP = '100';
    process.env.LLM_MAX_CALLS = '3';
    const backend = new Counting('SELECT no_such_col FROM analytics_orders');
    setLiveDeps({ backend });
    await liveGenerate('how many orders?', tenantCtx('tenant_a'), 'ceiling-2');
    expect(backend.calls).toBe(3);
  }, 60000);
});

describe('app and eval share one engine', () => {
  it('the live app builds the eval AgentEngine with the measured config', () => {
    setLiveDeps({ backend: new Counting('SELECT 1') });
    const eng = getLiveEngine('openai');
    expect(eng).toBeInstanceOf(AgentEngine);
    const measured = AGENT_CONFIGS['sc3-noret'];
    expect({ ...eng.config, maxCalls: undefined }).toEqual({ ...measured, maxCalls: undefined });
  });

  it('lib/agent.ts has no second model-calling implementation', () => {
    const src = readFileSync(new URL('./agent.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/chat\/completions|geminiGenerate/);
    expect(src).toMatch(/liveGenerate/);
  });
});
