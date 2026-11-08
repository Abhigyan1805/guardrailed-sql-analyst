// Writes eval/AGENT.md from the committed agent-engine reports in
// eval/reports/{deepseek,gemini}/ (no model calls). Run after the dev ablation,
// calibration and the one-per-config held-out scores:
//   npx tsx scripts/agent-report.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPORTS_DIR, ROOT } from '../eval/loader';
import { percentile } from '../eval/metrics/latency';
import { wilson } from '../eval/metrics/wilson';
import { reliability, ece, thresholdCell, type CalibrationPoint } from '../eval/metrics/calibration';
import { PROMPT_VERSION } from '../eval/engines/agent-prompt';
import { calibrationPath } from '../eval/engines/agent';
import type { RunReport } from '../eval/report';

const BACKENDS = ['deepseek', 'gemini'];
const LADDER = ['base', 'schema', 'retrieval', 'repair', 'sc3', 'repair-noret', 'sc3-noret'];
const LADDER_LABEL: Record<string, string> = {
  base: 'baseline: existing `llm` engine (selected views, 6 fixed dev exemplars, self-reported confidence)',
  schema: '+ rich static schema: all views, value hints, business definitions, output conventions',
  retrieval: '+ retrieval: up to 2 most similar solved dev questions (similarity >= 0.5, leave-one-out)',
  repair: '+ execution-guided repair (one fix on guard/DB error or empty/all-NULL result)',
  sc3: '+ self-consistency: 3 drafts, majority by executed result set',
  'repair-noret': 'rich schema + repair, without retrieval',
  'sc3-noret': 'rich schema + repair + self-consistency, without retrieval',
};
export const FINAL: Record<string, string> = { deepseek: 'sc3-noret', gemini: 'sc3-noret' };

interface Keyed { backend: string; set: string; config: string; calibrated: boolean; ungated: boolean; r: RunReport }

function load(): Keyed[] {
  const out = new Map<string, Keyed>();
  for (const backend of BACKENDS) {
    const dir = join(REPORTS_DIR, backend);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as RunReport;
      const m = r.meta as any;
      if (m.engine === 'agent' && m.prompt_version !== PROMPT_VERSION) continue;
      const config = m.engine === 'llm' ? 'base' : m.agent_config?.name;
      if (!config) continue;
      const k: Keyed = { backend, set: m.set, config, calibrated: !!m.calibrated, ungated: String(m.gate_mode ?? '').startsWith('off'), r };
      const key = `${backend}/${k.set}/${config}/${k.calibrated}/${k.ungated}`;
      const prev = out.get(key);
      if (!prev || String(m.timestamp) > String((prev.r.meta as any).timestamp)) out.set(key, k);
    }
  }
  return [...out.values()];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** End-to-end latency over every question that reached the model. */
function lat(r: RunReport): { p50: number; p95: number } {
  const v = r.items.filter((i) => i.tokensIn > 0).map((i) => i.latencyMs);
  return { p50: percentile(v, 50), p95: percentile(v, 95) };
}

function costPerQ(r: RunReport): string {
  const items = r.items.filter((i) => i.tokensIn > 0);
  if (!items.length) return '—';
  if (items.some((i) => i.costUsd === null)) {
    const tin = items.reduce((s, i) => s + i.tokensIn, 0) / items.length;
    const tout = items.reduce((s, i) => s + i.tokensOut, 0) / items.length;
    return `$0 (free tier); ${Math.round(tin)} in / ${Math.round(tout)} out tokens`;
  }
  return `$${(items.reduce((s, i) => s + (i.costUsd ?? 0), 0) / items.length).toFixed(5)}`;
}

function calls(r: RunReport): string {
  const items = r.items.filter((i) => i.tokensIn > 0);
  const n = items.reduce((s, i) => s + (i.llm_calls ?? (i.retries + 1)), 0);
  return items.length ? (n / items.length).toFixed(2) : '—';
}

function accCell(r: RunReport): string {
  const s = r.summary;
  const ci = wilson(s.correct, s.scored);
  return `${s.correct}/${s.scored} · ${pct(s.accuracy)} [${(ci.low * 100).toFixed(1)}, ${(ci.high * 100).toFixed(1)}]`;
}

function points(r: RunReport): CalibrationPoint[] {
  return r.items.map((i) => ({ id: i.id, confidence: i.confidence, correct: i.row_correct, expected: i.expected_decision }));
}

function main(): void {
  const all = load();
  const find = (backend: string, set: string, config: string, calibrated: boolean, ungated = false) =>
    all.find((k) => k.backend === backend && k.set === set && k.config === config && k.calibrated === calibrated && k.ungated === ungated)?.r;
  const L: string[] = [];
  L.push('# Agent engine results (November 2026)', '');
  L.push(`Generated ${new Date().toISOString()} by \`scripts/agent-report.ts\` from \`eval/reports/{deepseek,gemini}/\`. Prompt \`${PROMPT_VERSION}\`. EVAL_NOW 2025-09-01, seed 42, 1 pass per configuration (temperature 0 for the first draft; extra self-consistency drafts at 0.7). Same frozen sets, golds and positional exact-row scoring as \`REPORT.md\`; the published DeepSeek-through-opencode baseline there is unchanged history.`, '');
  L.push('Integrity: every design choice was made on **dev** only. The retrieval pool is dev-only (`eval/pool/dev.json`, validated against the dev golds by `scripts/validate-pool.ts`) and a dev question never retrieves itself. The calibrator and gate are fitted on dev (`eval/calibrate.ts`). Held-out was scored once per configuration listed below and every held-out score is shown. Paraphrase was not used for tuning.', '');

  for (const backend of BACKENDS) {
    const base = find(backend, 'dev', 'base', false);
    if (!base) continue;
    const model = String((base.meta as any).model);
    L.push(`## ${backend === 'deepseek' ? 'DeepSeek' : 'Gemini'} (\`${model}\`${backend === 'deepseek' ? ', reasoning effort low, api.deepseek.com' : ', free tier'})`, '');
    L.push('### Dev ablation (gate off: every answer executed, so this is pure generation accuracy)', '');
    L.push('| step | dev exact rows (Wilson 95%) | p50 / p95 latency | LLM calls / q | cost / q |', '|---|---|---|---|---|');
    for (const c of LADDER) {
      // A calibrated gate-off replay carries the same generations as the collection run.
      const r = c === 'base' ? base : find(backend, 'dev', c, false) ?? find(backend, 'dev', c, true, true);
      if (!r) continue;
      const l = lat(r);
      L.push(`| ${LADDER_LABEL[c]} | ${accCell(r)} | ${sec(l.p50)} / ${sec(l.p95)} | ${calls(r)} | ${costPerQ(r)} |`);
    }
    L.push('');

    const fc = FINAL[backend];
    const cal = existsSync(calibrationPath(fc, backend)) ? JSON.parse(readFileSync(calibrationPath(fc, backend), 'utf8')) : null;
    const devG = find(backend, 'dev', fc, true);
    const heldG = find(backend, 'heldout', fc, true);
    const heldU = find(backend, 'heldout', fc, true, true);
    const heldB = find(backend, 'heldout', 'base', false);
    const parG = find(backend, 'paraphrase', fc, true);
    const parB = find(backend, 'paraphrase', 'base', false);
    if (!heldG || !heldB) { L.push(`Held-out not yet scored for ${backend}.`, ''); continue; }
    L.push(`### Final configuration \`${fc}\` vs baseline`, '');
    if (cal) L.push(`Calibrated gate (re-derived on dev leave-one-out confidences): **CLARIFY below ${cal.gate.clarify}**${cal.gate.allow > cal.gate.clarify ? `, caveat band [${cal.gate.clarify}, ${cal.gate.allow})` : ''}. Dev leave-one-out ECE ${cal.dev.ece_loo.toFixed(3)}.`, '');
    L.push('| set | engine | exact rows (Wilson 95%) | false-clarify | missed-clarify | ECE | p50 / p95 latency | cost / q | violations |', '|---|---|---|---|---|---|---|---|---|');
    const row = (set: string, label: string, r: RunReport | undefined) => {
      if (!r) return;
      const s = r.summary;
      const l = lat(r);
      L.push(`| ${set} | ${label} | ${accCell(r)} | ${pct(s.false_clarify_rate.rate)} | ${s.missed_clarify_rate.n ? pct(s.missed_clarify_rate.rate) : '—'} | ${s.calibration.ece.toFixed(3)} | ${sec(l.p50)} / ${sec(l.p95)} | ${costPerQ(r)} | ${s.violations} |`);
    };
    row('dev', 'baseline (self-reported conf.)', base);
    row('dev', `final, gate on`, devG);
    row('held-out', 'baseline (self-reported conf.)', heldB);
    row('held-out', 'final, gate on', heldG);
    row('held-out', 'final, gate off (cached replay)', heldU);
    row('paraphrase', 'baseline', parB);
    row('paraphrase', 'final, gate on', parG);
    L.push('');
    L.push('"gate on" counts a correct answer the gate deferred to a clarifying question as a miss, exactly like the headline numbers in `REPORT.md`. "gate off" is the same configuration and the same cached model responses with every answer executed: it is the generation accuracy and the population ECE is measured on. ECE uses 10 equal-width bins over executed answers.', '');

    if (heldU) {
      L.push('### ALLOW/CLARIFY trade-off on held-out (reported, not tuned)', '');
      L.push('| CLARIFY below | answered | correct | precision of answers | correct overall | false-clarify | missed-clarify |', '|---|---|---|---|---|---|---|');
      const pts = points(heldU);
      const scored = heldU.summary.scored;
      for (const t of [0, 0.35, 0.45, 0.55, 0.65, 0.75]) {
        const c = thresholdCell(pts, t, t);
        L.push(`| ${t.toFixed(2)}${cal && Math.abs(t - cal.gate.clarify) < 1e-9 ? ' (dev-chosen)' : ''} | ${c.executed} | ${c.correct} | ${pct(c.accuracy)} | ${c.correct}/${scored} · ${pct(c.correct / scored)} | ${pct(c.falseClarifyRate)} | ${c.missedClarify}/${pts.filter((p) => p.expected === 'CLARIFY').length} |`);
      }
      const bins = reliability(pts);
      L.push('', `Reliability on held-out (gate off): ${bins.filter((b) => b.count).map((b) => `${b.label}: n=${b.count}, conf ${b.meanConfidence.toFixed(2)}, acc ${pct(b.accuracy)}`).join('; ')}. ECE ${ece(bins).toFixed(3)}.`, '');
    }
    if (cal) L.push(`Calibrator weights (logistic, L2=1, fitted on ${cal.calibrator.n} dev answers): ${cal.calibrator.features.map((f: string, j: number) => `${f} ${cal.calibrator.weights[j].toFixed(2)}`).join(', ')}, bias ${cal.calibrator.bias.toFixed(2)}. A weight of 0 means the signal never varied on dev (e.g. no dev answer needed a repair).`, '');
  }

  L.push('## Limitations', '');
  L.push('- 42 scored held-out questions: a Wilson 95% interval is about ±13-15 points wide, so one question moves accuracy by 2.4 points. 35 scored dev questions make every ablation step below ~2 questions indistinguishable from noise; retrieval and repair measured as no change on dev.');
  L.push('- The calibrator is fitted on 35 dev answers; with that few points its weights are rough, and ECE on 42 held-out answers in 10 bins is itself noisy.');
  L.push('- The gate trades coverage for precision: at the dev-chosen threshold some correct held-out answers become clarifying questions, which the headline "gate on" accuracy counts as misses.');
  L.push('- Latency is end-to-end per question (local guard + EXPLAIN + execution plus provider call time on the critical path; parallel drafts count once; client-side free-tier throttle waits excluded; cached replays use the recorded original call time). Free-tier Gemini latency is dominated by provider queueing and varies widely.');
  L.push('- The demo model `gemini-2.5-flash` allows 20 free requests per day on this key, so the Gemini evaluation used `gemini-3.1-flash-lite` (separate free quota).');
  L.push('- Accuracy, LLM and calibration runs use PGlite; the security suite runs on real Postgres (`eval/SECURITY.md`).');
  writeFileSync(join(ROOT, 'eval', 'AGENT.md'), L.join('\n') + '\n');
  console.log('wrote eval/AGENT.md');
}

main();
