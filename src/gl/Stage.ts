import {
  WebGPURenderer,
  Scene,
  PerspectiveCamera,
  RenderTarget,
  HalfFloatType,
  Mesh,
  PlaneGeometry,
  MeshBasicNodeMaterial,
  RenderPipeline,
  Color,
  Vector3,
  Vector2,
  NeutralToneMapping,
  SRGBColorSpace,
  Group,
} from 'three/webgpu';
import { screenUV, uniform, texture, vec4, pass, rand, vec3, vec2, time, positionGeometry, fract } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { EnvironmentUniforms, createEnvironment } from './tsl/environment';
import { createSlabGeometry, createSlabMaterial, createEtchUniforms } from './stack/slab';
import { Stack } from './stack/Stack';
import { horizonClock, type FormationContext } from './stack/formations';
import { PULSE_AT, PULSE_PERIOD } from './stack/pulse';
import { audio } from '../components/audio/engine';
import { scroll } from '../motion/scroll';
import type { FormationId } from '../experience/director';
import { SdfText } from './text/SdfText';
import type { AtlasGroup } from './text/atlas';
import { director, type Directive } from '../experience/director';
import { experience, type RoomId } from '../experience/state';
import { pointer } from '../experience/pointer';
import { Spring, damp, clamp } from '../lib/math';
import { device, type QualityTier } from '../lib/device';
import type { View } from './views/View';
import { ResolutionGovernor } from './resolution';

/** Environment + accent colours for each room (linear-space targets). */
const ROOM_LIGHT: Record<RoomId, { key: string; rim: string; top: string; accent: string; accent2: string; intensity: number }> = {
  // A neutral charcoal studio everywhere; each room's identity comes from its
  // accents (glow, highlights) and a restrained rim light, not a tinted fog.
  home: { key: '#28292c', rim: '#0f1b20', top: '#101113', accent: '#f1dcb6', accent2: '#9fd7e6', intensity: 1 },
  fiscora: { key: '#27282a', rim: '#0a231d', top: '#0f1111', accent: '#e8c98c', accent2: '#3fd6ae', intensity: 1 },
  anka: { key: '#29292b', rim: '#0f1c21', top: '#111112', accent: '#ff7148', accent2: '#8fd6e0', intensity: 1 },
  'persian-alpr': { key: '#26282c', rim: '#0c1226', top: '#0e0f13', accent: '#72dcef', accent2: '#8fb0ff', intensity: 1 },
};

const DPR_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export class Stage {
  readonly renderer: WebGPURenderer;
  readonly camera = new PerspectiveCamera(26, 1, 0.1, 80);
  readonly scene = new Scene();
  readonly backdrop = new Scene();
  /** The glass layer: slabs only, farthest per pixel (see slab.ts). */
  private layerScene = new Scene();
  readonly env = new EnvironmentUniforms();
  readonly stack: Stack;
  title: SdfText | null = null;
  readonly views = new Set<View>();
  /** Resolves when fonts, the name and the pipelines are ready. */
  prepared: Promise<void> = Promise.resolve();
  /** 0..1 progress of `prepare()`, for the opening. */
  progress = 0.25;

  private backdropTarget: RenderTarget;
  private layerTarget: RenderTarget | null;
  private layerOn = uniform(1);
  private pipeline: RenderPipeline;
  private bloomStrength = uniform(0.32);
  private grainAmount = uniform(0.028);
  private lightDir = uniform(new Vector3(0.3, 0.6, 0.7).normalize());
  private accent = uniform(new Color('#f0d9b0'));
  private accent2 = uniform(new Color('#9fd7e6'));
  private refraction = uniform(0.055);
  private uTime = uniform(0);
  private etch = createEtchUniforms();
  /** Etched groups by name, and each group's first row in the current atlas. */
  private etchGroups = new Map<string, AtlasGroup>();
  private etchOffsets = new Map<string, number>();
  private etchGen = 0;

  private anchorX = new Spring(0, 40, 13);
  private anchorY = new Spring(0, 40, 13);
  private scaleS = new Spring(1, 40, 13);
  private presence = new Spring(0, 20, 9);
  private titleAmount = new Spring(0, 18, 8);
  /** Story position: the whole row moves as one mechanism with a little inertia. */
  private story = new Spring(0, 90, 17);
  private energy = 0;
  private stackRoot = new Group();
  private snapNext = false;
  private ctx: FormationContext = {
    t: 0,
    px: 0,
    py: 0,
    energy: 0,
    portrait: false,
    story: 0,
    storyVel: 0,
    beats: 5,
    camZ: 12,
    intro: director.channels.intro,
    etchRows: { story: -1, plate: -1 },
    plateFocus: -1,
    age: 0,
    reduced: false,
  };

  private width = 1;
  private height = 1;
  /** Pixel-ratio ladder position; see gl/resolution.ts. */
  readonly governor: ResolutionGovernor;
  private wasBusy = false;
  private lastRevision = -1;
  private startTime = performance.now() / 1000;
  private scratchColor = new Color();
  private disposed = false;

  static async create(canvas: HTMLCanvasElement, quality: QualityTier) {
    // ?renderer=webgl2 forces the WebGL 2 backend (used to QA the fallback path).
    const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl2';
    const renderer = new WebGPURenderer({
      canvas,
      forceWebGL,
      antialias: quality !== 'lean',
      alpha: false,
      powerPreference: 'high-performance',
    });
    await renderer.init();
    const stage = new Stage(renderer, quality);
    // The glass is what the opening needs first; compile it before the first
    // visible frame. Some drivers never resolve parallel compilation while a
    // tab is backgrounded, so this is bounded; the first frame compiles the rest.
    await Promise.race([
      Promise.all([renderer.compileAsync(stage.scene, stage.camera), renderer.compileAsync(stage.backdrop, stage.camera)]),
      new Promise((r) => setTimeout(r, 900)),
    ]).catch(() => undefined);
    stage.prepared = stage.prepare();
    return stage;
  }

  get backendName(): 'WebGPU' | 'WebGL 2' {
    const b = this.renderer.backend as { isWebGPUBackend?: boolean };
    return b.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  }

  private constructor(renderer: WebGPURenderer, quality: QualityTier) {
    this.renderer = renderer;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = SRGBColorSpace;

    const maxDpr = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'balanced' ? 1.75 : 1.25);
    const cap = Math.max(0, DPR_STEPS.findLastIndex((d) => d <= maxDpr + 0.01));
    this.governor = new ResolutionGovernor(Math.max(0, cap - (quality === 'high' ? 0 : 1)), cap);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (quality === 'lean') this.refraction.value = 0.035;

    this.backdropTarget = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    // Glass seen through glass costs a second draw of twelve slabs; skipped
    // where the budget is tight.
    this.layerTarget = quality === 'lean' ? null : new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });

    // Backdrop: environment light field (and the hero name, added later).
    const envFn = createEnvironment(this.env);
    const envMat = new MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
    envMat.colorNode = envFn(screenUV);
    // Full-screen quad: positions are written straight to clip space.
    envMat.vertexNode = vec4(positionGeometry.xy, 0, 1);
    const envQuad = new Mesh(new PlaneGeometry(2, 2), envMat);
    envQuad.frustumCulled = false;
    envQuad.renderOrder = -10;
    this.backdrop.add(envQuad);

    // Main scene: backdrop as background, slabs in front.
    const backdropTex = this.backdropTarget.texture;
    this.scene.backgroundNode = texture(backdropTex, screenUV);

    const common = {
      backdrop: backdropTex,
      lightDir: this.lightDir,
      accent: this.accent,
      accent2: this.accent2,
      time: this.uTime,
      refraction: this.refraction,
      etch: this.etch,
    };
    const slabMat = createSlabMaterial({ ...common, layer: this.layerTarget?.texture, layerOn: this.layerOn });
    const layerMat = this.layerTarget ? createSlabMaterial(common) : null;
    this.stack = new Stack(createSlabGeometry(quality === 'lean' ? 6 : 10, quality === 'lean' ? 3 : 5), slabMat, layerMat);
    this.stackRoot.add(this.stack.group);
    this.scene.add(this.stackRoot);
    if (this.stack.layerGroup) this.layerScene.add(this.stack.layerGroup);

    // Post: soft bloom on highlights + film grain (also dithers gradients).
    this.pipeline = new RenderPipeline(renderer);
    const scenePass = pass(this.scene, this.camera);
    const color = scenePass.getTextureNode('output');
    const glow = bloom(color, 0.32, 0.55, 0.92);
    glow.strength = this.bloomStrength;
    const seed = screenUV.mul(vec2(1.0, 1.37)).add(fract(time.mul(0.6131)));
    const grain = rand(seed).sub(0.5).mul(this.grainAmount);
    this.pipeline.outputNode = color.add(quality === 'lean' ? vec4(0) : glow).add(vec4(vec3(grain), 0));

    // A level camera keeps verticals vertical (buildings don't lean); the
    // formations tilt their own slabs toward the viewer instead.
    this.camera.position.set(0, 0, 12);
    this.camera.lookAt(0, 0, 0);
    this.resize();
  }

  /** Everything the opening waits for after the glass itself. */
  private async prepare() {
    const step = (p: number) => (this.progress = Math.max(this.progress, p));
    try {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
    } catch {
      /* fonts API unavailable: continue with fallbacks */
    }
    step(0.5);
    await this.loadTitle().catch(() => undefined);
    step(0.75);
    await Promise.race([
      Promise.all([
        this.renderer.compileAsync(this.scene, this.camera),
        this.renderer.compileAsync(this.backdrop, this.camera),
        this.layerTarget ? this.renderer.compileAsync(this.layerScene, this.camera) : null,
      ]),
      new Promise((r) => setTimeout(r, 1500)),
    ]).catch(() => undefined);
    step(1);
  }

  private async loadTitle() {
    const title = await SdfText.create(
      {
        text: 'Sam Afshar',
        family: "'Mona Sans Variable', 'Mona Sans', sans-serif",
        weight: 620,
        stretch: 'semi-expanded',
        tracking: -0.035,
        size: 180,
      },
      '#d9d2c7',
    );
    if (this.disposed) {
      title.dispose();
      return;
    }
    title.position.set(0, 0, -2.4);
    title.reveal.value = 0;
    title.renderOrder = 1;
    this.backdrop.add(title);
    this.title = title;
    this.layoutTitle();
  }

  /**
   * Glyphs etched inside the glass, by group: the story's beat labels, the
   * plate's characters. Registering a group rebuilds the one shared atlas;
   * formations find their rows through the context's `etchRows`.
   */
  registerEtch(name: string, group: AtlasGroup) {
    const prev = this.etchGroups.get(name);
    if (prev && prev.labels.join('|') === group.labels.join('|')) return;
    this.etchGroups.set(name, group);
    void this.rebuildEtch();
  }

  private async rebuildEtch() {
    const gen = ++this.etchGen;
    const entries = [...this.etchGroups.entries()];
    const { createSdfAtlas } = await import('./text/atlas');
    const atlas = await createSdfAtlas(entries.map(([, g]) => g));
    if (this.disposed || gen !== this.etchGen) {
      atlas.texture.dispose();
      return;
    }
    const old = this.etch.map.value;
    this.etch.map.value = atlas.texture;
    this.etch.rows.value = atlas.rows;
    this.etch.widthEm.value = atlas.widthEm;
    this.etch.rowEm.value = atlas.rowEm;
    this.etchOffsets.clear();
    entries.forEach(([name], k) => this.etchOffsets.set(name, atlas.offsets[k]));
    old.dispose();
  }

  /** Jump the glass straight into the next formation (reduced motion, first frame). */
  snapFormation() {
    this.snapNext = true;
  }

  /** Visible world-space size of the z=0 plane. */
  frustumAt(z = 0) {
    const dist = this.camera.position.z - z;
    const h = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * dist;
    return { w: h * this.camera.aspect, h };
  }

  resize() {
    this.governor?.hold(performance.now() / 1000, 1);
    // The canvas's own box, not the window: a classic scrollbar makes them
    // differ, and a buffer wider than the canvas is resampled (soft) on screen.
    const host = this.renderer.domElement.parentElement;
    const w = Math.max(1, host?.clientWidth || window.innerWidth);
    const h = Math.max(1, host?.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;
    const dpr = DPR_STEPS[this.governor.index];
    this.renderer.setPixelRatio(dpr);
    // Grain is per rendered pixel: at a lower ratio each grain is larger on
    // screen, so it is quieter to look the same.
    this.grainAmount.value = 0.028 * Math.min(1, Math.max(0.55, dpr / Math.min(window.devicePixelRatio || 1, 2)));
    // The glass layer is only dropped at the very bottom of the ladder, and
    // comes back with the resolution.
    this.layerOn.value = this.governor.index > 1 ? 1 : 0;
    this.renderer.setSize(w, h, false);
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    this.backdropTarget.setSize(size.x, size.y);
    this.layerTarget?.setSize(size.x, size.y);
    this.camera.aspect = w / h;
    // Keep the composition framed on narrow screens by pulling the camera back.
    const portrait = w / h < 0.9;
    this.camera.fov = portrait ? 34 : 26;
    this.camera.updateProjectionMatrix();
    this.env.aspect.value = w / h;
    this.layoutTitle();
  }

  private layoutTitle() {
    const t = this.title;
    if (!t) return;
    const f = this.frustumAt(t.position.z);
    const textW = Math.max(0.001, t.emWidth);
    const portrait = this.width / this.height < 0.9;
    const target = f.w * (portrait ? 0.92 : 0.8);
    t.scale.setScalar(Math.min(target / textW, f.h * 0.3));
    // On tall screens the hero copy fills the lower half; the name rides
    // higher so the two never overlap (the sculpture follows, see Hero).
    t.position.y = portrait ? f.h * 0.15 : 0;
  }

  private applyRoom(room: RoomId, dt: number) {
    const L = ROOM_LIGHT[room];
    const k = 1 - Math.exp(-2.2 * dt);
    this.env.key.value.lerp(this.scratchColor.set(L.key), k);
    this.env.rim.value.lerp(this.scratchColor.set(L.rim), k);
    this.env.top.value.lerp(this.scratchColor.set(L.top), k);
    this.accent.value.lerp(this.scratchColor.set(L.accent), k);
    this.accent2.value.lerp(this.scratchColor.set(L.accent2), k);
    // The opening keeps the studio dim until the sculpture has formed.
    const light = 0.4 + 0.6 * director.channels.intro.light;
    this.env.intensity.value = damp(this.env.intensity.value, L.intensity * light, 2.6, dt);
    this.env.daylight.value = damp(this.env.daylight.value, director.active.daylight, 2.6, dt);
  }

  frame(dt: number) {
    if (this.disposed) return;
    const now = performance.now() / 1000 - this.startTime;
    this.uTime.value = now;
    const d: Directive = director.active;
    const reduced = device.reducedMotion;
    const portrait = this.width / this.height < 0.9;

    // Story position, read straight from the page every frame.
    const source = director.channels.story;
    if (source) {
      const target = source();
      this.story.target = target;
      if (d.formation !== 'fan' && this.stack.current !== 'fan') this.story.snap(target);
    }
    const prevStory = this.story.value;
    if (reduced) this.story.value = damp(this.story.value, this.story.target, 7, dt);
    else this.story.step(dt);

    if (director.revision !== this.lastRevision) {
      this.lastRevision = director.revision;
      if (d.formation === 'fan' && this.stack.current !== 'fan') this.story.snap(this.story.target);
      this.stack.setFormation(d.formation, now);
    }

    // Director targets → springs.
    const f = this.frustumAt(0);
    this.anchorX.target = d.anchor[0] * f.w * 0.5;
    this.anchorY.target = d.anchor[1] * f.h * 0.5;
    this.scaleS.target = d.scale * (portrait ? 0.8 : 1);
    this.presence.target = d.presence;
    this.titleAmount.target = d.title;
    this.energy = damp(this.energy, d.energy, 3, dt);
    for (const s of [this.anchorX, this.anchorY, this.scaleS, this.presence, this.titleAmount]) {
      if (reduced || this.snapNext) s.value = this.snapNext ? s.target : damp(s.value, s.target, 3, dt);
      else s.step(dt);
    }
    this.applyRoom(d.room, dt);

    // Pointer: key light direction + a little parallax on the whole stack.
    const lx = pointer.lightX.value;
    const ly = pointer.lightY.value;
    this.env.light.value.set(lx, ly);
    this.lightDir.value.set((lx - 0.5) * 1.6, (0.5 - ly) * 1.4 + 0.5, 0.9).normalize();

    this.stackRoot.position.set(this.anchorX.value, this.anchorY.value, 0);
    this.stackRoot.scale.setScalar(Math.max(0.001, this.scaleS.value));
    this.stackRoot.rotation.y = pointer.sx.value * 0.06;
    this.stackRoot.rotation.x = -pointer.sy.value * 0.04;

    const c = this.ctx;
    c.t = now;
    c.px = pointer.sx.value;
    c.py = pointer.sy.value;
    c.energy = this.energy;
    c.portrait = portrait;
    c.story = this.story.value;
    c.storyVel = dt > 0 ? (this.story.value - prevStory) / dt : 0;
    c.beats = director.channels.beats;
    c.camZ = this.camera.position.z / Math.max(0.05, this.scaleS.value);
    c.etchRows.story = this.etchOffsets.get('story') ?? -1;
    c.etchRows.plate = this.etchOffsets.get(`plate:${director.channels.plateSet}`) ?? -1;
    c.plateFocus = director.channels.plateFocus;
    c.reduced = reduced;
    if (this.snapNext) {
      this.snapNext = false;
      this.stack.setFormation(d.formation, now);
      this.stack.snap(c);
    }
    this.stack.update(dt, now, c, reduced, clamp(this.presence.value));
    this.sonify(now, c, reduced);

    if (this.title) {
      this.title.opacity.value = clamp(this.titleAmount.value);
      this.title.visible = this.titleAmount.value > 0.002;
    }

    this.render();
    this.adapt(dt);
  }

  /** What the stage has already sounded (see sonify). */
  private heard = { formation: 'awaken' as FormationId, beat: -1, scan: -9, unroll: 0, roll: -1, fresh: -1, shove: -1 };

  /**
   * The objects, heard (only when sound is on): the story handing over from
   * beat to beat, the glass re-forming, Fiscora's reading light passing each
   * observation and its forecast opening period by period, and the ground
   * shove under ANKA's frame. Scroll speed livens the score.
   */
  private sonify(now: number, c: FormationContext, reduced: boolean) {
    if (!audio.enabled) return;
    const h = this.heard;
    audio.setActivity(Math.abs(scroll.lenis?.velocity ?? 0) / 40);
    const f = this.stack.current;
    const shown = this.presence.value > 0.5;
    if (f !== h.formation) {
      if (h.formation !== 'awaken' && this.presence.value > 0.3) audio.morph();
      Object.assign(h, { formation: f, beat: -1, scan: -9, unroll: 0, roll: -1, fresh: -1, shove: -1 });
    }
    if (f === 'fan') {
      const beat = Math.round(c.story);
      if (beat !== h.beat) {
        if (h.beat >= 0) audio.handoff(beat, this.width * 0.55);
        h.beat = beat;
      }
    } else if (f === 'horizon' && shown) {
      const k = horizonClock(this.stack.ageAt(now), reduced);
      // One note per observation the reading light reaches, every pass.
      const slot = Math.floor(k.scan);
      const key = k.m * 16 + slot;
      if (key > h.scan && slot >= 0 && slot < 7) audio.pulse(slot);
      h.scan = Math.max(h.scan, key);
      const u = Math.floor(k.unroll + 1e-3);
      if (u > h.unroll) audio.bloom(u);
      h.unroll = u;
      if (k.sigma > 0.5 && h.roll !== k.m) {
        h.roll = k.m;
        audio.roll();
      }
      if (k.fresh > 0.2 && k.fresh < 1 && h.fresh !== k.m) {
        h.fresh = k.m;
        audio.bloom(5);
      }
    } else if (f === 'building' && shown && !reduced) {
      const t = this.stack.ageAt(now) - 1.4;
      const cycle = Math.floor((t - PULSE_AT + 0.25) / PULSE_PERIOD);
      if (t > 0 && cycle !== h.shove) {
        h.shove = cycle;
        audio.shove(0.7 + this.energy);
      }
    }
  }

  private render() {
    const r = this.renderer;
    r.setRenderTarget(this.backdropTarget);
    r.render(this.backdrop, this.camera);
    if (this.layerTarget && this.layerOn.value > 0) {
      this.stack.syncLayer(this.camera);
      r.setRenderTarget(this.layerTarget);
      const alpha = r.getClearAlpha();
      r.setClearAlpha(0);
      r.render(this.layerScene, this.camera);
      r.setClearAlpha(alpha);
    }
    r.setRenderTarget(null);
    this.pipeline.render();
    for (const v of this.views) v.render(r);
  }

  private onVisibility = () => {
    // Frames around a tab switch say nothing about the renderer's load.
    this.governor.hold(performance.now() / 1000, 1.5);
  };

  /** Adaptive resolution from measured frame time; never labels the device. */
  private adapt(dt: number) {
    const now = performance.now() / 1000;
    const { transitioning, introActive } = experience.get();
    const busy = transitioning || introActive;
    if (busy) this.governor.hold(now, 0.8);
    // Arriving on a page: quality is allowed to climb back to the device's best.
    if (this.wasBusy && !busy) this.governor.release();
    this.wasBusy = busy;
    const step = this.governor.update(dt, now);
    if (step !== 0) {
      this.resize();
      experience.set({ quality: this.governor.index <= 1 ? 'lean' : 'balanced' });
    }
  }

  get backdropTexture() {
    return this.backdropTarget.texture;
  }

  /** Projected size of one world unit at z = 0, in CSS pixels. */
  get pixelsPerUnit() {
    return this.height / this.frustumAt(0).h;
  }

  addView(v: View) {
    // Views are drawn through the renderer's own output target, not over the
    // post-processed frame, so they carry the same backdrop as their
    // background: the seam between the stage and a view is invisible.
    const scene = (v as View & { scene?: Scene }).scene;
    if (scene) scene.backgroundNode = texture(this.backdropTarget.texture, screenUV);
    this.views.add(v);
    return () => {
      this.views.delete(v);
    };
  }

  get size() {
    return { width: this.width, height: this.height };
  }

  dispose() {
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.title?.dispose();
    this.backdropTarget.dispose();
    this.layerTarget?.dispose();
    this.pipeline.dispose();
    this.renderer.dispose();
  }
}
