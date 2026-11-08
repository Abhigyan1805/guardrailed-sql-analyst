// Fit the agent engine's confidence calibrator on DEV only (R2).
//   npx tsx eval/calibrate.ts --backend deepseek --config sc3-noret
// Reads the newest dev report for that (backend, config), fits a logistic
// calibrator on the observable signals of every executed expected-ALLOW item,
// scores dev with leave-one-out predictions, re-derives the ALLOW/CLARIFY gate
// on those LOO confidences, and writes eval/calibration/<backend>-<config>.json.
// Held-out is never read here.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { REPORTS_DIR } from './loader';
import { fitCalibrator, leaveOneOut, type LabelledSignals } from './metrics/calibrator';
import { reliability, ece, mce, thresholdGrid, chooseOperatingPoint, type CalibrationPoint } from './metrics/calibration';
import { calibrationPath, type CalibrationFile } from './engines/agent';
import type { ItemResult } from './pipeline';

export function devPoints(items: ItemResult[]): LabelledSignals[] {
  return items
    .filter((i) => i.expected_decision === 'ALLOW' && i.signals && i.row_correct !== null)
    .map((i) => ({ id: i.id, signals: i.signals!, correct: i.row_correct === true }));
}

export function newestReport(backend: string, set: string, config: string): { items: ItemResult[]; meta: any; file: string } {
  const dir = join(REPORTS_DIR, backend);
  const files = readdirSync(dir).filter((f) => f.startsWith(`${set}-agent-`) && f.endsWith('.json'));
  let best: any = null;
  let bestFile = '';
  for (const f of files) {
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    // The calibrator is fitted on the gate-off collection run (every answer executed).
    // A gate-off replay of a calibrated run has the same signals and outcomes.
    const gateOff = !r.meta.calibrated || String(r.meta.gate_mode ?? '').startsWith('off');
    if (r.meta.agent_config?.name !== config || !gateOff) continue;
    if (!best || String(r.meta.timestamp) > String(best.meta.timestamp)) { best = r; bestFile = f; }
  }
  if (!best) throw new Error(`no ${set} report for ${backend}/${config}`);
  return { items: best.items, meta: best.meta, file: join(dir, bestFile) };
}

function main(): void {
  const argv = process.argv.slice(2);
  const get = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const backend = get('--backend') ?? 'deepseek';
  const config = get('--config') ?? 'sc3';
  const { items, meta, file } = newestReport(backend, 'dev', config);
  const points = devPoints(items);
  const cal = fitCalibrator(points, `dev (${file.split('/').pop()})`);
  const loo = leaveOneOut(points);
  const looPoints: CalibrationPoint[] = loo.map((p) => ({ id: p.id, confidence: p.confidence, correct: p.correct, expected: 'ALLOW' }));
  // Items that never executed (abstained / rejected) are expected-ALLOW misses at the floor confidence.
  for (const i of items) {
    if (i.expected_decision === 'ALLOW' && !points.some((p) => p.id === i.id)) looPoints.push({ id: i.id, confidence: cal.abstainConfidence, correct: null, expected: 'ALLOW' });
  }
  const bins = reliability(looPoints.filter((p) => p.correct !== null));
  const grid = thresholdGrid(looPoints);
  const chosen = chooseOperatingPoint(grid, { falseClarifyBudget: 0.15, caveatBudget: 0.25 });
  const out: CalibrationFile & Record<string, unknown> = {
    config,
    backend,
    model: String(meta.model),
    calibrator: cal,
    gate: { allow: chosen.allow, clarify: chosen.clarify },
    dev: {
      report: file.replace(/^.*eval\//, 'eval/'),
      n: points.length,
      base_rate: points.filter((p) => p.correct).length / points.length,
      ece_loo: ece(bins),
      mce_loo: mce(bins),
      bins,
      chosen_cell: chosen,
      selection: 'max dev executed accuracy within 15% false-clarify and 25% caveat budgets, on leave-one-out confidences',
    },
  };
  const path = calibrationPath(config, backend);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`${backend}/${config}: n=${points.length} dev LOO ECE=${ece(bins).toFixed(3)} gate allow>=${chosen.allow} clarify<${chosen.clarify} (dev exec acc ${(chosen.accuracy * 100).toFixed(1)}%, false-clarify ${(chosen.falseClarifyRate * 100).toFixed(1)}%)`);
  console.log('weights', cal.features.map((f, j) => `${f}=${cal.weights[j].toFixed(2)}`).join(' '), `bias=${cal.bias.toFixed(2)}`);
}

if (process.argv[1]?.endsWith('calibrate.ts')) main();
