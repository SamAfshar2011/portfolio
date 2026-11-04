import { seeded } from '../../lib/math';

/**
 * Fiscora's month-end projection, ported line-for-line from
 * `BudgetAdvisor.projection()` in the project's server notebook:
 *
 *   expected path  = spent so far + Σ(mean spend for that weekday over the
 *                    last 28 days) for each remaining day
 *   uncertainty    = 300 bootstrap samples: spent so far + a random draw
 *                    (with replacement) of the last 28 daily totals for each
 *                    remaining day
 *   band           = 20th–80th percentile of the samples
 *   overrun        = share of samples above the budget
 *
 * The daily data here is a synthetic sample month generated in the browser.
 */
export interface SampleMonth {
  daysInMonth: number;
  today: number; // 1-based day of month
  /** Daily totals for day 1..today of this month. */
  mtd: number[];
  /** The last 28 daily totals ending today (weekday of each). */
  last28: { amount: number; weekday: number }[];
  /** Weekday (0 = Monday, as in Python) of day 1 of the month. */
  firstWeekday: number;
}

export function sampleMonth(seed: number): SampleMonth {
  const rnd = seeded(seed);
  const daysInMonth = 30;
  const today = 18;
  const firstWeekday = Math.floor(rnd() * 7);
  // Weekday profile (Mon..Sun): weekends cost more.
  const dow = [0.85, 0.8, 0.9, 0.95, 1.2, 1.55, 1.35];
  const day = (weekday: number) => {
    const base = 58 * dow[weekday];
    const noise = Math.exp((rnd() - 0.5) * 0.9);
    const spike = rnd() < 0.08 ? 90 + rnd() * 160 : 0;
    const quiet = rnd() < 0.1 ? 0.15 : 1;
    return Math.round((base * noise * quiet + spike) * 100) / 100;
  };
  const all: { amount: number; weekday: number }[] = [];
  // 10 days from the previous month, then day 1..today of this month.
  for (let i = -10; i < today; i++) {
    const weekday = (((firstWeekday + i) % 7) + 7) % 7;
    all.push({ amount: day(weekday), weekday });
  }
  const last28 = all.slice(-28);
  const mtd = all.slice(10).map((d) => d.amount);
  return { daysInMonth, today, mtd, last28, firstWeekday };
}

export interface Projection {
  spent: number;
  projected: number;
  p20: number;
  p80: number;
  burn: number;
  /** Cumulative paths for each bootstrap sample over the remaining days. */
  paths: Float32Array[];
  /** Month-end totals of every sample. */
  samples: number[];
  /** Expected cumulative path over the remaining days. */
  expected: number[];
}

export function project(m: SampleMonth, seed = 7, n = 300): Projection {
  const spent = m.mtd.reduce((a, b) => a + b, 0);
  const remaining = m.daysInMonth - m.today;
  const overall = m.last28.map((d) => d.amount);
  const overallMean = overall.reduce((a, b) => a + b, 0) / overall.length;
  const byDow = new Map<number, number[]>();
  m.last28.forEach((d) => byDow.set(d.weekday, [...(byDow.get(d.weekday) ?? []), d.amount]));
  const dowMean = (w: number) => {
    const v = byDow.get(w);
    return v && v.length ? v.reduce((a, b) => a + b, 0) / v.length : overallMean;
  };

  const expected: number[] = [];
  let acc = spent;
  for (let i = 1; i <= remaining; i++) {
    const weekday = (m.firstWeekday + m.today - 1 + i) % 7;
    acc += dowMean(weekday);
    expected.push(acc);
  }

  const rnd = seeded(seed);
  const paths: Float32Array[] = [];
  const samples: number[] = [];
  for (let s = 0; s < n; s++) {
    const path = new Float32Array(remaining);
    let c = spent;
    for (let i = 0; i < remaining; i++) {
      c += overall[Math.floor(rnd() * overall.length)];
      path[i] = c;
    }
    paths.push(path);
    samples.push(c);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = (q: number) => {
    // numpy.percentile default: linear interpolation between closest ranks
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  return {
    spent,
    projected: acc,
    p20: pct(0.2),
    p80: pct(0.8),
    burn: overallMean,
    paths,
    samples,
    expected,
  };
}

export const overrunProbability = (p: Projection, budget: number) =>
  budget > 0 ? p.samples.filter((s) => s > budget).length / p.samples.length : 0;
