// Live LLM path: the app runs the SAME AgentEngine the eval measures
// (eval/engines/agent.ts, config `sc3-noret`: rich schema, execution-guided
// repair, 3-draft self-consistency, dev-fitted calibrator). There is no second
// implementation. Every SQL the engine runs (drafts and repairs) goes through
// validateSql and executeGuarded via the `execute` tool lent below.
//
// Cost controls, applied to every provider:
//  - one global daily-cap unit per QUESTION (takeLlmCall), however many calls it makes
//  - a hard per-question ceiling on model calls (LLM_MAX_CALLS, default drafts + 1)
//  - a process-lifetime spend guard on the OpenAI-compatible backend (LLM_SPEND_CAP_USD)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentEngine, AGENT_CONFIGS, loadCalibration, type AgentConfig, type CalibrationFile } from '../eval/engines/agent';
import { OpenAiCompatBackend } from '../eval/engines/openai-compat';
import { GeminiBackend } from '../eval/engines/gemini';
import { loadPool } from '../eval/retrieval';
import type { LlmBackend } from '../eval/engines/llm';
import type { Generation, Question } from '../eval/engines/engine';
import { executeGuarded } from './exec';
import { getDb, type TenantCtx } from './db';
import { takeLlmCall } from './llm-budget';

export type LiveResult =
  | { kind: 'generated'; gen: Generation; model: string; gate: { allow: number; clarify: number }; calibrated: boolean }
  | { kind: 'capped' }
  | { kind: 'unavailable' };

const CONFIG_NAME = 'sc3-noret';

/** Which provider the environment selects, or null when the LLM is not configured. */
export function liveProvider(): 'openai' | 'gemini' | null {
  const p = process.env.LLM_PROVIDER ?? 'offline';
  if (p === 'gemini' && process.env.GOOGLE_API_KEY) return 'gemini';
  if (p === 'openai' && (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY)) return 'openai';
  return null;
}

export function liveConfig(): AgentConfig {
  const base = AGENT_CONFIGS[CONFIG_NAME];
  const drafts = Math.max(1, Number(process.env.LLM_DRAFTS ?? base.drafts) || base.drafts);
  const maxCalls = Number(process.env.LLM_MAX_CALLS ?? drafts + 1);
  return { ...base, drafts, maxCalls: Number.isFinite(maxCalls) ? Math.max(drafts, maxCalls) : drafts + 1 };
}

function makeBackend(provider: 'openai' | 'gemini'): LlmBackend {
  if (provider === 'gemini') return new GeminiBackend(process.env.LLM_MODEL ?? 'gemini-2.5-flash', null);
  const base = process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';
  return new OpenAiCompatBackend(model, base, (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY)!, {
    provider: /deepseek/i.test(base) ? 'deepseek' : 'openai-compatible',
    // reasoning_effort is a DeepSeek parameter; plain OpenAI models reject it.
    effort: process.env.LLM_REASONING_EFFORT ?? (/deepseek/i.test(base) ? 'low' : 'none'),
    cacheDir: null,
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 30_000),
    budgetUsd: Number(process.env.LLM_SPEND_CAP_USD ?? 0.25),
  });
}

/** A fitted calibrator is only valid for the model it was fitted on; otherwise the gate stays off. */
function calibrationFor(provider: 'openai' | 'gemini', model: string): CalibrationFile | null {
  const backend = provider === 'gemini' ? 'gemini' : 'deepseek';
  const path = join(process.cwd(), 'eval', 'calibration', `${backend}-${CONFIG_NAME}.json`);
  if (!existsSync(path)) return null;
  const f = loadCalibration(CONFIG_NAME, path);
  return f && f.model === model ? f : null;
}

interface Deps { backend?: LlmBackend; schemaDb?: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> } }
let deps: Deps = {};
/** Test seam: inject a backend / schema connection. */
export function setLiveDeps(d: Deps) { deps = d; engine = null; engineKey = ''; }

let engine: AgentEngine | null = null;
let engineKey = '';

export function getLiveEngine(provider: 'openai' | 'gemini'): AgentEngine {
  const cfg = liveConfig();
  const key = `${provider}|${process.env.LLM_MODEL}|${process.env.LLM_BASE_URL}|${cfg.drafts}|${cfg.maxCalls}`;
  if (engine && key === engineKey) return engine;
  const backend = deps.backend ?? makeBackend(provider);
  let pool = [] as ReturnType<typeof loadPool>;
  try { pool = loadPool(join(process.cwd(), 'eval', 'pool', 'dev.json')); } catch { /* signal degrades to 0 */ }
  const schemaDb = deps.schemaDb ?? { query: async (sql: string) => (await (await getDb()).query(sql)) as any };
  engine = new AgentEngine(backend, cfg, schemaDb, calibrationFor(provider, backend.model), pool);
  engineKey = key;
  return engine;
}

/** Generate SQL for one question with the shared agent engine. */
export async function liveGenerate(question: string, ctx: TenantCtx, requestId: string): Promise<LiveResult> {
  const provider = liveProvider();
  if (!provider) return { kind: 'unavailable' };
  // One cap unit per question, for every provider. Over budget => offline engine.
  if (!takeLlmCall()) return { kind: 'capped' };
  const eng = getLiveEngine(provider);
  const q: Question = {
    id: requestId, set: 'live', bucket: 'live', question, tenant: ctx.tenant_id, expected_decision: 'ALLOW',
    order_sensitive: false, gold_sql: null, gold_sql_path: null, gold_rows_path: null, gold_rows_hash: null,
    paraphrase_of: null, status: 'active', retired_reason: null, notes: null,
  };
  const tools = {
    async execute(sql: string, tag: string) {
      const r = await executeGuarded(sql, ctx, `${requestId}-probe-${tag}`);
      if (r.decision !== 'ALLOW') return { ok: false, error: `${r.blockStage ?? 'blocked'}: ${r.blockReason ?? 'execution blocked'}` };
      return { ok: true, rows: r.rows ?? [] };
    },
  };
  try {
    const gen = await eng.generate(q, { tables: [], views: [], hint: '' }, tools);
    return { kind: 'generated', gen, model: eng.model, gate: eng.gate, calibrated: !!eng.calibration };
  } catch {
    return { kind: 'unavailable' }; // quota/balance/network: offline engine answers
  }
}
