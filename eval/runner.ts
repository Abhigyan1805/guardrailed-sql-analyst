// Eval v2 runner (spec 5-8). CLI:
//   npm run eval -- --set dev --engine templates --strict
//   npm run eval -- --set heldout --engine hybrid --repeats 3
//   npm run eval -- --set paraphrase --engine llm
//   npm run eval -- --attacks
//   npm run eval:matrix                 # every set x engine, writes REPORT.md
//
// All three engines pass through the identical pre-generation guardrail, SQL
// guardrail, confidence gate and execution pipeline (see pipeline.ts). The
// engine changes generation only.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../lib/db';
import { runQuestion, type ItemResult, type PipelineDeps } from './pipeline';
import { runAttacks, type AttackReport } from './attacks';
import {
  parseArgs, loadEnv, loadSet, setExists, gitSha,
  EVAL_NOW, EVAL_SEED, GATE, ROOT, REPORTS_DIR,
  LATENCY_GATES_MS, ACCURACY_FLOORS,
} from './loader';
import { makeEngine, engineMeta, summarizePass, writeReportMd, writeCalibrationMd, DEFAULT_HYBRID_THRESHOLD, type RunReport } from './report';
import { REFERENCE_PRICING, type CostOptions } from './metrics/cost';

async function ensureViews(): Promise<void> {
  const db = await getDb();
  try {
    await db.exec(readFileSync(join(ROOT, 'db/002_views_rls.sql'), 'utf8'));
  } catch {
    // views already present
  }
}

export async function runSetEngine(set: string, engineName: string, repeats: number, deps: PipelineDeps, limit?: number): Promise<RunReport> {
  const { questions, hash, source } = loadSet(set);
  const active = questions.filter((q) => q.status === 'active');
  const selected = limit ? active.slice(0, limit) : active;
  const engine = makeEngine(engineName);
  const meta = engineMeta(engineName);

  const allPasses: ItemResult[][] = [];
  for (let rep = 0; rep < repeats; rep++) {
    const items: ItemResult[] = [];
    for (let i = 0; i < selected.length; i++) items.push(await runQuestion(selected[i], engine, deps, i));
    allPasses.push(items);
  }

  // Amended R5: the reference sheet is a fallback for when the backend cannot
  // expose exact usage; it never overrides provider-reported cost.
  const llmInvolved = engineName !== 'templates';
  const costOptions: CostOptions = llmInvolved
    ? { referencePricing: REFERENCE_PRICING.offPeak, referenceLabel: REFERENCE_PRICING.label }
    : {};
  const summaries = allPasses.map((items) => summarizePass(items, meta.model, repeats, costOptions));
  const primary = summaries[0];
  const accValues = summaries.map((s) => s.accuracy);
  const report: RunReport = {
    meta: {
      set,
      set_source: source,
      set_hash: `sha256:${hash}`,
      engine: engineName,
      model: meta.model,
      provider: meta.provider,
      temperature: meta.temperature,
      effort: meta.effort,
      eval_now: EVAL_NOW,
      seed: EVAL_SEED,
      git_sha: gitSha(),
      timestamp: new Date().toISOString(),
      repeats,
      gate: GATE,
      hybrid_threshold: DEFAULT_HYBRID_THRESHOLD,
      usage_source: primary.cost_per_100q.source,
      usage_source_note: llmInvolved
        ? primary.cost_per_100q.source === 'provider'
          ? `exact provider-reported token counts and cost from the headless subagent; published sheet ${REFERENCE_PRICING.label} recorded for reference`
          : `provider usage unavailable; estimated from ${REFERENCE_PRICING.label}; served model: ${meta.model} (effort ${meta.effort})`
        : primary.cost_per_100q.source === 'unavailable'
          ? (primary.cost_per_100q.reason ?? 'usage unavailable')
          : 'exact provider-reported usage',
      cost_basis: llmInvolved
        ? {
            cost_per_100q_reference: REFERENCE_PRICING.label,
            price_snapshot_date: REFERENCE_PRICING.retrieved,
            source_url: REFERENCE_PRICING.source,
            peak_rate_caveat: REFERENCE_PRICING.caveat,
            model_served: meta.model,
            reasoning_effort: meta.effort,
            usage_source: primary.cost_per_100q.source,
          }
        : { note: 'deterministic templates: no model, $0 measured' },
      repeat_summaries: summaries,
    },
    summary: {
      ...primary,
      accuracy: accValues.reduce((a, b) => a + b, 0) / accValues.length,
      accuracy_min: Math.min(...accValues),
      accuracy_max: Math.max(...accValues),
      repeats_observed: repeats,
    },
    items: allPasses[0],
  };

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(join(REPORTS_DIR, `${set}-${engineName}-${gitSha()}.json`), JSON.stringify(report, null, 2));
  return report;
}

/** Newest committed report per (set, engine), ignoring the attacks file. */
function loadCommittedReports(): RunReport[] {
  const files = readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('attacks-'));
  const byKey = new Map<string, RunReport>();
  for (const f of files) {
    let r: RunReport;
    try {
      r = JSON.parse(readFileSync(join(REPORTS_DIR, f), 'utf8')) as RunReport;
    } catch {
      continue;
    }
    const set = String(r.meta?.set ?? '');
    const engine = String(r.meta?.engine ?? '');
    if (!set || !engine) continue;
    const key = `${set}/${engine}`;
    const prev = byKey.get(key);
    if (!prev || String(r.meta.timestamp) > String(prev.meta.timestamp)) byKey.set(key, r);
  }
  return [...byKey.values()];
}

/** Newest committed attacks report, with its own meta stripped. */
function loadLatestAttacks(): AttackReport | null {
  const files = readdirSync(REPORTS_DIR).filter((f) => f.startsWith('attacks-') && f.endsWith('.json'));
  let best: { meta?: { timestamp?: string } } & Record<string, unknown> = null as never;
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(REPORTS_DIR, f), 'utf8'));
    if (!best || String(j.meta?.timestamp) > String(best.meta?.timestamp)) best = j;
  }
  if (!best) return null;
  const { meta: _meta, ...rest } = best;
  return rest as unknown as AttackReport;
}

/** Per-engine strict gates (spec 8). Returns human-readable failures. */
function strictFailures(r: RunReport): string[] {
  const out: string[] = [];
  const engine = String(r.meta.engine);
  const set = String(r.meta.set);
  if (r.summary.violations > 0) out.push(`violations=${r.summary.violations}`);
  const gate = LATENCY_GATES_MS[engine];
  if (gate !== undefined && r.summary.latency.p95Allow > gate) {
    out.push(`p95 ALLOW ${Math.round(r.summary.latency.p95Allow)}ms > ${gate}ms (${engine})`);
  }
  const floor = ACCURACY_FLOORS[`${set}/${engine}`];
  if (floor !== undefined && r.summary.accuracy < floor) {
    out.push(`accuracy ${(r.summary.accuracy * 100).toFixed(1)}% < floor ${(floor * 100).toFixed(1)}% (${set}/${engine})`);
  }
  return out;
}

function formatSummary(label: string, r: RunReport): string {
  const s = r.summary;
  const cost = s.cost_per_100q.value === null
    ? 'cost=unavailable'
    : `$/100q=$${s.cost_per_100q.value.toFixed(4)}${s.cost_per_100q.source === 'estimated' ? '*estimated' : ''}`;
  return `${label}: acc=${(s.accuracy * 100).toFixed(1)}% (${s.correct}/${s.scored}) ci=[${(s.ci95.low * 100).toFixed(1)}%,${(s.ci95.high * 100).toFixed(1)}%] violations=${s.violations} p95_allow=${Math.round(s.latency.p95Allow)}ms ${cost}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Regenerate the markdown from already-committed reports (no engine calls).
  if (args.report) {
    const reports = loadCommittedReports();
    if (!reports.length) throw new Error('no committed reports found in eval/reports');
    writeReportMd(reports, loadLatestAttacks());
    writeCalibrationMd(reports);
    console.log(`wrote eval/REPORT.md and eval/CALIBRATION.md from ${reports.length} committed reports`);
    return;
  }

  if (!args.attacks && !args.matrix && !args.set) throw new Error('--set is required (or use --attacks / --matrix / --report)');
  if (!args.attacks && !args.matrix && !args.engine) throw new Error('--engine is required (or use --matrix)');

  loadEnv();
  await ensureViews();
  const deps: PipelineDeps = { db: await getDb(), schemaCache: new Map() };

  if (args.attacks) {
    const attacks = await runAttacks(deps.db);
    if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
    const sha = gitSha();
    writeFileSync(join(REPORTS_DIR, `attacks-${sha}.json`), JSON.stringify({
      meta: { git_sha: sha, eval_now: EVAL_NOW, seed: EVAL_SEED, timestamp: new Date().toISOString() },
      ...attacks,
    }, null, 2));
    const blocked = attacks.items.filter((i) => i.verdict === 'pass').length;
    console.log(`attacks blocked=${blocked}/${attacks.items.length} violations=${attacks.violations} db_unchanged=${attacks.dbUnchanged}`);
    if (args.strict && (attacks.violations > 0 || !attacks.dbUnchanged)) {
      console.error('STRICT attacks gates FAILED');
      process.exit(1);
    }
    if (args.strict) console.log('STRICT attacks gates PASSED');
    return;
  }

  if (args.matrix) {
    const sets = ['dev', 'heldout', 'paraphrase'].filter(setExists);
    const engines = ['templates', 'llm', 'hybrid'];
    const reports: RunReport[] = [];
    for (const set of sets) {
      for (const engine of engines) {
        const repeats = args.repeats ?? (engine === 'templates' ? 1 : 3);
        const r = await runSetEngine(set, engine, repeats, deps, args.limit);
        reports.push(r);
        console.log(formatSummary(`${set}/${engine}`, r));
      }
    }
    const attacks = await runAttacks(deps.db);
    if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
    writeFileSync(join(REPORTS_DIR, `attacks-${gitSha()}.json`), JSON.stringify({
      meta: { git_sha: gitSha(), eval_now: EVAL_NOW, seed: EVAL_SEED, timestamp: new Date().toISOString() },
      ...attacks,
    }, null, 2));
    writeReportMd(reports, attacks);
    writeCalibrationMd(reports);
    console.log('wrote eval/REPORT.md');
    if (args.strict) {
      const failures = reports.flatMap((r) => strictFailures(r).map((m) => `${r.meta.set}/${r.meta.engine}: ${m}`));
      if (attacks.violations > 0) failures.push(`attacks: ${attacks.violations} executed violations`);
      if (!attacks.dbUnchanged) failures.push('attacks: DB fingerprint changed');
      if (failures.length) {
        for (const m of failures) console.error(`STRICT FAIL ${m}`);
        console.error('STRICT matrix gates FAILED');
        process.exit(1);
      }
      console.log('STRICT matrix gates PASSED');
    }
    return;
  }

  const repeats = args.repeats ?? (args.engine === 'templates' ? 1 : 3);
  const report = await runSetEngine(args.set!, args.engine!, repeats, deps, args.limit);
  if (args.set === 'dev') writeCalibrationMd([report]);
  console.log(formatSummary(`${args.set}/${args.engine}`, report));
  if (args.strict) {
    const failures = strictFailures(report);
    if (failures.length) {
      for (const m of failures) console.error(`STRICT FAIL ${m}`);
      console.error('STRICT gates FAILED');
      process.exit(1);
    }
    console.log('STRICT gates PASSED');
  }
}

if (process.argv[1] && process.argv[1].endsWith('runner.ts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
