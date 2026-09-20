import { describe, it, expect } from 'vitest';
import { wilson, formatInterval } from './wilson';

describe('wilson', () => {
  it('matches the spec example 54/60 ~ 90% [80%, 95%]', () => {
    const iv = wilson(54, 60);
    expect(iv.low).toBeGreaterThan(0.79);
    expect(iv.low).toBeLessThan(0.81);
    expect(iv.high).toBeGreaterThan(0.94);
    expect(iv.high).toBeLessThan(0.96);
  });

  it('stays within [0,1] at the extremes', () => {
    const all = wilson(40, 40);
    expect(all.high).toBeCloseTo(1, 6);
    expect(all.low).toBeGreaterThan(0.9);
    const none = wilson(0, 10);
    expect(none.low).toBe(0);
    expect(none.high).toBeGreaterThan(0.2);
    expect(none.high).toBeLessThan(0.4);
  });

  it('returns the full interval for n=0', () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1, center: 0 });
  });

  it('is symmetric about p=0.5', () => {
    const a = wilson(5, 10);
    expect(a.low).toBeCloseTo(1 - a.high, 6);
  });

  it('rejects impossible inputs', () => {
    expect(() => wilson(11, 10)).toThrow();
    expect(() => wilson(-1, 10)).toThrow();
  });

  it('formats an interval', () => {
    expect(formatInterval(54, 60)).toMatch(/90\.0% \[.*%, .*%\]/);
    expect(formatInterval(0, 0)).toBe('n/a [0.0%, 100.0%]');
  });
});
