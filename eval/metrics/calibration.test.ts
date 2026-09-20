import { describe, it, expect } from 'vitest';
import { reliability, ece, mce, thresholdSweep, defaultThresholds, type CalibrationPoint } from './calibration';

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
