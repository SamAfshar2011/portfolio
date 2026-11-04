import { ExtrudeGeometry, Shape, Vector3, MeshBasicNodeMaterial, Color, DataTexture, RedFormat, NoBlending } from 'three/webgpu';
import type { Object3D, Texture, UniformNode } from 'three/webgpu';
import {
  Fn,
  uniform,
  positionGeometry,
  positionWorld,
  cameraPosition,
  modelNormalMatrix,
  cameraViewMatrix,
  screenUV,
  texture,
  varying,
  vec2,
  vec3,
  vec4,
  float,
  clamp,
  length,
  normalize,
  max,
  min,
  dot,
  mix,
  pow,
  exp,
  reflect,
  smoothstep,
  step,
  cos,
  saturate,
  fract,
  abs,
  fwidth,
  mx_noise_float,
} from 'three/tsl';

/**
 * A "slab" is the single physical object of the site: a sheet of smoked
 * optical glass with continuously rounded corners and a quarter-round edge
 * bevel. Every formation (stack, floors, plate characters, gauge…) is built
 * from the same slabs, which is what makes page transitions feel continuous.
 *
 * One unit geometry is reshaped per object in the vertex shader with a 9-slice
 * rule: corners keep their shape, the core stretches. Normals are analytic
 * (Minkowski sum of a rounded rectangle and a sphere), so highlights stay
 * perfectly smooth at any size.
 *
 * Optics, in order of what the eye notices:
 *   - refraction of whatever is behind: the studio backdrop, or — when
 *     another slab is behind this one — that slab (see Stage's glass layer)
 *   - absorption that grows with the path length through the glass
 *     (Beer–Lambert), so thin faces stay clear and grazing views go deep
 *   - studio reflections weighted by Fresnel, a crisp arris line where the
 *     face meets the bevel, and faint thin-film colour on the bevel only
 *   - tiny imperfections: float-glass waviness in the refraction and a
 *     polish that varies across the face
 *   - an optional glyph etched inside the glass (the story's beats)
 */
const R0 = 0.25; // unit corner radius
const B0 = 0.03; // unit edge bevel (R0/B0 fixed so bevels scale uniformly)
export const SLAB_BEVEL_RATIO = B0 / R0;
/** Largest slab id the glass layer can encode (ids are 0..LAYER_IDS-2). */
export const LAYER_IDS = 32;

export function createSlabGeometry(curveSegments = 10, bevelSegments = 5) {
  const h = 0.5 - B0;
  const rc = R0 - B0;
  const shape = new Shape();
  shape.moveTo(-h + rc, -h);
  shape.lineTo(h - rc, -h);
  shape.absarc(h - rc, -h + rc, rc, -Math.PI / 2, 0, false);
  shape.lineTo(h, h - rc);
  shape.absarc(h - rc, h - rc, rc, 0, Math.PI / 2, false);
  shape.lineTo(-h + rc, h);
  shape.absarc(-h + rc, h - rc, rc, Math.PI / 2, Math.PI, false);
  shape.lineTo(-h, -h + rc);
  shape.absarc(-h + rc, -h + rc, rc, Math.PI, Math.PI * 1.5, false);
  const geo = new ExtrudeGeometry(shape, {
    depth: 1 - 2 * B0,
    bevelEnabled: true,
    bevelThickness: B0,
    bevelSize: B0,
    bevelSegments,
    curveSegments,
  });
  geo.translate(0, 0, -(0.5 - B0));
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo.computeBoundingSphere();
  // Bounds must cover any reshaped size; slabs are culled manually instead.
  geo.boundingSphere!.radius = 50;
  return geo;
}

export interface SlabData {
  /** Stable identity (0..SLAB_COUNT-1), used by the glass layer. */
  id: number;
  /** Half extents (x, y = face, z = thickness/2). */
  size: Vector3;
  /** Corner radius in the face plane. */
  radius: number;
  /** Dichroic phase offset: each slab catches a slightly different colour. */
  phase: number;
  /** Additive light used by formations (scan lines, highlights). */
  glow: number;
  /** 0..1 dissolve into the backdrop. */
  presence: number;
  /** 0..1 visibility of the etched glyph. */
  etch: number;
  /** Row of the etch atlas; -1 = none. */
  etchIndex: number;
  /** 0 = label along the bottom edge, 1 = one large centred glyph. */
  etchStyle: number;
  /** Glow colour: 0 = the room's second accent, 1 = its main accent. */
  hue: number;
}

/** Glyphs etched inside the glass: one row per glyph, all at one em size. */
export interface EtchAtlas {
  texture: Texture;
  rows: number;
  /** Width of the atlas and height of one row, in em. */
  widthEm: number;
  rowEm: number;
}

export interface SlabMaterialOptions {
  backdrop: Texture;
  /** Pointer-driven key light direction (world space). */
  lightDir: UniformNode<'vec3', Vector3>;
  accent: UniformNode<'color', Color>;
  accent2: UniformNode<'color', Color>;
  time: UniformNode<'float', number>;
  /** Dispersion + refraction strength, reduced on lean quality. */
  refraction: UniformNode<'float', number>;
  /** Glass layer (farthest slab per pixel, id in alpha); omit to render it. */
  layer?: Texture;
  layerOn?: UniformNode<'float', number>;
  etch: {
    map: ReturnType<typeof createEtchUniforms>['map'];
    rows: UniformNode<'float', number>;
    widthEm: UniformNode<'float', number>;
    rowEm: UniformNode<'float', number>;
  };
}

const data = (o: Object3D | null) => o!.userData.slab as SlabData;

/** Shared etch uniforms (the atlas arrives after fonts load). */
export function createEtchUniforms() {
  const blank = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat);
  blank.needsUpdate = true;
  return {
    map: texture(blank),
    rows: uniform(1),
    widthEm: uniform(1),
    rowEm: uniform(1),
  };
}

export function createSlabMaterial(opts: SlabMaterialOptions) {
  const uSize = uniform(new Vector3(1, 1, 0.05)).onObjectUpdate(({ object }) => data(object).size);
  const uRadius = uniform(0.18).onObjectUpdate(({ object }) => data(object).radius);
  const uPhase = uniform(0).onObjectUpdate(({ object }) => data(object).phase);
  const uGlow = uniform(0).onObjectUpdate(({ object }) => data(object).glow);
  const uPresence = uniform(1).onObjectUpdate(({ object }) => data(object).presence);
  const uEtch = uniform(0).onObjectUpdate(({ object }) => data(object).etch);
  const uEtchRow = uniform(-1).onObjectUpdate(({ object }) => data(object).etchIndex);
  const uEtchStyle = uniform(0).onObjectUpdate(({ object }) => data(object).etchStyle);
  const uHue = uniform(0).onObjectUpdate(({ object }) => data(object).hue);
  const uId = uniform(0).onObjectUpdate(({ object }) => data(object).id);
  const isLayerPass = !opts.layer;

  const material = new MeshBasicNodeMaterial();
  material.toneMapped = true;
  if (isLayerPass) {
    // The layer pass writes the slab id into alpha; keep it.
    material.blending = NoBlending;
    material.depthTest = false;
    material.depthWrite = false;
  }

  // --- vertex: 9-slice reshape ------------------------------------------------
  const k = uRadius.div(R0);
  const bevel = k.mul(B0);
  const reshaped = Fn(() => {
    const p = positionGeometry;
    const c0 = float(0.5 - R0);
    const z0 = float(0.5 - B0);
    const coreXY = clamp(p.xy, c0.negate(), c0);
    const xy = coreXY.div(c0).mul(uSize.xy.sub(uRadius)).add(p.xy.sub(coreXY).mul(k));
    const coreZ = clamp(p.z, z0.negate(), z0);
    const z = coreZ.div(z0).mul(uSize.z.sub(bevel)).add(p.z.sub(coreZ).mul(k));
    return vec3(xy, z);
  })();
  material.positionNode = reshaped;
  const vLocal = varying(reshaped, 'vSlabLocal');

  const layerTex = opts.layer ? texture(opts.layer) : null;
  const layerOn = opts.layerOn ?? uniform(0);
  const myCode = uId.add(1).div(LAYER_IDS);

  /** What lies behind this slab at a screen position: another slab, or the studio. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const behindAt = (uv: any) => {
    const bd = texture(opts.backdrop, uv);
    if (!layerTex) return bd.rgb;
    const l = layerTex.sample(uv);
    // Another slab if the layer holds an id that is not ours.
    const other = step(float(0.5 / LAYER_IDS), l.a).mul(step(float(0.5 / LAYER_IDS), abs(l.a.sub(myCode)))).mul(layerOn);
    return mix(bd.rgb, l.rgb, other);
  };

  // --- fragment ---------------------------------------------------------------
  material.colorNode = Fn(() => {
    const P = vLocal;
    // Analytic normal of (rounded rect core) ⊕ sphere(bevel).
    const s = uSize.xy.sub(bevel);
    const rc = max(uRadius.sub(bevel), float(0.0001));
    const lim = max(s.sub(rc), vec2(0));
    const q = clamp(P.xy, lim.negate(), lim);
    const d = P.xy.sub(q);
    const dl = length(d);
    const xyClosest = q.add(d.div(max(dl, float(1e-5))).mul(min(dl, rc)));
    const zLim = max(uSize.z.sub(bevel), float(0));
    const zClosest = clamp(P.z, zLim.negate(), zLim);
    const nLocal = normalize(P.sub(vec3(xyClosest, zClosest)));

    const N = normalize(modelNormalMatrix.mul(nLocal));
    const V = normalize(cameraPosition.sub(positionWorld));
    const NdV = saturate(dot(N, V));
    const fres = float(0.04).add(float(0.96).mul(pow(float(1).sub(NdV), 5)));

    // Face (0) → machined edge (1).
    const bevelW = smoothstep(0.05, 0.95, float(1).sub(abs(nLocal.z)));
    const faceW = float(1).sub(bevelW);

    // Imperfections: a slow float-glass wave in the refraction and a polish
    // that varies across the face. Both are tiny; they read as "real".
    const seed = uPhase.mul(17.0);
    const wave = vec2(
      mx_noise_float(P.xy.mul(1.7).add(seed)),
      mx_noise_float(P.xy.mul(1.7).add(seed).add(vec2(5.2, 1.3))),
    );
    const polish = mx_noise_float(P.xy.mul(9.0).add(seed.mul(0.5))).mul(0.5).add(0.5);

    // Refraction. Flat faces displace the image only slightly (a thin
    // parallel slab); the rounded bevels bend it hard.
    const nView = cameraViewMatrix.mul(vec4(N, 0)).xyz;
    const thick = uSize.z.mul(2.0);
    const off = vec2(nView.x, nView.y.negate())
      .mul(opts.refraction)
      .mul(bevelW.mul(0.9).add(thick.mul(1.2)).add(0.08))
      .add(wave.mul(0.0014).mul(faceW));
    const uv0 = screenUV;
    // Dispersion: each channel bends a little differently.
    const r = behindAt(uv0.add(off.mul(1.0))).r;
    const g = behindAt(uv0.add(off.mul(1.045))).g;
    const b = behindAt(uv0.add(off.mul(1.09))).b;
    const behind = vec3(r, g, b);
    const straight = texture(opts.backdrop, uv0).rgb;
    // Frost: polished-but-thick glass softens what is seen through it.
    const fr = float(0.0065);
    const refr = uv0.add(off);
    const frost = texture(opts.backdrop, refr.add(vec2(fr, 0)))
      .rgb.add(texture(opts.backdrop, refr.sub(vec2(fr, 0))).rgb)
      .add(texture(opts.backdrop, refr.add(vec2(0, fr))).rgb)
      .add(texture(opts.backdrop, refr.sub(vec2(0, fr))).rgb)
      .mul(0.25);
    const frostAmt = mix(float(0.36), float(0.5), polish);

    // Absorption (Beer–Lambert): light crossing more glass is darker and
    // slightly cooler. The path through a face grows as the view grazes it;
    // the bevel is thick glass seen edge-on.
    const path = thick.div(max(NdV, float(0.28))).add(bevelW.mul(thick).mul(1.5));
    const sigma = vec3(1.0, 0.985, 0.955).mul(7.6);
    const transmit = exp(sigma.mul(path).negate());
    const body = mix(behind, mix(behind, frost, frostAmt), faceW).mul(transmit).add(opts.accent.mul(0.006));

    // Studio reflections: an overhead softbox, a strip light, the moving key.
    const R = reflect(V.negate(), N);
    const L = opts.lightDir;
    const top = smoothstep(0.6, 0.98, R.y).mul(0.16);
    const strip = smoothstep(0.95, 0.997, dot(R, normalize(vec3(-0.75, 0.25, 0.62)))).mul(0.7);
    const keyDot = max(dot(R, L), float(0));
    // The polish varies the key highlight's sharpness very slightly.
    const key = pow(keyDot, mix(float(90), float(150), polish)).mul(2.4);
    const soft = pow(keyDot, 5).mul(0.1);
    // Screen-space reflection of the studio backdrop gives the glass volume.
    const rView = cameraViewMatrix.mul(vec4(R, 0)).xyz;
    const mirrored = texture(opts.backdrop, uv0.sub(vec2(rView.x, rView.y.negate()).mul(0.22))).rgb;
    // A large softbox above-left of the camera: faces turned toward the
    // viewer carry a broad, soft sheen that slides across as they rotate.
    const box = smoothstep(0.72, 0.985, dot(R, normalize(vec3(-0.32, 0.42, 0.85)))).mul(0.11).mul(faceW);
    const env = vec3(1.0, 0.97, 0.93)
      .mul(top.add(strip).add(soft).add(box))
      .add(vec3(1, 0.95, 0.88).mul(key))
      .add(mirrored.mul(2.4));

    // Thin-film colour on the machined edge only, restrained.
    const t = fract(float(1).sub(NdV).mul(1.35).add(uPhase).add(opts.time.mul(0.015)));
    const film = vec3(0.62, 0.62, 0.62).add(vec3(0.33, 0.3, 0.3).mul(cos(vec3(0.55, 0.72, 0.95).add(t).mul(6.2831))));
    const edge = pow(float(1).sub(NdV), 3.0);
    const dichroic = film.mul(bevelW).mul(edge.mul(0.26).add(0.04));
    // Light trapped inside the glass exits at the edges: the bright rim.
    const trapped = vec3(1.0, 0.93, 0.84).mul(bevelW).mul(0.035);
    // The arris: a hairline where the face turns into the bevel, brightest
    // where it faces the key light.
    const e = float(1).sub(abs(nLocal.z));
    const arrisBand = exp(e.sub(0.035).div(0.02).mul(e.sub(0.035).div(0.02)).negate());
    const facing = saturate(dot(N, L));
    const arris = vec3(1.0, 0.96, 0.9).mul(arrisBand).mul(facing.mul(facing).mul(0.55).add(0.12));
    // Faces carry a faint vertical sheen, as if lit from above.
    const faceY = P.y.div(max(uSize.y, float(0.001)));
    const sheen = smoothstep(-0.3, 1.0, faceY).mul(faceW).mul(0.02);

    // Highlight light lives in the rim and seeps a little into the face.
    const glow = mix(opts.accent2, opts.accent, uHue)
      .mul(uGlow).mul(bevelW.mul(0.9).add(edge.mul(0.5)).add(sheen.mul(6)).add(0.05));

    // Etched glyph: sub-surface engraving scatters light in every direction,
    // so it reads as pale frost that brightens toward the key light.
    // Style 0: a label along the bottom-left of the face. Style 1: one glyph
    // filling the middle of the face (the plate's character chambers).
    const rows = opts.etch.rows;
    const em = mix(uSize.y.mul(0.2), uSize.y.mul(1.18), uEtchStyle);
    const labelX = P.x.sub(uSize.x.negate().add(uSize.x.mul(0.17))).div(em.mul(opts.etch.widthEm));
    const labelY = P.y.sub(uSize.y.negate().add(uSize.y.mul(0.1))).div(em.mul(opts.etch.rowEm));
    const glyphX = P.x.div(em.mul(opts.etch.widthEm)).add(0.5);
    const glyphY = P.y.div(em.mul(opts.etch.rowEm)).add(0.5);
    const ex = mix(labelX, glyphX, uEtchStyle);
    const ey = mix(labelY, glyphY, uEtchStyle);
    const inside = step(0, ex).mul(step(ex, 1)).mul(step(0, ey)).mul(step(ey, 1)).mul(step(-0.5, uEtchRow));
    const sd = vec4(opts.etch.map.sample(vec2(ex, uEtchRow.add(ey).div(rows)))).x;
    const aa = fwidth(sd).mul(0.8).add(0.004);
    const etchMask = smoothstep(float(0.5).sub(aa), float(0.5).add(aa), sd).mul(inside).mul(uEtch).mul(faceW);
    const etchLight = vec3(0.97, 0.95, 0.92).mul(facing.mul(0.16).add(0.07).add(fres.mul(0.2)));

    const lit = mix(mix(body, frost.mul(1.05), etchMask.mul(0.45)), env, fres)
      .add(dichroic)
      .add(trapped)
      .add(arris)
      .add(sheen)
      .add(env.mul(0.25).mul(bevelW))
      .add(glow)
      .add(etchLight.mul(etchMask));
    const out = mix(straight, lit, uPresence);
    if (isLayerPass) return vec4(out, myCode);
    return out;
  })();

  return material;
}
