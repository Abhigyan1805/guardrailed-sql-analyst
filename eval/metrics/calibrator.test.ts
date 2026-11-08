import { describe, it, expect } from 'vitest';
import { fitCalibrator, fitLogistic, leaveOneOut, predict, sqlComplexity, type Signals } from './calibrator';

const sig = (over: Partial<Signals>): Signals => ({
  abstained: false, drafts: 3, agreement: 1, clean: true, repaired: false, executed: true,
  empty: false, nullColumn: false, topSimilarity: 0.5, complexity: 0.25, ...over,
});

describe('logistic calibrator', () => {
  it('recovers a monotone relationship', () => {
    const X = [[0], [0.2], [0.4], [0.6], [0.8], [1], [0.1], [0.9]];
    const y = [0, 0, 0, 1, 1, 1, 0, 1];
    const { weights } = fitLogistic(X, y, 0.1);
    expect(weights[0]).toBeGreaterThan(0);
  });

  it('maps higher agreement and clean execution to higher confidence', () => {
    const points = [];
    for (let i = 0; i < 20; i++) points.push({ id: `a${i}`, signals: sig({ agreement: 1 }), correct: i % 5 !== 0 });
    for (let i = 0; i < 20; i++) points.push({ id: `b${i}`, signals: sig({ agreement: 1 / 3, clean: false, repaired: true }), correct: i % 5 === 0 });
    const cal = fitCalibrator(points, 'test');
    expect(predict(cal, sig({ agreement: 1 }))).toBeGreaterThan(0.6);
    expect(predict(cal, sig({ agreement: 1 / 3, clean: false }))).toBeLessThan(0.4);
    const p = predict(cal, sig({}));
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('gives abstentions and non-executed answers the floor confidence', () => {
    const cal = fitCalibrator([{ id: 'x', signals: sig({}), correct: true }, { id: 'y', signals: sig({ agreement: 0.3 }), correct: false }], 't');
    expect(predict(cal, sig({ abstained: true }))).toBe(cal.abstainConfidence);
    expect(predict(cal, sig({ executed: false }))).toBe(cal.abstainConfidence);
  });

  it('leave-one-out never scores a point with a model that saw it', () => {
    const pts = [
      { id: 'a', signals: sig({ agreement: 1 }), correct: true },
      { id: 'b', signals: sig({ agreement: 1 }), correct: true },
      { id: 'c', signals: sig({ agreement: 0.33 }), correct: false },
      { id: 'd', signals: sig({ agreement: 0.33 }), correct: false },
      { id: 'e', signals: sig({ agreement: 1 }), correct: false },
    ];
    const loo = leaveOneOut(pts);
    const full = fitCalibrator(pts, 't');
    // Point e is an outlier: in-sample it pulls the agreement=1 estimate down; LOO does not.
    expect(loo.find((p) => p.id === 'e')!.confidence).toBeGreaterThan(predict(full, pts[4].signals));
  });

  it('scores SQL complexity in 0..1', () => {
    expect(sqlComplexity('SELECT 1')).toBe(0);
    expect(sqlComplexity('WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a JOIN b ON true')).toBeGreaterThan(0.4);
  });
});
