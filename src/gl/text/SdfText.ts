import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, Color, DoubleSide } from 'three/webgpu';
import { Fn, uniform, uv, texture, vec2, vec4, float, clamp, pow, smoothstep, fwidth, mix, sin } from 'three/tsl';
import { createSdfText, type SdfTextSpec, type SdfTextResult } from './sdf';

/**
 * A block of SDF text on a single quad, sized in em (1 world unit = 1 em).
 *
 * The material performs the site's signature "focus pull": glyphs resolve
 * from a soft, low-density blur into a crisp edge, sweeping across the line,
 * while rising slightly into place. Because it's a distance field, blur is
 * physically plausible (edge softening) rather than a texture blur.
 */
export class SdfText extends Mesh {
  readonly color = uniform(new Color('#ede8e1'));
  /** 0..1 reveal sweep across the line. */
  readonly reveal = uniform(1);
  /** Blur while unresolved, in em. */
  readonly blur = uniform(0.09);
  readonly opacity = uniform(1);
  /** Rise while unresolved, in em. */
  readonly rise = uniform(0.1);
  /** Additional glow outside the glyph edge (0 = none). */
  readonly glow = uniform(0);
  readonly info: SdfTextResult;

  private constructor(info: SdfTextResult) {
    const qw = info.emWidth + info.padEm * 2;
    const qh = info.emHeight + info.padEm * 2;
    super(new PlaneGeometry(qw, qh), new MeshBasicNodeMaterial());
    this.info = info;
    this.frustumCulled = false;
    this.material = this.createMaterial(qh);
  }

  static async create(spec: SdfTextSpec, color?: string) {
    const info = await createSdfText(spec);
    const t = new SdfText(info);
    if (color) t.color.value.set(color);
    return t;
  }

  /** Width of the glyphs (excluding padding) in em. */
  get emWidth() {
    return this.info.emWidth;
  }

  private createMaterial(quadHeightEm: number) {
    const info = this.info;
    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
    const map = texture(info.texture);
    const spread = float(0.35);

    m.colorNode = vec4(this.color, 1);
    m.opacityNode = Fn(() => {
      const u = uv();
      const wobble = sin(u.x.mul(37.0)).mul(0.5).add(0.5).mul(0.06);
      const progress = clamp(
        this.reveal.mul(float(1).add(spread)).sub(u.x.mul(0.92)).sub(wobble).div(spread),
        0,
        1,
      );
      const eased = float(1).sub(pow(float(1).sub(progress), 3));
      const lift = float(1).sub(eased).mul(this.rise).div(quadHeightEm);
      const v = map.sample(vec2(u.x, u.y.add(lift))).r;
      const distPx = float(0.5).sub(v).mul(2 * info.radius);
      const aa = fwidth(distPx).mul(0.75);
      const blurPx = float(1).sub(eased).mul(this.blur).mul(info.size);
      const soft = aa.add(blurPx);
      const body = smoothstep(soft, soft.negate(), distPx);
      const halo = smoothstep(float(info.radius), float(0), distPx).mul(this.glow).mul(0.35);
      return body.add(halo).min(1).mul(mix(float(0.3), float(1), eased)).mul(this.opacity);
    })();
    return m;
  }

  dispose() {
    this.geometry.dispose();
    (this.material as MeshBasicNodeMaterial).dispose();
    this.info.texture.dispose();
  }
}
