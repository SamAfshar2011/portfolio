// Sweeps every formation across its parameters (story position, opening
// progress, pointer, scroll velocity, time) and checks each pair of slabs for
// overlap: an oriented-box separating-axis test first, then, where the boxes
// touch, the exact signed distance of the rounded slab shapes.
//
//   npm run qa:slabs
import { evaluate, SLAB_COUNT, type FormationContext, type SlabTarget } from '../../src/gl/stack/formations';

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function axesFromEuler(x: number, y: number, z: number): V[] {
  // three.js Euler XYZ: R = Rx * Ry * Rz
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const m = [
    [c * e, -c * f, d],
    [af + be * d, ae - bf * d, -b * c],
    [bf - ae * d, be + af * d, a * c],
  ];
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

interface Box { c: V; ax: V[]; h: V; r: number; vis: boolean; pts?: V[] }
function box(t: SlabTarget): Box {
  const r = Math.min(t.radius, t.sx, t.sy);
  let ax = axesFromEuler(t.rx, t.ry, t.rz);
  if (t.pitch) {
    // R = R_euler · R_y(pitch): local x and z axes turn about local y.
    const c = Math.cos(t.pitch), s = Math.sin(t.pitch);
    const X = ax[0], Z = ax[2];
    ax = [[X[0] * c - Z[0] * s, X[1] * c - Z[1] * s, X[2] * c - Z[2] * s], ax[1], [X[0] * s + Z[0] * c, X[1] * s + Z[1] * c, X[2] * s + Z[2] * c]];
  }
  return { c: [t.x, t.y, t.z], ax, h: [t.sx, t.sy, t.sz], r, vis: t.presence > 0.02 };
}
/** Exact SDF of a rounded-rectangle prism (the slab without its edge bevel). */
function sdf(B: Box, p: V) {
  const d = sub(p, B.c);
  const lx = dot(d, B.ax[0]), ly = dot(d, B.ax[1]), lz = dot(d, B.ax[2]);
  const qx = Math.abs(lx) - (B.h[0] - B.r), qy = Math.abs(ly) - (B.h[1] - B.r);
  const d2 = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - B.r;
  const wz = Math.abs(lz) - B.h[2];
  return Math.min(Math.max(d2, wz), 0) + Math.hypot(Math.max(d2, 0), Math.max(wz, 0));
}
function surface(B: Box): V[] {
  if (B.pts) return B.pts;
  const pts: V[] = [];
  const [hx, hy, hz] = B.h;
  const r = B.r;
  const put = (x: number, y: number, z: number) =>
    pts.push([0, 1, 2].map((k) => B.c[k] + B.ax[0][k] * x + B.ax[1][k] * y + B.ax[2][k] * z) as V);
  // outline (rounded rectangle) on both faces and the mid-plane
  const seg = 96;
  const per = [hx - r, hy - r];
  for (let s = 0; s < seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    const cx = Math.cos(a), cy = Math.sin(a);
    // walk the rounded rect: corner centre + radius direction, plus straight runs
    for (const tt of [0, 0.5]) {
      const x = Math.sign(cx) * per[0] * (tt ? 1 - Math.abs(cy) : 1) + cx * r;
      const y = Math.sign(cy) * per[1] * (tt ? 1 - Math.abs(cx) : 1) + cy * r;
      for (const z of [-hz, 0, hz]) put(x, y, z);
    }
  }
  const g = 10;
  for (let a = 0; a <= g; a++) for (let b = 0; b <= g; b++) {
    const x = (a / g - 0.5) * 2 * (hx - r * 0.3), y = (b / g - 0.5) * 2 * (hy - r * 0.3);
    put(x, y, hz); put(x, y, -hz);
  }
  B.pts = pts;
  return pts;
}
/** Separation along the best axis (>0 separated, <0 penetration depth). */
function separation(A: Box, B: Box) {
  const axes: V[] = [...A.ax, ...B.ax];
  for (const a of A.ax) for (const b of B.ax) {
    const cr = cross(a, b);
    const l = Math.hypot(...cr);
    if (l > 1e-6) axes.push([cr[0] / l, cr[1] / l, cr[2] / l]);
  }
  const T = sub(B.c, A.c);
  let best = -Infinity;
  for (const L of axes) {
    const ra = A.h.reduce((s, h, i) => s + h * Math.abs(dot(A.ax[i], L)), 0);
    const rb = B.h.reduce((s, h, i) => s + h * Math.abs(dot(B.ax[i], L)), 0);
    best = Math.max(best, Math.abs(dot(T, L)) - ra - rb);
  }
  return best;
}

const baseCtx = (): FormationContext => ({
  t: 0, px: 0, py: 0, energy: 0, portrait: false, story: 0, storyVel: 0, beats: 5,
  intro: { arrive: 1, orbit: 0, ready: 1, unwrap: 0 },
  etchRows: { story: 0, plate: 5 },
  camZ: 12,
  plateFocus: -1,
  age: 0,
  reduced: false,
});

function sweep(label: string, id: Parameters<typeof evaluate>[0], ctxs: Iterable<[string, FormationContext]>) {
  const n = SLAB_COUNT;
  const t: SlabTarget[] = Array.from({ length: n }, () => ({}) as SlabTarget);
  let worst = Infinity, worstAt = '';
  let hits = 0, samples = 0;
  for (const [tag, c] of ctxs) {
    samples++;
    for (let i = 0; i < n; i++) evaluate(id, i, n, c, t[i]);
    const boxes = t.map(box);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (!boxes[i].vis || !boxes[j].vis) continue;
      let s = separation(boxes[i], boxes[j]);
      if (s < 0.01) {
        // Boxes touch: measure the rounded shapes instead.
        let m = Infinity;
        for (const p of surface(boxes[i])) m = Math.min(m, sdf(boxes[j], p));
        for (const p of surface(boxes[j])) m = Math.min(m, sdf(boxes[i], p));
        s = m;
      }
      if (s < worst) { worst = s; worstAt = `${tag} slabs ${i}/${j}`; }
      if (s < 0) hits++;
    }
  }
  console.log(`${label.padEnd(34)} samples ${String(samples).padStart(6)}  overlaps ${String(hits).padStart(5)}  min separation ${worst.toFixed(4)}  @ ${worstAt}`);
}

const args = process.argv.slice(2);
for (const portrait of [false, true]) {
  // Composite formations must stay intact at every pointer position.
  for (const id of ['plate', 'monolith'] as const) {
    sweep(`${id} ${portrait ? 'portrait' : 'landscape'}`, id, (function* () {
      for (let px = -1; px <= 1.001; px += 0.1) for (let py = -1; py <= 1.001; py += 0.25) for (const time of [0, 0.7, 1.9, 3.3, 60, 600]) for (const focus of [-1, 3, 7]) {
        const c = baseCtx(); c.portrait = portrait; c.px = px; c.py = py; c.t = time; c.plateFocus = focus;
        yield [`px=${px.toFixed(1)} py=${py} t=${time} focus=${focus}`, c];
      }
    })());
  }
  const P = portrait ? 'portrait' : 'landscape';
  // Time-driven formations: the arrival, then several cycles, at pointer extremes.
  for (const id of ['horizon', 'building'] as const) {
    for (const energy of [0, 0.5, 1]) {
      sweep(`${id} e=${energy} ${P}`, id, (function* () {
        for (let age = 0; age < 45; age += 0.02) for (const px of [-1, 0, 1]) for (const py of [-1, 1]) {
          const c = baseCtx(); c.portrait = portrait; c.px = px; c.py = py; c.age = age; c.t = age + 3.1; c.energy = energy;
          yield [`age=${age.toFixed(2)} px=${px} py=${py}`, c];
        }
      })());
    }
    const c = baseCtx(); c.portrait = portrait; c.reduced = true;
    sweep(`${id} reduced ${P}`, id, [['reduced', c]]);
  }
  // Story: every position, pointer extremes, velocity extremes, idle phases.
  sweep(`fan ${P}`, 'fan', (function* () {
    for (let s = 0; s <= 4; s += 0.0025)
      for (const px of [-1, 0, 1]) for (const vel of [-8, 0, 8]) for (const time of [0, 1.3, 2.9]) {
        const c = baseCtx(); c.portrait = portrait; c.story = s; c.px = px; c.storyVel = vel; c.t = time;
        yield [`s=${s.toFixed(4)} px=${px} v=${vel} t=${time}`, c];
      }
  })());
  sweep(`stack ${P}`, 'stack', (function* () {
    for (const px of [-1, -0.5, 0, 0.5, 1]) for (const py of [-1, 0, 1]) for (let time = 0; time < 20; time += 0.37) {
      const c = baseCtx(); c.portrait = portrait; c.px = px; c.py = py; c.t = time;
      yield [`px=${px} py=${py} t=${time.toFixed(2)}`, c];
    }
  })());
  sweep(`awaken arrival ${P}`, 'awaken', (function* () {
    // The array turns while bars arrive (orbit advances with time).
    for (const dur of [3.2, 1.3]) for (let a = 0; a <= 1; a += 0.0015) for (const w of [0.55, 0.9]) for (const time of [0, 0.8]) {
      const c = baseCtx(); c.portrait = portrait; c.camZ = portrait ? 15 : 12; c.intro = { arrive: a, orbit: w * a * dur, ready: a * 0.8, unwrap: 0 }; c.t = time + a * dur;
      yield [`dur=${dur} arrive=${a.toFixed(4)} w=${w}`, c];
    }
  })());
  sweep(`awaken unwrap ${P}`, 'awaken', (function* () {
    for (let u = 0; u <= 1; u += 0.001) for (const orbit of [0, 0.4, 1.3, 2.2, 3.9, 17.3]) for (const px of [-1, 0, 1]) for (const time of [0, 0.8]) {
      const c = baseCtx(); c.portrait = portrait; c.px = px; c.t = time; c.intro = { arrive: 1, orbit: orbit + u * 1.5, ready: 1, unwrap: u };
      yield [`unwrap=${u.toFixed(3)} orbit=${orbit} px=${px}`, c];
    }
  })());
}
