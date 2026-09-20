// Metric aggregation, engine construction and markdown report writers.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { accuracy, decisionMatrix, falseClarifyRate, missedClarifyRate } from './metrics/accuracy';
import { wilson } from './metrics/wilson';
import { latencyByDecision } from './metrics/latency';
import { costPer100q, costPer100qByBasis, PRICE_BASES, type CostOptions, type UsageRecord } from './metrics/cost';
import {
  reliability, ece, mce, defaultThresholds,
  thresholdCell, thresholdGrid, chooseOperatingPoint,
  type CalibrationPoint,
} from './metrics/calibration';
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
      const costSource = modelRow?.summary.cost_per_100q.source === 'provider'
        ? 'provider-reported cost'
        : 'reference-priced estimate';
      lines.push(`Cost (${costSource}): served model \`${basis.model_served}\` (effort ${basis.reasoning_effort}); reference sheet ${basis.cost_per_100q_reference}; snapshot ${basis.price_snapshot_date}, ${basis.source_url}; usage_source=\`${basis.usage_source}\`. Both published bases are compared below.`, '');
    }
  }
  const llmReports = reports.filter((r) => r.meta.engine !== 'templates');
  if (llmReports.length) {
    lines.push('## Cost basis comparison', '');
    lines.push('The same measured token counts (one repeat pass, retries included) priced under each published list. The model actually served is recorded per run; the non-served basis is a comparison, not a charge.', '');
    lines.push(`| set / engine | tokens in | tokens out | provider $/100q (measured) | ${PRICE_BASES.map((b) => `${b.label} $/100q (est)`).join(' | ')} |`);
    lines.push(`|---|--:|--:|--:|${PRICE_BASES.map(() => '--:').join('|')}|`);
    for (const r of llmReports) {
      const records = r.items.map((i) => ({ tokensIn: i.tokensIn, tokensOut: i.tokensOut }));
      const tokensIn = records.reduce((s, x) => s + x.tokensIn, 0);
      const tokensOut = records.reduce((s, x) => s + x.tokensOut, 0);
      const scored = r.summary.scored || r.items.length;
      const bases = costPer100qByBasis(records, scored);
      const provider = r.summary.cost_per_100q;
      const providerCell = provider.value === null
        ? 'n/a'
        : `$${provider.value.toFixed(4)}${provider.source === 'estimated' ? '*' : ''}`;
      lines.push(`| ${String(r.meta.set)} / ${String(r.meta.engine)} | ${tokensIn} | ${tokensOut} | ${providerCell} | ${bases.map((b) => `$${(b.value ?? 0).toFixed(4)}`).join(' | ')} |`);
    }
    lines.push('');
    for (const b of PRICE_BASES) {
      lines.push(`- ${b.label}: $${b.inputPer1M.toFixed(3)} in${b.cachedInputPer1M !== null ? ` ($${b.cachedInputPer1M.toFixed(3)} cached)` : ''} / $${b.outputPer1M.toFixed(2)} out per 1M — ${b.source}, retrieved ${b.retrieved}${b.flat ? ', flat' : ', off-peak; peak is 2x'}. ${b.note}.`);
    }
    lines.push('');
  }
  if (attacks) {
    lines.push('## Adversarial', '');
    lines.push(`- blocked: ${attacks.items.filter((i) => i.verdict === 'pass').length}/${attacks.items.length}`);
    lines.push(`- executed violations: ${attacks.violations} (gate: 0)`);
    lines.push(`- DB fingerprint unchanged: ${attacks.dbUnchanged ? 'yes' : 'NO'}`, '');
  }
  writeFileSync(join(ROOT, 'eval', 'REPORT.md'), lines.join('\n'));
}

function calPoints(report: RunReport): CalibrationPoint[] {
  return report.items.map((i) => ({
    id: i.id,
    confidence: i.confidence,
    correct: i.row_correct,
    expected: i.expected_decision,
  }));
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/**
 * Calibration report (spec 6.2). Tuned on dev only (R2): the threshold sweep
 * and the operating-point choice read the dev confidence/outcome pairs. The
 * held-out set is applied at the chosen point purely to report what that point
 * costs when it generalizes; held-out never influences the choice.
 */
export function writeCalibrationMd(reports: RunReport[]): void {
  const devReport = reports.find((r) => r.meta.set === 'dev' && r.meta.engine === 'llm') ?? reports.find((r) => r.meta.set === 'dev');
  if (!devReport) return;
  const heldReport = reports.find((r) => r.meta.set === 'heldout' && r.meta.engine === devReport.meta.engine);
  const points = calPoints(devReport);
  const thresholds = defaultThresholds();
  const grid = thresholdGrid(points, thresholds, thresholds);
  const preferred = { allow: GATE.allow, clarify: GATE.clarify };
  const chosen = chooseOperatingPoint(grid, { preferred });
  const retained = Math.abs(chosen.allow - preferred.allow) < 1e-9 && Math.abs(chosen.clarify - preferred.clarify) < 1e-9;

  const operatingPoints = points.filter((p) => p.expected !== 'ALLOW' || p.confidence >= chosen.clarify - 1e-9);
  const bins = reliability(operatingPoints);
  const devCell = thresholdCell(points, chosen.allow, chosen.clarify);

  const lines: string[] = [];
  lines.push('# Calibration', '');
  lines.push(`Model: \`${devReport.meta.model}\` · provider: \`${devReport.meta.provider}\` · effort: ${devReport.meta.effort} · temperature: ${devReport.meta.temperature} · commit: \`${devReport.meta.git_sha}\``);
  lines.push(`Set: dev (${devReport.items.length} questions, ${points.filter((p) => p.expected === 'ALLOW').length} expected-ALLOW) · EVAL_NOW: ${EVAL_NOW} · seed: ${EVAL_SEED}`);
  lines.push('');
  lines.push('The confidence signal is only meaningful for the LLM engine; the template engine returns fixed per-template constants, so this table uses the dev LLM run. Held-out is applied at the chosen point for reporting only and is never used to choose it (R2).', '');
  lines.push('## Reliability (executed answers at the chosen point)', '');
  lines.push('| confidence bin | n | mean confidence | observed accuracy |', '|---|---|---|---|');
  for (const b of bins) {
    lines.push(`| ${b.label} | ${b.count} | ${b.meanConfidence.toFixed(3)} | ${b.count ? pct(b.accuracy) : '—'} |`);
  }
  lines.push('');
  lines.push(`ECE: ${ece(bins).toFixed(4)} · MCE: ${mce(bins).toFixed(4)}`, '');
  lines.push('## Operating point', '');
  lines.push(`- Gate: **ALLOW >= ${chosen.allow.toFixed(2)}**, caveat band [${chosen.clarify.toFixed(2)}, ${chosen.allow.toFixed(2)}), **CLARIFY < ${chosen.clarify.toFixed(2)}**.`);
  lines.push(`- Source: dev-only sweep below (allow × clarify over 0.40–0.90 in 0.05 steps). Selection rule: respect a ${pct(0.15)} dev false-clarify budget and a ${pct(0.25)} dev caveat budget, maximise executed accuracy, then coverage, then stay closest to the pre-registered ${preferred.allow.toFixed(2)}/${preferred.clarify.toFixed(2)} point. A challenger must beat the pre-registered point by more than 5 percentage points (about two dev questions) to replace it.`);
  if (retained) {
    lines.push(`- Outcome: the pre-registered ${preferred.allow.toFixed(2)}/${preferred.clarify.toFixed(2)} point is retained. No dev-tuned alternative improves executed accuracy by more than 5 percentage points inside the budgets, so the sweep does not justify moving the gate.`);
  } else {
    lines.push(`- Outcome: the sweep replaces the pre-registered ${preferred.allow.toFixed(2)}/${preferred.clarify.toFixed(2)} point with ${chosen.allow.toFixed(2)}/${chosen.clarify.toFixed(2)} (executed accuracy ${pct(devCell.accuracy)} on ${devCell.executed} dev questions, false-clarify ${pct(devCell.falseClarifyRate)}).`);
  }
  lines.push(`- Dev at this point: ${devCell.executed} executed, accuracy ${pct(devCell.accuracy)}, false-clarify ${pct(devCell.falseClarifyRate)}, caveated ${pct(devCell.caveatRate)}, missed-clarify ${pct(devCell.missedClarifyRate)}.`);
  if (heldReport) {
    const heldPoints = calPoints(heldReport);
    const heldCell = thresholdCell(heldPoints, chosen.allow, chosen.clarify);
    const baseline = thresholdCell(heldPoints, GATE.allow, GATE.clarify);
    lines.push(`- Held-out cost of this point (reported, not tuned): ${heldCell.executed}/${heldPoints.filter((p) => p.expected === 'ALLOW').length} expected-ALLOW executed at ${pct(heldCell.accuracy)} accuracy, ${pct(heldCell.falseClarifyRate)} false-clarify, ${pct(heldCell.missedClarifyRate)} missed-clarify${retained ? '' : ` (pre-registered point: ${baseline.executed} executed at ${pct(baseline.accuracy)}, ${pct(baseline.falseClarifyRate)} false-clarify)`}.`);
  } else {
    lines.push('- Held-out cost: no held-out report was part of this run, so it cannot be reported here. Run `npm run eval:matrix` for the full doc.');
  }
  lines.push('');
  lines.push('## Threshold sweep (dev only, R2)', '');
  lines.push(`### CLARIFY boundary at the chosen ALLOW=${chosen.allow.toFixed(2)} (this is the execution tradeoff)`, '');
  lines.push('| CLARIFY >= | executed | correct | accuracy | false-clarify | missed-clarify | caveated |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const c of grid.filter((g) => Math.abs(g.allow - chosen.allow) < 1e-9)) {
    lines.push(`| ${c.clarify.toFixed(2)} | ${c.executed} | ${c.correct} | ${pct(c.accuracy)} | ${pct(c.falseClarifyRate)} | ${pct(c.missedClarifyRate)} | ${pct(c.caveatRate)} |`);
  }
  lines.push('');
  lines.push(`### ALLOW boundary at the chosen CLARIFY=${chosen.clarify.toFixed(2)} (caveat band only; does not move execution)`, '');
  lines.push('| ALLOW >= | executed | accuracy | false-clarify | caveated |');
  lines.push('|---|---|---|---|---|');
  for (const c of grid.filter((g) => Math.abs(g.clarify - chosen.clarify) < 1e-9)) {
    lines.push(`| ${c.allow.toFixed(2)} | ${c.executed} | ${pct(c.accuracy)} | ${pct(c.falseClarifyRate)} | ${pct(c.caveatRate)} |`);
  }
  lines.push('');
  lines.push('### Full dev grid — accuracy (false-clarify)', '');
  lines.push(`Rows: ALLOW >=; columns: CLARIFY >=. Only CLARIFY changes the executed set, so accuracy and false-clarify are constant down each column; ALLOW only moves answers into the caveat band.`, '');
  lines.push(`| ALLOW \\ CLARIFY | ${thresholds.map((t) => t.toFixed(2)).join(' | ')} |`);
  lines.push(`|---|${thresholds.map(() => '---').join('|')}|`);
  for (const a of thresholds) {
    const cells = thresholds.map((cl) => {
      const cell = grid.find((g) => Math.abs(g.allow - a) < 1e-9 && Math.abs(g.clarify - cl) < 1e-9);
      return cell ? `${pct(cell.accuracy)} (${pct(cell.falseClarifyRate)})` : '—';
    });
    lines.push(`| ${a.toFixed(2)} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  writeFileSync(join(ROOT, 'eval', 'CALIBRATION.md'), lines.join('\n'));
}

export { DEFAULT_HYBRID_THRESHOLD };
