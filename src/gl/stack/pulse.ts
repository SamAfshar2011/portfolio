/**
 * The seismic pulse behind ANKA's hero sculpture: the steady-state response
 * of a five-storey shear building to one ground impulse per cycle.
 *
 * The ground acceleration is a Ricker wavelet, so the ground's displacement
 * is a single smooth shove and return (a Gaussian). The building is a lumped
 * shear model (equal storeys, a slightly lighter roof) with Rayleigh damping,
 * integrated with RK4. Simulating several cycles and keeping the last gives a
 * periodic solution: the loop has no seam. Upper floors answer late and swing
 * furthest, the motion decays, and the building comes to rest before the next
 * impulse — the same story ANKA's simulator tells, in miniature.
 *
 * Everything is normalised: `ground` peaks at 1, and floor displacements are
 * relative to the ground, in the same units. Formations scale them.
 */
export const PULSE_PERIOD = 9;
/** When the ground shove peaks within a cycle (s). */
export const PULSE_AT = 0.7;
const RATE = 120;
const STOREYS = 5;
const SAMPLES = Math.round(PULSE_PERIOD * RATE);

const RICKER_HZ = 1.5;
const A = Math.PI * Math.PI * RICKER_HZ * RICKER_HZ;
/** Ground displacement for a unit peak: x_g = -exp(-a τ²); its acceleration is a Ricker wavelet. */
const groundAt = (t: number) => -Math.exp(-A * (t - PULSE_AT) ** 2);
/** d²x_g/dt² for the same pulse. */
const groundAccAt = (t: number) => {
  const tau = t - PULSE_AT;
  return 2 * A * (1 - 2 * A * tau * tau) * Math.exp(-A * tau * tau);
};

function simulate() {
  const m = [1, 1, 1, 1, 0.85];
  // Storey stiffness for a fundamental period of about 1.4 s.
  const w1target = (2 * Math.PI) / 1.4;
  const k = (w1target / (2 * Math.sin(Math.PI / (2 * (2 * STOREYS + 1))))) ** 2;
  const w = (j: number) => 2 * Math.sqrt(k) * Math.sin(((2 * j - 1) * Math.PI) / (2 * (2 * STOREYS + 1)));
  // Rayleigh damping, 12% of critical at the first and third modes: generous
  // (real frames are nearer 5%), so the motion settles within the cycle.
  const zeta = 0.12;
  const w1 = w(1);
  const w3 = w(3);
  const a0 = (2 * zeta * w1 * w3) / (w1 + w3);
  const a1 = (2 * zeta) / (w1 + w3);

  const storeyForce = (u: Float64Array, out: Float64Array) => {
    for (let i = 0; i < STOREYS; i++) {
      const below = i > 0 ? u[i] - u[i - 1] : u[i];
      const above = i < STOREYS - 1 ? u[i + 1] - u[i] : 0;
      out[i] = k * (below - above);
    }
  };
  const ku = new Float64Array(STOREYS);
  const kv = new Float64Array(STOREYS);
  const deriv = (t: number, u: Float64Array, v: Float64Array, du: Float64Array, dv: Float64Array) => {
    storeyForce(u, ku);
    storeyForce(v, kv);
    const ag = groundAccAt(t % PULSE_PERIOD);
    for (let i = 0; i < STOREYS; i++) {
      du[i] = v[i];
      dv[i] = (-(a0 * m[i] * v[i] + a1 * kv[i]) - ku[i]) / m[i] - ag;
    }
  };

  const u = new Float64Array(STOREYS);
  const v = new Float64Array(STOREYS);
  const k1 = [new Float64Array(STOREYS), new Float64Array(STOREYS)];
  const k2 = [new Float64Array(STOREYS), new Float64Array(STOREYS)];
  const k3 = [new Float64Array(STOREYS), new Float64Array(STOREYS)];
  const k4 = [new Float64Array(STOREYS), new Float64Array(STOREYS)];
  const tu = new Float64Array(STOREYS);
  const tv = new Float64Array(STOREYS);
  const sub = 8; // integration steps per sample
  const h = 1 / (RATE * sub);
  const cycles = 6;
  const floors = new Float32Array(SAMPLES * STOREYS);
  let t = 0;
  for (let c = 0; c < cycles; c++) {
    for (let s = 0; s < SAMPLES; s++) {
      if (c === cycles - 1) for (let i = 0; i < STOREYS; i++) floors[s * STOREYS + i] = u[i];
      for (let q = 0; q < sub; q++) {
        deriv(t, u, v, k1[0], k1[1]);
        for (let i = 0; i < STOREYS; i++) (tu[i] = u[i] + (h / 2) * k1[0][i]), (tv[i] = v[i] + (h / 2) * k1[1][i]);
        deriv(t + h / 2, tu, tv, k2[0], k2[1]);
        for (let i = 0; i < STOREYS; i++) (tu[i] = u[i] + (h / 2) * k2[0][i]), (tv[i] = v[i] + (h / 2) * k2[1][i]);
        deriv(t + h / 2, tu, tv, k3[0], k3[1]);
        for (let i = 0; i < STOREYS; i++) (tu[i] = u[i] + h * k3[0][i]), (tv[i] = v[i] + h * k3[1][i]);
        deriv(t + h, tu, tv, k4[0], k4[1]);
        for (let i = 0; i < STOREYS; i++) {
          u[i] += (h / 6) * (k1[0][i] + 2 * k2[0][i] + 2 * k3[0][i] + k4[0][i]);
          v[i] += (h / 6) * (k1[1][i] + 2 * k2[1][i] + 2 * k3[1][i] + k4[1][i]);
        }
        t += h;
      }
    }
  }
  // Peak storey drift per storey, to normalise the strain glow.
  const drift = new Float32Array(STOREYS);
  for (let s = 0; s < SAMPLES; s++)
    for (let i = 0; i < STOREYS; i++) {
      const d = Math.abs(floors[s * STOREYS + i] - (i > 0 ? floors[s * STOREYS + i - 1] : 0));
      if (d > drift[i]) drift[i] = d;
    }
  let roof = 0;
  for (let s = 0; s < SAMPLES; s++) roof = Math.max(roof, Math.abs(floors[s * STOREYS + STOREYS - 1]));
  return { floors, drift, roof };
}

let table: ReturnType<typeof simulate> | null = null;

export interface PulseState {
  /** Ground displacement (peak magnitude 1). */
  ground: number;
  /** 0..1 how hard the ground is moving right now (for the foundation's glow). */
  shove: number;
  /** Floor displacements relative to the ground, floors 1..5. */
  floors: number[];
  /** 0..1 storey drift relative to its own peak, storeys 1..5. */
  strain: number[];
  /** Roof displacement relative to its peak (signed). */
  roof: number;
}

/** The pulse at time `t` within the cycle (wraps). Allocates nothing after the first call. */
export function pulseAt(t: number, out: PulseState) {
  table ??= simulate();
  const p = ((t % PULSE_PERIOD) + PULSE_PERIOD) % PULSE_PERIOD;
  const f = p * RATE;
  const s0 = Math.floor(f) % SAMPLES;
  const s1 = (s0 + 1) % SAMPLES;
  const w = f - Math.floor(f);
  const { floors, drift, roof } = table;
  for (let i = 0; i < STOREYS; i++) {
    const a = floors[s0 * STOREYS + i];
    const b = floors[s1 * STOREYS + i];
    out.floors[i] = a + (b - a) * w;
  }
  for (let i = 0; i < STOREYS; i++) out.strain[i] = Math.min(1, Math.abs(out.floors[i] - (i > 0 ? out.floors[i - 1] : 0)) / drift[i]);
  out.roof = out.floors[STOREYS - 1] / roof;
  out.ground = groundAt(p);
  const tau = p - PULSE_AT;
  // Ground speed, normalised to its peak (at τ = ±1/√(2a)).
  const speed = Math.abs(2 * A * tau * Math.exp(-A * tau * tau));
  out.shove = speed / (2 * A * Math.sqrt(1 / (2 * A)) * Math.exp(-0.5));
  return out;
}

export const createPulseState = (): PulseState => ({ ground: 0, shove: 0, floors: [0, 0, 0, 0, 0], strain: [0, 0, 0, 0, 0], roof: 0 });

/** Peak roof displacement relative to the ground, per unit of ground displacement. */
export function roofGain() {
  table ??= simulate();
  return table.roof;
}
