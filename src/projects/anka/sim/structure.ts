import { seeded } from '../../../lib/math';
import { G, sample, type GroundRecord, type Soil } from './ground';

/**
 * A reduced-order structural model of one building in one earthquake.
 *
 * It is an explanatory simulation derived from ANKA's simulator (same
 * inputs, same storey height and bay layout, same ground-motion estimate),
 * rebuilt so its behaviour comes from mechanics instead of damage rates:
 *
 *   Superstructure — a shear building: one horizontal degree of freedom per
 *   floor, floors carrying their mass, storeys carrying stiffness, damping
 *   and strength.
 *   Storeys — Bouc–Wen hysteresis (smooth yielding, energy dissipation and
 *   permanent set), stiffness that degrades with the energy dissipated,
 *   strength that softens with damage, and P-Δ: the weight above a leaning
 *   storey pushes it further over.
 *   Damage — the Park–Ang index per storey (peak drift over capacity plus
 *   cumulative hysteretic energy). ≥ 1 means the storey can no longer carry
 *   the building above it.
 *   Foundation — a mat on the soil with a horizontal spring (sway), a
 *   rotational spring (rocking), radiation damping and a friction limit on
 *   sliding. Stiffnesses follow the elastic half-space formulas for a
 *   footing, from each soil's shear-wave velocity.
 *   Liquefaction — pore pressure builds with shaking in susceptible soils;
 *   it softens the foundation springs, lowers the sliding limit (lateral
 *   spreading leaves a permanent offset) and makes the building settle and
 *   tilt. It does not multiply "damage".
 *
 * Everything is integrated together (a coupled mass matrix, so base shear
 * and overturning moment are exchanged exactly) at a fixed 2 kHz step.
 *
 * Parameter values are generalised approximations chosen to make the
 * differences between materials, ages, walls and soils behave plausibly;
 * the period formula has the form T = Ct·H^x used in design codes. None of
 * this is a code-compliant or certified analysis.
 */
export type Structure = 'concrete' | 'steel' | 'wood' | 'masonry';
export type Liquefaction = 'low' | 'medium' | 'high';

export interface BuildingInput {
  structure: Structure;
  floors: number;
  age: number;
  shearWall: boolean;
  soil: Soil;
  liquefaction: Liquefaction;
}

/** ANKA's storey height and plan (simulation.html: FLOOR_H, BAY_W × NUM_BAYS). */
export const STOREY_H = 3.2;
export const BAYS = 3;
export const BAY_W = 5;
export const PLAN = { B: BAYS * BAY_W, D: 10 };

interface Material {
  /** Approximate fundamental period T = ct · H^x (s, H in m). */
  ct: number;
  x: number;
  /** Seismic mass per floor area (t/m²). */
  mass: number;
  /** Yield and ultimate inter-storey drift ratios. */
  thetaY: number;
  thetaU: number;
  /** Post-yield stiffness as a fraction of the initial. */
  alpha: number;
  /** Park–Ang weight of cumulative energy (brittle systems suffer more from cycling). */
  betaPA: number;
  /** Viscous damping ratio. */
  zeta: number;
  /** How far strength falls once damage sets in (0 = keeps it, 1 = loses it). */
  soften: number;
}

export const MATERIALS: Record<Structure, Material> = {
  concrete: { ct: 0.0466, x: 0.9, mass: 1.0, thetaY: 0.007, thetaU: 0.035, alpha: 0.03, betaPA: 0.08, zeta: 0.05, soften: 0.6 },
  steel: { ct: 0.0724, x: 0.8, mass: 0.75, thetaY: 0.009, thetaU: 0.05, alpha: 0.05, betaPA: 0.025, zeta: 0.025, soften: 0.35 },
  wood: { ct: 0.0488, x: 0.75, mass: 0.35, thetaY: 0.011, thetaU: 0.045, alpha: 0.06, betaPA: 0.05, zeta: 0.06, soften: 0.5 },
  masonry: { ct: 0.0488, x: 0.75, mass: 1.2, thetaY: 0.0022, thetaU: 0.009, alpha: 0.0, betaPA: 0.2, zeta: 0.06, soften: 0.9 },
};

/** Shear walls: stiffer (a wall-system period), yield at smaller drift, different capacity. */
const WALL_THETA_U: Record<Structure, number> = { concrete: 0.026, steel: 0.035, wood: 0.04, masonry: 0.014 };

/** Soil: shear-wave velocity (m/s) and how prone it is to liquefy. */
export const SOIL_GROUND: Record<Soil, { vs: number; susceptible: number }> = {
  rock: { vs: 760, susceptible: 0 },
  gravel: { vs: 420, susceptible: 0.3 },
  sand: { vs: 250, susceptible: 1 },
  clay: { vs: 180, susceptible: 0.3 },
  soft: { vs: 110, susceptible: 0.8 },
};
const LIQ_LEVEL: Record<Liquefaction, number> = { low: 0.12, medium: 0.45, high: 1 };
/** How far pore pressure can build at each risk level (a low-risk soil never fully liquefies). */
const LIQ_MAX: Record<Liquefaction, number> = { low: 0.3, medium: 0.7, high: 0.97 };

export type DamageState = 'none' | 'minor' | 'moderate' | 'severe' | 'collapse';
/** Park–Ang index bands (Park, Ang & Wen, 1985). */
export function damageState(d: number): DamageState {
  if (d >= 1) return 'collapse';
  if (d >= 0.4) return 'severe';
  if (d >= 0.25) return 'moderate';
  if (d >= 0.1) return 'minor';
  return 'none';
}

export interface StoreyState {
  /** Inter-storey drift (m) and its peak. */
  drift: number;
  peak: number;
  /** Bouc–Wen hysteretic variable: |z| → 1 means the storey is yielding. */
  z: number;
  /** Park–Ang damage index (never decreases). */
  damage: number;
  /** Remaining strength fraction. */
  strength: number;
  failed: boolean;
}

export interface FloorRelease {
  /** First floor (1-based) that lost support; every floor above it went with it. */
  from: number;
  time: number;
  /** Horizontal offsets from the ground (m) and velocities (m/s) of the released floors, bottom up. */
  offsets: number[];
  velocities: number[];
  /** Rocking of the base at release (rad). */
  tilt: number;
}

export class Building {
  readonly input: BuildingInput;
  readonly n: number;
  readonly m: Float64Array;
  readonly k: Float64Array;
  readonly c: Float64Array;
  readonly dy: Float64Array;
  readonly du: Float64Array;
  readonly fy: Float64Array;
  readonly weightAbove: Float64Array;
  readonly mat: Material;
  readonly period: number;
  readonly mf: number;
  readonly If: number;
  readonly kx0: number;
  readonly kt0: number;
  private cx: number;
  private ct: number;
  private readonly muSlide = 0.5;
  private readonly liqRate: number;
  private readonly tiltBias: number;

  // --- state
  /** Active storeys (floors above a failed storey have been released). */
  active: number;
  readonly q: Float64Array;
  readonly v: Float64Array;
  private a: Float64Array;
  private Minv: Float64Array;
  private rhs: Float64Array;
  readonly storeys: StoreyState[];
  private zr: Float64Array;
  private eh: Float64Array;
  private dPrev: Float64Array;
  /** Foundation: plastic slide offset, settlement, permanent tilt, pore pressure ratio. */
  slide = 0;
  settlement = 0;
  tiltPerm = 0;
  ru = 0;
  time = 0;
  peakAcc = 0;
  releases: FloorRelease[] = [];
  unstable = false;

  constructor(input: BuildingInput) {
    this.input = input;
    const n = Math.max(1, Math.round(input.floors));
    this.n = n;
    this.active = n;
    const mat = MATERIALS[input.structure];
    this.mat = mat;
    const rnd = seeded(hashInput(input));
    const area = PLAN.B * PLAN.D;

    // Age: restrained — strength and stiffness fall by up to ~30% and the
    // drift a storey can survive by up to ~40% (older detailing), both
    // approaching their limit gradually rather than linearly.
    const ageK = 1 - 0.3 * (1 - Math.exp(-input.age / 40));
    const ageU = 1 - 0.4 * (1 - Math.exp(-input.age / 35));

    const H = n * STOREY_H;
    let T = mat.ct * Math.pow(H, mat.x);
    let thetaY = mat.thetaY;
    let thetaU = mat.thetaU;
    if (input.shearWall) {
      // Walls give a wall-system period and a stiffer, stronger structure.
      T = Math.min(T, 0.0488 * Math.pow(H, 0.75) * 0.85);
      thetaY *= 0.85;
      thetaU = WALL_THETA_U[input.structure];
    }
    T /= Math.sqrt(ageK);
    this.period = T;

    this.m = new Float64Array(n);
    this.k = new Float64Array(n);
    this.c = new Float64Array(n);
    this.dy = new Float64Array(n);
    this.du = new Float64Array(n);
    this.fy = new Float64Array(n);
    this.weightAbove = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      this.m[j] = mat.mass * 1000 * area * (j === n - 1 ? 0.85 : 1);
      // Stiffness tapers with height; each storey differs a little.
      this.k[j] = (1 - (0.5 * j) / n) * (0.94 + rnd() * 0.12);
    }
    // Scale stiffness so the fixed-base building has period T.
    const w1 = fundamental(this.m, this.k);
    const scale = ((2 * Math.PI) / T / w1) ** 2;
    for (let j = 0; j < n; j++) {
      this.k[j] *= scale;
      this.c[j] = (2 * mat.zeta * this.k[j]) / ((2 * Math.PI) / T);
      this.dy[j] = thetaY * STOREY_H * Math.sqrt(ageK);
      this.du[j] = thetaU * ageU * STOREY_H;
      this.fy[j] = this.k[j] * this.dy[j];
    }
    let w = 0;
    for (let j = n - 1; j >= 0; j--) {
      w += this.m[j] * G;
      this.weightAbove[j] = w;
    }

    // Foundation on an elastic half-space.
    const soil = SOIL_GROUND[input.soil];
    const rho = 2100;
    const G0 = rho * soil.vs * soil.vs;
    const nu = 0.35;
    const Rx = Math.sqrt(area / Math.PI);
    const Rt = Math.pow((PLAN.B ** 3 * PLAN.D) / (3 * Math.PI), 0.25);
    this.kx0 = (8 * G0 * Rx) / (2 - nu);
    this.kt0 = (8 * G0 * Rt ** 3) / (3 * (1 - nu));
    this.mf = 1.5 * mat.mass * 1000 * area;
    this.If = (this.mf * (PLAN.B ** 2 + PLAN.D ** 2)) / 12;
    this.cx = 0;
    this.ct = 0;
    this.liqRate = 5 * LIQ_LEVEL[input.liquefaction] * soil.susceptible;
    this.tiltBias = (0.12 + rnd() * 0.22) * (rnd() < 0.5 ? -1 : 1);

    this.q = new Float64Array(n + 2);
    this.v = new Float64Array(n + 2);
    this.a = new Float64Array(n + 2);
    this.rhs = new Float64Array(n + 2);
    this.Minv = new Float64Array(0);
    this.zr = new Float64Array(n);
    this.eh = new Float64Array(n);
    this.dPrev = new Float64Array(n);
    this.storeys = Array.from({ length: n }, () => ({ drift: 0, peak: 0, z: 0, damage: 0, strength: 1, failed: false }));
    this.assemble();
  }

  /** Height of floor j (1-based) above the foundation. */
  static height(j: number) {
    return j * STOREY_H;
  }

  /** Coupled mass matrix of the active part, inverted once (it only changes on release). */
  private assemble() {
    const n = this.active;
    const N = n + 2;
    const M = new Float64Array(N * N);
    const ib = n;
    const it = n + 1;
    let mSum = 0;
    let mh = 0;
    let mh2 = 0;
    let rot = 0;
    for (let j = 0; j < n; j++) {
      const h = Building.height(j + 1);
      const mj = this.m[j];
      M[j * N + j] = mj;
      M[j * N + ib] = M[ib * N + j] = mj;
      M[j * N + it] = M[it * N + j] = mj * h;
      mSum += mj;
      mh += mj * h;
      mh2 += mj * h * h;
      rot += (mj * PLAN.B ** 2) / 12;
    }
    M[ib * N + ib] = this.mf + mSum;
    M[ib * N + it] = M[it * N + ib] = mh;
    M[it * N + it] = this.If + mh2 + rot;
    this.Minv = invert(M, N);
    // Radiation-type damping of the foundation modes (about 20% sway, 12% rocking).
    this.cx = 2 * 0.2 * Math.sqrt(this.kx0 * (this.mf + mSum));
    this.ct = 2 * 0.12 * Math.sqrt(this.kt0 * (this.If + mh2 + rot));
  }

  /** Displacement of floor j (1-based) relative to the moving ground, m. */
  floorOffset(j: number) {
    const n = this.active;
    const h = Building.height(j);
    return this.q[n] + h * (this.q[n + 1] + this.tiltPerm) + (j <= n ? this.q[j - 1] : 0);
  }

  get sway() {
    return this.q[this.active];
  }
  get rocking() {
    return this.q[this.active + 1] + this.tiltPerm;
  }

  /** Advance by `dt` seconds of simulated time at a fixed 2 kHz step. */
  advance(ground: GroundRecord, dt: number) {
    const h = 1 / 2000;
    const steps = Math.round(Math.min(dt, 0.1) / h);
    for (let s = 0; s < steps && !this.unstable; s++) this.step(ground, h);
  }

  private step(ground: GroundRecord, h: number) {
    this.time += h;
    const ag = sample(ground.acc, ground.dt, this.time);
    const vg = sample(ground.vel, ground.dt, this.time);
    this.peakAcc = Math.max(this.peakAcc, Math.abs(ag) / G);
    const n = this.active;
    const N = n + 2;
    const ib = n;
    const it = n + 1;
    const q = this.q;
    const v = this.v;
    const Q = this.rhs;

    // Liquefaction: pore pressure builds with strong shaking.
    if (this.liqRate > 0) {
      const excess = Math.max(0, Math.abs(ag) / G - 0.05);
      const cap = LIQ_MAX[this.input.liquefaction];
      this.ru = Math.min(cap, this.ru + this.liqRate * Math.pow(excess, 1.5) * Math.sqrt(Math.max(0, 1 - this.ru / cap)) * h);
    }
    const soft = Math.max(0.02, (1 - this.ru) ** 2);
    const kx = this.kx0 * soft;
    const kt = this.kt0 * soft;

    let mSum = 0;
    let mh = 0;
    for (let j = 0; j < n; j++) {
      mSum += this.m[j];
      mh += this.m[j] * Building.height(j + 1);
    }

    // Storey forces.
    for (let j = 0; j < N; j++) Q[j] = 0;
    for (let j = 0; j < n; j++) {
      const st = this.storeys[j];
      const d = q[j] - (j > 0 ? q[j - 1] : 0);
      const dv = v[j] - (j > 0 ? v[j - 1] : 0);
      const k = this.k[j];
      const alpha = this.mat.alpha;
      const g = st.strength;
      const F = g * (alpha * k * d + (1 - alpha) * this.fy[j] * this.zr[j]) + g * this.c[j] * dv - (this.weightAbove[j] * d) / STOREY_H;
      Q[j] -= F;
      if (j > 0) Q[j - 1] += F;
    }
    // Foundation: sliding spring with a friction limit, rocking spring, damping.
    const wTotal = (mSum + this.mf) * G;
    let fx = kx * (q[ib] - this.slide);
    const limit = this.muSlide * (1 - this.ru) * wTotal;
    if (Math.abs(fx) > limit) {
      // Slip: the spring's origin moves; the offset stays after shaking.
      this.slide = q[ib] - (Math.sign(fx) * limit) / kx;
      fx = Math.sign(fx) * limit;
    }
    Q[ib] -= fx + this.cx * v[ib];
    Q[it] -= kt * q[it] + this.ct * v[it];
    // Gravity on the leaning building (rocking P-Δ).
    let pd = 0;
    for (let j = 0; j < n; j++) pd += this.m[j] * G * (q[j] + Building.height(j + 1) * (q[it] + this.tiltPerm));
    Q[it] += pd;
    // Ground motion drives everything through its mass.
    for (let j = 0; j < n; j++) Q[j] -= this.m[j] * ag;
    Q[ib] -= (this.mf + mSum) * ag;
    Q[it] -= mh * ag;

    // q̈ = M⁻¹ Q, then semi-implicit Euler.
    const Mi = this.Minv;
    for (let r = 0; r < N; r++) {
      let acc = 0;
      const row = r * N;
      for (let cI = 0; cI < N; cI++) acc += Mi[row + cI] * Q[cI];
      this.a[r] = acc;
    }
    for (let r = 0; r < N; r++) {
      v[r] += this.a[r] * h;
      q[r] += v[r] * h;
    }

    // Hysteresis, damage and failure per storey.
    let firstFailed = -1;
    for (let j = 0; j < n; j++) {
      const st = this.storeys[j];
      const d = q[j] - (j > 0 ? q[j - 1] : 0);
      const dd = d - this.dPrev[j];
      this.dPrev[j] = d;
      const z = this.zr[j];
      const ehn = this.eh[j] / (this.fy[j] * this.dy[j]);
      const eta = Math.min(3, 1 + 0.06 * ehn);
      const beta = 0.55;
      const gamma = 0.45;
      const dz = ((dd / this.dy[j]) * (1 - z * z * (beta * Math.sign(dd * z) + gamma))) / eta;
      const zn = Math.max(-1, Math.min(1, z + dz));
      // Dissipated energy: hysteretic work minus what the spring still stores.
      const work = (1 - this.mat.alpha) * this.fy[j] * ((z + zn) / 2) * dd;
      const stored = (a: number) => ((1 - this.mat.alpha) * this.fy[j] * this.dy[j] * a * a) / 2;
      this.eh[j] = Math.max(0, this.eh[j] + work - (stored(zn) - stored(z)));
      this.zr[j] = zn;
      st.drift = d;
      st.z = zn;
      st.peak = Math.max(st.peak, Math.abs(d));
      const D = st.peak / this.du[j] + (this.mat.betaPA * this.eh[j]) / (this.fy[j] * this.du[j]);
      st.damage = Math.max(st.damage, D);
      const t = Math.min(1, Math.max(0, (st.damage - 0.35) / 0.65));
      st.strength = Math.max(0.04, 1 - this.mat.soften * t * t * (3 - 2 * t));
      if (!st.failed && (st.damage >= 1 || Math.abs(d) > 0.12 * STOREY_H)) {
        st.failed = true;
        if (firstFailed < 0) firstFailed = j;
      }
    }

    // Settlement and tilt while the ground has lost strength.
    if (this.ru > 0.05) {
      const bearing = wTotal / (PLAN.B * PLAN.D) / 1e5; // ×100 kPa
      const rate = 0.02 * this.ru * this.ru * bearing * Math.min(1.5, Math.abs(vg) / 0.2 + 0.1);
      this.settlement += rate * h;
      this.tiltPerm += ((this.tiltBias * rate) / PLAN.B) * 2 * h;
    }

    if (firstFailed >= 0) this.release(firstFailed);
    for (let r = 0; r < N; r++) if (!Number.isFinite(q[r]) || !Number.isFinite(v[r])) this.unstable = true;
  }

  /** Storey j (0-based) failed: everything above it loses support. */
  private release(j: number) {
    if (j >= this.active) return;
    const n = this.active;
    const offsets: number[] = [];
    const velocities: number[] = [];
    for (let f = j + 1; f <= n; f++) {
      offsets.push(this.floorOffset(f));
      velocities.push(this.v[n] + Building.height(f) * this.v[n + 1] + this.v[f - 1]);
    }
    this.releases.push({ from: j + 1, time: this.time, offsets, velocities, tilt: this.rocking });
    const keep = j; // floors below the failed storey stay in the model
    // Keep foundation DOFs; drop the released floors.
    const qb = this.q[n];
    const qt = this.q[n + 1];
    const vb = this.v[n];
    const vt = this.v[n + 1];
    this.active = keep;
    this.q[keep] = qb;
    this.q[keep + 1] = qt;
    this.v[keep] = vb;
    this.v[keep + 1] = vt;
    for (let r = keep + 2; r < n + 2; r++) {
      this.q[r] = 0;
      this.v[r] = 0;
    }
    this.assemble();
  }

  /** Worst storey now: index (1-based), drift ratio, damage. */
  summary() {
    let worst = 0;
    let ratio = 0;
    let peakRatio = 0;
    let peakAt = 0;
    let damage = 0;
    for (let j = 0; j < this.n; j++) {
      const st = this.storeys[j];
      const r = Math.abs(st.drift) / STOREY_H;
      if (j < this.active && r > ratio) {
        ratio = r;
        worst = j + 1;
      }
      const pr = st.peak / STOREY_H;
      if (pr > peakRatio) {
        peakRatio = pr;
        peakAt = j + 1;
      }
      damage = Math.max(damage, st.damage);
    }
    return { worst, ratio, peakRatio, peakAt, damage, state: damageState(damage) };
  }
}

function hashInput(b: BuildingInput) {
  const s = `${b.structure}|${b.floors}|${b.age}|${b.shearWall}|${b.soil}|${b.liquefaction}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Fundamental circular frequency of a fixed-base shear building (inverse iteration). */
function fundamental(m: Float64Array, k: Float64Array) {
  const n = m.length;
  let x = new Float64Array(n).fill(1);
  let lambda = 0;
  for (let it = 0; it < 60; it++) {
    // Solve K y = M x (tridiagonal K).
    const rhs = x.map((xi, i) => m[i] * xi);
    const y = solveShear(k, rhs);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += y[i] * m[i] * x[i];
      den += y[i] * m[i] * y[i];
    }
    lambda = num / den;
    const norm = Math.sqrt(den);
    x = y.map((v) => v / norm);
  }
  return Math.sqrt(lambda);
}

/** Solves K y = r for a shear building's tridiagonal stiffness matrix. */
function solveShear(k: Float64Array, r: Float64Array) {
  const n = k.length;
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    b[i] = k[i] + (i + 1 < n ? k[i + 1] : 0);
    if (i > 0) a[i] = -k[i];
    if (i + 1 < n) c[i] = -k[i + 1];
  }
  const cp = new Float64Array(n);
  const dp = new Float64Array(n);
  cp[0] = c[0] / b[0];
  dp[0] = r[0] / b[0];
  for (let i = 1; i < n; i++) {
    const den = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / den;
    dp[i] = (r[i] - a[i] * dp[i - 1]) / den;
  }
  const y = new Float64Array(n);
  y[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) y[i] = dp[i] - cp[i] * y[i + 1];
  return y;
}

/** Gauss–Jordan inverse of a small dense matrix. */
function invert(M: Float64Array, n: number) {
  const A = Float64Array.from(M);
  const I = new Float64Array(n * n);
  for (let i = 0; i < n; i++) I[i * n + i] = 1;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r * n + col]) > Math.abs(A[piv * n + col])) piv = r;
    if (piv !== col) {
      for (let cI = 0; cI < n; cI++) {
        [A[col * n + cI], A[piv * n + cI]] = [A[piv * n + cI], A[col * n + cI]];
        [I[col * n + cI], I[piv * n + cI]] = [I[piv * n + cI], I[col * n + cI]];
      }
    }
    const p = A[col * n + col];
    for (let cI = 0; cI < n; cI++) {
      A[col * n + cI] /= p;
      I[col * n + cI] /= p;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r * n + col];
      if (f === 0) continue;
      for (let cI = 0; cI < n; cI++) {
        A[r * n + cI] -= f * A[col * n + cI];
        I[r * n + cI] -= f * I[col * n + cI];
      }
    }
  }
  return I;
}
