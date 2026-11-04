import { Group, Mesh, Vector3, Quaternion, Euler } from 'three/webgpu';
import type { BufferGeometry, Material, Camera } from 'three/webgpu';
import { SLAB_COUNT, KINEMATIC, evaluate, cascadeOrder, type SlabTarget, type FormationContext } from './formations';
import { SLAB_BEVEL_RATIO, type SlabData } from './slab';
import type { FormationId } from '../../experience/director';
import { damp } from '../../lib/math';

interface SlabState {
  mesh: Mesh;
  /** The same slab in the glass layer pass (shares transform and data). */
  twin: Mesh | null;
  data: SlabData;
  vel: Vector3;
  quat: Quaternion;
  target: SlabTarget;
  prevTarget: Vector3;
  /** Formation this slab is currently following (lags during cascades). */
  following: FormationId;
  /** 0 = spring-driven, 1 = following a kinematic formation exactly. */
  kin: number;
}

const tmpEuler = new Euler();
const tmpQuat = new Quaternion();
const pitchQuat = new Quaternion();
const AXIS_Y = new Vector3(0, 1, 0);

/** A target's orientation: Euler XYZ, after the slab's own pitch about its long axis. */
function targetQuat(t: SlabTarget, out: Quaternion) {
  out.setFromEuler(tmpEuler.set(t.rx, t.ry, t.rz));
  if (t.pitch) out.multiply(pitchQuat.setFromAxisAngle(AXIS_Y, t.pitch));
  return out;
}
const tmpVec = new Vector3();
const tmpA = new Vector3();
const tmpB = new Vector3();

/**
 * The stack owns twelve slabs and moves them with springs toward whatever the
 * active formation asks for. A formation change cascades slab by slab, which
 * gives morphs their choreography (bottom-up for towers, centre-out for rows).
 *
 * Kinematic formations (the story row, the opening) are designed to be
 * collision-free at every value of their parameter. Once a slab has joined
 * one, it blends from its spring onto the exact pose and then follows it;
 * the spring state is kept in sync, so leaving again carries the slab's real
 * velocity instead of snapping.
 */
export class Stack {
  readonly group = new Group();
  /** Twin meshes rendered in the glass layer pass (null when disabled). */
  readonly layerGroup: Group | null;
  readonly slabs: SlabState[] = [];
  private formation: FormationId = 'awaken';
  /** The formation before the current one (shapes the exit cascade). */
  private previous: FormationId = 'awaken';
  private changedAt = 0;
  /** How long the previous formation had been showing when it was left (s). */
  private leftAt = 0;
  private stiffness = 64;
  private damping = 13;

  constructor(geometry: BufferGeometry, material: Material, layerMaterial: Material | null) {
    this.layerGroup = layerMaterial ? new Group() : null;
    for (let i = 0; i < SLAB_COUNT; i++) {
      const data: SlabData = {
        id: i,
        size: new Vector3(1, 0.8, 0.05),
        radius: 0.2,
        phase: i * 0.083,
        glow: 0,
        presence: 0,
        etch: 0,
        etchIndex: -1,
        etchStyle: 0,
        hue: 0,
      };
      const mesh = new Mesh(geometry, material);
      mesh.userData.slab = data;
      mesh.frustumCulled = false;
      mesh.renderOrder = i;
      this.group.add(mesh);
      let twin: Mesh | null = null;
      if (layerMaterial && this.layerGroup) {
        twin = new Mesh(geometry, layerMaterial);
        twin.userData.slab = data;
        twin.frustumCulled = false;
        twin.matrixAutoUpdate = false;
        this.layerGroup.add(twin);
      }
      this.slabs.push({
        mesh,
        twin,
        data,
        vel: new Vector3(),
        quat: new Quaternion(),
        target: {} as SlabTarget,
        prevTarget: new Vector3(),
        following: 'awaken',
        kin: 0,
      });
    }
  }

  get current() {
    return this.formation;
  }

  /** Seconds the current formation has been showing. */
  ageAt(now: number) {
    return now - this.changedAt;
  }

  setFormation(id: FormationId, now: number) {
    if (id === this.formation) return;
    this.previous = this.formation;
    this.leftAt = now - this.changedAt;
    this.formation = id;
    this.changedAt = now;
  }

  /** Jump straight to the formation (first frame, reduced motion). */
  snap(ctx: FormationContext) {
    const n = this.slabs.length;
    // A snapped formation is already settled: its entrance has long finished.
    this.changedAt -= 1e3;
    ctx.age = 1e3;
    this.slabs.forEach((s, i) => {
      s.following = this.formation;
      evaluate(this.formation, i, n, ctx, s.target);
      const t = s.target;
      s.mesh.position.set(t.x, t.y, t.z);
      s.prevTarget.set(t.x, t.y, t.z);
      targetQuat(t, s.quat);
      s.mesh.quaternion.copy(s.quat);
      s.vel.set(0, 0, 0);
      s.kin = KINEMATIC.has(this.formation) ? 1 : 0;
      s.data.size.set(t.sx, t.sy, t.sz);
      s.data.radius = t.radius;
      s.data.glow = t.glow;
      s.data.presence = t.presence;
      s.data.etch = t.etch;
      s.data.etchIndex = t.etchIndex;
      s.data.etchStyle = t.etchStyle;
      s.data.hue = t.hue;
    });
  }

  update(dt: number, now: number, ctx: FormationContext, reduced: boolean, presenceScale = 1) {
    const n = this.slabs.length;
    const h = Math.min(dt, 1 / 30);
    const age = now - this.changedAt;
    this.slabs.forEach((s, i) => {
      // Cascade: each slab joins the new formation after a short delay.
      ctx.age = this.leftAt;
      const delay = reduced ? 0 : cascadeOrder(this.formation, i, n, this.previous, ctx) * 0.045;
      // Slabs still on the old formation see its clock; the rest see the new one.
      ctx.age = s.following === this.formation ? age : this.leftAt + age;
      if (s.following !== this.formation && age >= delay) {
        s.following = this.formation;
        ctx.age = age;
      }
      evaluate(s.following, i, n, ctx, s.target);
      const t = s.target;
      const p = s.mesh.position;
      const kinematic = KINEMATIC.has(s.following);
      // Blend onto a kinematic path over ~0.6 s; leave it immediately.
      s.kin = kinematic ? Math.min(1, s.kin + dt * (reduced ? 3 : 1.7)) : 0;
      const w = s.kin * s.kin * (3 - 2 * s.kin);

      if (reduced) {
        // Calm alternative: no overshoot, slower exponential ease.
        p.x = damp(p.x, t.x, 3.2, dt);
        p.y = damp(p.y, t.y, 3.2, dt);
        p.z = damp(p.z, t.z, 3.2, dt);
      } else {
        tmpVec.set(t.x - p.x, t.y - p.y, t.z - p.z).multiplyScalar(this.stiffness);
        tmpVec.addScaledVector(s.vel, -this.damping);
        s.vel.addScaledVector(tmpVec, h);
        p.addScaledVector(s.vel, h);
      }
      if (w > 0) {
        tmpA.set(t.x, t.y, t.z);
        p.lerp(tmpA, w);
        if (w >= 1 && dt > 0) {
          // On the path: the spring carries the path's own velocity.
          s.vel.copy(tmpA).sub(s.prevTarget).divideScalar(Math.max(dt, 1 / 240));
          if (s.vel.lengthSq() > 400) s.vel.setLength(20);
        }
      }
      s.prevTarget.set(t.x, t.y, t.z);

      targetQuat(t, tmpQuat);
      s.quat.slerp(tmpQuat, w >= 1 ? 1 : Math.max(w, 1 - Math.exp(-(reduced ? 3 : 6.5) * dt)));
      s.mesh.quaternion.copy(s.quat);

      const k = reduced ? 3.5 : 7;
      const d = s.data;
      const follow = (cur: number, tgt: number) => (w >= 1 ? tgt : damp(cur, tgt, k + w * 30, dt));
      d.size.x = follow(d.size.x, t.sx);
      d.size.y = follow(d.size.y, t.sy);
      d.size.z = follow(d.size.z, t.sz);
      d.radius = follow(d.radius, Math.min(t.radius, t.sx, t.sy));
      // Keep the geometry valid while sizes animate.
      d.radius = Math.min(d.radius, d.size.x * 0.98, d.size.y * 0.98);
      d.size.z = Math.max(d.size.z, d.radius * SLAB_BEVEL_RATIO + 0.002);
      d.glow = damp(d.glow, t.glow, w >= 1 ? 14 : 5, dt);
      d.hue = damp(d.hue, t.hue, w >= 1 ? 14 : 5, dt);
      d.presence = damp(d.presence, t.presence * presenceScale, w >= 1 ? 9 : 4, dt);
      // A different glyph: the old one fades out first, then the new one in.
      const same = t.etchIndex === d.etchIndex || d.etchIndex < 0;
      d.etch = damp(d.etch, same ? t.etch : 0, 6, dt);
      if (!same && d.etch < 0.02) d.etchIndex = -1;
      if (d.etchIndex < 0 && t.etchIndex >= 0) {
        d.etchIndex = t.etchIndex;
        d.etchStyle = t.etchStyle;
      }
      s.mesh.visible = d.presence > 0.004;
    });
  }

  /**
   * Mirrors transforms into the layer pass and orders it nearest-first, so
   * the farthest slab is drawn last and survives in the layer: that is what
   * a slab in front sees through its own glass.
   */
  syncLayer(camera: Camera) {
    if (!this.layerGroup) return;
    this.group.updateMatrixWorld();
    camera.getWorldPosition(tmpB);
    const order = this.slabs
      .map((s) => ({ s, d: s.mesh.getWorldPosition(tmpA).distanceToSquared(tmpB) }))
      .sort((a, b) => a.d - b.d);
    order.forEach(({ s }, rank) => {
      const twin = s.twin!;
      twin.matrix.copy(s.mesh.matrixWorld);
      twin.matrixWorld.copy(s.mesh.matrixWorld);
      twin.renderOrder = rank;
      twin.visible = s.mesh.visible;
    });
  }
}
