// Metric aggregation, engine construction and markdown report writers.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { accuracy, decisionMatrix, falseClarifyRate, missedClarifyRate } from './metrics/accuracy';
import { wilson } from './metrics/wilson';
import { latencyByDecision } from './metrics/latency';
import { costPer100q, type CostOptions, type UsageRecord } from './metrics/cost';
import { reliability, ece, mce, thresholdSweep, defaultThresholds, type CalibrationPoint } from './metrics/calibration';
import { TemplatesEngine } from './engines/templates';
import { HybridEngine, DEFAULT_HYBRID_THRESHOLD } from './engines/hybrid';
import { LlmEngine, SubagentBackend, DEFAULT_MODEL } from './engines/llm';
import type { Engine } from './engines/engine';
import type { ItemResult } from './pipeline';
import type { AttackReport } from './attacks';
import { EVAL_NOW, EVAL_SEED, GATE, ROOT } from './loader';

export function summarizePass(items: ItemResult[], model: string, repeats: number, costOptions: CostOptions = {}) {
  const acc = accuracy(items);
  const ci = wilson(acc.correct, acc.scored);
  const fc = falseClarifyRate(items);
  const mc = missedClarifyRate(items);
  const lat = latencyByDecision(items.map((i) => ({ decision: i.decision, latencyMs: i.latencyMs })));
  const usages: UsageRecord[] = items.map((i) => ({ tokensIn: i.tokensIn, tokensOut: i.tokensOut, costUsd: i.costUsd, usageSource: i.usageSource }));
  const cost = costPer100q(usages, acc.scored, model, costOptions);
  const calPoints: CalibrationPoint[] = items.map((i) => ({ id: i.id, confidence: i.confidence, correct: i.row_correct, expected: i.expected_decision }));
  const bins = reliability(calPoints);
  const excluded = items.filter((i) => i.correct === null && i.expected_decision === 'ALLOW');
  const tenantItems = items.filter((i) => i.isolation);
  return {
    repeats,
    evaluated: items.length,
    tenant_pair: {
      runs: tenantItems.length,
      differs: tenantItems.filter((i) => i.isolation?.differs).length,
      matches_gold: tenantItems.filter((i) => i.isolation?.matches_gold === true).length,
      disjoint: tenantItems.filter((i) => i.isolation?.disjoint).length,
    },
    scored: acc.scored,
    correct: acc.correct,
    accuracy: acc.accuracy,
    ci95: { low: ci.low, high: ci.high },
    decision_matrix: decisionMatrix(items),
    false_clarify_rate: fc,
    missed_clarify_rate: mc,
    violations: items.filter((i) => i.violation).length,
    latency: lat,
    cost_per_100q: cost,
    excluded_golds: { count: excluded.length, ids: excluded.map((i) => i.id) },
    calibration: { bins, ece: ece(bins), mce: mce(bins) },
  };
}

export type Summary = ReturnType<typeof summarizePass>;

export interface RunReport {
  meta: Record<string, unknown>;
  summary: Summary & { accuracy_min?: number; accuracy_max?: number; repeats_observed?: number };
  items: ItemResult[];
}

export function makeEngine(name: string): Engine {
  const templates = new TemplatesEngine();
  if (name === 'templates') return templates;
  const llm = new LlmEngine(new SubagentBackend({ model: DEFAULT_MODEL }));
  if (name === 'llm') return llm;
  if (name === 'hybrid') return new HybridEngine(templates, llm);
  throw new Error(`unknown engine: ${name}`);
}

export function engineMeta(name: string): { model: string; provider: string; temperature: number; effort: string } {
  if (name === 'templates') return { model: 'deterministic-templates', provider: 'none', temperature: 0, effort: 'none' };
  const backend = new SubagentBackend({ model: DEFAULT_MODEL });
  return { model: backend.model, provider: backend.provider, temperature: backend.temperature, effort: backend.effort };
}

function engineRow(report: RunReport): string {
  const s = report.summary;
  const ci = `[${(s.ci95.low * 100).toFixed(1)}%, ${(s.ci95.high * 100).toFixed(1)}%]`;
  const cost = s.cost_per_100q.value === null
    ? 'unavailable'
    : `$${s.cost_per_100q.value.toFixed(4)}${s.cost_per_100q.source === 'estimated' ? '*' : ''}`;
  const range = s.accuracy_min !== undefined && s.accuracy_max !== undefined && (s.accuracy_max - s.accuracy_min) > 1e-9
    ? ` (${(s.accuracy_min * 100).toFixed(1)}–${(s.accuracy_max * 100).toFixed(1)}%)`
    : '';
  return `| ${report.meta.engine} | ${s.correct}/${s.scored} | ${(s.accuracy * 100).toFixed(1)}%${range} ${ci} | ${Math.round(s.latency.p95Allow)}ms | ${cost} | ${s.violations} |`;
}

export function writeReportMd(reports: RunReport[], attacks: AttackReport | null): void {
  const bySet = new Map<string, RunReport[]>();
  for (const r of reports) {
    const set = String(r.meta.set);
    if (!bySet.has(set)) bySet.set(set, []);
    bySet.get(set)!.push(r);
  }
  const anyEstimated = reports.some((r) => r.summary.cost_per_100q.source === 'estimated');
  const lines: string[] = [];
  lines.push('# Eval Report — Guardrailed Text-to-SQL Analyst', '');
  lines.push(`Generated: ${new Date().toISOString()} · EVAL_NOW: ${EVAL_NOW} · seed: ${EVAL_SEED}`, '');
  if (anyEstimated) lines.push('Costs marked `*` are **estimated** from a pinned tokenizer and published prices, not measured.', '');
  for (const [set, rs] of bySet) {
    lines.push(`## ${set}`, '');
    lines.push('| Engine | exact rows | accuracy (Wilson 95%) | p95 ALLOW | $/100q (retries incl.) | violations |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of rs) lines.push(engineRow(r));
    lines.push('');
    const modelRow = rs.find((r) => r.meta.engine !== 'templates') ?? rs[0];
    const repeats = [...new Set(rs.map((r) => r.meta.repeats))].join('/');
    lines.push(`Model: \`${modelRow?.meta.model}\` · provider: \`${modelRow?.meta.provider}\` · temperature: ${modelRow?.meta.temperature} · effort: ${modelRow?.meta.effort} · commit: \`${rs[0]?.meta.git_sha}\` · repeats: ${repeats}`, '');
    const basis = modelRow?.meta.cost_basis as any;
    if (basis?.source_url) {
      lines.push(`Cost basis: ${basis.cost_per_100q_reference}; served model: \`${basis.model_served}\` (effort ${basis.reasoning_effort}); peak rate 2x (${basis.peak_rate_caveat}); snapshot ${basis.price_snapshot_date}, ${basis.source_url}; usage_source=\`${basis.usage_source}\`.`, '');
    }
  }
  if (attacks) {
    lines.push('## Adversarial', '');
    lines.push(`- blocked: ${attacks.items.filter((i) => i.verdict === 'pass').length}/${attacks.items.length}`);
    lines.push(`- executed violations: ${attacks.violations} (gate: 0)`);
    lines.push(`- DB fingerprint unchanged: ${attacks.dbUnchanged ? 'yes' : 'NO'}`, '');
  }
  writeFileSync(join(ROOT, 'eval', 'REPORT.md'), lines.join('\n'));
}

export function writeCalibrationMd(report: RunReport): void {
  const s = report.summary;
  const lines: string[] = [];
  lines.push('# Calibration', '', `Engine: ${report.meta.engine} · set: ${report.meta.set} · model: ${report.meta.model} · commit: ${report.meta.git_sha}`, '');
  lines.push('## Reliability (executed ALLOW answers)', '');
  lines.push('| confidence bin | n | mean confidence | observed accuracy |', '|---|---|---|---|');
  for (const b of s.calibration.bins) {
    lines.push(`| ${b.label} | ${b.count} | ${b.meanConfidence.toFixed(3)} | ${b.count ? (b.accuracy * 100).toFixed(1) + '%' : '—'} |`);
  }
  lines.push('', `ECE: ${s.calibration.ece.toFixed(4)} · MCE: ${s.calibration.mce.toFixed(4)}`, '');
  lines.push(`Chosen operating point: ALLOW >= ${GATE.allow}, CLARIFY < ${GATE.clarify}.`, '');
  lines.push('## Threshold sweep (dev only, R2)', '');
  lines.push('| ALLOW threshold | executed | accuracy (executed) | false-clarify rate |', '|---|---|---|---|');
  const points: CalibrationPoint[] = report.items.map((i) => ({ id: i.id, confidence: i.confidence, correct: i.row_correct, expected: i.expected_decision }));
  for (const row of thresholdSweep(points, defaultThresholds())) {
    lines.push(`| ${row.threshold.toFixed(2)} | ${row.executed} | ${(row.accuracy * 100).toFixed(1)}% | ${(row.falseClarifyRate * 100).toFixed(1)}% |`);
  }
  writeFileSync(join(ROOT, 'eval', 'CALIBRATION.md'), lines.join('\n'));
}

export { DEFAULT_HYBRID_THRESHOLD };
