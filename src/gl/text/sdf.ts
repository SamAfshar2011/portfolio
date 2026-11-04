import { DataTexture, RedFormat, UnsignedByteType, LinearFilter, NoColorSpace } from 'three/webgpu';

/**
 * Signed-distance-field text, generated from the browser's own text renderer.
 *
 * Text is drawn with Canvas 2D (so it gets the real web font, variable axes,
 * kerning, and native shaping for Persian script), then converted into a
 * signed distance field with the Felzenszwalb–Huttenlocher exact Euclidean
 * distance transform. Anti-aliased edge pixels seed sub-pixel distances.
 *
 * Why not troika-three-text: its material patches WebGL shaders (unsupported
 * by WebGPURenderer) and its GPU-generated atlas reads back empty on WebKit.
 * This path has no GPU dependency and behaves identically everywhere.
 */
export interface SdfTextSpec {
  text: string;
  /** CSS font-family list, e.g. `'Mona Sans Variable', sans-serif`. */
  family: string;
  weight?: number;
  /** Pixel size used for rasterising (quality). */
  size?: number;
  /** Canvas fontStretch keyword where supported (e.g. 'semi-expanded'). */
  stretch?: string;
  /** Letter spacing in em. */
  tracking?: number;
  direction?: 'ltr' | 'rtl';
  /** SDF spread in pixels: the maximum blur/outline the field can represent. */
  radius?: number;
}

export interface SdfTextResult {
  texture: DataTexture;
  /** Texture size in pixels. */
  width: number;
  height: number;
  /** Size of the text block (without padding) in em. */
  emWidth: number;
  emHeight: number;
  /** Padding around the text in em (the quad must include it). */
  padEm: number;
  radius: number;
  size: number;
  /** Pixels below the baseline in the rasterised text (descenders). */
  descent: number;
}

const INF = 1e20;

function edt1d(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  let k = 0;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, j = 0; q < n; q++) {
    while (z[j + 1] < q) j++;
    const r = q - v[j];
    d[q] = r * r + f[v[j]];
  }
}

function edt2d(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
}

export async function createSdfText(spec: SdfTextSpec): Promise<SdfTextResult> {
  const size = spec.size ?? 160;
  const radius = spec.radius ?? Math.round(size * 0.18);
  const fontCss = `${spec.weight ?? 700} ${size}px ${spec.family}`;

  // Make sure the face is ready; otherwise the canvas silently uses a fallback.
  try {
    await document.fonts.load(fontCss, spec.text);
  } catch {
    /* fall back to whatever the browser has */
  }

  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d')!;
  const apply = (ctx: CanvasRenderingContext2D) => {
    ctx.font = fontCss;
    const c = ctx as CanvasRenderingContext2D & { fontStretch?: CanvasFontStretch; letterSpacing?: string };
    if (spec.stretch && 'fontStretch' in c) c.fontStretch = spec.stretch as CanvasFontStretch;
    if (spec.tracking && 'letterSpacing' in c) c.letterSpacing = `${spec.tracking * size}px`;
    ctx.direction = spec.direction ?? 'ltr';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  };
  apply(mctx);
  const m = mctx.measureText(spec.text);
  const ascent = m.actualBoundingBoxAscent;
  const descent = m.actualBoundingBoxDescent;
  const left = m.actualBoundingBoxLeft;
  const textW = Math.ceil(left + m.actualBoundingBoxRight);
  const textH = Math.ceil(ascent + descent);
  const pad = radius + 2;
  const w = textW + pad * 2;
  const h = textH + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  apply(ctx);
  ctx.fillStyle = '#fff';
  ctx.fillText(spec.text, pad + left, pad + ascent);
  const alpha = ctx.getImageData(0, 0, w, h).data;

  const outer = new Float64Array(w * h);
  const inner = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i * 4 + 3] / 255;
    if (a >= 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a <= 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      const e = 0.5 - a;
      outer[i] = e > 0 ? e * e : 0;
      inner[i] = e < 0 ? e * e : 0;
    }
  }
  edt2d(outer, w, h);
  edt2d(inner, w, h);

  // Store 0.5 at the edge; 0 = `radius` px outside, 1 = `radius` px inside.
  // Rows are written bottom-up so the texture needs no flip.
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = y * w;
    const dst = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) {
      const dist = Math.sqrt(outer[src + x]) - Math.sqrt(inner[src + x]);
      const v = 0.5 - dist / (2 * radius);
      data[dst + x] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }

  const texture = new DataTexture(data, w, h, RedFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  return {
    texture,
    width: w,
    height: h,
    emWidth: textW / size,
    emHeight: textH / size,
    padEm: pad / size,
    radius,
    size,
    descent: Math.max(0, Math.ceil(descent)),
  };
}
