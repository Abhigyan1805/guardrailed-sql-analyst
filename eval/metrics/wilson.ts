// Wilson score interval (spec 6.1). Used instead of the normal approximation
// because accuracies here sit near 0 or 1 on small n, where the normal
// interval is badly behaved (can exceed [0,1], collapses to zero width).

export interface Interval {
  low: number;
  high: number;
  center: number;
}

// 95% two-sided z. Kept as a named constant so the coverage is explicit.
export const Z_95 = 1.959963984540054;

/**
 * Wilson score interval for `successes` out of `n` trials.
 *
 *   center = (p + z^2/(2n)) / (1 + z^2/n)
 *   half   = z/(1 + z^2/n) * sqrt(p(1-p)/n + z^2/(4n^2))
 *
 * With n = 0 there is no information: returns the full [0, 1] interval
 * rather than NaN so callers can always print a bound.
 */
export function wilson(successes: number, n: number, z: number = Z_95): Interval {
  if (!Number.isFinite(successes) || !Number.isFinite(n) || n < 0) {
    throw new Error(`wilson: invalid inputs successes=${successes} n=${n}`);
  }
  if (successes < 0 || successes > n) {
    throw new Error(`wilson: successes ${successes} out of range for n=${n}`);
  }
  if (n === 0) return { low: 0, high: 1, center: 0 };

  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
    center,
  };
}

/** Format an interval as "xx.x% [yy.y%, zz.z%]". */
export function formatInterval(successes: number, n: number, digits = 1): string {
  if (n === 0) return `n/a [0.0%, 100.0%]`;
  const point = (successes / n) * 100;
  const { low, high } = wilson(successes, n);
  return `${point.toFixed(digits)}% [${(low * 100).toFixed(digits)}%, ${(high * 100).toFixed(digits)}%]`;
}
