/**
 * The liquid layer: a small WebGL 2 canvas that draws the cursor and, near a
 * control, the material that joins them — as one signed-distance field.
 *
 * Shapes (all in CSS pixels): the cursor (a disc that can stretch toward a
 * target), a neck (a tapered capsule between the cursor and a control), and
 * up to two "skins" hugging controls (rounded rectangles that can bulge
 * toward the pointer). They are combined with a smooth minimum, so where two
 * shapes come close a meniscus forms between them — the bridge, the lobe and
 * the pinch-off all fall out of that one operation.
 *
 * The field is drawn as glass: a lit hairline rim (brightest where it faces
 * the key light, with a hint of dispersion) and a faint fill that belongs
 * only to the cursor's own material, so the control's label is never dimmed.
 *
 * The canvas is a fixed-size window that moves with the action instead of a
 * full-screen layer: the cost is a few hundred thousand fragments, and only
 * while something is moving.
 */
export interface SkinState {
  /** Centre and half size of the control (CSS px, viewport space). */
  x: number;
  y: number;
  hx: number;
  hy: number;
  radius: number;
  /** 0..1 how visible the skin's rim is. */
  alpha: number;
  /** Outward bulge (px) centred at (qx, qy), width sigma. */
  bulge: number;
  sigma: number;
  qx: number;
  qy: number;
  /** Rim tint (linear-ish RGB 0..1). */
  tint: [number, number, number];
}

export interface LiquidState {
  cx: number;
  cy: number;
  /** Cursor radius (px) and overall visibility. */
  r: number;
  visible: number;
  /** Stretch toward (dx, dy) by s (0..~0.6). */
  dx: number;
  dy: number;
  s: number;
  /** Pointer dot. */
  px: number;
  py: number;
  dot: number;
  /** Neck from (ax, ay) to (bx, by), radius r0 at the cursor end, r1 at the far end. */
  neck: { ax: number; ay: number; bx: number; by: number; r0: number; r1: number };
  skins: [SkinState | null, SkinState | null];
  /** Key light position in viewport px. */
  lx: number;
  ly: number;
}

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uOrigin;      // canvas top-left, viewport px
uniform vec2 uSize;        // canvas size, CSS px
uniform float uDpr;
uniform vec4 uCursor;      // cx, cy, r, visible
uniform vec3 uStretch;     // dir.xy, s
uniform vec3 uDot;         // x, y, r
uniform vec4 uNeckA;       // ax, ay, bx, by
uniform vec2 uNeckR;       // r0, r1
uniform vec4 uSkinA; uniform vec4 uSkinA2; uniform vec2 uSkinAq; uniform vec3 uTintA;
uniform vec4 uSkinB; uniform vec4 uSkinB2; uniform vec2 uSkinBq; uniform vec3 uTintB;
uniform vec2 uLight;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// Tapered capsule: radius r0 at a, r1 at b.
float sdNeck(vec2 p, vec2 a, vec2 b, float r0, float r1) {
  vec2 pa = p - a, ba = b - a;
  float l2 = max(dot(ba, ba), 1e-4);
  float h = clamp(dot(pa, ba) / l2, 0.0, 1.0);
  // Thinnest in the middle: a neck, not a tube.
  float r = mix(r0, r1, h) * (1.0 - 0.45 * sin(3.14159 * h));
  return length(pa - ba * h) - r;
}
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float skin(vec2 p, vec4 s, vec4 s2, vec2 q) {
  if (s2.y <= 0.001 && s2.z <= 0.001) return 1e4;
  float d = sdRoundBox(p - s.xy, s.zw, min(s2.x, min(s.z, s.w)));
  vec2 dq = p - q;
  d -= s2.z * exp(-dot(dq, dq) / (2.0 * s2.w * s2.w));
  return d;
}
float cursor(vec2 p) {
  if (uCursor.z <= 0.05) return 1e4;
  vec2 d = p - uCursor.xy;
  vec2 u = uStretch.xy;
  vec2 v = vec2(-u.y, u.x);
  float s = uStretch.z;
  // Stretch toward the target, thin across it (volume roughly kept).
  vec2 q = vec2(dot(d, u) / (1.0 + s), dot(d, v) / (1.0 - 0.3 * s));
  // Egg shape: the leading side reaches further than the trailing one.
  float lead = dot(d, u) > 0.0 ? 1.0 : 1.0 / (1.0 + 0.6 * s);
  q.x *= lead;
  return (length(q) - uCursor.z) * min(1.0, 1.0 - 0.3 * s);
}
// Returns field and how much of it belongs to the cursor (vs a skin).
vec2 field(vec2 p) {
  float c = cursor(p);
  float n = uNeckR.x + uNeckR.y > 0.05 ? sdNeck(p, uNeckA.xy, uNeckA.zw, uNeckR.x, uNeckR.y) : 1e4;
  float cn = smin(c, n, 10.0);
  float a = skin(p, uSkinA, uSkinA2, uSkinAq);
  float b = skin(p, uSkinB, uSkinB2, uSkinBq);
  float sk = min(a, b);
  float d = smin(cn, sk, 14.0);
  float own = clamp(0.5 + (sk - cn) / 14.0, 0.0, 1.0);
  return vec2(d, own);
}

void main() {
  vec2 p = uOrigin + vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 f = field(p);
  float d = f.x;
  float own = f.y;
  // Normal from the field's gradient (for lighting the rim).
  float e = 0.75;
  vec2 g = vec2(field(p + vec2(e, 0.0)).x - field(p - vec2(e, 0.0)).x, field(p + vec2(0.0, e)).x - field(p - vec2(0.0, e)).x);
  vec2 n = normalize(g + 1e-5);
  vec2 toLight = normalize(uLight - p + 1e-5);
  float facing = max(dot(n, toLight), 0.0);

  // Which skin is this pixel nearest to (for its tint and visibility)?
  float da = skin(p, uSkinA, uSkinA2, uSkinAq);
  float db = skin(p, uSkinB, uSkinB2, uSkinBq);
  float wa = da < db ? 1.0 : 0.0;
  float skinAlpha = mix(uSkinB2.y, uSkinA2.y, wa);
  vec3 tint = mix(uTintB, uTintA, wa);
  float vis = mix(skinAlpha, 1.0, own) * uCursor.w;

  // Hairline rim with a whisper of dispersion.
  float aa = 0.9;
  float rimR = 1.0 - smoothstep(0.0, aa, abs(d + 0.35) - 0.45);
  float rimG = 1.0 - smoothstep(0.0, aa, abs(d) - 0.45);
  float rimB = 1.0 - smoothstep(0.0, aa, abs(d - 0.35) - 0.45);
  vec3 bone = vec3(0.93, 0.91, 0.88);
  vec3 rimCol = mix(bone, tint, 0.35 * (1.0 - own));
  float light = 0.42 + 0.58 * facing;
  // Premultiplied throughout: per-channel coverage gives the dispersion.
  vec3 rim = vec3(rimR, rimG, rimB) * rimCol * light * 0.62;
  float rimA = max(rimR, max(rimG, rimB)) * light * 0.62;

  // Meniscus: a thin bright band just inside the edge, facing the light.
  float inner = exp(-pow((d + 2.6) / 1.6, 2.0)) * facing * 0.3;
  // Fill: only the cursor's own material, a faint lit glass.
  vec2 hl = uCursor.xy + vec2(-0.3, -0.4) * uCursor.z;
  float fill = (1.0 - smoothstep(-0.5, 0.5, d)) * own * (0.03 + 0.06 * exp(-dot(p - hl, p - hl) / max(1.0, uCursor.z * uCursor.z)));

  vec3 rgb = (rim + bone * (inner + fill)) * vis;
  float alpha = clamp(rimA + inner + fill, 0.0, 1.0) * vis;

  // The pointer dot, over everything.
  float dd = length(p - uDot.xy) - uDot.z;
  float dotA = (1.0 - smoothstep(-0.6, 0.6, dd)) * step(0.05, uDot.z) * uCursor.w;
  rgb = rgb * (1.0 - dotA) + bone * dotA;
  alpha = alpha * (1.0 - dotA) + dotA;
  outColor = vec4(rgb, alpha);
}`;

export class LiquidLayer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private dpr = 1;
  readonly width: number;
  readonly height: number;
  private ox = 0;
  private oy = 0;
  lost = false;

  static create(width = 640, height = 400) {
    try {
      return new LiquidLayer(width, height);
    } catch {
      return null;
    }
  }

  private constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const canvas = document.createElement('canvas');
    canvas.className = 'cursor-liquid';
    canvas.setAttribute('aria-hidden', 'true');
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('no webgl2');
    this.canvas = canvas;
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uOrigin', 'uSize', 'uDpr', 'uCursor', 'uStretch', 'uDot', 'uNeckA', 'uNeckR', 'uSkinA', 'uSkinA2', 'uSkinAq', 'uTintA', 'uSkinB', 'uSkinB2', 'uSkinBq', 'uTintB', 'uLight'])
      this.u[n] = gl.getUniformLocation(prog, n);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  /** Places the window so the given region (viewport px) sits inside it. */
  place(minX: number, minY: number, maxX: number, maxY: number) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // Snap to whole device pixels so the rim doesn't shimmer while moving.
    const snap = (v: number) => Math.round(v * this.dpr) / this.dpr;
    this.ox = snap(cx - this.width / 2);
    this.oy = snap(cy - this.height / 2);
    this.canvas.style.transform = `translate3d(${this.ox}px, ${this.oy}px, 0)`;
  }

  render(s: LiquidState) {
    if (this.lost) return;
    const gl = this.gl;
    const u = this.u;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(u.uOrigin, this.ox, this.oy);
    gl.uniform2f(u.uSize, this.width, this.height);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform4f(u.uCursor, s.cx, s.cy, s.r, s.visible);
    gl.uniform3f(u.uStretch, s.dx, s.dy, s.s);
    gl.uniform3f(u.uDot, s.px, s.py, s.dot);
    gl.uniform4f(u.uNeckA, s.neck.ax, s.neck.ay, s.neck.bx, s.neck.by);
    gl.uniform2f(u.uNeckR, s.neck.r0, s.neck.r1);
    const setSkin = (k: 'A' | 'B', sk: SkinState | null) => {
      if (!sk) {
        gl.uniform4f(u[`uSkin${k}`], -1e4, -1e4, 1, 1);
        gl.uniform4f(u[`uSkin${k}2`], 0, 0, 0, 1);
        gl.uniform2f(u[`uSkin${k}q`], -1e4, -1e4);
        gl.uniform3f(u[`uTint${k}`], 1, 1, 1);
        return;
      }
      gl.uniform4f(u[`uSkin${k}`], sk.x, sk.y, sk.hx, sk.hy);
      gl.uniform4f(u[`uSkin${k}2`], sk.radius, sk.alpha, sk.bulge, Math.max(1, sk.sigma));
      gl.uniform2f(u[`uSkin${k}q`], sk.qx, sk.qy);
      gl.uniform3f(u[`uTint${k}`], ...sk.tint);
    };
    setSkin('A', s.skins[0]);
    setSkin('B', s.skins[1]);
    gl.uniform2f(u.uLight, s.lx, s.ly);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  clear() {
    if (this.lost) return;
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
    this.canvas.remove();
  }
}
