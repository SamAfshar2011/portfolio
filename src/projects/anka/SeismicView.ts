import {
  Mesh,
  Group,
  MeshBasicNodeMaterial,
  Color,
  BoxGeometry,
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  Euler,
  DynamicDrawUsage,
} from 'three/webgpu';
import type { Object3D } from 'three/webgpu';
import {
  Fn,
  uniform,
  normalWorld,
  positionWorld,
  positionGeometry,
  cameraPosition,
  normalize,
  dot,
  max,
  pow,
  mix,
  vec3,
  float,
  saturate,
  smoothstep,
  reflect,
  varying,
  uv,
  abs,
  exp,
  sin,
  mx_noise_float,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DomView } from '../../gl/views/DomView';
import { rapierNow, type Rapier } from '../../gl/physics';
import type RAPIERNS from '@dimforge/rapier3d-compat';
import { BAYS, BAY_W, PLAN, STOREY_H, type Building } from './sim/structure';
import { sample, type GroundRecord, type Soil } from './sim/ground';

/**
 * The building as an architectural maquette, drawn from the structural model
 * every frame (see sim/structure.ts). What you see is what the model says:
 *
 *   - columns bend in the double curvature of a fixed–fixed column under
 *     storey drift; where a storey is yielding, plastic hinges glow at the
 *     column ends
 *   - shear walls shear with their storey and crack diagonally as damage grows
 *   - every member warms from bone toward ember with its storey's damage
 *   - the foundation sways, rocks, slides and settles; liquefying soil
 *     darkens as it takes on water
 *   - a storey that fails releases everything above it to rigid-body physics
 *     (Rapier): floors fall onto the structure below, columns topple
 *
 * Deformations are exaggerated (they are centimetres on a 3 m storey); the
 * factors are fixed and shown in the interface.
 */
export const EXAGGERATE = 8;
/** Ground and base translation are exaggerated less, so the building stays in frame. */
const GROUND_EXAGGERATE = 2.5;
const S = 0.42 / STOREY_H; // world units per metre
const STOREY = STOREY_H * S;
const WIDTH = PLAN.B * S;
const DEPTH = PLAN.D * S;
const SLAB_T = 0.05;
const COL_W = 0.05;

interface PartData {
  color: Color;
  damage: number;
  alpha: number;
  drift: number;
  height: number;
  hinge: number;
  wet: number;
}
const part = (o: Object3D | null) => o!.userData.part as PartData;
const newPart = (color: string, alpha = 1): PartData => ({ color: new Color(color), damage: 0, alpha, drift: 0, height: 1, hinge: 0, wet: 0 });

/** Shared lighting for the maquette: soft key, rim, damage heat. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node types
function shade(base: any, damage: any) {
  const N = normalize(normalWorld);
  const V = normalize(cameraPosition.sub(positionWorld));
  const L = normalize(vec3(-0.5, 0.9, 0.6));
  const diff = saturate(dot(N, L)).mul(0.5).add(0.42);
  const R = reflect(V.negate(), N);
  const spec = pow(max(dot(R, L), float(0)), 40).mul(0.45);
  const rim = pow(float(1).sub(saturate(dot(N, V))), 3).mul(0.3);
  const ember = vec3(0.92, 0.36, 0.14);
  const amber = vec3(0.95, 0.72, 0.3);
  const heat = mix(amber, ember, smoothstep(0.4, 0.95, damage));
  const tint = mix(base, heat, smoothstep(0.08, 0.7, damage).mul(0.8));
  return tint.mul(diff).add(vec3(1, 0.95, 0.9).mul(spec.add(rim))).add(heat.mul(smoothstep(0.5, 1, damage).mul(0.25)));
}

function solidMaterial() {
  const uColor = uniform(new Color('#cfc8bd')).onObjectUpdate(({ object }) => part(object).color);
  const uDamage = uniform(0).onObjectUpdate(({ object }) => part(object).damage);
  const m = new MeshBasicNodeMaterial();
  m.colorNode = Fn(() => shade(uColor, uDamage))();
  return m;
}

/** Columns of one storey: bent into an S between the floor below and the floor above. */
function columnMaterial() {
  const uColor = uniform(new Color('#e4ded4')).onObjectUpdate(({ object }) => part(object).color);
  const uDamage = uniform(0).onObjectUpdate(({ object }) => part(object).damage);
  const uDrift = uniform(0).onObjectUpdate(({ object }) => part(object).drift);
  const uH = uniform(1).onObjectUpdate(({ object }) => part(object).height);
  const uHinge = uniform(0).onObjectUpdate(({ object }) => part(object).hinge);
  const m = new MeshBasicNodeMaterial();
  const xi = positionGeometry.y; // 0 at the floor below, 1 at the floor above
  m.positionNode = Fn(() => {
    const s = xi.mul(xi).mul(float(3).sub(xi.mul(2)));
    return vec3(positionGeometry.x.add(uDrift.mul(s)), xi.mul(uH), positionGeometry.z);
  })();
  const vXi = varying(xi, 'vColumnXi');
  m.colorNode = Fn(() => {
    const ends = exp(vXi.div(0.09).pow(2).negate()).add(exp(float(1).sub(vXi).div(0.09).pow(2).negate()));
    const glow = vec3(1.0, 0.62, 0.25).mul(ends.mul(uHinge).mul(0.9));
    return shade(uColor, uDamage).add(glow);
  })();
  return m;
}

/** Shear walls: shear with the storey; diagonal cracks open with damage. */
function wallMaterial() {
  const uColor = uniform(new Color('#efe9df')).onObjectUpdate(({ object }) => part(object).color);
  const uDamage = uniform(0).onObjectUpdate(({ object }) => part(object).damage);
  const uDrift = uniform(0).onObjectUpdate(({ object }) => part(object).drift);
  const uH = uniform(1).onObjectUpdate(({ object }) => part(object).height);
  const uAlpha = uniform(1).onObjectUpdate(({ object }) => part(object).alpha);
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const xi = positionGeometry.y;
  m.positionNode = vec3(positionGeometry.x.add(uDrift.mul(xi)), xi.mul(uH), positionGeometry.z);
  m.colorNode = Fn(() => {
    const u = uv();
    const n = mx_noise_float(u.mul(vec3(9, 7, 0).xy)).mul(0.035);
    const a = abs(u.x.sub(0.5).add(u.y.sub(0.5)).add(n));
    const b = abs(u.x.sub(0.5).sub(u.y.sub(0.5)).sub(n));
    // Principal diagonals first; parallel cracks join as damage grows.
    const main = max(smoothstep(0.018, 0.0, a), smoothstep(0.018, 0.0, b)).mul(smoothstep(0.18, 0.55, uDamage));
    const par = abs(sin(u.x.add(u.y).mul(19).add(n.mul(40)))).oneMinus();
    const more = smoothstep(0.93, 1.0, par).mul(smoothstep(0.5, 0.9, uDamage));
    const crack = max(main, more);
    return mix(shade(uColor, uDamage.mul(0.6)), vec3(0.16, 0.08, 0.05), crack.mul(0.9));
  })();
  m.opacityNode = uAlpha;
  return m;
}

/** Soil strata; liquefying ground takes on water (darker, glossier). */
function soilMaterial() {
  const uColor = uniform(new Color('#3a3d42')).onObjectUpdate(({ object }) => part(object).color);
  const uWet = uniform(0).onObjectUpdate(({ object }) => part(object).wet);
  const uAlpha = uniform(1).onObjectUpdate(({ object }) => part(object).alpha);
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.colorNode = Fn(() => {
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const L = normalize(vec3(-0.5, 0.9, 0.6));
    const R = reflect(V.negate(), N);
    const grain = mx_noise_float(positionWorld.mul(26)).mul(0.04);
    const base = uColor.mul(saturate(dot(N, L)).mul(0.45).add(0.55)).add(grain);
    const wet = base.mul(mix(float(1), float(0.55), uWet));
    const gloss = pow(max(dot(R, L), float(0)), 60).mul(uWet).mul(0.8);
    return wet.add(vec3(0.85, 0.9, 1).mul(gloss));
  })();
  m.opacityNode = uAlpha;
  return m;
}

const SOIL_COLORS: Record<Soil, string[]> = {
  rock: ['#3a3d42', '#2f3236', '#26282b'],
  gravel: ['#4a4640', '#3b3833', '#2d2b28'],
  sand: ['#6b5a3e', '#56482f', '#3f3524'],
  clay: ['#6a3f2c', '#553222', '#3f261a'],
  soft: ['#4a3a2a', '#3a2d20', '#2a2118'],
};

/** Plan positions of the columns (x along the shaking, z across). */
const COLUMN_XZ: [number, number][] = [];
for (let b = 0; b <= BAYS; b++) for (const z of [-DEPTH / 2, DEPTH / 2]) COLUMN_XZ.push([-WIDTH / 2 + ((b * BAY_W) / (BAYS * BAY_W)) * WIDTH, z]);

function storeyColumns() {
  const parts = COLUMN_XZ.map(([x, z]) => {
    const g = new BoxGeometry(COL_W, 1, COL_W, 1, 10, 1);
    g.translate(x, 0.5, z);
    return g;
  });
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

/** Wall panels in the end bays of both long faces. */
function storeyWalls() {
  const w = (BAY_W * S) * 0.92;
  const xs = [-WIDTH / 2 + (BAY_W * S) / 2, WIDTH / 2 - (BAY_W * S) / 2];
  const parts: BufferGeometry[] = [];
  for (const x of xs)
    for (const z of [-DEPTH / 2, DEPTH / 2]) {
      const g = new BoxGeometry(w, 1, 0.035);
      g.translate(x, 0.5, z);
      parts.push(g);
    }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

/** Something drawn from a rigid body: a floor slab, or one column. */
interface Piece {
  kind: 'floor' | 'column';
  floor: number;
  /** Transform relative to the body carrying it. */
  p: Vector3;
  q: Quaternion;
}

interface Debris {
  body: RAPIERNS.RigidBody;
  pieces: Piece[];
  /** A whole block of storeys still holding together. */
  block: boolean;
  startY: number;
  vyPrev: number;
  prev: { p: Vector3; q: Quaternion };
  cur: { p: Vector3; q: Quaternion };
}

export class SeismicView extends DomView {
  private root = new Group();
  private building = new Group();
  private floors: Mesh[] = [];
  private columns: Mesh[] = [];
  private walls: Mesh[] = [];
  private foundation!: Mesh;
  private groundTop!: Mesh;
  private strata: Mesh[] = [];
  private box = new RoundedBoxGeometry(1, 1, 1, 2, 0.06);
  private colGeo = storeyColumns();
  private wallGeo = storeyWalls();
  private debrisColumnGeo = new BoxGeometry(COL_W, STOREY, COL_W);
  private mat = solidMaterial();
  private colMat = columnMaterial();
  private wallMat = wallMaterial();
  private soilMat = soilMaterial();
  private debrisCols: InstancedMesh | null = null;
  private model: Building | null = null;
  private ground: GroundRecord | null = null;

  // Rigid-body collapse.
  private R: Rapier | null = null;
  private world: RAPIERNS.World | null = null;
  private debris: Debris[] = [];
  private supports: RAPIERNS.RigidBody[] = [];
  private groundBody: RAPIERNS.RigidBody | null = null;
  private released = new Set<number>();
  private handled = 0;
  private acc = 0;
  private fallback: { floor: number; y: number; vy: number; x: number }[] = [];

  // Inspection camera.
  private yaw = 0;
  private pitch = 0;
  private yawT = 0;
  private pitchT = 0;
  private framing = { dist: 8, look: 1 };
  private drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  private tmpM = new Matrix4();
  private tmpS = new Vector3(1, 1, 1);
  private tmpE = new Euler();

  constructor(el: HTMLElement) {
    super(el);
    this.camera.fov = 30;
    this.scene.add(this.root);
    this.root.add(this.building);

    // Ground: a surface slab and three strata beneath it.
    this.groundTop = this.solid('#6d665c');
    this.groundTop.scale.set(WIDTH + 1.8, 0.05, DEPTH + 1.3);
    this.groundTop.position.y = -0.03;
    this.root.add(this.groundTop);
    for (let i = 0; i < 3; i++) {
      const s = new Mesh(this.box, this.soilMat);
      s.userData.part = newPart('#333', 0.95 - i * 0.22);
      s.scale.set(WIDTH + 1.8, 0.26, DEPTH + 1.3);
      s.position.y = -0.19 - i * 0.29;
      s.renderOrder = 1;
      this.strata.push(s);
      this.root.add(s);
    }
    this.foundation = this.solid('#8f887d');
    this.foundation.scale.set(WIDTH + 0.22, 0.1, DEPTH + 0.22);
    this.root.add(this.foundation);

    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('dblclick', this.onDouble);
  }

  private solid(color: string) {
    const m = new Mesh(this.box, this.mat);
    m.userData.part = newPart(color);
    return m;
  }

  // ---------------------------------------------------------------- camera
  private onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    this.drag = { x: e.clientX, y: e.clientY, yaw: this.yawT, pitch: this.pitchT };
    this.el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!this.drag) return;
      // Limited on purpose: enough to inspect, never enough to lose the building.
      this.yawT = Math.max(-0.85, Math.min(0.85, this.drag.yaw + (ev.clientX - this.drag.x) * 0.006));
      this.pitchT = Math.max(-0.12, Math.min(0.35, this.drag.pitch + (ev.clientY - this.drag.y) * 0.004));
    };
    const up = () => {
      this.drag = null;
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  };
  private onDouble = () => {
    this.yawT = 0;
    this.pitchT = 0;
  };

  /** Rebuild the maquette for a new building (parameters changed or reset). */
  setModel(model: Building, ground: GroundRecord | null, soil: Soil) {
    this.model = model;
    this.ground = ground;
    this.clearDebris();
    this.building.clear();
    this.floors = [];
    this.columns = [];
    this.walls = [];
    SOIL_COLORS[soil].forEach((c, i) => part(this.strata[i]).color.set(c));
    const n = model.n;
    for (let f = 0; f < n; f++) {
      const floor = this.solid('#cfc8bd');
      floor.scale.set(WIDTH + 0.12, SLAB_T, DEPTH + 0.12);
      this.building.add(floor);
      this.floors.push(floor);
      const cols = new Mesh(this.colGeo, this.colMat);
      cols.userData.part = newPart('#e4ded4');
      cols.frustumCulled = false;
      this.building.add(cols);
      this.columns.push(cols);
      if (model.input.shearWall) {
        const w = new Mesh(this.wallGeo, this.wallMat);
        w.userData.part = newPart('#efe9df', 0.5);
        w.frustumCulled = false;
        w.renderOrder = 2;
        this.building.add(w);
        this.walls.push(w);
      }
    }
    const h = n * STOREY;
    this.framing = { dist: 6.4 + h * 1.25, look: h * 0.42 - 0.15 };
    this.layout();
  }

  setGround(ground: GroundRecord | null) {
    this.ground = ground;
  }

  /** Display offset (world units) of floor j from the building's base line. */
  private floorX(j: number) {
    const m = this.model!;
    if (j === 0 || j > m.active) return 0;
    return m.q[j - 1] * S * EXAGGERATE;
  }

  private layout() {
    const m = this.model;
    if (!m) return;
    const t = m.time;
    const g = this.ground ? sample(this.ground.disp, this.ground.dt, t) : 0;
    const gx = g * S * GROUND_EXAGGERATE;
    this.groundTop.position.x = gx;
    this.strata.forEach((s, i) => {
      s.position.x = gx * (0.8 - i * 0.25);
      part(s).wet = i === 0 ? m.ru : m.ru * 0.5;
    });

    // The building's base: sway and slide (exaggerated less), settlement and rocking.
    const baseX = gx + m.sway * S * GROUND_EXAGGERATE;
    const settle = m.settlement * S * 4;
    const tilt = m.rocking * EXAGGERATE;
    this.foundation.position.set(baseX, -0.05 - settle, 0);
    this.foundation.rotation.z = -tilt;
    this.building.position.set(baseX, -settle, 0);
    this.building.rotation.z = -tilt;

    let prevX = 0;
    for (let f = 0; f < m.n; f++) {
      const j = f + 1;
      const st = m.storeys[f];
      const floor = this.floors[f];
      const cols = this.columns[f];
      const wall = this.walls[f];
      const released = f >= m.active;
      if (released) {
        // Handed over to rigid-body physics (or the simple drop).
        cols.visible = false;
        if (wall) wall.visible = false;
        continue;
      }
      const x = this.floorX(j);
      const y = j * STOREY;
      floor.visible = true;
      floor.position.set(x, y, 0);
      floor.rotation.z = 0;
      const dmg = Math.min(1, st.damage);
      part(floor).damage = dmg * 0.8;
      cols.visible = true;
      cols.position.set(prevX, (j - 1) * STOREY + SLAB_T / 2, 0);
      part(cols).drift = x - prevX;
      part(cols).height = STOREY - SLAB_T;
      part(cols).damage = dmg;
      // Plastic hinges: the storey is on its yield plateau.
      part(cols).hinge = Math.max(0, (Math.abs(st.z) - 0.75) / 0.25) * (1 - dmg * 0.3);
      if (wall) {
        wall.visible = true;
        wall.position.set(prevX, (j - 1) * STOREY + SLAB_T / 2, 0);
        part(wall).drift = x - prevX;
        part(wall).height = STOREY - SLAB_T;
        part(wall).damage = dmg;
      }
      prevX = x;
    }
  }

  // --------------------------------------------------------------- collapse
  private ensureWorld() {
    if (this.world) return this.world;
    const R = rapierNow();
    if (!R) return null;
    this.R = R;
    // Gravity in maquette units, so a storey falls in real time.
    this.world = new R.World({ x: 0, y: -9.81 * S, z: 0 });
    this.groundBody = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    this.world.createCollider(R.ColliderDesc.cuboid(WIDTH * 2, 0.1, DEPTH * 2).setTranslation(0, -0.1, 0).setFriction(0.9), this.groundBody);
    return this.world;
  }

  /**
   * A storey failed: it and everything above it leave the model. The failed
   * storey's columns kick out as loose pieces; the storeys above drop as one
   * rigid block (floors and columns together) and only come apart when they
   * hit what is below — the way a pancake collapse reads.
   */
  private handleReleases() {
    const m = this.model;
    if (!m) return;
    while (this.handled < m.releases.length) {
      const rel = m.releases[this.handled++];
      const world = this.ensureWorld();
      this.building.updateMatrixWorld();
      const first = rel.from - 1; // 0-based index of the failed storey (and the floor on it)
      const floorsOut: number[] = [];
      for (let f = first; f < m.n; f++) if (!this.released.has(f)) floorsOut.push(f);
      if (!floorsOut.length) continue;
      floorsOut.forEach((f) => this.released.add(f));
      const vel = (rel.velocities[0] ?? 0) * S * EXAGGERATE * 0.5;
      if (!world || !this.R) {
        for (const f of floorsOut) {
          const wp = this.floors[f].getWorldPosition(new Vector3());
          this.root.worldToLocal(wp);
          this.fallback.push({ floor: f, y: wp.y, vy: 0, x: wp.x });
        }
        continue;
      }
      const R = this.R;
      // World transforms of everything that goes.
      const pieces: { kind: 'floor' | 'column'; floor: number; p: Vector3; q: Quaternion }[] = [];
      const toRoot = (o: Object3D, lp: Vector3) => this.root.worldToLocal(o.localToWorld(lp.clone()));
      for (const f of floorsOut) {
        const floor = this.floors[f];
        pieces.push({ kind: 'floor', floor: f, p: toRoot(floor, new Vector3()), q: floor.getWorldQuaternion(new Quaternion()) });
      }
      const colsOf = (f: number) => {
        const cols = this.columns[f];
        const drift = part(cols).drift;
        const tilt = Math.atan2(drift, STOREY);
        return COLUMN_XZ.map(([cx, cz]) => ({
          p: toRoot(cols, new Vector3(cx + drift / 2, STOREY / 2, cz)),
          q: cols.getWorldQuaternion(new Quaternion()).multiply(new Quaternion().setFromEuler(this.tmpE.set(0, 0, -tilt))),
        }));
      };
      // The failed storey's columns: loose, buckled outward.
      for (const c of colsOf(first)) {
        const out = Math.sign(c.p.x - pieces[0].p.x) || 1;
        const body = world.createRigidBody(
          R.RigidBodyDesc.dynamic()
            .setTranslation(c.p.x, c.p.y, c.p.z)
            .setRotation({ x: c.q.x, y: c.q.y, z: c.q.z, w: c.q.w })
            .setLinvel(vel * 0.5 + out * 0.08, 0, 0)
            .setAngvel({ x: (Math.random() - 0.5) * 0.6, y: 0, z: -out * (0.8 + Math.random()) })
            .setAngularDamping(0.3),
        );
        world.createCollider(R.ColliderDesc.cuboid(COL_W / 2, STOREY / 2, COL_W / 2).setFriction(0.7).setDensity(1.5), body);
        this.addDebris(body, [{ kind: 'column', floor: -1, p: new Vector3(), q: new Quaternion() }], false);
      }
      // Storeys above: one block, pivoting on its lowest floor.
      const blockP = pieces[0].p.clone();
      const blockQ = pieces[0].q.clone();
      const inv = blockQ.clone().invert();
      const local = (p: Vector3, q: Quaternion) => ({ p: p.clone().sub(blockP).applyQuaternion(inv), q: inv.clone().multiply(q) });
      const members: Piece[] = [];
      for (const pc of pieces) members.push({ kind: 'floor', floor: pc.floor, ...local(pc.p, pc.q) });
      for (const f of floorsOut.slice(1)) for (const c of colsOf(f)) members.push({ kind: 'column', floor: -1, ...local(c.p, c.q) });
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(blockP.x, blockP.y, blockP.z)
          .setRotation({ x: blockQ.x, y: blockQ.y, z: blockQ.z, w: blockQ.w })
          .setLinvel(vel, 0, 0)
          .setAngvel({ x: 0, y: 0, z: -Math.sign(vel || 1) * 0.12 })
          .setAngularDamping(0.2),
      );
      for (const mb of members) {
        const desc =
          mb.kind === 'floor'
            ? R.ColliderDesc.cuboid((WIDTH + 0.12) / 2, SLAB_T / 2, (DEPTH + 0.12) / 2).setDensity(2)
            : R.ColliderDesc.cuboid(COL_W / 2, STOREY / 2, COL_W / 2).setDensity(1.5);
        world.createCollider(desc.setTranslation(mb.p.x, mb.p.y, mb.p.z).setRotation({ x: mb.q.x, y: mb.q.y, z: mb.q.z, w: mb.q.w }).setFriction(0.8), body);
      }
      this.addDebris(body, members, true);
      for (const f of floorsOut) if (this.floors[f].parent !== this.root) this.root.add(this.floors[f]);
      this.syncSupports();
    }
  }

  private addDebris(body: RAPIERNS.RigidBody, pieces: Piece[], block: boolean) {
    const t = body.translation();
    const r = body.rotation();
    const p = new Vector3(t.x, t.y, t.z);
    const q = new Quaternion(r.x, r.y, r.z, r.w);
    this.debris.push({ body, pieces, block, startY: t.y, vyPrev: 0, prev: { p: p.clone(), q: q.clone() }, cur: { p, q } });
  }

  /** A falling block has hit something: it comes apart into its floors and columns. */
  private breakBlock(d: Debris) {
    const world = this.world!;
    const R = this.R!;
    const lv = d.body.linvel();
    const av = d.body.angvel();
    const w = new Vector3(av.x, av.y, av.z);
    const centre = d.cur.p;
    for (const pc of d.pieces) {
      const p = pc.p.clone().applyQuaternion(d.cur.q).add(centre);
      const q = d.cur.q.clone().multiply(pc.q);
      const v = new Vector3(lv.x, lv.y, lv.z).add(w.clone().cross(p.clone().sub(centre)));
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinvel(v.x, v.y, v.z)
          .setAngvel({ x: av.x + (Math.random() - 0.5) * 0.4, y: av.y, z: av.z + (Math.random() - 0.5) * 0.6 })
          .setLinearDamping(0.1)
          .setAngularDamping(0.4),
      );
      const desc =
        pc.kind === 'floor'
          ? R.ColliderDesc.cuboid((WIDTH + 0.12) / 2, SLAB_T / 2, (DEPTH + 0.12) / 2).setDensity(2).setRestitution(0.05)
          : R.ColliderDesc.cuboid(COL_W / 2, STOREY / 2, COL_W / 2).setDensity(1.5);
      world.createCollider(desc.setFriction(0.8), body);
      this.addDebris(body, [{ ...pc, p: new Vector3(), q: new Quaternion() }], false);
    }
    world.removeRigidBody(d.body);
    this.debris.splice(this.debris.indexOf(d), 1);
  }

  /** The standing structure, as kinematic bodies the debris can land on. */
  private syncSupports() {
    const world = this.world;
    const R = this.R;
    const m = this.model;
    if (!world || !R || !m) return;
    while (this.supports.length < m.active) {
      const b = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
      world.createCollider(R.ColliderDesc.cuboid((WIDTH + 0.12) / 2, SLAB_T / 2 + 0.01, (DEPTH + 0.12) / 2).setFriction(0.8), b);
      this.supports.push(b);
    }
    this.building.updateMatrixWorld();
    const wp = new Vector3();
    const wq = new Quaternion();
    this.supports.forEach((b, f) => {
      if (f >= m.active) {
        b.setNextKinematicTranslation({ x: 0, y: -50, z: 0 });
        return;
      }
      this.floors[f].getWorldPosition(wp);
      this.floors[f].getWorldQuaternion(wq);
      this.root.worldToLocal(wp);
      b.setNextKinematicTranslation({ x: wp.x, y: wp.y, z: wp.z });
      b.setNextKinematicRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w });
    });
    this.groundBody?.setNextKinematicTranslation({ x: this.groundTop.position.x, y: 0, z: 0 });
  }

  private stepPhysics(dt: number) {
    const world = this.world;
    // Fallback without Rapier: released floors simply drop onto what is below.
    if (!world) {
      for (const fb of this.fallback) {
        const floor = this.floors[fb.floor];
        const floorBelow = fb.floor > 0 ? this.floors[fb.floor - 1] : null;
        const stop = floorBelow && floorBelow.visible && !this.released.has(fb.floor - 1) ? floorBelow.position.y + SLAB_T * 1.4 : SLAB_T;
        fb.vy -= 9.81 * S * dt;
        fb.y = Math.max(stop + fb.floor * SLAB_T * 0.2, fb.y + fb.vy * dt);
        if (fb.y <= stop) fb.vy = 0;
        floor.position.set(fb.x, fb.y, 0);
        part(floor).damage = 0.6;
      }
      return;
    }
    const h = 1 / 120;
    this.acc = Math.min(this.acc + dt, h * 6);
    while (this.acc >= h) {
      this.syncSupports();
      for (const d of this.debris) {
        d.prev.p.copy(d.cur.p);
        d.prev.q.copy(d.cur.q);
      }
      world.step();
      for (const d of [...this.debris]) {
        const t = d.body.translation();
        const r = d.body.rotation();
        d.cur.p.set(t.x, t.y, t.z);
        d.cur.q.set(r.x, r.y, r.z, r.w);
        if (d.block) {
          const vy = d.body.linvel().y;
          // Impact: a sudden loss of downward speed, or it has dropped a storey.
          if ((d.vyPrev < -0.2 && vy > d.vyPrev + 0.15) || d.startY - t.y > STOREY * 1.1) this.breakBlock(d);
          else d.vyPrev = vy;
        }
      }
      this.acc -= h;
    }
    // Draw between the last two physics states.
    const a = this.acc / h;
    const cols = this.ensureDebrisColumns();
    let ci = 0;
    const bp = new Vector3();
    const bq = new Quaternion();
    const wp = new Vector3();
    const wq = new Quaternion();
    for (const d of this.debris) {
      bp.copy(d.prev.p).lerp(d.cur.p, a);
      bq.copy(d.prev.q).slerp(d.cur.q, a);
      for (const pc of d.pieces) {
        wp.copy(pc.p).applyQuaternion(bq).add(bp);
        wq.copy(bq).multiply(pc.q);
        if (pc.kind === 'floor') {
          const floor = this.floors[pc.floor];
          floor.position.copy(wp);
          floor.quaternion.copy(wq);
          part(floor).damage = 0.55;
        } else if (ci < cols.instanceMatrix.count) {
          this.tmpM.compose(wp, wq, this.tmpS.set(1, 1, 1));
          cols.setMatrixAt(ci++, this.tmpM);
        }
      }
    }
    cols.count = ci;
    cols.instanceMatrix.needsUpdate = true;
  }

  private ensureDebrisColumns() {
    if (this.debrisCols) return this.debrisCols;
    const mesh = new InstancedMesh(this.debrisColumnGeo, this.mat, 8 * 26);
    mesh.userData.part = newPart('#e4ded4');
    part(mesh).damage = 0.55;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.debrisCols = mesh;
    return mesh;
  }

  private clearDebris() {
    for (const f of this.released) {
      const floor = this.floors[f];
      if (floor && floor.parent === this.root) this.root.remove(floor);
    }
    this.released.clear();
    this.handled = 0;
    this.fallback = [];
    this.debris = [];
    this.supports = [];
    this.world?.free();
    this.world = null;
    this.groundBody = null;
    this.acc = 0;
    if (this.debrisCols) this.debrisCols.count = 0;
  }

  protected update(dt: number) {
    // Inspection: eased toward the dragged angle.
    this.yaw += (this.yawT - this.yaw) * Math.min(1, dt * 8);
    this.pitch += (this.pitchT - this.pitch) * Math.min(1, dt * 8);
    const { dist, look } = this.framing;
    const az = 0.64 + this.yaw;
    const el = 0.26 + this.pitch;
    this.camera.position.set(Math.sin(az) * Math.cos(el) * dist, look + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    this.camera.lookAt(0, look, 0);

    this.layout();
    this.handleReleases();
    if (this.released.size) this.stepPhysics(dt);
  }

  dispose() {
    super.dispose();
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('dblclick', this.onDouble);
    this.clearDebris();
    this.box.dispose();
    this.colGeo.dispose();
    this.wallGeo.dispose();
    this.debrisColumnGeo.dispose();
    this.mat.dispose();
    this.colMat.dispose();
    this.wallMat.dispose();
    this.soilMat.dispose();
  }
}

