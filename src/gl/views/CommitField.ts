import {
  InstancedMesh,
  Mesh,
  PlaneGeometry,
  MeshBasicNodeMaterial,
  Matrix4,
  Quaternion,
  Vector3,
  Vector2,
  Color,
  InstancedBufferAttribute,
  DynamicDrawUsage,
  Raycaster,
  Plane,
} from 'three/webgpu';
import type { Texture, Node } from 'three/webgpu';
import {
  Fn,
  uniform,
  normalWorld,
  positionWorld,
  cameraPosition,
  cameraViewMatrix,
  screenUV,
  viewportUV,
  texture,
  instancedDynamicBufferAttribute,
  instanceIndex,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  normalize,
  dot,
  pow,
  max,
  mix,
  reflect,
  smoothstep,
  saturate,
  cos,
  fract,
  length,
  hash,
  exp,
  min,
} from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type RAPIERNS from '@dimforge/rapier3d-compat';
import { DomView } from './DomView';
import { loadRapier } from '../physics';

type Rapier = typeof RAPIERNS;

/**
 * The commit field — the GitHub moment.
 *
 * A tray of small glass blocks, each one a unit of work. They are real rigid
 * bodies (Rapier): your pointer is a light that pushes them around, a tap
 * sends a ripple through them. Approach the GitHub control and the blocks
 * lift and file themselves into a 7-row grid, the shape of a contribution
 * graph: disorder becoming a record. Activating it sends a wave of light
 * across the grid before leaving for GitHub.
 */
const HALF = 0.15;
const PITCH = 0.4;

export class CommitField extends DomView {
  private R!: Rapier;
  private world!: RAPIERNS.World;
  private bodies: RAPIERNS.RigidBody[] = [];
  private ball!: RAPIERNS.RigidBody;
  private cubes!: InstancedMesh;
  private shadows!: InstancedMesh;
  private lightAttr!: InstancedBufferAttribute;
  private shadowAttr!: InstancedBufferAttribute;
  private cols: number;
  private rows = 7;
  private bounds: { x: number; z: number };
  private mode: 'loose' | 'order' = 'loose';
  private orderedAt = 0;
  private time = 0;
  private acc = 0;
  private pointerWorld = new Vector3(0, -10, 0);
  private pointerActive = false;
  private pointerU = uniform(new Vector2(0, 0));
  private pointerGlow = uniform(0);
  private wave = -1;
  private launchT = 0;
  private launching = false;
  private raycaster = new Raycaster();
  private plane = new Plane(new Vector3(0, 1, 0), -0.3);
  private tmpM = new Matrix4();
  private tmpQ = new Quaternion();
  private tmpS = new Vector3(1, 1, 1);
  private tmpP = new Vector3();
  private readonly camHome = new Vector3();
  private readonly camLaunch = new Vector3();

  private constructor(el: HTMLElement, R: Rapier, backdrop: Texture, compact: boolean, settled: boolean) {
    super(el);
    this.R = R;
    this.cols = compact ? 9 : 17;
    this.bounds = { x: (this.cols * PITCH) / 2 + 0.55, z: (this.rows * PITCH) / 2 + 0.5 };
    this.camera.fov = compact ? 42 : 30;
    this.camHome.set(0, compact ? 6.4 : 5.1, compact ? 4.6 : 5.4);
    this.camLaunch.set(0, 3.2, 2.4);
    this.camera.position.copy(this.camHome);
    this.camera.lookAt(0, 0, 0.15);
    this.build(backdrop);
    this.buildPhysics(settled);
  }

  static async create(el: HTMLElement, backdrop: Texture, compact: boolean, settled = false) {
    const R = await loadRapier();
    return new CommitField(el, R, backdrop, compact, settled);
  }

  /** Called once, after the first frame has actually been drawn. */
  onFirstFrame: (() => void) | null = null;
  /** The blocks fall into the tray the first time the field is seen. */
  private dropping = false;
  private seen = false;

  get count() {
    return this.cols * this.rows;
  }

  private build(backdrop: Texture) {
    const n = this.count;
    // ---- glass blocks
    const geo = new RoundedBoxGeometry(HALF * 2, HALF * 2, HALF * 2, 3, 0.045);
    this.lightAttr = new InstancedBufferAttribute(new Float32Array(n), 1);
    this.lightAttr.setUsage(DynamicDrawUsage);
    const aLight = instancedDynamicBufferAttribute(this.lightAttr, 'float') as unknown as Node<'float'>;
    const accent = uniform(new Color('#ffe6c2'));
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const N = normalize(normalWorld);
      const V = normalize(cameraPosition.sub(positionWorld));
      const NdV = saturate(dot(N, V));
      const fres = float(0.04).add(float(0.96).mul(pow(float(1).sub(NdV), 5)));
      const nView = cameraViewMatrix.mul(vec4(N, 0)).xyz;
      const behind = texture(backdrop, screenUV.add(vec2(nView.x, nView.y.negate()).mul(0.035))).rgb.mul(0.55);
      const R = reflect(V.negate(), N);
      const top = smoothstep(0.35, 0.95, R.y).mul(0.38);
      const key = pow(max(dot(R, normalize(vec3(-0.45, 0.8, 0.4))), float(0)), 70).mul(1.8);
      const env = vec3(1, 0.97, 0.93).mul(top.add(key));
      const phase = hash(float(instanceIndex)).mul(0.6);
      const t = fract(float(1).sub(NdV).mul(1.2).add(phase));
      const film = vec3(0.62).add(vec3(0.33, 0.3, 0.3).mul(cos(vec3(0.55, 0.72, 0.95).add(t).mul(6.2831))));
      const edge = pow(float(1).sub(NdV), 2.4);
      const lit = mix(behind.add(vec3(0.018, 0.017, 0.016)), env, fres)
        .add(film.mul(edge).mul(0.3))
        .add(accent.mul(aLight).mul(edge.mul(1.2).add(0.35)));
      return lit;
    })();
    this.cubes = new InstancedMesh(geo, mat, n);
    this.cubes.instanceMatrix.setUsage(DynamicDrawUsage);
    this.cubes.frustumCulled = false;
    this.scene.add(this.cubes);

    // ---- soft contact shadows (one blurred disc under each block)
    this.shadowAttr = new InstancedBufferAttribute(new Float32Array(n), 1);
    this.shadowAttr.setUsage(DynamicDrawUsage);
    const aShadow = instancedDynamicBufferAttribute(this.shadowAttr, 'float') as unknown as Node<'float'>;
    const sMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    sMat.colorNode = vec3(0, 0, 0);
    sMat.opacityNode = Fn(() => {
      const d = length(uv().sub(0.5)).mul(2);
      return smoothstep(1, 0.15, d).mul(aShadow).mul(0.6);
    })();
    const sGeo = new PlaneGeometry(0.62, 0.62);
    sGeo.rotateX(-Math.PI / 2);
    this.shadows = new InstancedMesh(sGeo, sMat, n);
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.scene.add(this.shadows);

    // ---- the tray surface: a softly lit plane that dissolves into the page
    const fMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const bx = this.bounds.x;
    const bz = this.bounds.z;
    fMat.colorNode = Fn(() => {
      const p = positionWorld.xz;
      const pool = exp(length(p.sub(vec2(-bx * 0.35, -bz * 0.6)).mul(vec2(0.35, 0.6))).mul(-1.4)).mul(0.05);
      const glow = exp(length(p.sub(this.pointerU)).mul(-2.6)).mul(this.pointerGlow).mul(0.09);
      return vec3(0.03, 0.028, 0.026).add(vec3(1, 0.93, 0.82).mul(pool.add(glow)));
    })();
    fMat.opacityNode = Fn(() => {
      const e = min(min(viewportUV.x, float(1).sub(viewportUV.x)), min(viewportUV.y, float(1).sub(viewportUV.y)));
      return smoothstep(0.0, 0.16, e).mul(0.92);
    })();
    const floor = new Mesh(new PlaneGeometry(bx * 5, bz * 6), fMat);
    floor.rotation.x = -Math.PI / 2;
    floor.renderOrder = 0;
    this.scene.add(floor);
    this.cubes.renderOrder = 2;
  }

  private buildPhysics(settled: boolean) {
    const R = this.R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    const ground = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.world.createCollider(R.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0).setFriction(0.9), ground);
    const { x: bx, z: bz } = this.bounds;
    const wall = (x: number, z: number, hx: number, hz: number) =>
      this.world.createCollider(R.ColliderDesc.cuboid(hx, 2, hz).setTranslation(x, 2, z), ground);
    wall(bx + 0.5, 0, 0.5, bz + 1);
    wall(-bx - 0.5, 0, 0.5, bz + 1);
    wall(0, bz + 0.5, bx + 1, 0.5);
    wall(0, -bz - 0.5, bx + 1, 0.5);

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    for (let i = 0; i < this.count; i++) {
      // Unsettled fields start as a loose column of blocks above the tray
      // (out of frame) and pour in the first time the field is seen.
      const y = settled ? rand(0.3, 2.4) : 3.2 + (i / this.count) * 5.5 + rand(0, 0.6);
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(rand(-bx + 0.4, bx - 0.4), y, rand(-bz + 0.4, bz - 0.4))
          .setRotation(new Quaternion().setFromAxisAngle(new Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), rand(0, Math.PI)))
          .setLinearDamping(0.35)
          .setAngularDamping(0.45)
          .setCanSleep(true),
      );
      this.world.createCollider(R.ColliderDesc.cuboid(HALF, HALF, HALF).setRestitution(0.12).setFriction(0.75).setDensity(1.2), body);
      this.bodies.push(body);
    }
    this.ball = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -5, 0));
    this.world.createCollider(R.ColliderDesc.ball(0.42), this.ball);
    if (settled) {
      // Let the pile settle before anyone sees it.
      for (let i = 0; i < 180; i++) this.world.step();
    } else this.dropping = true;
  }

  protected onVisibility(visible: boolean) {
    if (visible) this.seen = true;
  }

  private gridTarget(i: number) {
    const col = Math.floor(i / this.rows);
    const row = i % this.rows;
    return {
      x: (col - (this.cols - 1) / 2) * PITCH,
      y: HALF + 0.02,
      z: (row - (this.rows - 1) / 2) * PITCH,
      col,
    };
  }

  /** Pointer as a pushing light. Pass `active: false` when the pointer leaves. */
  setPointer(clientX: number, clientY: number, active: boolean) {
    this.pointerActive = active;
    if (!active) return;
    const ndc = this.toNdc(clientX, clientY);
    this.raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), this.camera);
    this.raycaster.ray.intersectPlane(this.plane, this.pointerWorld);
  }

  /** A tap sends a radial impulse through the pile. */
  impulse(clientX: number, clientY: number) {
    if (this.mode === 'order') return;
    this.setPointer(clientX, clientY, true);
    const c = this.pointerWorld;
    for (const b of this.bodies) {
      const t = b.translation();
      const dx = t.x - c.x;
      const dz = t.z - c.z;
      const d = Math.hypot(dx, dz) + 0.2;
      const f = Math.max(0, 1.6 - d) * 0.9;
      if (f <= 0) continue;
      b.applyImpulse({ x: (dx / d) * f * 0.35, y: f * 0.9, z: (dz / d) * f * 0.35 }, true);
      b.applyTorqueImpulse({ x: (Math.random() - 0.5) * 0.02, y: (Math.random() - 0.5) * 0.02, z: (Math.random() - 0.5) * 0.02 }, true);
    }
    this.pointerActive = false;
  }

  /** Blocks file themselves into the grid (true) or fall back into a pile. */
  setOrdered(on: boolean) {
    if (this.launching) return;
    const R = this.R;
    if (on && this.mode !== 'order') {
      this.mode = 'order';
      this.orderedAt = this.time;
      this.bodies.forEach((b) => b.setBodyType(R.RigidBodyType.KinematicPositionBased, true));
    } else if (!on && this.mode === 'order') {
      this.mode = 'loose';
      this.bodies.forEach((b) => {
        b.setBodyType(R.RigidBodyType.Dynamic, true);
        b.setLinvel({ x: (Math.random() - 0.5) * 0.6, y: 0.5 + Math.random() * 0.8, z: (Math.random() - 0.5) * 0.6 }, true);
        b.setAngvel({ x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 }, true);
      });
    }
  }

  /** Wave of light across the grid, then a short camera dive. Resolves when done. */
  launch(): Promise<void> {
    this.setOrdered(true);
    this.launching = true;
    this.wave = 0;
    this.launchT = 0;
    return new Promise((resolve) => window.setTimeout(resolve, 520));
  }

  resetLaunch() {
    this.launching = false;
    this.wave = -1;
    this.launchT = 0;
    this.camera.position.copy(this.camHome);
    this.camera.lookAt(0, 0, 0.15);
  }

  protected update(dt: number) {
    this.time += dt;
    const step = 1 / 60;
    // Hold the pour until the field is actually on screen.
    this.acc = this.dropping && !this.seen ? 0 : Math.min(this.acc + dt, step * 4);

    // Kinematic pointer ball follows the pointer just above the floor.
    const target = this.pointerActive && this.mode === 'loose' ? this.pointerWorld : this.tmpP.set(0, -5, 0);
    while (this.acc >= step) {
      this.ball.setNextKinematicTranslation({ x: target.x, y: target.y > -1 ? 0.3 : -5, z: target.z });
      if (this.mode === 'order') this.driveToGrid(step);
      this.world.step();
      this.acc -= step;
    }

    this.pointerU.value.set(this.pointerWorld.x, this.pointerWorld.z);
    this.pointerGlow.value += ((this.pointerActive ? 1 : 0) - this.pointerGlow.value) * Math.min(1, dt * 6);

    const lights = this.lightAttr.array as Float32Array;
    const shadows = this.shadowAttr.array as Float32Array;
    if (this.wave >= 0) this.wave += dt * 34;
    if (this.launching) {
      this.launchT = Math.min(1, this.launchT + dt * 1.6);
      const k = this.launchT * this.launchT * (3 - 2 * this.launchT);
      this.camera.position.lerpVectors(this.camHome, this.camLaunch, k);
      this.camera.lookAt(0, 0, 0.15);
    }

    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const t = b.translation();
      const r = b.rotation();
      this.tmpP.set(t.x, t.y, t.z);
      this.tmpQ.set(r.x, r.y, r.z, r.w);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      this.cubes.setMatrixAt(i, this.tmpM);

      const h = Math.max(0, t.y - HALF);
      shadows[i] = Math.max(0, 1 - h * 0.9);
      this.tmpM.makeTranslation(t.x, 0.002, t.z);
      const s = 1 + h * 0.8;
      this.tmpM.scale(this.tmpP.set(s, 1, s));
      this.shadows.setMatrixAt(i, this.tmpM);

      // Light: near the pointer, and the launch wave sweeping column by column.
      let l = 0;
      if (this.mode === 'loose' && this.pointerActive) {
        const d = Math.hypot(t.x - this.pointerWorld.x, t.z - this.pointerWorld.z);
        l = Math.max(0, 1 - d / 1.1) * 0.55;
      }
      if (this.wave >= 0) {
        const col = this.gridTarget(i).col;
        l = Math.max(l, Math.max(0, 1 - Math.abs(this.wave - col) / 3));
        if (this.wave > col) l = Math.max(l, 0.45);
      }
      lights[i] += (l - lights[i]) * Math.min(1, dt * 10);
    }
    this.cubes.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.lightAttr.needsUpdate = true;
    this.shadowAttr.needsUpdate = true;
  }

  render(renderer: Parameters<DomView['render']>[0]) {
    super.render(renderer);
    if (this.onFirstFrame && this.visible && this.rect.w > 2) {
      const cb = this.onFirstFrame;
      this.onFirstFrame = null;
      // After the frame this render belongs to has been presented.
      requestAnimationFrame(() => cb());
    }
  }

  private driveToGrid(step: number) {
    const since = this.time - this.orderedAt;
    this.bodies.forEach((b, i) => {
      const g = this.gridTarget(i);
      const delay = g.col * 0.025 + (i % this.rows) * 0.012;
      if (since < delay) return;
      const t = b.translation();
      const r = b.rotation();
      const k = 1 - Math.exp(-9 * step);
      const lift = Math.max(0, 1 - (since - delay) * 2.2) * 0.6;
      b.setNextKinematicTranslation({ x: t.x + (g.x - t.x) * k, y: t.y + (g.y + lift - t.y) * k, z: t.z + (g.z - t.z) * k });
      this.tmpQ.set(r.x, r.y, r.z, r.w).slerp(new Quaternion(), k);
      b.setNextKinematicRotation({ x: this.tmpQ.x, y: this.tmpQ.y, z: this.tmpQ.z, w: this.tmpQ.w });
    });
  }

  dispose() {
    super.dispose();
    this.onFirstFrame = null;
    this.world.free();
    this.cubes.geometry.dispose();
    this.shadows.geometry.dispose();
  }
}
