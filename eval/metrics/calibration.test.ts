import { describe, it, expect } from 'vitest';
import {
  reliability, ece, mce, thresholdSweep, defaultThresholds,
  thresholdCell, thresholdGrid, chooseOperatingPoint, type CalibrationPoint,
} from './calibration';

function pt(id: string, confidence: number, correct: boolean | null, expected: 'ALLOW' | 'CLARIFY' | 'BLOCK' = 'ALLOW'): CalibrationPoint {
  return { id, confidence, correct, expected };
}

describe('reliability', () => {
  it('bins by confidence and reports mean confidence and accuracy', () => {
    const bins = reliability([
      pt('a', 0.15, true),
      pt('b', 0.15, false),
      pt('c', 0.95, true),
      pt('d', 0.2, null), // not executed -> ignored
    ]);
    const lowBin = bins[1]; // 0.10-0.20
    expect(lowBin.count).toBe(2);
    expect(lowBin.meanConfidence).toBeCloseTo(0.15, 6);
    expect(lowBin.accuracy).toBeCloseTo(0.5, 6);
    const highBin = bins[9]; // 0.90-1.00
    expect(highBin.count).toBe(1);
    expect(highBin.accuracy).toBe(1);
  });

  it('computes ECE and MCE', () => {
    const bins = reliability([pt('a', 0.9, true), pt('b', 0.1, false)]);
    // 0.9 bucket: |1-0.9| = 0.1 ; 0.1 bucket: |0-0.1| = 0.1
    expect(ece(bins)).toBeCloseTo(0.1, 6);
    expect(mce(bins)).toBeCloseTo(0.1, 6);
  });
});

describe('thresholdSweep', () => {
  it('raises false-clarify and shrinks executions as the threshold rises', () => {
    const points = [pt('a', 0.9, true), pt('b', 0.6, false), pt('c', 0.4, true)];
    const rows = thresholdSweep(points, [0.4, 0.55, 0.9]);
    expect(rows[0].executed).toBe(3);
    expect(rows[1].executed).toBe(2);
    expect(rows[2].executed).toBe(1);
    expect(rows[2].falseClarifyRate).toBeCloseTo(2 / 3, 6);
    expect(rows[0].falseClarifyRate).toBe(0);
  });

  it('produces 0.40..0.90 in 0.05 steps', () => {
    const t = defaultThresholds();
    expect(t[0]).toBe(0.4);
    expect(t[t.length - 1]).toBe(0.9);
    expect(t.length).toBe(11);
  });
});

describe('thresholdCell', () => {
  it('splits clear answers into executed / caveat / false-clarify bands', () => {
    const points = [
      pt('a', 0.95, true),   // high confidence, no caveat
      pt('b', 0.80, false),  // inside caveat band [0.55, 0.90)
      pt('c', 0.40, true),   // below clarify -> false clarify
      pt('d', 0.90, true),   // at allow -> no caveat
      pt('amb', 0.70, null, 'CLARIFY'), // ambiguous executed -> missed clarify
    ];
    const cell = thresholdCell(points, 0.9, 0.55);
    expect(cell.executed).toBe(3); // a, b, d
    expect(cell.correct).toBe(2);
    expect(cell.accuracy).toBeCloseTo(2 / 3, 6);
    expect(cell.falseClarify).toBe(1);
    expect(cell.falseClarifyRate).toBeCloseTo(0.25, 6);
    expect(cell.caveat).toBe(1);
    expect(cell.caveatRate).toBeCloseTo(0.25, 6);
    expect(cell.missedClarify).toBe(1);
    expect(cell.missedClarifyRate).toBeCloseTo(1, 6);
  });

  it('ignores unexecuted points from the accuracy denominator', () => {
    const cell = thresholdCell([pt('a', 0.9, null)], 0.75, 0.55);
    expect(cell.executed).toBe(0);
    expect(cell.accuracy).toBe(0);
  });
});

describe('thresholdGrid + chooseOperatingPoint', () => {
  it('omits invalid bands where allow < clarify', () => {
    const cells = thresholdGrid([pt('a', 0.9, true)], [0.4, 0.9], [0.4, 0.9]);
    expect(cells.every((c) => c.allow >= c.clarify)).toBe(true);
    expect(cells.length).toBe(3); // (0.4,0.4), (0.9,0.4), (0.9,0.9)
  });

  it('retains the pre-registered point when the sweep is flat', () => {
    const points = [pt('a', 0.9, true), pt('b', 0.9, true), pt('c', 0.9, false)];
    const cells = thresholdGrid(points);
    const chosen = chooseOperatingPoint(cells, { preferred: { allow: 0.75, clarify: 0.55 } });
    expect(chosen.allow).toBe(0.75);
    expect(chosen.clarify).toBe(0.55);
  });

  it('moves off the pre-registered point when dev evidence improves accuracy within budget', () => {
    // A confident correct answer plus a low-confidence wrong one. Raising
    // clarify above 0.6 drops the wrong answer at a 50% false-clarify cost,
    // inside a relaxed budget, so the tuned point wins.
    const points = [pt('a', 0.9, true), pt('b', 0.6, false)];
    const cells = thresholdGrid(points);
    const chosen = chooseOperatingPoint(cells, {
      preferred: { allow: 0.75, clarify: 0.55 },
      falseClarifyBudget: 0.6,
    });
    expect(chosen.accuracy).toBe(1);
    expect(chosen.clarify).toBe(0.65);
  });
});
