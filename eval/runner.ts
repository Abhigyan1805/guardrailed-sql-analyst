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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../lib/db';
import { runQuestion, type ItemResult, type PipelineDeps } from './pipeline';
import { runAttacks } from './attacks';
import {
  parseArgs, loadEnv, loadSet, setExists, gitSha,
  EVAL_NOW, EVAL_SEED, GATE, ROOT, REPORTS_DIR,
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
        ? `${REFERENCE_PRICING.label}; served model: ${meta.model} (effort ${meta.effort}); tokens are provider-reported, priced at the published sheet`
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

function formatSummary(label: string, r: RunReport): string {
  const s = r.summary;
  const cost = s.cost_per_100q.value === null
    ? 'cost=unavailable'
    : `$/100q=$${s.cost_per_100q.value.toFixed(4)}${s.cost_per_100q.source === 'estimated' ? '*estimated' : ''}`;
  return `${label}: acc=${(s.accuracy * 100).toFixed(1)}% (${s.correct}/${s.scored}) ci=[${(s.ci95.low * 100).toFixed(1)}%,${(s.ci95.high * 100).toFixed(1)}%] violations=${s.violations} p95_allow=${Math.round(s.latency.p95Allow)}ms ${cost}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.attacks && !args.matrix && !args.set) throw new Error('--set is required (or use --attacks / --matrix)');
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
    const calSource = reports.find((r) => r.meta.set === 'dev' && r.meta.engine === 'llm') ?? reports.find((r) => r.meta.set === 'dev');
    if (calSource) writeCalibrationMd(calSource);
    console.log('wrote eval/REPORT.md');
    if (args.strict) {
      const bad = reports.some((r) => r.summary.violations > 0) || attacks.violations > 0 || !attacks.dbUnchanged;
      if (bad) { console.error('STRICT matrix gates FAILED'); process.exit(1); }
      console.log('STRICT matrix gates PASSED');
    }
    return;
  }

  const repeats = args.repeats ?? (args.engine === 'templates' ? 1 : 3);
  const report = await runSetEngine(args.set!, args.engine!, repeats, deps, args.limit);
  if (args.set === 'dev') writeCalibrationMd(report);
  console.log(formatSummary(`${args.set}/${args.engine}`, report));
  if (args.strict) {
    const s = report.summary;
    if (s.violations > 0) { console.error('STRICT gates FAILED: violations > 0'); process.exit(1); }
    console.log('STRICT gates PASSED');
  }
}

if (process.argv[1] && process.argv[1].endsWith('runner.ts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
