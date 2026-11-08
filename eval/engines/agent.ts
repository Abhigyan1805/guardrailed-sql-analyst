// Agent engine: the LLM path with the standard text-to-SQL improvements, each
// switchable so the dev ablation can measure what it buys.
//
//   richSchema   static prefix with every view, value hints, business
//                definitions and output conventions (agent-prompt.ts)
//   retrievalK   few-shot hints = the K most similar SOLVED DEV questions
//                (leave-one-out: a question never sees its own solution)
//   repair       execution-guided repair: run the draft through the SAME
//                guarded executor as the pipeline (validateSql -> EXPLAIN cost
//                gate -> read-only RLS transaction -> audit); on a rejection,
//                error, or degenerate result, ask the model to fix it once
//   drafts       self-consistency: N drafts (draft 0 at temperature 0, the rest
//                sampled), majority vote by executed result set
//
// Confidence is never the model's self-report: the engine records observable
// signals and a dev-fitted calibrator maps them to P(correct).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSql } from '../../lib/sql-guard';
import { EXEMPLARS } from '../../lib/prompts/exemplars';
import { canonicalRow } from '../metrics/accuracy';
import { predict, sqlComplexity, type Calibrator, type Signals } from '../metrics/calibrator';
import { Retriever, loadPool, type Retrieved } from '../retrieval';
import { EVAL_NOW, ROOT } from '../loader';
import type { Queryable } from '../schema-context';
import { buildPrompt as buildBasePrompt, parseModelJson, type BackendResult, type LlmBackend } from './llm';
import { buildAgentPrompt, buildRepairPrompt, buildStaticSchema, PROMPT_VERSION } from './agent-prompt';
import type { Engine, EngineTools, Generation, ProbeResult, Question, SchemaContext } from './engine';

export interface AgentConfig {
  name: string;
  richSchema: boolean;
  retrievalK: number;
  /** Only examples at least this similar are shown (low-similarity examples were copied wrongly on dev). */
  retrievalMin: number;
  repair: boolean;
  drafts: number;
}

/** Ablation ladder: each step adds one change on top of the previous one. */
export const AGENT_CONFIGS: Record<string, AgentConfig> = {
  schema: { name: 'schema', richSchema: true, retrievalK: 0, retrievalMin: 0, repair: false, drafts: 1 },
  retrieval: { name: 'retrieval', richSchema: true, retrievalK: 2, retrievalMin: 0.5, repair: false, drafts: 1 },
  repair: { name: 'repair', richSchema: true, retrievalK: 2, retrievalMin: 0.5, repair: true, drafts: 1 },
  sc3: { name: 'sc3', richSchema: true, retrievalK: 2, retrievalMin: 0.5, repair: true, drafts: 3 },
  // Same steps without retrieval, for when retrieval does not pay on dev.
  'repair-noret': { name: 'repair-noret', richSchema: true, retrievalK: 0, retrievalMin: 0, repair: true, drafts: 1 },
  'sc3-noret': { name: 'sc3-noret', richSchema: true, retrievalK: 0, retrievalMin: 0, repair: true, drafts: 3 },
};

export const SAMPLE_TEMPERATURE = 0.7;
/** One fitted calibrator per (backend, config), e.g. eval/calibration/deepseek-sc3.json. */
export function calibrationPath(config: string, backend = process.env.EVAL_LLM_BACKEND ?? 'opencode'): string {
  return join(ROOT, 'eval', 'calibration', `${backend}-${config}.json`);
}

export interface CalibrationFile {
  config: string;
  backend: string;
  model: string;
  calibrator: Calibrator;
  gate: { allow: number; clarify: number };
}

export function loadCalibration(config: string, path = calibrationPath(config)): CalibrationFile | null {
  if (!existsSync(path)) return null;
  const f = JSON.parse(readFileSync(path, 'utf8')) as CalibrationFile;
  return f.config === config ? f : null;
}

/** Map the dev exemplar ids used by the fixed few-shot block to dev question ids. */
const EXEMPLAR_DEV_IDS: Record<string, string> = { E6: 'dev-006', M5: 'dev-015', M7: 'dev-017', H6: 'dev-031', H4: 'dev-029' };

export interface Candidate {
  index: number;
  sql: string | null;
  reason: string;
  ok: boolean;
  error?: string;
  rows?: Record<string, unknown>[];
  repaired: boolean;
  /** Critical-path latency of this draft chain (calls + local work). */
  chainMs: number;
}

/** Result-set key used for voting: column count + ordered canonical rows. */
export function resultKey(rows: Record<string, unknown>[]): string {
  const arity = rows[0] ? Object.keys(rows[0]).length : 0;
  return `${arity}|${JSON.stringify(rows.map(canonicalRow))}`;
}

export function degenerate(rows: Record<string, unknown>[]): string | null {
  if (!rows.length) return 'the query returned 0 rows';
  const cols = Object.keys(rows[0]);
  const nullCols = cols.filter((c) => rows.every((r) => r[c] === null || r[c] === undefined));
  if (nullCols.length) return `column(s) ${nullCols.join(', ')} are NULL in every row`;
  return null;
}

/** Majority vote over executed candidates; ties go to the lowest draft index. */
export function vote(cands: Candidate[]): { winner: Candidate | null; agreement: number } {
  const groups = new Map<string, Candidate[]>();
  for (const c of cands) {
    if (!c.ok || !c.rows) continue;
    const k = resultKey(c.rows);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  let best: Candidate[] | null = null;
  for (const g of groups.values()) {
    if (!best || g.length > best.length || (g.length === best.length && g[0].index < best[0].index)) best = g;
  }
  if (!best) return { winner: null, agreement: 0 };
  return { winner: best[0], agreement: best.length / cands.length };
}

export class AgentEngine implements Engine {
  readonly name = 'agent' as const;
  private staticPrefix: Promise<string> | null = null;
  private readonly retriever: Retriever;
  readonly calibration: CalibrationFile | null;

  constructor(
    private readonly backend: LlmBackend,
    readonly config: AgentConfig,
    private readonly schemaDb: Queryable | null = null,
    calibration?: CalibrationFile | null,
  ) {
    this.retriever = new Retriever(loadPool());
    this.calibration = calibration === undefined ? loadCalibration(config.name) : calibration;
  }

  get provider(): string { return this.backend.provider; }
  get model(): string { return this.backend.model; }
  get temperature(): number { return this.backend.temperature; }
  get promptVersion(): string { return PROMPT_VERSION; }

  /** Gate thresholds re-derived on dev for this config; gate off until calibrated. */
  get gate(): { allow: number; clarify: number } {
    // EVAL_AGENT_GATE=off replays a run with calibrated confidences but every
    // answer executed, to measure ECE and the gate trade-off over all answers.
    if (process.env.EVAL_AGENT_GATE === 'off') return { allow: 0, clarify: 0 };
    return this.calibration?.gate ?? { allow: 0, clarify: 0 };
  }

  private examples(q: Question): Retrieved[] {
    // Fixed dev exemplars (as in the base engine), minus the question's own.
    const fixed: Retrieved[] = EXEMPLARS.filter((e) => e.sql !== null && EXEMPLAR_DEV_IDS[e.id] !== q.id)
      .map((e) => ({ id: EXEMPLAR_DEV_IDS[e.id] ?? e.id, question: e.question, sql: e.sql!, similarity: 0 }));
    if (this.config.retrievalK <= 0) return fixed;
    // Retrieval adds the closest solved dev questions (above the floor) after the fixed ones.
    const near = this.retriever.retrieve(q.question, this.config.retrievalK, q.id).filter((e) => e.similarity >= this.config.retrievalMin);
    return [...fixed.filter((f) => !near.some((n) => n.id === f.id)), ...near];
  }

  private async prompt(q: Question, ctx: SchemaContext, examples: Retrieved[]): Promise<string> {
    if (!this.config.richSchema) return buildBasePrompt(q, ctx);
    if (!this.schemaDb) throw new Error('agent engine needs a schema connection for the rich schema prefix');
    this.staticPrefix ??= buildStaticSchema(this.schemaDb, EVAL_NOW);
    return buildAgentPrompt(await this.staticPrefix, examples, q.question);
  }

  async generate(q: Question, ctx: SchemaContext, tools?: EngineTools): Promise<Generation> {
    const wall0 = Date.now();
    const examples = this.examples(q);
    const base = await this.prompt(q, ctx, examples);
    const prepMs = Date.now() - wall0;
    const usage = { tokensIn: 0, tokensOut: 0, cachedTokens: 0, calls: 0, cacheHits: 0, costUsd: 0 as number | null };

    const call = async (prompt: string, sample: number, temperature: number): Promise<{ res: BackendResult; wallMs: number }> => {
      const t = Date.now();
      const res = await this.backend.generate(prompt, { sample, temperature });
      usage.tokensIn += res.tokensIn;
      usage.tokensOut += res.tokensOut;
      usage.cachedTokens += res.cachedTokens ?? 0;
      usage.calls++;
      if (res.cached) usage.cacheHits++;
      usage.costUsd = res.costUsd === null || usage.costUsd === null ? null : usage.costUsd + res.costUsd;
      return { res, wallMs: Date.now() - t };
    };

    const probe = async (sql: string, tag: string): Promise<ProbeResult> => {
      const v = validateSql(sql);
      if (!v.ok) return { ok: false, error: `${v.stage}: ${v.reason}` };
      if (!tools) return { ok: true, rows: undefined };
      return tools.execute(v.rewritten ?? sql, tag);
    };

    const runDraft = async (index: number): Promise<Candidate> => {
      const t0 = Date.now();
      let callWall = 0;
      let callReported = 0;
      const temp = index === 0 ? 0 : SAMPLE_TEMPERATURE;
      const first = await call(base, index, temp);
      callWall += first.wallMs;
      callReported += first.res.latencyMs ?? first.wallMs;
      const finish = (c: Omit<Candidate, 'chainMs' | 'index'>): Candidate => ({
        ...c, index, chainMs: Date.now() - t0 - callWall + callReported,
      });

      let parsed;
      try {
        parsed = parseModelJson(first.res.text);
      } catch (e: any) {
        parsed = { sql: null, reason: `unparseable model output: ${String(e?.message ?? e)}`, columns: [], confidence: 0 };
        if (!this.config.repair) return finish({ sql: null, reason: parsed.reason, ok: false, error: parsed.reason, repaired: false });
      }
      if (parsed.sql === null && !/unparseable/.test(parsed.reason)) {
        return finish({ sql: null, reason: parsed.reason || 'model abstained', ok: false, repaired: false });
      }
      let sql = parsed.sql;
      let result: ProbeResult = sql ? await probe(sql, `d${index}`) : { ok: false, error: parsed.reason };
      const problem = !result.ok ? result.error : result.rows ? degenerate(result.rows) : null;
      if (!this.config.repair || !problem) {
        return finish({ sql, reason: '', ok: result.ok, error: result.ok ? undefined : result.error, rows: result.rows, repaired: false });
      }

      // One execution-guided repair. Its SQL goes through the same probe (guard + executor).
      const repairPrompt = buildRepairPrompt(base, result.ok ? { sql: sql!, observation: problem } : { sql: sql ?? '(none)', error: problem });
      const second = await call(repairPrompt, index, 0);
      callWall += second.wallMs;
      callReported += second.res.latencyMs ?? second.wallMs;
      let fixed;
      try {
        fixed = parseModelJson(second.res.text);
      } catch {
        fixed = null;
      }
      if (!fixed?.sql) {
        if (result.ok) return finish({ sql, reason: '', ok: true, rows: result.rows, repaired: false });
        return finish({ sql: null, reason: fixed?.reason || 'model abstained after repair', ok: false, error: result.error, repaired: true });
      }
      const r2 = await probe(fixed.sql, `d${index}r`);
      // Keep the repair when it runs and is not itself degenerate, or when the original failed outright.
      if (r2.ok && (!result.ok || !r2.rows || !degenerate(r2.rows))) {
        sql = fixed.sql;
        result = r2;
        return finish({ sql, reason: '', ok: true, rows: r2.rows, repaired: true });
      }
      if (result.ok) return finish({ sql, reason: '', ok: true, rows: result.rows, repaired: false });
      return finish({ sql: fixed.sql, reason: '', ok: false, error: r2.ok ? undefined : r2.error, repaired: true });
    };

    let cands: Candidate[];
    try {
      cands = await Promise.all(Array.from({ length: this.config.drafts }, (_, i) => runDraft(i)));
    } catch (e: any) {
      if (e?.name === 'QuotaExhausted') throw e;
      return this.result(wall0, prepMs, 0, usage, null, 0, `backend error: ${String(e?.message ?? e).slice(0, 200)}`, null);
    }
    const chainMs = Math.max(...cands.map((c) => c.chainMs));
    const abstained = cands.filter((c) => c.sql === null && !c.error).length;
    const { winner, agreement } = vote(cands);
    // Similarity is a signal even when no example clears the display floor.
    const topSimilarity = this.retriever.retrieve(q.question, 1, q.id)[0]?.similarity ?? 0;

    if (!winner) {
      // Nothing executed. Abstain when most drafts abstained; otherwise hand the
      // first draft's SQL to the pipeline, whose guard will reject it again.
      const first = cands[0];
      const signals: Signals = {
        abstained: abstained * 2 > cands.length || first.sql === null, drafts: cands.length, agreement: 0,
        clean: false, repaired: first.repaired, executed: false, empty: false, nullColumn: false, topSimilarity, complexity: 0,
      };
      const sql = signals.abstained ? null : first.sql;
      return this.result(wall0, prepMs, chainMs, usage, sql, this.confidence(signals), sql ? undefined : (first.reason || first.error || 'model abstained'), signals);
    }

    const rows = winner.rows ?? [];
    const signals: Signals = {
      abstained: false,
      drafts: cands.length,
      agreement,
      clean: !winner.repaired,
      repaired: winner.repaired,
      executed: true,
      empty: rows.length === 0,
      nullColumn: !!rows.length && !!degenerate(rows),
      topSimilarity,
      complexity: sqlComplexity(winner.sql ?? ''),
    };
    return this.result(wall0, prepMs, chainMs, usage, winner.sql, this.confidence(signals), undefined, signals);
  }

  private confidence(s: Signals): number {
    if (this.calibration) return predict(this.calibration.calibrator, s);
    // Uncalibrated (dev collection run): a transparent placeholder; the gate is off.
    if (s.abstained || !s.executed) return 0.1;
    return 0.4 + 0.3 * s.agreement + 0.2 * (s.clean ? 1 : 0) + 0.1 * (s.empty || s.nullColumn ? 0 : 1);
  }

  private result(
    wall0: number, prepMs: number, chainMs: number,
    usage: { tokensIn: number; tokensOut: number; cachedTokens: number; calls: number; cacheHits: number; costUsd: number | null },
    sql: string | null, confidence: number, error: string | undefined, signals: Signals | null,
  ): Generation {
    return {
      sql,
      confidence,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      retries: Math.max(0, usage.calls - this.config.drafts),
      latencyMs: prepMs + chainMs,
      wallMs: Date.now() - wall0,
      usageSource: 'provider',
      costUsd: usage.calls ? usage.costUsd : 0,
      error,
      signals: signals ?? undefined,
      llmCalls: usage.calls,
      cacheHits: usage.cacheHits,
      cachedTokens: usage.cachedTokens,
    };
  }
}
