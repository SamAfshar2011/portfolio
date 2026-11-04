export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a));
export const mapRange = (v: number, a: number, b: number, c: number, d: number) => lerp(c, d, invLerp(a, b, v));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/**
 * Semi-implicit spring integrator. Used for everything that should feel like
 * it has mass: the stage objects, the cursor, magnetic controls.
 */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  constructor(
    value = 0,
    public stiffness = 120,
    public damping = 18,
  ) {
    this.value = value;
    this.target = value;
  }
  step(dt: number) {
    // Sub-step large frames so the spring never explodes after a tab switch.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = Math.min(dt, 0.1) / steps;
    for (let i = 0; i < steps; i++) {
      const force = (this.target - this.value) * this.stiffness - this.velocity * this.damping;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  snap(v = this.target) {
    this.value = this.target = v;
    this.velocity = 0;
  }
  get settled() {
    return Math.abs(this.target - this.value) < 1e-4 && Math.abs(this.velocity) < 1e-4;
  }
}

/** Deterministic PRNG (mulberry32) for anything that must look random but stay stable. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
