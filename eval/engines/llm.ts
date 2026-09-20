// LLM engine (spec 4/5.1). Model path only: templates are never consulted.
//
// Backend is a small swappable client interface. The default backend runs each
// generation in a *fresh* headless subagent process (`opencode run`) pinned to
// a dated model id at temperature 0, discovered from the installed tooling.
// Each call is a new process, so there is no cross-question session state.
import { spawn } from 'node:child_process';
import { validateSql } from '../../lib/sql-guard';
import { EXEMPLARS, type Exemplar } from '../../lib/prompts/exemplars';
import type { Engine, Generation, Question, SchemaContext } from './engine';

export const MAX_RETRIES = 2;

// Pinned default. Override with EVAL_LLM_MODEL; the report records the exact
// value, provider and reasoning effort.
export const DEFAULT_MODEL = process.env.EVAL_LLM_MODEL ?? 'opencode-go/deepseek-v4.1-flash';
export const DEFAULT_TEMPERATURE = 0;
export const DEFAULT_VARIANT = process.env.EVAL_LLM_VARIANT ?? 'low';

export interface BackendResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  usageSource: 'provider' | 'estimated';
}

export interface LlmBackend {
  readonly provider: string;
  readonly model: string;
  readonly temperature: number;
  generate(prompt: string): Promise<BackendResult>;
}

export interface ParsedModelOutput {
  sql: string | null;
  columns: { name: string; type: string; description: string }[];
  confidence: number;
  reason: string;
}

/** Extract the first JSON object from model text, tolerating code fences/prose. */
export function parseModelJson(text: string): ParsedModelOutput {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  let candidate = cleaned;
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) candidate = cleaned.slice(first, last + 1);
  let raw: any;
  try {
    raw = JSON.parse(candidate);
  } catch (e: any) {
    throw new Error(`model output was not valid JSON: ${String(e?.message ?? e).slice(0, 160)}`);
  }
  const sql = typeof raw.sql === 'string' && raw.sql.trim() ? raw.sql : null;
  const confidence = typeof raw.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : sql ? 0.5 : 0.3;
  return {
    sql,
    columns: Array.isArray(raw.columns)
      ? raw.columns.map((x: any) => ({ name: String(x?.name ?? ''), type: String(x?.type ?? ''), description: String(x?.description ?? '') }))
      : [],
    confidence,
    reason: typeof raw.reason === 'string' ? raw.reason : '',
  };
}

export interface OpencodeUsage {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  usageSource: 'provider' | 'estimated';
  error: string | null;
}

/**
 * Parse the JSONL emitted by `opencode run --format json`. Text parts are
 * concatenated in order; token usage is summed across step_finish events so
 * multi-step runs are still accounted for. Exported for unit testing.
 */
export function parseOpencodeOutput(stdout: string): OpencodeUsage {
  const texts: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let sawUsage = false;
  let sawCost = false;
  let error: string | null = null;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let ev: any;
    try {
      ev = JSON.parse(t);
    } catch {
      continue;
    }
    if (ev.type === 'text' && typeof ev.part?.text === 'string') texts.push(ev.part.text);
    else if (ev.type === 'step_finish' && ev.part?.tokens) {
      sawUsage = true;
      tokensIn += Number(ev.part.tokens.input ?? 0);
      tokensOut += Number(ev.part.tokens.output ?? 0);
      if (typeof ev.part.cost === 'number') {
        costUsd += ev.part.cost;
        sawCost = true;
      }
    } else if (ev.type === 'error') {
      error = String(ev.error?.data?.message ?? ev.error?.name ?? 'unknown backend error');
    }
  }
  return {
    text: texts.join('').trim(),
    tokensIn,
    tokensOut,
    costUsd: sawCost ? costUsd : null,
    usageSource: sawUsage ? 'provider' : 'estimated',
    error,
  };
}

export interface SubagentBackendOptions {
  model?: string;
  command?: string;
  agent?: string;
  timeoutMs?: number;
  cwd?: string;
  variant?: string;
}

/**
 * Fresh headless subagent per generation. Invocation discovered from the
 * installed tooling:
 *   opencode run --pure --agent <agent> --model <provider/model> --format json <prompt>
 * `--pure` keeps the host's plugins out of the nested process; the pinned
 * `eval-gen` agent sets temperature 0 and denies every tool.
 */
export class SubagentBackend implements LlmBackend {
  readonly provider: string;
  readonly model: string;
  readonly temperature = DEFAULT_TEMPERATURE;
  /** Provider-specific reasoning effort (`--variant`). */
  readonly effort: string;
  private readonly command: string;
  private readonly agent: string;
  private readonly timeoutMs: number;
  private readonly cwd: string;

  constructor(opts: SubagentBackendOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.provider = this.model.includes('/') ? this.model.split('/')[0] : 'opencode';
    this.command = opts.command ?? process.env.EVAL_LLM_COMMAND ?? 'opencode';
    this.agent = opts.agent ?? process.env.EVAL_LLM_AGENT ?? 'eval-gen';
    this.effort = opts.variant ?? DEFAULT_VARIANT;
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.EVAL_LLM_TIMEOUT_MS ?? 120_000);
    this.cwd = opts.cwd ?? process.cwd();
  }

  /**
   * Child env that pins the generation agent inline (temperature 0, no tools)
   * and disables MCP hosts, whose startup would otherwise dominate per-call
   * latency. Defining the agent here keeps the harness self-contained: no
   * project config file is required. Opt out with EVAL_LLM_DISABLE_MCP=0.
   */
  private childEnv(): NodeJS.ProcessEnv {
    const config: Record<string, unknown> = {
      permission: { '*': 'allow' },
      agent: {
        // NOTE: do not restrict this agent's permissions. OpenCode Zen's free
        // tier rejects (403 FreeTierError) any request whose agent denies tools,
        // so the harness leaves tools enabled and relies on the prompt to
        // return a single JSON object.
        [this.agent]: {
          description: 'Single-shot SQL generation for the eval LLM harness; returns JSON only.',
          mode: 'primary',
          temperature: DEFAULT_TEMPERATURE,
        },
      },
    };
    if (process.env.EVAL_LLM_DISABLE_MCP !== '0') {
      config.mcp = { 'colab-mcp': { enabled: false }, 'kaggle-exec': { enabled: false } };
    }
    return { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };
  }

  generate(prompt: string): Promise<BackendResult> {
    return new Promise<BackendResult>((resolve, reject) => {
      const args = ['run', '--pure', '--agent', this.agent, '--model', this.model];
      if (this.effort) args.push('--variant', this.effort);
      args.push('--format', 'json', prompt);
      const child = spawn(this.command, args, { cwd: this.cwd, env: this.childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`subagent timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      child.stdout.on('data', (d) => { stdout += String(d); });
      child.stderr.on('data', (d) => { stderr += String(d); });
      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const parsed = parseOpencodeOutput(stdout);
        if (parsed.error) return reject(new Error(`subagent error: ${parsed.error}`));
        if (!parsed.text) return reject(new Error(`subagent produced no output (exit ${code}): ${stderr.slice(0, 300)}`));
        resolve({ text: parsed.text, tokensIn: parsed.tokensIn, tokensOut: parsed.tokensOut, costUsd: parsed.costUsd, usageSource: parsed.usageSource });
      });
    });
  }
}

function formatExemplar(ex: Exemplar): string {
  const answer = ex.sql === null
    ? `{"sql": null, "columns": [], "confidence": ${ex.confidence}, "reason": ${JSON.stringify(ex.reason ?? 'refused')}}`
    : JSON.stringify({ sql: ex.sql, columns: ex.columns, confidence: ex.confidence, reason: '' });
  return `Q: ${ex.question}\nA: ${answer}`;
}

export function buildPrompt(q: Question, ctx: SchemaContext, exemplars: Exemplar[] = EXEMPLARS): string {
  const viewBlocks = ctx.views.map((v) => {
    const cols = v.columns.map((col) => `    - ${col.name} ${col.type}: ${col.description}`).join('\n');
    const enums = Object.entries(v.enums)
      .map(([col, vals]) => `    - ${col}: ${vals.map((x) => JSON.stringify(x)).join(', ')}`)
      .join('\n');
    const samples = v.sampleRows.map((r) => `    ${JSON.stringify(r)}`).join('\n');
    return `VIEW ${v.name}: ${v.description}\n  columns:\n${cols}${enums ? `\n  enumerated values:\n${enums}` : ''}\n  sample rows (PII-free):\n${samples}`;
  }).join('\n\n');

  return `You are a deterministic Postgres SQL generator for an analytics assistant.
Generate ONE read-only SQL query that answers the question, or refuse.

SCHEMA (use ONLY these views; never base tables, pg_*, or information_schema):
${viewBlocks}

OUTPUT CONTRACT (strict). Return a single JSON object and nothing else:
{"sql": <string single SELECT, or null to refuse>, "columns": [{"name": <string>, "type": <string>, "description": <one-line meaning>}], "confidence": <0..1>, "reason": <string, required when sql is null>}
The "columns" array MUST list the selected columns in the exact left-to-right order the SQL returns them. Column names are presentation only; row values are scored positionally, so the order matters.

RULES
- Read-only single SELECT. No DDL/DML, no stacked statements, no comments.
- Revenue = SUM(line_revenue) over analytics_order_lines; for revenue questions filter status IN ('paid','shipped') unless asked otherwise.
- Time windows: filter ordered_at with explicit literal bounds (e.g. ordered_at >= '2025-01-01' AND ordered_at < '2026-01-01'). Never use now()/CURRENT_DATE.
- Always add a deterministic tie-breaker to ORDER BY (e.g. ORDER BY revenue DESC, product_id ASC).
- Give every output column a stable alias. Select exactly the key/id columns plus the columns the question asks for; do not add extra descriptive columns.
- PII (emails, phones, names beyond masked display_name) and finance-only cost are never available: refuse instead of guessing.
- If the question is vague (no metric, window or grouping), return "sql": null with confidence below 0.4 and a reason.

EXAMPLES
${exemplars.map(formatExemplar).join('\n\n')}

QUESTION: ${q.question}

JSON:`;
}

export function buildRetryPrompt(basePrompt: string, previousSql: string, error: string): string {
  return `${basePrompt}\n\nYOUR PREVIOUS ANSWER WAS REJECTED BY THE GUARDRAIL.\nPrevious SQL: ${previousSql}\nExact error: ${error}\nCorrect the SQL and return the same JSON contract. If it cannot be made valid, return "sql": null with a reason.`;
}

export interface LlmEngineOptions {
  maxRetries?: number;
}

export class LlmEngine implements Engine {
  readonly name = 'llm' as const;

  constructor(
    private readonly backend: LlmBackend,
    private readonly opts: LlmEngineOptions = {},
  ) {}

  get provider(): string { return this.backend.provider; }
  get model(): string { return this.backend.model; }
  get temperature(): number { return this.backend.temperature; }

  async generate(q: Question, ctx: SchemaContext): Promise<Generation> {
    const t0 = Date.now();
    const base = buildPrompt(q, ctx);
    const maxRetries = this.opts.maxRetries ?? MAX_RETRIES;
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd: number | null = 0;
    let usageSource: 'provider' | 'estimated' = 'provider';
    let hasCost = true;
    let lastError = '';
    let prompt = base;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let res: BackendResult;
      try {
        res = await this.backend.generate(prompt);
      } catch (e: any) {
        return this.fail(t0, String(e?.message ?? e), attempt, tokensIn, tokensOut, costUsd, usageSource);
      }
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      usageSource = res.usageSource === 'estimated' ? 'estimated' : usageSource;
      if (res.costUsd === null) hasCost = false;
      else costUsd = (costUsd ?? 0) + res.costUsd;

      let parsed: ParsedModelOutput;
      try {
        parsed = parseModelJson(res.text);
      } catch (e: any) {
        lastError = String(e?.message ?? e);
        prompt = buildRetryPrompt(base, '', lastError);
        continue;
      }
      if (parsed.sql === null) {
        return {
          sql: null, confidence: parsed.confidence, tokensIn, tokensOut,
          retries: attempt, latencyMs: Date.now() - t0,
          usageSource, costUsd: hasCost ? costUsd : null, error: parsed.reason || 'model abstained',
        };
      }
      const v = validateSql(parsed.sql);
      if (v.ok) {
        return {
          sql: v.rewritten ?? parsed.sql, confidence: parsed.confidence, tokensIn, tokensOut,
          retries: attempt, latencyMs: Date.now() - t0,
          usageSource, costUsd: hasCost ? costUsd : null,
        };
      }
      lastError = `${v.stage}: ${v.reason}`;
      prompt = buildRetryPrompt(base, parsed.sql, lastError);
    }
    return this.fail(t0, lastError, maxRetries, tokensIn, tokensOut, costUsd, usageSource, hasCost);
  }

  private fail(
    t0: number, error: string, retries: number,
    tokensIn: number, tokensOut: number, costUsd: number | null,
    usageSource: 'provider' | 'estimated', hasCost = true,
  ): Generation {
    return {
      sql: null, confidence: 0, tokensIn, tokensOut, retries,
      latencyMs: Date.now() - t0, usageSource, costUsd: hasCost ? costUsd : null, error,
    };
  }
}
