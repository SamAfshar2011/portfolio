import {
  Group,
  Mesh,
  CylinderGeometry,
  CircleGeometry,
  TorusGeometry,
  BoxGeometry,
  MeshStandardNodeMaterial,
  CanvasTexture,
  SRGBColorSpace,
  NoColorSpace,
  RepeatWrapping,
  DirectionalLight,
  PointLight,
  HemisphereLight,
  PMREMGenerator,
  Raycaster,
  Vector2,
  Vector3,
  Color,
} from 'three/webgpu';
import type { WebGPURenderer, Object3D } from 'three/webgpu';
import { float, smoothstep, positionLocal } from 'three/tsl';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DomView } from './DomView';

/**
 * The medal hall — the honours, as objects.
 *
 * Each medal is a real metal disc: a turned edge, a raised rim and two struck
 * faces whose relief is drawn procedurally (Canvas 2D height map → normal,
 * colour and roughness maps), lit by a studio environment and one key light.
 * Your pointer is a second light; the medals turn to look at it. Click one to
 * turn it over: the back carries the invention it was awarded for.
 */
export interface MedalSpec {
  metal: 'gold' | 'silver';
  ribbon: [string, string];
  ribbonStyle?: 'stripe' | 'dots';
  front: { ring: string; title: string; motif: 'laurel' | 'bulb' | 'wings' };
  back: { ring: string; title: string; lines: string[] };
}

interface Options {
  compact: boolean;
  reducedMotion: boolean;
  onFirstFrame?: () => void;
}

const R = 1; // medal radius (world units)
const T = 0.13; // thickness
const TEX = 768;

const METAL = {
  gold: { base: [229, 182, 78], deep: [120, 82, 22], rough: 0.26 },
  silver: { base: [214, 218, 226], deep: [96, 102, 114], rough: 0.22 },
} as const;

/* ------------------------------------------------------------------ relief */

function arcText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, size: number) {
  ctx.save();
  ctx.font = `700 ${size}px "Mona Sans Variable", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width + size * 0.16);
  const total = widths.reduce((a, b) => a + b, 0);
  const arc = Math.min(total / r, Math.PI * 1.96);
  const scale = arc / (total / r);
  let a = -Math.PI / 2 - arc / 2;
  chars.forEach((c, i) => {
    const w = (widths[i] / r) * scale;
    a += w / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(c, 0, 0);
    ctx.restore();
    a += w / 2;
  });
  ctx.restore();
}

function laurel(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  for (const side of [-1, 1]) {
    for (let k = 0; k < 9; k++) {
      const th = Math.PI / 2 + side * (0.32 + k * 0.27);
      for (const [off, rot] of [
        [0.07, 0.5],
        [-0.07, -0.5],
      ]) {
        const rr = s * (0.5 + off);
        const x = cx + Math.cos(th) * rr;
        const y = cy + Math.sin(th) * rr;
        const z = 1 - k * 0.045;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(th + (Math.PI / 2) * -side + rot * side);
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.11 * z, s * 0.042 * z, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r1: number, r2: number) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? r2 : r1;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

function bulb(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.08, s * 0.24, Math.PI * 0.82, Math.PI * 2.18);
  ctx.lineTo(cx + s * 0.1, cy + s * 0.22);
  ctx.lineTo(cx - s * 0.1, cy + s * 0.22);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 2; i++) ctx.fillRect(cx - s * 0.11, cy + s * (0.25 + i * 0.07), s * 0.22, s * 0.045);
  for (const a of [-1.05, -0.52, 0, 0.52, 1.05]) {
    ctx.save();
    ctx.translate(cx, cy - s * 0.08);
    ctx.rotate(a);
    ctx.fillRect(-s * 0.018, -s * 0.44, s * 0.036, s * 0.11);
    ctx.restore();
  }
}

function wings(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const L = s * (0.5 - k * 0.07);
      const y0 = cy + s * (-0.12 + k * 0.075);
      const x0 = cx + side * s * 0.08;
      const x1 = x0 + side * L;
      const y1 = y0 - s * (0.24 - k * 0.04);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + side * L * 0.6, y1 - s * 0.06, x1, y1);
      ctx.quadraticCurveTo(x0 + side * L * 0.55, y0 - s * 0.01, x0, y0 + s * 0.07);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.13, cy - s * 0.08);
  ctx.lineTo(cx + s * 0.13, cy - s * 0.08);
  ctx.lineTo(cx + s * 0.13, cy + s * 0.12);
  ctx.quadraticCurveTo(cx + s * 0.13, cy + s * 0.28, cx, cy + s * 0.34);
  ctx.quadraticCurveTo(cx - s * 0.13, cy + s * 0.28, cx - s * 0.13, cy + s * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.2, s * 0.075, 0, Math.PI * 2);
  ctx.fill();
}

/** Draws the relief of one face as a height map (white = raised). */
function drawRelief(spec: MedalSpec, back: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d')!;
  const m = TEX / 2;
  ctx.fillStyle = 'rgb(118,118,118)';
  ctx.fillRect(0, 0, TEX, TEX);

  // Struck field with a fine radial brushing.
  ctx.save();
  ctx.translate(m, m);
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const g = 110 + Math.random() * 18;
    ctx.strokeStyle = `rgba(${g},${g},${g},0.28)`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * TEX * 0.5, Math.sin(a) * TEX * 0.5);
    ctx.stroke();
  }
  ctx.restore();

  // Grooves around the inscription band.
  ctx.lineWidth = TEX * 0.006;
  ctx.strokeStyle = 'rgb(70,70,70)';
  for (const r of [0.455, 0.335]) {
    ctx.beginPath();
    ctx.arc(m, m, TEX * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Pearled ring.
  ctx.fillStyle = 'rgb(205,205,205)';
  for (let k = 0; k < 96; k++) {
    const a = (k / 96) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(m + Math.cos(a) * TEX * 0.475, m + Math.sin(a) * TEX * 0.475, TEX * 0.0045, 0, Math.PI * 2);
    ctx.fill();
  }

  const raised = document.createElement('canvas');
  raised.width = raised.height = TEX;
  const r = raised.getContext('2d')!;
  r.fillStyle = '#fff';
  const face = back ? spec.back : spec.front;
  arcText(r, face.ring.toUpperCase(), m, m, TEX * 0.395, TEX * 0.052);

  if (!back) {
    const f = spec.front;
    if (f.motif === 'laurel') {
      laurel(r, m, m - TEX * 0.02, TEX * 0.4);
      star(r, m, m - TEX * 0.1, TEX * 0.045, TEX * 0.019);
    } else if (f.motif === 'bulb') {
      bulb(r, m, m - TEX * 0.06, TEX * 0.42);
    } else {
      wings(r, m, m - TEX * 0.05, TEX * 0.5);
    }
    r.font = `700 ${TEX * 0.07}px "Newsreader Variable", Georgia, serif`;
    r.textAlign = 'center';
    r.textBaseline = 'middle';
    r.fillText(f.title.toUpperCase(), m, m + TEX * 0.235);
  } else {
    const b = spec.back;
    r.textAlign = 'center';
    r.textBaseline = 'middle';
    r.font = `700 ${TEX * 0.1}px "Newsreader Variable", Georgia, serif`;
    r.fillText(b.title.toUpperCase(), m, m - TEX * 0.12);
    r.fillRect(m - TEX * 0.13, m - TEX * 0.055, TEX * 0.26, TEX * 0.006);
    r.font = `700 ${TEX * 0.04}px "Mona Sans Variable", system-ui, sans-serif`;
    b.lines.forEach((line, i) => r.fillText(line.toUpperCase(), m, m + TEX * (0.01 + i * 0.062)));
  }

  // Soft bevel: blurred copy underneath, crisp copy on top.
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.filter = 'blur(3px)';
  ctx.drawImage(raised, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.filter = 'blur(1px)';
  ctx.drawImage(raised, 0, 0);
  ctx.restore();
  return c;
}

/** Height map → colour, normal and roughness textures. */
function bake(height: HTMLCanvasElement, metal: MedalSpec['metal']) {
  const src = height.getContext('2d')!.getImageData(0, 0, TEX, TEX).data;
  const h = new Float32Array(TEX * TEX);
  for (let i = 0; i < h.length; i++) h[i] = src[i * 4] / 255;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = TEX;
    const ctx = c.getContext('2d')!;
    return { c, ctx, img: ctx.createImageData(TEX, TEX) };
  };
  const col = mk();
  const nor = mk();
  const rou = mk();
  const M = METAL[metal];
  const strength = 5.5;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const xl = h[y * TEX + Math.max(x - 1, 0)];
      const xr = h[y * TEX + Math.min(x + 1, TEX - 1)];
      const yu = h[Math.max(y - 1, 0) * TEX + x];
      const yd = h[Math.min(y + 1, TEX - 1) * TEX + x];
      let nx = (xl - xr) * strength;
      let ny = (yd - yu) * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const o = i * 4;
      nor.img.data[o] = (nx * 0.5 + 0.5) * 255;
      nor.img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      nor.img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      nor.img.data[o + 3] = 255;
      // Recesses hold a little patina; raised relief is polished.
      const v = h[i];
      const t = Math.min(Math.max((v - 0.25) / 0.6, 0), 1);
      const k = 0.62 + 0.38 * t;
      col.img.data[o] = M.deep[0] + (M.base[0] - M.deep[0]) * k;
      col.img.data[o + 1] = M.deep[1] + (M.base[1] - M.deep[1]) * k;
      col.img.data[o + 2] = M.deep[2] + (M.base[2] - M.deep[2]) * k;
      col.img.data[o + 3] = 255;
      const rough = 0.5 - 0.34 * t;
      rou.img.data[o] = rou.img.data[o + 1] = rou.img.data[o + 2] = rough * 255;
      rou.img.data[o + 3] = 255;
    }
  }
  const tex = (m: ReturnType<typeof mk>, srgb: boolean) => {
    m.ctx.putImageData(m.img, 0, 0);
    const t = new CanvasTexture(m.c);
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: tex(col, true), normalMap: tex(nor, false), roughnessMap: tex(rou, false) };
}

function ribbonTexture(spec: MedalSpec) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  const [a, b] = spec.ribbon;
  if (spec.ribbonStyle === 'dots') {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 128, 512);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let y = 8; y < 512; y += 22)
      for (let x = (y / 22) % 2 ? 10 : 21; x < 128; x += 22) {
        ctx.beginPath();
        ctx.ellipse(x, y, 4, 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
  } else {
    const g = ctx.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, a);
    g.addColorStop(0.5, b);
    g.addColorStop(1, a);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 512);
    ctx.fillStyle = spec.metal === 'gold' ? '#e8b84a' : '#d9dde4';
    ctx.fillRect(40, 0, 12, 512);
    ctx.fillRect(76, 0, 12, 512);
  }
  // Woven sheen.
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 0; y < 512; y += 3) ctx.fillRect(0, y, 128, 1);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function knurl() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 8;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < 512; x++) {
    const v = Math.sin((x / 512) * Math.PI * 2 * 64);
    ctx.fillStyle = `rgb(${128 + v * 90},128,255)`;
    ctx.fillRect(x, 0, 1, 8);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/* ------------------------------------------------------------------ view */

interface Rig {
  pivot: Group;
  swing: Group;
  turn: Group;
  body: Group;
  phase: number;
  yaw: number;
  yawV: number;
  flip: number;
  flipV: number;
  flipTarget: number;
  hover: number;
  baseX: number;
}

export class MedalHall extends DomView {
  private rigs: Rig[] = [];
  private pickables: Object3D[] = [];
  private envReady = false;
  private firstFrame = false;
  private time = 0;
  private pointer = new Vector2(0, 0);
  private pointerIn = false;
  private pointerWorld = new Vector3();
  private hovered = -1;
  private raycaster = new Raycaster();
  private key = new DirectionalLight('#fff3df', 2.2);
  private torch = new PointLight('#ffe6c2', 0, 9, 1.6);
  private opts: Options;
  private layoutAspect = 0;

  private constructor(el: HTMLElement, opts: Options) {
    super(el);
    this.opts = opts;
    this.camera.fov = opts.compact ? 38 : 30;
    this.key.position.set(3.5, 4.5, 6);
    this.scene.add(this.key);
    const rim = new DirectionalLight('#9fd7e6', 0.9);
    rim.position.set(-5, 1.5, -2);
    this.scene.add(rim);
    this.scene.add(new HemisphereLight('#fff1dc', '#1b1b1d', 0.35));
    this.scene.add(this.torch);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('click', this.onClick);
  }

  static async create(el: HTMLElement, medals: MedalSpec[], opts: Options) {
    try {
      await document.fonts.load('600 40px "Newsreader Variable"');
      await document.fonts.load('700 40px "Newsreader Variable"');
      await document.fonts.load('700 40px "Mona Sans Variable"');
    } catch {
      /* fall back to Georgia */
    }
    const v = new MedalHall(el, opts);
    for (let i = 0; i < medals.length; i++) {
      v.build(medals[i], i, medals.length);
      // Bake one medal per task so the page stays responsive.
      await new Promise((r) => setTimeout(r, 0));
    }
    return v;
  }

  private build(spec: MedalSpec, i: number, n: number) {
    const M = METAL[spec.metal];
    const tint = new Color(`rgb(${M.base.join(',')})`);
    const front = bake(drawRelief(spec, false), spec.metal);
    const back = bake(drawRelief(spec, true), spec.metal);
    const faceMat = (maps: ReturnType<typeof bake>) =>
      new MeshStandardNodeMaterial({ ...maps, metalness: 1, roughness: 1, normalScale: new Vector2(1, 1) });
    const edgeTex = knurl();
    edgeTex.repeat.set(1, 1);
    const edgeMat = new MeshStandardNodeMaterial({ color: tint, metalness: 1, roughness: M.rough + 0.08, normalMap: edgeTex });
    const rimMat = new MeshStandardNodeMaterial({ color: tint, metalness: 1, roughness: M.rough - 0.06 });

    const body = new Group();
    const edge = new Mesh(new CylinderGeometry(R, R, T, 160, 1, true), edgeMat);
    edge.rotation.x = Math.PI / 2;
    body.add(edge);
    const f = new Mesh(new CircleGeometry(R * 0.995, 160), faceMat(front));
    f.position.z = T / 2 - 0.004;
    body.add(f);
    const b = new Mesh(new CircleGeometry(R * 0.995, 160), faceMat(back));
    b.position.z = -T / 2 + 0.004;
    b.rotation.y = Math.PI;
    body.add(b);
    for (const z of [T / 2, -T / 2]) {
      const lip = new Mesh(new TorusGeometry(R * 0.965, 0.036, 14, 180), rimMat);
      lip.position.z = z;
      body.add(lip);
    }
    const bail = new Mesh(new TorusGeometry(0.13, 0.032, 14, 48), rimMat);
    bail.rotation.y = Math.PI / 2;
    bail.position.y = R + 0.1;
    body.add(bail);
    body.position.y = -(R + 0.2);

    const turn = new Group();
    turn.add(body);
    const swing = new Group();
    swing.add(turn);
    const pivot = new Group();
    pivot.add(swing);

    // Ribbon: two strips crossing through the bail, running off the top edge.
    const rt = ribbonTexture(spec);
    const ribbonMat = new MeshStandardNodeMaterial({ map: rt, roughness: 0.72, metalness: 0.05, transparent: true, depthWrite: false });
    // Dissolve towards the top of the frame instead of being cut by it.
    ribbonMat.opacityNode = float(1).sub(smoothstep(0.42, 0.98, positionLocal.y));
    for (const side of [-1, 1]) {
      const strip = new Mesh(new BoxGeometry(0.36, 1.7, 0.012), ribbonMat);
      strip.geometry.translate(0, 0.85, 0);
      strip.rotation.z = side * 0.2;
      strip.position.set(-side * 0.02, -0.12, -0.03 * side);
      pivot.add(strip);
    }

    this.scene.add(pivot);
    this.pickables.push(body);
    body.userData.index = i;
    const rig: Rig = { pivot, swing, turn, body, phase: i * 1.7, yaw: 0, yawV: 0, flip: 0, flipV: 0, flipTarget: 0, hover: 0, baseX: 0 };
    this.rigs.push(rig);
    void n;
  }

  private layout(aspect: number) {
    if (Math.abs(aspect - this.layoutAspect) < 0.01) return;
    this.layoutAspect = aspect;
    const n = this.rigs.length;
    const spacing = this.opts.compact ? 2.3 : 2.75;
    const scale = this.opts.compact ? 0.86 : 1;
    this.rigs.forEach((r, i) => {
      r.baseX = (i - (n - 1) / 2) * spacing;
      r.pivot.position.set(r.baseX, 1.3, 0);
      r.pivot.scale.setScalar(scale);
    });
    const needW = (n - 1) * spacing + 2.6 * scale;
    const needH = 3.75;
    const t = Math.tan((this.camera.fov * Math.PI) / 360);
    const dist = Math.max(needH / (2 * t), needW / (2 * t * aspect));
    this.camera.position.set(0, 0.45, dist);
    this.camera.lookAt(0, 0.28, 0);
    this.camera.updateProjectionMatrix();
  }

  private onMove = (e: PointerEvent) => {
    const p = this.toNdc(e.clientX, e.clientY);
    this.pointer.set(p.x, p.y);
    this.pointerIn = true;
  };

  private onLeave = () => {
    this.pointerIn = false;
    this.hovered = -1;
    this.el.style.cursor = '';
  };

  private onClick = (e: MouseEvent) => {
    const p = this.toNdc(e.clientX, e.clientY);
    const hit = this.pick(p.x, p.y);
    if (hit < 0) return;
    const r = this.rigs[hit];
    r.flipTarget += Math.PI;
    r.flipV += 2.5;
  };

  private pick(x: number, y: number) {
    this.raycaster.setFromCamera(new Vector2(x, y), this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && o.userData.index === undefined) o = o.parent;
      if (o) return o.userData.index as number;
    }
    return -1;
  }

  private ensureEnvironment(renderer: WebGPURenderer) {
    if (this.envReady) return;
    this.envReady = true;
    try {
      const pmrem = new PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      this.scene.environment = pmrem.fromScene(room, 0.035).texture;
      this.scene.environmentIntensity = 0.85;
      room.dispose?.();
    } catch {
      // Without an environment the key, rim and torch lights still model the metal.
      this.scene.add(new HemisphereLight('#fff1dc', '#202024', 1.1));
    }
  }

  render(renderer: WebGPURenderer) {
    this.ensureEnvironment(renderer);
    super.render(renderer);
  }

  protected update(dt: number) {
    this.layout(this.rect.w / Math.max(this.rect.h, 1));
    this.time += dt;
    const t = this.time;
    const still = this.opts.reducedMotion;

    // Pointer → world point on the medal plane; the torch follows it.
    let px = 0;
    let py = 0;
    if (this.pointerIn) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const ray = this.raycaster.ray;
      const k = -ray.origin.z / ray.direction.z;
      this.pointerWorld.copy(ray.origin).addScaledVector(ray.direction, k);
      px = this.pointerWorld.x;
      py = this.pointerWorld.y;
      this.torch.position.set(px, py, 2.6);
      this.hovered = this.pick(this.pointer.x, this.pointer.y);
      this.el.style.cursor = this.hovered >= 0 ? 'pointer' : '';
    }
    const torchTarget = this.pointerIn ? 14 : 0;
    this.torch.intensity += (torchTarget - this.torch.intensity) * Math.min(1, dt * 4);
    // The key light breathes slowly across the hall.
    this.key.position.x = 3.5 + Math.sin(t * 0.25) * 2.5;

    this.rigs.forEach((r, i) => {
      // Turn towards the pointer, or show off the metal while idle.
      const target = this.pointerIn
        ? Math.max(-0.75, Math.min(0.75, (px - r.baseX) * 0.28))
        : still
          ? 0
          : Math.sin(t * 0.45 + r.phase) * 0.32;
      r.yawV += ((target - r.yaw) * 26 - r.yawV * 7) * dt;
      r.yaw += r.yawV * dt;
      r.flipV += ((r.flipTarget - r.flip) * 30 - r.flipV * 6.2) * dt;
      r.flip += r.flipV * dt;
      r.turn.rotation.y = r.yaw + r.flip;
      r.turn.rotation.x = this.pointerIn ? Math.max(-0.25, Math.min(0.25, (py - 0.1) * -0.12)) : 0;
      // Pendulum sway around the ribbon.
      r.swing.rotation.z = still ? 0 : Math.sin(t * 1.1 + r.phase) * 0.025 + r.flipV * 0.004;
      const h = this.hovered === i ? 1 : 0;
      r.hover += (h - r.hover) * Math.min(1, dt * 8);
      r.body.position.z = r.hover * 0.18;
      r.body.scale.setScalar(1 + r.hover * 0.04);
    });

    if (!this.firstFrame) {
      this.firstFrame = true;
      requestAnimationFrame(() => this.opts.onFirstFrame?.());
    }
  }

  dispose() {
    super.dispose();
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerleave', this.onLeave);
    this.el.removeEventListener('click', this.onClick);
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mat = m.material as MeshStandardNodeMaterial;
        mat.map?.dispose();
        mat.normalMap?.dispose();
        mat.roughnessMap?.dispose();
        mat.dispose();
      }
    });
    this.scene.environment?.dispose();
  }
}
