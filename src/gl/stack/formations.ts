import type { FormationId } from '../../experience/director';
import { createPulseState, pulseAt } from './pulse';

/**
 * Formations: the shapes the slab stack can take. Each is a pure function of
 * slab index and time, evaluated every frame; springs in Stack.ts chase the
 * result, so switching formation is always a physical morph, never a cut.
 *
 * Every formation comes from a real structure in Sam's work:
 *   awaken   — the opening: glass arrives, orbits as a radial array while the
 *              site loads, then unwinds into the hero sculpture
 *   stack    — layers: the hero sculpture
 *   fan      — the story: a row of moments, one presented at a time
 *   horizon  — Fiscora: a ribbon of observations that organises itself and
 *              opens into a widening forecast
 *   building — ANKA: a structural skeleton answering a ground pulse
 *   plate    — PlateHunter: eight character tiles on a plate
 *   monolith — many layers pressed into one object (the company)
 *   drift    — loose pieces before they are assembled
 *   python   — a small helix; an easter egg for 2024
 *
 * `awaken`, `fan`, `horizon` and `building` are kinematic: their poses are
 * exact functions of a continuous parameter (load progress, scroll progress,
 * time), designed so no two slabs ever occupy the same space. Stack.ts follows them without springs
 * once a slab has arrived, so the guarantee holds on screen too.
 */
export const SLAB_COUNT = 12;

export interface SlabTarget {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  /** Half extents: face width, face height, thickness. */
  sx: number;
  sy: number;
  sz: number;
  radius: number;
  glow: number;
  presence: number;
  /** Visibility (0..1) of the glyph etched inside the glass. */
  etch: number;
  /** Which glyph is etched (row of the etch atlas); -1 = none. */
  etchIndex: number;
  /** 0 = a small label along the bottom edge, 1 = one large centred glyph. */
  etchStyle: number;
  /**
   * Rotation about the slab's own long (y) axis, applied before the Euler
   * rotation — the blade pitch of the opening's turbine.
   */
  pitch: number;
  /** Colour of the glow: 0 = the room's second accent, 1 = its main accent. */
  hue: number;
}

export interface IntroState {
  /** 0..1 arrival of the glass from the viewer's side of the lens. */
  arrive: number;
  /** Accumulated rotation of the radial array (radians). */
  orbit: number;
  /** 0..1 real readiness of the site (fonts, renderer, pipelines…). */
  ready: number;
  /** 0..1 the array unwinding into the hero stack. */
  unwrap: number;
}

export interface FormationContext {
  t: number;
  /** Smoothed pointer, -1..1. */
  px: number;
  py: number;
  energy: number;
  portrait: boolean;
  /** Continuous story position: 0 = first beat, 1 = second… */
  story: number;
  /** Story velocity (beats per second), for secondary motion. */
  storyVel: number;
  /** Number of story beats (slabs 0..beats-1 carry them). */
  beats: number;
  /** Camera distance in the stack's own units (the opening starts at the lens). */
  camZ: number;
  intro: IntroState;
  /** First row of each etched group in the etch atlas (-1 = not loaded yet). */
  etchRows: { story: number; plate: number };
  /** A plate chamber singled out (the matching crop is hovered); -1 = none. */
  plateFocus: number;
  /** Seconds since the stack was asked for its current formation (entrances). */
  age: number;
  /** prefers-reduced-motion: formations hold a calm, legible pose. */
  reduced: boolean;
}

type Formation = (i: number, n: number, c: FormationContext, o: SlabTarget) => void;

/** Formations whose poses are followed exactly (see header). */
export const KINEMATIC: ReadonlySet<FormationId> = new Set<FormationId>(['fan', 'awaken', 'horizon', 'building']);

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;
/** How far horizontal slabs lean toward the camera so their faces read. */
const VIEW_TILT = 0.24;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ss = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Wraps an angle into (-π, π]. */
const wrap = (a: number) => a - TAU * Math.round(a / TAU);

function reset(o: SlabTarget) {
  o.x = o.y = o.z = o.rx = o.ry = o.rz = 0;
  o.sx = 1;
  o.sy = 0.8;
  o.sz = 0.05;
  o.radius = 0.2;
  o.glow = 0;
  o.presence = 1;
  o.etch = 0;
  o.etchIndex = -1;
  o.etchStyle = 0;
  o.pitch = 0;
  o.hue = 0;
}

/**
 * Turns a formation's slab poses as one rigid body: positions are rotated
 * about the formation's origin as well as the slabs themselves, so a
 * composite object (a plate, a gauge) tilts as a whole instead of each part
 * pivoting on its own centre and swinging through its neighbours.
 * Same convention as three.js Euler XYZ with rz = 0: R = Rx(rx) · Ry(ry).
 */
function rigid(o: SlabTarget, rx: number, ry: number) {
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  // Ry, then Rx.
  const x1 = o.x * cy + o.z * sy;
  const z1 = -o.x * sy + o.z * cy;
  const y2 = o.y * cx - z1 * sx;
  const z2 = o.y * sx + z1 * cx;
  o.x = x1;
  o.y = y2;
  o.z = z2;
  o.rx = rx;
  o.ry = ry;
}

const stack: Formation = (i, n, c, o) => {
  const k = i - (n - 1) / 2;
  const u = i / (n - 1);
  const breathe = Math.sin(c.t * 0.55 + i * 0.45) * 0.012;
  o.y = k * 0.2 + breathe * (k + 0.5);
  o.rx = -HALF_PI + VIEW_TILT + c.py * 0.05;
  o.ry = 0.62 + c.px * 0.08;
  // A gentle helix: each plate turns within its own plane, so the plates
  // stay parallel and never touch; the pointer winds it tighter or looser.
  o.rz = k * 0.045 + c.px * 0.3 * (u - 0.5) * 2 + Math.sin(c.t * 0.3 + i * 0.2) * 0.012;
  o.sx = c.portrait ? 1.0 : 1.12;
  o.sy = c.portrait ? 0.8 : 1.02;
  o.sz = 0.055;
  o.radius = 0.28;
  o.presence = 1;
};

/* ------------------------------------------------------------------ awaken
 * The opening. The screen starts almost empty. Then twelve bars of glass come
 * through it from the visitor's side: each one starts behind the lens, passes
 * it face-on — briefly filling the view, like a pane carried past your eyes —
 * and rushes away into depth, decelerating, while it spirals out to its slot.
 * They arrive in order round the dial; the array is already turning, so each
 * bar is aimed a little behind its moving slot and carried into it, arriving
 * with the array's own angular velocity. Only when most have arrived does the
 * radial structure read. It orbits (slowing, breathing, each bar precessing a
 * little) while the site gets ready, then unwinds:
 *
 *   A  the aperture opens a little and tips back until it lies flat
 *   B  the ring stretches upward into a helix, bar by bar
 *   C  the bars spiral in toward the axis, broaden into plates, and lock
 *      into the hero stack
 *
 * Arrivals are separated in depth and angle; in A every bar turns with the
 * same rigid rotation; in B and C every bar sits at its own height. No two
 * bars ever cross (checked numerically: npm run qa:slabs).
 */
export function ringLayout(c: Pick<FormationContext, 'portrait'>) {
  return c.portrait
    ? { R: 0.86, len: 0.24, wid: 0.062, thick: 0.032 }
    : { R: 0.92, len: 0.26, wid: 0.068, thick: 0.034 };
}

/** Angle of bar i in the array (clockwise from twelve o'clock). */
const barAngle = (i: number, n: number) => (i / n) * TAU;
/**
 * Launch schedule, as shares of the whole arrival. The first bar comes alone
 * and takes its time — it sets the plane the others join; the rest follow at
 * an even beat.
 */
const FIRST_FLIGHT = 0.44;
const launchAt = (i: number, n: number) => (i === 0 ? 0 : 0.13 + ((i - 1) * (0.87 - 0.34)) / Math.max(1, n - 2));
const flightOf = (i: number) => (i === 0 ? FIRST_FLIGHT : 0.34);
/** Progress (0..1) of bar i's flight at a given arrival progress. */
export const arrivalOf = (i: number, n: number, arrive: number) => clamp01((arrive - launchAt(i, n)) / flightOf(i));
/** Tilt of the array (back from the viewer) and its blades' pitch. */
const RING_TILT = -0.5;
const BLADE_PITCH = 0.85;

const awaken: Formation = (i, n, c, o) => {
  const I = c.intro;
  const L = ringLayout(c);
  const ua = arrivalOf(i, n, I.arrive);

  // --- arrival ---------------------------------------------------------------
  // The first bars pass right at the lens; later ones a little wider and quicker.
  const reach = Math.min(1, i / 6);
  const r0 = 0.04 + 0.3 * reach;
  // Depth: distance from the lens grows geometrically (so perceived size
  // changes evenly): it hangs at the glass for a moment, is pushed through
  // into the scene, and glides the last stretch into its slot.
  const d0 = 0.42 + 0.9 * reach;
  const fz = 0.6 * ua * ua * ua * (10 - 15 * ua + 6 * ua * ua) + 0.4 * (1 - Math.pow(1 - ua, 3));
  const dist = d0 * Math.pow(c.camZ / d0, fz);
  // Radius: out to the ring, with a small, damped overshoot as it is caught.
  const er = ss(0.1, 0.92, ua);
  const caught = clamp01((ua - 0.62) / 0.38);
  const overshoot = Math.sin(Math.PI * caught) * (1 - caught) * 0.1;
  // Angle: aimed behind its moving slot, carried into it by the array.
  const lag = (1 - ss(0.05, 0.96, ua)) * 1.05;
  const turn = 1 - ss(0.12, 1, ua); // remaining spin from the throw

  // Ring radius: tightens slightly as the site gets ready, and breathes.
  const Rr = L.R * (1 - 0.035 * I.ready) * (1 + 0.01 * Math.sin(c.t * 1.15));

  // --- unwinding (see above) --------------------------------------------------
  const U = I.unwrap;
  const tOpen = ss(0, 0.22, U) * (1 - ss(0.46, 0.7, U));
  const tA = ss(0.04, 0.36, U);
  const tB = ss(0.2 + (i / n) * 0.12, 0.6 + (i / n) * 0.12, U);
  const tR = ss(0.46, 0.86, U);
  const tS = ss(0.46, 0.9, U);
  const tY = ss(0.58, 1, U);
  const tG = ss(0.64, 1, U);

  const a = barAngle(i, n) + I.orbit - lag;
  const r = (r0 + (Rr - r0) * er + L.R * overshoot) * (1 + 0.16 * tOpen);
  // A little precession per bar keeps the array from reading as a flat icon.
  const prec = Math.sin(c.t * 1.3 + i * 0.9) * 0.06 * caught;

  const target = o;
  stack(i, n, c, target);
  const ty = target.y;
  const trx = target.rx;
  const tRy = target.ry;
  const tRz = target.rz;
  const tsx = target.sx;
  const tsy = target.sy;
  const tsz = target.sz;
  const tr = target.radius;

  // Tip the ring plane back (a rotation about x), shared by every bar; while
  // it orbits the whole array nods very slowly, like a gyroscope settling.
  const nod = Math.sin(c.t * 0.7) * 0.05 * (1 - tA);
  const alpha = lerp(RING_TILT + nod, -(HALF_PI - VIEW_TILT), tA);
  const rr = r * (1 - tR);
  const px = Math.sin(a) * rr;
  const py = Math.cos(a) * rr;
  o.x = px;
  o.y = py * Math.cos(alpha) + ty * tB;
  // Depth: from the lens (camZ) to the ring plane.
  o.z = py * Math.sin(alpha) + (c.camZ - dist);
  // Euler order is x, y, z: spin within the ring plane (z), lean (y), tip (x).
  // Thrown bars start face-on to the viewer, turned over; they shed that spin
  // on the way in. Because the in-plane spin is about each bar's own normal,
  // the bars stay parallel while they unwind.
  const flip = (i % 2 ? 1 : -1) * Math.PI * turn * turn;
  o.rx = lerp(alpha, trx, tY) + prec * (1 - tA) + flip;
  o.ry = tRy * tY + Math.sin(c.t * 0.9 + i * 1.7) * 0.04 * caught * (1 - tA) + (i % 3 - 1) * 0.5 * turn * turn;
  // Unspin by the shortest way round, however long the array has orbited.
  o.rz = -wrap(a) * (1 - tS) + tRz * tS + (i % 2 ? -0.8 : 0.8) * turn * turn;
  o.sx = lerp(L.wid, tsx, tG);
  o.sy = lerp(L.len, tsy, tG);
  o.sz = lerp(L.thick, tsz, tG);
  o.radius = lerp(L.wid * 0.98, tr, tG);
  // Turbine blades: each bar pitched about its own radial axis, so light
  // rakes across the array differently all the way round. The pitch comes
  // with the catch and is laid flat before the bars unwind (so they are
  // parallel from stage B on).
  // A slow wave of pitch travels round the blades (two crests), so light
  // moves across the array like an iris breathing rather than a dial ticking.
  const wave = Math.sin(c.t * 1.25 - (i / n) * TAU * 2) * 0.28;
  o.pitch = (BLADE_PITCH + wave) * caught * (1 - tA);

  // A glint as each bar is caught; a faint steady light as the site gets ready.
  o.glow = (Math.sin(Math.PI * caught) * 0.55 + 0.06 * I.ready * caught) * (1 - ss(0.05, 0.45, U));
  // Each bar materialises as it crosses into the scene.
  o.presence = ss(0.0, 0.1, ua);
};

/* --------------------------------------------------------------------- fan
 * The story. Slabs stand in a row that reads left to right as time: the past
 * gathers in a stack on the left, the future waits in a stack on the right,
 * and one slab — the present beat — stands forward, square to the viewer.
 *
 * Within each side stack the slabs are parallel, so they can slide past one
 * another without touching. A hand-off is one continuous motion of the whole
 * mechanism, driven by the story position s (d = i − s):
 *
 *   incoming (0 < d < 1)  leaves the front of the future stack, steps
 *                         forward first, then turns to face the viewer
 *   outgoing (−1 < d < 0) steps back and aside first, and only turns into
 *                         the past stack once it is clear of the new one
 *
 * The incoming slab always travels in front of the outgoing one, which is
 * what keeps the pair from crossing. Scroll backwards and every pose is
 * retraced exactly. Slabs past the last beat are blank: the future.
 */
export function storyLayout(portrait: boolean) {
  return portrait
    ? { sx: 0.36, sy: 0.56, sz: 0.024, radius: 0.11, theta: 0.98, gap: 0.54, step: 0.15, forward: 0.5, recede: 0.04 }
    : { sx: 0.46, sy: 0.72, sz: 0.028, radius: 0.14, theta: 0.98, gap: 0.68, step: 0.19, forward: 0.62, recede: 0.05 };
}

const fan: Formation = (i, _n, c, o) => {
  const S = storyLayout(c.portrait);
  const d = i - c.story;
  const side = d < 0 ? -1 : 1;
  const ad = Math.abs(d);
  const idle = Math.sin(c.t * 0.6 + i * 0.5) * 0.012;

  o.sx = S.sx;
  o.sy = S.sy;
  o.sz = S.sz;
  o.radius = S.radius;
  o.rx = c.py * 0.03;

  if (ad >= 1) {
    // In a side stack: parallel, evenly stepped, receding into depth.
    const k = ad - 1;
    // Inertia: while the row travels, slabs further out trail a little,
    // compressing the stack in front of the motion.
    const lag = Math.max(-1, Math.min(1, c.storyVel / 3)) * 0.035 * Math.min(1, k);
    o.x = side * (S.gap + k * S.step) - lag;
    o.z = -S.recede * k;
    o.y = idle * 0.6;
    o.ry = -side * S.theta + c.px * 0.05;
    // The slab settling into the front of a stack gives a tiny nod.
    if (k < 1) o.ry += side * 0.07 * Math.sin(Math.PI * k) * (side > 0 ? 1 : -0.6);
    const future = i >= c.beats;
    o.presence = future ? Math.max(0, 0.62 - k * 0.06) : Math.max(0.35, 0.82 - k * 0.1);
  } else {
    const a = 1 - ad; // 0 at the stack, 1 when presented
    let fx: number;
    let fz: number;
    let fy: number;
    if (d > 0) {
      // Incoming: out of the stack and forward, then square up.
      fz = ss(0, 0.58, a);
      fx = ss(0.12, 0.95, a);
      fy = ss(0.3, 1, a);
    } else {
      // Outgoing: turn toward the past stack while still forward, then slide
      // back into it along its own face.
      fz = ss(0, 0.6, a);
      fx = ss(0.25, 1, a);
      fy = ss(0.45, 1, a);
    }
    o.x = side * S.gap * (1 - fx);
    o.z = S.forward * fz;
    o.y = 0.05 * fz + idle;
    o.ry = -side * S.theta * (1 - fy) + c.px * 0.05 * (1 - a) + c.px * 0.1 * a;
    o.presence = lerp(i >= c.beats ? 0.62 : 0.82, 1, fz);
    const grow = 1 + 0.06 * ss(0.4, 1, a);
    o.sx *= grow;
    o.sy *= grow;
    o.glow = 0.3 * ss(0.55, 1, a);
  }

  // The beat's glyph is etched inside its slab: it surfaces as the slab is
  // presented and stays faintly visible once it has joined the past.
  if (i < c.beats && c.etchRows.story >= 0) {
    o.etchIndex = c.etchRows.story + i;
    o.etch = d > 0 ? ss(0.5, 1, 1 - Math.min(1, d)) : lerp(0.3, 1, ss(0, 1, 1 - Math.min(1, -d)));
  }
};

/* ----------------------------------------------------------------- horizon
 * Fiscora: transaction history → financial context → forecast.
 *
 * Twelve tiles of glass overlap along a timeline, like a spread hand of
 * cards: each is one period, and its height on the ribbon is what was spent.
 * Seven are observations — compact, certain, lit in the room's gold — the
 * last of them "now". Five are the forecast: centred on the continuing trend
 * and as tall as its uncertainty, so past "now" the ribbon opens into a soft
 * emerald fan that widens with the horizon and fades with it.
 *
 * On arrival the observations come in raw (scattered, tilted); a reading
 * light passes along them and each one squares up onto the ribbon as it is
 * read; then the forecast unrolls out of "now", one period at a time. After
 * that it lives: a reading light passes every cycle, and time advances — the
 * whole ribbon steps back one period, the oldest observation fades away, the
 * nearest forecast collapses into a new, certain observation (landing close
 * to, not exactly on, its forecast), and a new period opens at the far end.
 *
 * Every tile keeps its own slot, a step deeper than the one before, and tiles
 * only ever turn within their own plane, so they never touch; the tile that
 * wraps from the oldest slot to the newest is invisible while it moves.
 * Checked numerically by npm run qa:slabs.
 */
const OBSERVED = 7;
const NOW_SLOT = OBSERVED - 1;
export const HORIZON_INTRO = 4.6;
export const HORIZON_CYCLE = 10;
/** A deterministic value in -1..1 for period n (and a stream k). */
const noise = (n: number, k = 0) => {
  const v = Math.sin(n * 127.1 + k * 311.7) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
};
/** The underlying pattern of spending: slow and seasonal, bounded for any n. */
const trend = (n: number) => 0.2 * Math.sin(0.52 * n + 0.4) + 0.085 * Math.sin(1.37 * n + 2.1);
/** What actually happened in period n: the pattern plus that period's own character. */
const actual = (n: number) => trend(n) + 0.055 * noise(n, 1);
/** Half-height of a forecast slice h periods ahead: uncertainty grows with the horizon. */
const band = (h: number) => 0.05 + 0.1 * Math.pow(h, 0.8);

/** Which cycle of the timeline is showing (how many periods have elapsed). */
const horizonCycle = (age: number) => (age < HORIZON_INTRO ? 0 : Math.floor((age - HORIZON_INTRO) / HORIZON_CYCLE));

/**
 * Fiscora's clock at a given age: how many periods have elapsed, where the
 * reading light is, how far the step in progress has gone, how much of the
 * forecast has unrolled. Shared with the stage, which sonifies it.
 */
export function horizonClock(age: number, reduced = false) {
  const a = reduced ? HORIZON_INTRO + HORIZON_CYCLE * 0.3 : age;
  let m = 0;
  let sigma = 0;
  let scan = -2; // reading light position, in slots
  let organise = 1; // how settled the observations are (arrival only)
  let unroll = 5; // forecast periods unrolled (0..5)
  let fresh = 1; // the newest far slice opening (0..1)
  if (a < HORIZON_INTRO) {
    scan = lerp(-1.2, OBSERVED + 0.6, ss(0.35, 2.6, a));
    organise = 0;
    unroll = ss(2.3, 4.5, a) * 5;
  } else {
    m = horizonCycle(a);
    const ph = (a - HORIZON_INTRO) / HORIZON_CYCLE - m;
    if (!reduced) {
      scan = lerp(-1.2, OBSERVED + 0.6, ss(0.08, 0.5, ph));
      sigma = ss(0.58, 0.78, ph);
      fresh = ss(0.84, 0.99, ph);
    }
  }
  return { m, sigma, scan, organise, unroll, fresh };
}

const horizon: Formation = (i, n, c, o) => {
  const reduced = c.reduced;
  const spacing = c.portrait ? 0.17 : 0.21;
  const V = 1.15; // vertical scale of the ribbon
  const { m, sigma, scan, organise, unroll, fresh } = horizonClock(c.age, reduced);

  // This slab's slot for the current cycle, and the period it shows.
  const slot0 = (((i - m) % n) + n) % n;
  const period = slot0 + m;
  // The slice leaving at the old end is the one that will open at the new end.
  const leaving = slot0 === 0 && sigma > 0;
  let slot = slot0 - sigma;
  let presence = 1;
  let ext = 1;
  if (slot0 >= OBSERVED) {
    // Forecast tiles slide out from behind "now", nearest first.
    const j = slot0 - NOW_SLOT;
    ext = clamp01(unroll - (j - 1));
    if (slot0 === n - 1 && m > 0) ext = Math.min(ext, fresh);
    slot = lerp(slot - 0.6, slot, ext);
    presence = ext;
  }
  if (leaving) presence = 1 - ss(0, 0.7, sigma);
  const h = slot - NOW_SLOT; // ≤ 0 observed, > 0 forecast
  const fc = clamp01(h); // forecast-ness (continuous through the step)

  // Settling onto the ribbon: raw (arrival) → read → organised. Only
  // observations arrive raw; the forecast is born organised.
  const read = Math.max(organise, clamp01((scan - slot) * 1.4));
  const raw = (1 - read) * (1 - fc);
  const yObserved = actual(period) + raw * 0.2 * noise(period, 2);
  const yForecast = trend(period);
  const breathe = reduced ? 0 : Math.sin(c.t * 0.8 + slot * 0.7) * 0.01;
  const y = V * lerp(yObserved, yForecast, fc) + breathe;
  const tileH = 0.24;
  const spread = band(Math.max(h, 0.001)) - band(0);
  const halfH = tileH + fc * spread * 1.5 * (1 + 0.05 * Math.sin(c.t * 0.9 + h));

  // Tiles face the viewer and overlap like a spread hand of cards: each
  // period sits a little further back, so neighbours never touch.
  const lx = (slot - (n - 1) / 2) * spacing + raw * 0.03 * noise(period, 3);
  // Depth follows the slot a tile belongs to, not where it has slid to: a
  // forecast tile emerges sideways from behind its neighbour, in its own layer.
  const lz = -(slot0 - sigma - (n - 1) / 2) * 0.07;
  const roll = raw * 0.42 * noise(period, 5);

  o.x = lx;
  o.y = y;
  o.z = lz;
  const ax = 0.05 + c.py * 0.06;
  const ay = -0.38 + c.px * 0.16;
  rigid(o, ax, ay);
  o.rz = roll;
  const isNow = Math.abs(h) < 0.5;
  const halfW = c.portrait ? 0.17 : 0.21;
  o.sx = halfW;
  o.sy = halfH * lerp(0.35, 1, ext);
  o.sz = isNow ? 0.026 : 0.02;
  o.radius = lerp(0.09, halfW * 0.85, fc);
  // Light: the reading passes as a warm glint; "now" holds a little gold; the
  // forecast keeps a soft emerald edge, brightest where it has just opened.
  const glint = Math.exp(-((slot - scan) ** 2) / 0.35);
  o.glow = (1 - fc) * (0.07 + glint * 0.9 + (isNow ? 0.36 : 0)) + fc * (0.14 + 0.2 * (1 - h / 5) + (1 - ext) * 0.4);
  o.hue = 1 - fc;
  o.presence = presence * lerp(1, 0.86 - 0.09 * h, fc);
};

/* ---------------------------------------------------------------- building
 * ANKA: a structural skeleton — a foundation mat, five floor diaphragms,
 * four corner columns, a shear wall and a spine at the back — answering a
 * ground pulse. The ground shoves and returns; the floors answer late, the
 * roof furthest, swinging back and forth less each time until the frame is
 * still again (pulse.ts: a damped shear-building model, not an animation
 * curve). Members that are working glow ember in proportion to their strain;
 * the spine keeps a faint cyan light. Columns and walls lean as one with the
 * roof's drift; they stand just outside the floor edges, so the floors can
 * move past them without touching.
 *
 *   slab 0     foundation      slabs 1–5  floors
 *   slab 6     spine           slab 7     shear wall      slabs 8–11 columns
 */
export const SKELETON = {
  floorY: (f: number) => -1.08 + f * 0.45,
  width: 0.5,
  depth: 0.36,
  base: -1.08,
  columns: [
    [-0.42, 1],
    [0.42, 1],
    [-0.42, -1],
    [0.42, -1],
  ] as [number, number][],
};
const pulseState = createPulseState();

const building: Formation = (i, _n, c, o) => {
  const S = SKELETON;
  const amp = c.reduced ? 0 : 0.055 * (0.85 + 0.9 * c.energy);
  const live = amp > 0 ? 1 : 0;
  // The first pulse comes once the frame has assembled.
  const p = pulseAt(Math.max(0, c.age - 1.4), pulseState);
  const gx = p.ground * amp;
  const roofTop = S.floorY(5) + 0.022;
  const H = roofTop - S.base;
  const roofD = p.floors[4] * amp;
  const ax = 0.2 + c.py * 0.06;
  const ay = 0.6 + c.px * 0.18;

  if (i <= 5) {
    // Foundation and floors: horizontal plates. Rx(ax)·Ry(ay)·Rx(-π/2) is
    // Rx(ax - π/2)·Rz(ay) in Euler XYZ.
    const f = i;
    o.x = gx + (f > 0 ? p.floors[f - 1] * amp : 0);
    o.y = f === 0 ? S.base - 0.055 : S.floorY(f);
    o.z = 0;
    rigid(o, ax, ay);
    o.rx = ax - HALF_PI;
    o.ry = 0;
    o.rz = ay;
    if (f === 0) {
      o.sx = S.width + 0.2;
      o.sy = S.depth + 0.24;
      o.sz = 0.055;
      o.radius = 0.12;
      o.glow = 0.02 + 0.3 * p.shove * live;
    } else {
      o.sx = S.width;
      o.sy = S.depth;
      o.sz = 0.028;
      o.radius = 0.07;
      o.glow = 0.015 + 0.38 * p.strain[f - 1] * p.strain[f - 1] * live;
    }
    o.hue = 1;
    return;
  }

  // Vertical members lean with the roof's drift about their base.
  let bx = 0;
  let bz = 0;
  let half = 0.03;
  let length = H - 0.012;
  let glow = 0;
  let hue = 1;
  if (i === 6) {
    // The spine: a narrow core that rises a little past the roof.
    bx = 0.16;
    bz = -(S.depth + 0.05);
    half = 0.036;
    length = H + 0.22;
    glow = 0.14 + 0.04 * Math.sin(c.t * 0.7);
    hue = 0;
  } else if (i === 7) {
    // A shear wall in the left bay, in the plane of the shaking.
    bx = -0.19;
    bz = -(S.depth + 0.05);
    half = 0.16;
    length = H - 0.03;
    glow = 0.015 + 0.3 * p.strain[0] * p.strain[0] * live;
  } else {
    const [cx, side] = S.columns[i - 8];
    bx = cx;
    bz = side * (S.depth + 0.05);
    glow = 0.015 + 0.26 * p.roof * p.roof * live;
  }
  const lean = Math.atan2(roofD * (length / H), length);
  const base = S.base + (i === 7 ? 0.018 : 0.006);
  o.x = gx + bx + Math.sin(lean) * length * 0.5;
  o.y = base + Math.cos(lean) * length * 0.5;
  o.z = bz;
  rigid(o, ax, ay);
  o.rz = -lean;
  o.sx = half;
  o.sy = length / 2;
  o.sz = 0.018;
  o.radius = Math.min(half, 0.03);
  o.glow = glow;
  o.hue = hue;
};

/* ------------------------------------------------------------------- plate
 * PlateHunter's subject, as one machined object in the proportions of an
 * Iranian plate (about 4.7 : 1): a body of smoked glass, a narrow band at the
 * left where the national strip sits, six chambers for the main characters
 * grouped DD · L · DDD, a thin divider, and the two-digit region box at the
 * right. Each chamber carries, etched inside it, the character the pipeline
 * read from the real plate shown beside it. A rear layer gives the body
 * depth. The whole assembly turns rigidly (see `rigid`).
 *
 *   slabs 0–7  chambers        slab 8  body
 *   slab 9     national band   slab 10 region divider   slab 11 rear layer
 */
export const PLATE = (() => {
  const H = 0.36; // half height of the body
  const ch = { w: 0.13, h: 0.215 }; // chamber half size
  const reg = { w: 0.122, h: 0.2 }; // region chamber half size
  const band = 0.1; // band half width
  const m = 0.1; // margin inside the body
  const gap = 0.055; // between characters
  const letterGap = 0.1; // around the letter
  const sect = 0.11; // either side of the divider
  const xs: number[] = [];
  let x = 0;
  const bandX = x + m + band;
  x = bandX + band + 0.12;
  const place = (w: number, g: number) => {
    xs.push(x + w);
    x += w * 2 + g;
  };
  place(ch.w, gap); // D
  place(ch.w, letterGap); // D
  place(ch.w, letterGap); // L
  place(ch.w, gap); // D
  place(ch.w, gap); // D
  place(ch.w, 0); // D
  const divX = x + sect;
  x = divX + sect;
  place(reg.w, gap * 0.8);
  place(reg.w, 0);
  const W = (x + m) / 2;
  const centre = (v: number) => v - W;
  return {
    W,
    H,
    ch,
    reg,
    band,
    bandX: centre(bandX),
    divX: centre(divX),
    xs: xs.map(centre),
  };
})();

const plate: Formation = (i, _n, c, o) => {
  const P = PLATE;
  // Chambers stand proud of the body; the band and divider sit on it.
  const zBody = -0.07;
  const bodyT = 0.05;
  const front = zBody + bodyT;
  if (i < 8) {
    const region = i >= 6;
    const s = region ? P.reg : P.ch;
    o.x = P.xs[i];
    o.y = region ? 0.045 : 0;
    o.sx = s.w;
    o.sy = s.h;
    o.sz = 0.04;
    o.z = front + o.sz + 0.018;
    o.radius = 0.055;
    // The pipeline's read: a pass of light across the chambers in order.
    const scan = ((c.t * (0.42 + c.energy * 0.6)) % 1.8) * 8 - 2;
    o.glow = Math.max(0, 1 - Math.abs(scan - i) * 0.85) * 0.55;
    if (c.plateFocus === i) {
      o.z += 0.07;
      o.glow = Math.max(o.glow, 0.8);
    }
    if (c.etchRows.plate >= 0) {
      o.etchIndex = c.etchRows.plate + i;
      o.etchStyle = 1;
      o.etch = 0.75 + 0.25 * Math.min(1, o.glow * 2);
    }
  } else if (i === 8) {
    o.sx = P.W;
    o.sy = P.H;
    o.sz = bodyT;
    o.z = zBody;
    o.radius = 0.1;
  } else if (i === 9) {
    o.x = P.bandX;
    o.sx = P.band;
    o.sy = P.H - 0.075;
    o.sz = 0.018;
    o.z = front + o.sz + 0.02;
    o.radius = 0.05;
    o.glow = 0.22;
  } else if (i === 10) {
    o.x = P.divX;
    o.sx = 0.009;
    o.sy = P.H - 0.09;
    o.sz = 0.018;
    o.z = front + o.sz + 0.02;
    o.radius = 0.009;
  } else {
    o.sx = P.W + 0.05;
    o.sy = P.H + 0.05;
    o.sz = 0.012;
    o.z = zBody - bodyT - 0.13;
    o.radius = 0.13;
    o.presence = 0.55;
  }
  o.y += Math.sin(c.t * 0.6) * 0.008;
  // A three-quarter view shows the chambers standing off the body.
  rigid(o, -0.1 + c.py * 0.07, -0.24 + c.px * 0.16);
};

const monolith: Formation = (i, n, c, o) => {
  const hz = 0.062;
  const lean = 0.55 + c.px * 0.08;
  // The whole block turns slowly — as a spin of every plate about its own
  // normal, so the plates stay parallel however long the page is open.
  o.rz = c.t * 0.05 + c.px * 0.12;
  o.rx = -HALF_PI + VIEW_TILT;
  o.ry = lean;
  // Pressed together but never into each other: the vertical pitch covers
  // the thickness measured along the (leaning) normal.
  const ny = Math.cos(VIEW_TILT) * Math.cos(0.63);
  o.y = (i - (n - 1) / 2) * ((hz * 2.06) / ny);
  o.sx = 0.9;
  o.sy = 0.62;
  o.sz = hz;
  o.radius = 0.2;
};

const drift: Formation = (i, _n, c, o) => {
  const a = i * 2.399963; // golden angle
  const r = 1.5 + (i % 3) * 0.55;
  const t = c.t * 0.08;
  o.x = Math.cos(a + t) * r * (c.portrait ? 0.6 : 1.1);
  o.y = Math.sin(a * 1.7 + t * 1.3) * 1.1;
  o.z = Math.sin(a + t) * r - 1.5;
  o.rx = a + c.t * 0.1;
  o.ry = a * 0.7 + c.t * 0.07;
  o.rz = a * 0.3;
  o.sx = 0.34;
  o.sy = 0.24;
  o.sz = 0.02;
  o.radius = 0.1;
  o.presence = 0.8;
};

const python: Formation = (i, n, c, o) => {
  const k = i - (n - 1) / 2;
  const a = i * 0.62 + c.t * 0.8;
  o.x = Math.cos(a) * 0.55;
  o.z = Math.sin(a) * 0.55;
  o.y = k * 0.2;
  o.rx = -HALF_PI + VIEW_TILT;
  o.ry = -a;
  o.sx = 0.5;
  o.sy = 0.24;
  o.sz = 0.035;
  o.radius = 0.1;
  o.glow = 0.25;
};

const table: Record<FormationId, Formation> = { awaken, stack, fan, horizon, building, plate, monolith, drift, python };

export function evaluate(id: FormationId, i: number, n: number, c: FormationContext, o: SlabTarget) {
  reset(o);
  table[id](i, n, c, o);
}

/**
 * The order in which slabs join a new formation. Cascades run bottom-up for
 * vertical structures and centre-out for horizontal ones; leaving Fiscora's
 * timeline, the past goes first and the forecast last.
 */
export function cascadeOrder(id: FormationId, i: number, n: number, from?: FormationId, c?: FormationContext) {
  if (from === 'horizon' && c) return ((((i - horizonCycle(c.age)) % n) + n) % n) * 0.7;
  switch (id) {
    case 'plate':
      return Math.abs(i - (n - 1) / 2);
    case 'fan':
      // The row assembles from the present outward.
      return Math.min(i, 6) * 0.8;
    case 'awaken':
      return 0;
    case 'horizon':
      // The oldest observation first; the forecast last.
      return i * 0.9;
    case 'building':
      // Foundation, then floor by floor; the frame's members rise last.
      return i < 6 ? i * 1.6 : 9 + (i - 6) * 0.8;
    default:
      return i;
  }
}
