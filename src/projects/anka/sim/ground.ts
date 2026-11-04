import { seeded } from '../../../lib/math';

/**
 * Ground motion for the simulator — an explanatory model, not a hazard
 * analysis.
 *
 * Amplitude keeps ANKA's own estimate (simulation.html in the project repo):
 *
 *     log10 PGA[g] = 0.28 M − 0.8 log10(depth + 10) − 1.2,  × soil factor
 *
 * with the horizontal distance taken as zero (the site directly above the
 * hypocentre — the strongest case for a given depth), and capped at 2 g.
 *
 * The waveform is new. ANKA summed five sine waves; here the record is a
 * seeded stochastic process of the kind used to simulate earthquakes:
 *
 *   white noise
 *   → Kanai–Tajimi filter: the soil column as a damped oscillator, so rock
 *     passes stiff, high-frequency shaking and soft soil a slow, rolling one
 *   → Clough–Penzien high-pass: removes the unphysical very-low frequencies;
 *     its corner falls with magnitude (bigger earthquakes carry more long-
 *     period energy)
 *   → a low-pass whose corner falls with depth (high frequencies are
 *     absorbed on the way up)
 *   → an envelope: build-up, strong phase of the chosen duration, decay
 *
 * The soil filter's frequency drifts down through the record (early shaking
 * is sharper than late shaking). Every record starts from the same noise, so
 * the same parameters always give the same record and small changes give
 * small differences. The result is scaled so its peak equals the estimated PGA.
 */
export type Soil = 'rock' | 'gravel' | 'sand' | 'clay' | 'soft';

/** ANKA's soil amplification factors (simulation.html, CONFIG.SOIL_AMP). */
export const SOIL_AMP: Record<Soil, number> = { rock: 0.8, gravel: 0.95, sand: 1.1, clay: 1.35, soft: 1.7 };

/**
 * Soil column as a filter (rad/s, damping ratio). Generalised values in the
 * range used with the Kanai–Tajimi model: firm ground ≈ 15 rad/s / 0.6,
 * soft ground ≈ 5 rad/s / 0.2.
 */
export const SOIL_FILTER: Record<Soil, { w: number; z: number }> = {
  rock: { w: 19, z: 0.64 },
  gravel: { w: 15, z: 0.56 },
  sand: { w: 11, z: 0.46 },
  clay: { w: 8, z: 0.36 },
  soft: { w: 5.5, z: 0.26 },
};

export const G = 9.81;

export interface QuakeInput {
  magnitude: number;
  /** Strong-motion duration, s. */
  duration: number;
  /** Hypocentral depth, km. */
  depth: number;
  soil: Soil;
}

export interface GroundRecord {
  dt: number;
  /** Acceleration, velocity, displacement of the ground surface (SI). */
  acc: Float32Array;
  vel: Float32Array;
  disp: Float32Array;
  /** Estimated peak ground acceleration, g. */
  pga: number;
  /** Total length of the record, s (strong phase plus decay). */
  length: number;
  input: QuakeInput;
}

/**
 * ANKA's PGA estimate at the site, in g. Capped at 2 g: very shallow, very
 * large events push the simple formula past anything it can represent.
 */
export const PGA_CAP = 2;
export function estimatePga(q: QuakeInput) {
  const depth = Math.max(q.depth, 1);
  const log = 0.28 * q.magnitude - 0.8 * Math.log10(depth + 10) - 1.2;
  return Math.min(PGA_CAP, Math.pow(10, log) * SOIL_AMP[q.soil]);
}

/**
 * One noise realisation for every record. The filters, envelope and scale
 * vary smoothly with the inputs, so nudging a slider changes the shaking a
 * little — it never swaps in a different earthquake.
 */
const SEED = 20111203;

/** Envelope: quadratic build-up, strong phase, exponential decay. */
export function envelope(t: number, duration: number) {
  const rise = Math.min(2.5, 0.15 * duration);
  const strong = rise + duration * 0.7;
  if (t < 0) return 0;
  if (t < rise) return (t / rise) ** 2;
  if (t < strong) return 1;
  // Down to ~5% over the remaining 30% of the duration plus a short tail.
  const tail = duration * 0.3 + 2;
  return Math.exp((-3 * (t - strong)) / tail);
}

export function generateGround(q: QuakeInput, dt = 1 / 200): GroundRecord {
  const duration = Math.max(1, q.duration);
  const length = duration + 3;
  const n = Math.ceil(length / dt) + 1;
  const rnd = seeded(SEED);
  const gauss = () => {
    const u = Math.max(1e-12, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const soil = SOIL_FILTER[q.soil];
  // Clough–Penzien corner: ~0.9 Hz at M5 falling to ~0.1 Hz by M7.5.
  const fc = Math.min(1.2, Math.max(0.08, 0.9 * Math.pow(10, -(q.magnitude - 5) / 2.6)));
  const wf = 2 * Math.PI * fc;
  const zf = 0.7;
  // Anelastic attenuation: fewer high frequencies from deeper sources.
  const flp = 22 / (1 + Math.max(q.depth, 1) / 40);
  const kLp = 1 - Math.exp(-2 * Math.PI * flp * dt);

  const acc = new Float32Array(n);
  // Filter states (integrated at a finer step for stability).
  let xg = 0;
  let vg = 0;
  let xh = 0;
  let vh = 0;
  let lp = 0;
  const sub = 4;
  const h = dt / sub;
  for (let k = 0; k < n; k++) {
    const t = k * dt;
    const drift = 1.25 - 0.5 * Math.min(1, t / (duration + 1));
    const wg = soil.w * drift;
    // White noise, scaled so its spectral density does not depend on dt.
    const w = gauss() / Math.sqrt(dt);
    let aKT = 0;
    let aCP = 0;
    for (let s = 0; s < sub; s++) {
      // Kanai–Tajimi: x'' + 2ζω x' + ω² x = −w ;  output = −(2ζω x' + ω² x)
      const axg = -w - 2 * soil.z * wg * vg - wg * wg * xg;
      vg += axg * h;
      xg += vg * h;
      aKT = -(2 * soil.z * wg * vg + wg * wg * xg);
      // Clough–Penzien high-pass on the KT output.
      const axh = aKT - 2 * zf * wf * vh - wf * wf * xh;
      vh += axh * h;
      xh += vh * h;
      aCP = aKT - 2 * zf * wf * vh - wf * wf * xh;
    }
    lp += (aCP - lp) * kLp;
    acc[k] = lp * envelope(t, duration);
  }

  // Scale to the estimated PGA.
  const pga = estimatePga(q);
  let peak = 1e-9;
  for (let k = 0; k < n; k++) peak = Math.max(peak, Math.abs(acc[k]));
  const scale = (pga * G) / peak;
  for (let k = 0; k < n; k++) acc[k] *= scale;

  // Velocity and displacement for drawing the ground, baseline-corrected
  // (a real record ends at rest; small integration drift is removed).
  const vel = new Float32Array(n);
  const disp = new Float32Array(n);
  for (let k = 1; k < n; k++) vel[k] = vel[k - 1] + ((acc[k] + acc[k - 1]) / 2) * dt;
  const vEnd = vel[n - 1];
  for (let k = 0; k < n; k++) vel[k] -= (vEnd * k) / (n - 1);
  for (let k = 1; k < n; k++) disp[k] = disp[k - 1] + ((vel[k] + vel[k - 1]) / 2) * dt;
  const dEnd = disp[n - 1];
  for (let k = 0; k < n; k++) disp[k] -= (dEnd * k) / (n - 1);

  return { dt, acc, vel, disp, pga, length, input: q };
}

/** Linear interpolation into a record at time t (zero outside it). */
export function sample(arr: Float32Array, dt: number, t: number) {
  const x = t / dt;
  const i = Math.floor(x);
  if (i < 0 || i >= arr.length - 1) return 0;
  const f = x - i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}
