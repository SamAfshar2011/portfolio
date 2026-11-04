import type { RoomId } from '../../experience/state';
import { storage } from '../../lib/storage';
import { Score } from './score';
import { air, bell, click, creak, crackle, droplet, glass, mtof, thock, thump, type VoiceOut } from './voices';

/**
 * Sound, synthesised with the Web Audio API (no audio files, nothing
 * borrowed). Nothing plays until the visitor turns sound on — which is also
 * the gesture browsers require. A visitor who turned it on before is
 * remembered, but sound still waits for their first click or key press on
 * the next visit and then fades in slowly; it never starts by itself.
 *
 * Signal flow:
 *
 *   music ───────┐
 *   interaction ─┤── dry ──┐
 *   project ─────┤         ├── master ── limiter ── out
 *   impact ──────┘         │
 *        └── sends ── spatial (a generated room) ─┘
 *
 *   music        the generative score (score.ts): each room's identity,
 *                morphing on transitions
 *   interaction  the cursor and controls: taps, presses, the liquid merge
 *   project      the objects speaking: slabs arriving and re-forming, story
 *                hand-offs, ALPR's scan, Fiscora's data pulse
 *   impact       weight: ANKA's ground shove, resonance, yield and collapse
 *
 * Every event has a priority and a cooldown, and the engine keeps a budget
 * of concurrent voices, so fast input never turns into a cacophony: low
 * priority events are the first to be skipped. Positions on screen become a
 * gentle stereo pan.
 */
type Bus = 'music' | 'interaction' | 'project' | 'impact';
type Kind =
  | 'tick'
  | 'press'
  | 'merge'
  | 'sweep'
  | 'chime'
  | 'morph'
  | 'handoff'
  | 'arrive'
  | 'reveal'
  | 'scan'
  | 'pulse'
  | 'bloom'
  | 'roll'
  | 'shove'
  | 'yield'
  | 'collapse';

const RULES: Record<Kind, { bus: Bus; cool: number; pri: 1 | 2 | 3 }> = {
  tick: { bus: 'interaction', cool: 0.045, pri: 1 },
  press: { bus: 'interaction', cool: 0.08, pri: 2 },
  merge: { bus: 'interaction', cool: 0.07, pri: 1 },
  sweep: { bus: 'interaction', cool: 0.5, pri: 2 },
  chime: { bus: 'interaction', cool: 0.4, pri: 2 },
  morph: { bus: 'project', cool: 1.2, pri: 1 },
  handoff: { bus: 'project', cool: 0.25, pri: 2 },
  arrive: { bus: 'project', cool: 0.05, pri: 1 },
  reveal: { bus: 'project', cool: 2, pri: 3 },
  scan: { bus: 'project', cool: 0.06, pri: 1 },
  pulse: { bus: 'project', cool: 0.1, pri: 1 },
  bloom: { bus: 'project', cool: 0.12, pri: 1 },
  roll: { bus: 'project', cool: 2, pri: 1 },
  shove: { bus: 'impact', cool: 1, pri: 2 },
  yield: { bus: 'impact', cool: 0.12, pri: 2 },
  collapse: { bus: 'impact', cool: 1.5, pri: 3 },
};
const BUS_LEVEL: Record<Bus, number> = { music: 0.55, interaction: 0.75, project: 0.6, impact: 0.8 };
const SEND_LEVEL: Record<Bus, number> = { music: 0.55, interaction: 0.32, project: 0.5, impact: 0.28 };
const MAX_VOICES = 16;
const PREF = 'sa.sound';

/** Screen x (px) → a gentle pan. */
const panFor = (x?: number) => (x == null || typeof window === 'undefined' ? 0 : ((x / window.innerWidth) * 2 - 1) * 0.55);

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** The last stage before the speakers, for metering. */
  output: DynamicsCompressorNode | null = null;
  private buses = {} as Record<Bus, GainNode>;
  private noise: AudioBuffer | null = null;
  private score: Score | null = null;
  private room: RoomId = 'home';
  private last: Partial<Record<Kind, number>> = {};
  private active = 0;
  private res: { tone: OscillatorNode; fifth: OscillatorNode; gain: GainNode; rumble: GainNode } | null = null;
  enabled = false;

  /** The visitor's remembered choice (sound still waits for a gesture). */
  get preferred() {
    return storage.get<boolean>(PREF, false);
  }

  private init() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // Master → limiter: nothing the site makes can clip or jump out.
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 3;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.22;
    this.master.connect(limiter).connect(ctx.destination);
    this.output = limiter;

    // Spatial bus: a generated room (decaying stereo noise), slightly pre-delayed.
    const reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.6);
    }
    reverb.buffer = ir;
    const pre = ctx.createDelay(0.1);
    pre.delayTime.value = 0.025;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    pre.connect(reverb).connect(wet).connect(this.master);

    (['music', 'interaction', 'project', 'impact'] as Bus[]).forEach((b) => {
      const g = ctx.createGain();
      g.gain.value = b === 'music' ? 0 : BUS_LEVEL[b];
      g.connect(this.master!);
      const send = ctx.createGain();
      send.gain.value = SEND_LEVEL[b];
      g.connect(send).connect(pre);
      this.buses[b] = g;
    });

    const nlen = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    this.score = new Score(ctx, this.buses.music, this.noise);
    this.score.setRoom(this.room);

    document.addEventListener('visibilitychange', this.onVisibility);
    return ctx;
  }

  async setEnabled(on: boolean) {
    this.enabled = on;
    storage.set(PREF, on);
    if (on) {
      const ctx = this.init();
      if (ctx.state === 'suspended') await ctx.resume();
      const t = ctx.currentTime;
      this.master!.gain.cancelScheduledValues(t);
      this.master!.gain.setTargetAtTime(0.9, t, 0.5);
      // The music arrives slowly; interface sounds are available at once.
      this.buses.music.gain.cancelScheduledValues(t);
      this.buses.music.gain.setValueAtTime(this.buses.music.gain.value, t);
      this.buses.music.gain.setTargetAtTime(BUS_LEVEL.music, t + 0.2, 1.4);
      this.score!.start();
      this.tick(1.4);
    } else if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master!.gain.cancelScheduledValues(t);
      this.master!.gain.setTargetAtTime(0, t, 0.22);
      this.buses.music.gain.setTargetAtTime(0, t, 0.22);
      window.setTimeout(() => {
        if (this.enabled) return;
        this.score?.stop();
        this.ctx?.suspend();
      }, 1400);
    }
  }

  private onVisibility = () => {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    if (document.hidden) {
      this.master!.gain.setTargetAtTime(0, t, 0.15);
      window.setTimeout(() => document.hidden && this.ctx?.suspend(), 700);
    } else {
      this.ctx.resume().then(() => this.master!.gain.setTargetAtTime(0.9, this.ctx!.currentTime, 0.8));
    }
  };

  setRoom(room: RoomId) {
    this.room = room;
    this.score?.setRoom(room);
  }

  /** 0..1 how much the visitor is moving (scroll speed): livens the score. */
  setActivity(a: number) {
    if (this.score) this.score.activity += (Math.max(0, Math.min(1, a)) - this.score.activity) * 0.08;
  }

  private get live() {
    return !!(this.enabled && this.ctx && this.ctx.state === 'running');
  }

  /** Admits an event under its priority, cooldown and the voice budget. */
  private voice(kind: Kind, x?: number): VoiceOut | null {
    if (!this.live) return null;
    const r = RULES[kind];
    const now = this.ctx!.currentTime;
    if (now - (this.last[kind] ?? -1) < r.cool) return null;
    if (this.active >= MAX_VOICES && r.pri < 3) return null;
    if (this.active >= MAX_VOICES * 0.7 && r.pri < 2) return null;
    this.last[kind] = now;
    return { ctx: this.ctx!, dest: this.buses[r.bus], pan: panFor(x), noise: this.noise! };
  }

  private hold(seconds: number) {
    this.active++;
    window.setTimeout(() => this.active--, seconds * 1000 + 60);
  }

  /** Lowers the music briefly so a weighty event can be heard (sidechain-style). */
  private duck(depth = 0.5, seconds = 0.9) {
    const g = this.buses.music.gain;
    const t = this.ctx!.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(BUS_LEVEL.music * depth, t, 0.05);
    g.setTargetAtTime(BUS_LEVEL.music, t + seconds, 0.6);
  }

  private get now() {
    return this.ctx!.currentTime;
  }

  /** A note from the chord that is sounding, in a given octave band. */
  private chordNote(index: number, octave = 0) {
    const chord = this.score?.currentChord ?? [62, 66, 69, 73];
    const m = chord[((index % chord.length) + chord.length) % chord.length] + 24 + octave * 12;
    return mtof(m);
  }

  // ------------------------------------------------------------ interface

  /** Glass tap. `pitch` scales the partials (1 = default). */
  tick(pitch = 1, x?: number) {
    const o = this.voice('tick', x);
    if (!o) return;
    this.hold(glass(o, 1480 * pitch, this.now, 0.022));
  }

  press(x?: number) {
    const o = this.voice('press', x);
    if (!o) return;
    this.hold(thock(o, this.now, 0.05));
  }

  sweep(up = true) {
    const o = this.voice('sweep');
    if (!o) return;
    this.hold(air(o, this.now, { from: up ? 280 : 2200, to: up ? 2400 : 300, dur: 1.1, gain: 0.05 }));
  }

  /** Three rising glass notes — used when leaving for GitHub. */
  chime() {
    const o = this.voice('chime');
    if (!o) return;
    [0, 1, 2].forEach((i) => glass(o, 1480 * 0.8 * [1, 1.25, 1.5][i], this.now + i * 0.07, 0.02));
    this.hold(0.5);
  }

  /**
   * The liquid cursor. bridge: it reaches toward a control (a rising glass
   * note); absorb: it flows into it (a soft low swell); release: the neck
   * pinches off (a falling droplet).
   */
  merge(phase: 'bridge' | 'absorb' | 'release', x?: number) {
    const o = this.voice('merge', x);
    if (!o) return;
    const t = this.now;
    if (phase === 'bridge') this.hold(glass(o, 1480 * 1.2, t, 0.016));
    else if (phase === 'absorb') this.hold(droplet(o, 520, t, 0.03, true));
    else this.hold(droplet(o, 900, t, 0.022));
  }

  // --------------------------------------------------------------- objects

  /** The slabs re-forming into another structure: a short arpeggio on the chord. */
  morph() {
    const o = this.voice('morph');
    if (!o) return;
    const id = this.score?.identity;
    [0, 1, 2, 3].forEach((k) => bell({ ...o, pan: (k - 1.5) * 0.25 }, this.chordNote(k), this.now + k * 0.09, { gain: 0.012, decay: 1.6, ratio: id?.ratio ?? 3.5 }));
    this.hold(2);
  }

  /** The story: a new beat is presented. Higher beats sit higher on the chord. */
  handoff(beat: number, x?: number) {
    const o = this.voice('handoff', x);
    if (!o) return;
    this.hold(bell(o, this.chordNote(beat, beat > 2 ? 1 : 0), this.now, { gain: 0.03, decay: 2.2, ratio: 3.5, index: 1.2 }));
  }

  /** The opening: a bar of glass passes the lens. */
  arrive(i: number, n: number) {
    const o = this.voice('arrive', (0.2 + 0.6 * (i / Math.max(1, n - 1))) * (typeof window === 'undefined' ? 1 : window.innerWidth));
    if (!o) return;
    const t = this.now;
    air(o, t, { from: 1800, to: 600, dur: 0.35, gain: 0.018, q: 2 });
    this.hold(glass(o, 1480 * (1.1 + (i % 4) * 0.08), t + 0.05, 0.012));
  }

  /** The opening resolves into the hero. */
  reveal() {
    const o = this.voice('reveal');
    if (!o) return;
    [0, 1, 2, 3].forEach((k) => bell({ ...o, pan: (k - 1.5) * 0.3 }, this.chordNote(k, -1), this.now + k * 0.14, { gain: 0.02, decay: 3, ratio: 3.5 }));
    this.hold(3);
  }

  /** ALPR: the pipeline advances a stage / a detection is inspected. */
  scan(step: number, x?: number) {
    const o = this.voice('scan', x);
    if (!o) return;
    this.hold(click(o, 1800 + step * 240, this.now, 0.03));
  }

  /** Fiscora: the reading light passes one observation. */
  pulse(slot: number) {
    const o = this.voice('pulse', window.innerWidth * (0.55 + slot * 0.04));
    if (!o) return;
    this.hold(bell(o, this.chordNote(slot, 1), this.now, { gain: 0.012, decay: 1.1, ratio: 2, index: 0.8 }));
  }

  /** Fiscora: a forecast period opens — softer, airier, less certain. */
  bloom(j: number) {
    const o = this.voice('bloom', window.innerWidth * (0.78 + j * 0.03));
    if (!o) return;
    const t = this.now;
    air(o, t, { from: 2600, to: 5200, dur: 0.9, gain: 0.006 + (5 - j) * 0.001, q: 3 });
    this.hold(bell(o, this.chordNote(j + 2, 1), t, { gain: 0.008, decay: 2.4, ratio: 2, index: 0.5 }));
  }

  /** Fiscora: time advances one period. */
  roll() {
    const o = this.voice('roll');
    if (!o) return;
    this.hold(air(o, this.now, { from: 500, to: 1400, dur: 1.6, gain: 0.012, q: 0.8 }));
  }

  // --------------------------------------------------------------- weight

  /** ANKA's hero: the ground shoves. Kept low and soft — felt, not alarming. */
  shove(strength = 1) {
    const o = this.voice('shove');
    if (!o) return;
    this.duck(0.7, 0.6);
    this.hold(thump(o, this.now, 0.07 * strength, 64, 36, 0.9));
  }

  /**
   * The simulator's building, heard: a low tone at a pitch set by the
   * building's own period and a rumble from the ground, both following the
   * simulated motion. Call every frame while it runs; 0 lets it fade.
   */
  resonance(level: number, periodS: number, ground = 0) {
    if (!this.live) {
      if (this.res) this.res.gain.gain.setTargetAtTime(0, this.ctx?.currentTime ?? 0, 0.1);
      return;
    }
    const ctx = this.ctx!;
    if (!this.res) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      gain.connect(lp).connect(this.buses.impact);
      const tone = ctx.createOscillator();
      tone.type = 'triangle';
      const fifth = ctx.createOscillator();
      fifth.type = 'sine';
      const fg = ctx.createGain();
      fg.gain.value = 0.4;
      tone.connect(gain);
      fifth.connect(fg).connect(gain);
      tone.start();
      fifth.start();
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'lowpass';
      nf.frequency.value = 140;
      const rumble = ctx.createGain();
      rumble.gain.value = 0;
      src.connect(nf).connect(rumble).connect(this.buses.impact);
      src.start();
      this.res = { tone, fifth, gain, rumble };
    }
    const t = ctx.currentTime;
    // Longer periods sound lower: a 0.3 s frame near E2, a 1.5 s tower near A1.
    const hz = Math.max(46, Math.min(120, 36 / Math.max(0.2, periodS) + 30));
    this.res.tone.frequency.setTargetAtTime(hz, t, 0.2);
    this.res.fifth.frequency.setTargetAtTime(hz * 1.5, t, 0.2);
    this.res.gain.gain.setTargetAtTime(Math.min(1, level) * 0.09, t, 0.08);
    this.res.rumble.gain.setTargetAtTime(Math.min(1, ground) * 0.12, t, 0.06);
  }

  /** A storey has begun to yield: a creak from that height. */
  yieldAt(storey: number, of: number) {
    const o = this.voice('yield');
    if (!o) return;
    this.hold(creak(o, this.now, 0.05, 1.4 - (storey / Math.max(1, of)) * 0.6));
  }

  /** Collapse: a heavy low blow, then debris settling. */
  collapse() {
    const o = this.voice('collapse');
    if (!o) return;
    const t = this.now;
    this.duck(0.35, 2.2);
    thump(o, t, 0.16, 58, 28, 1.6);
    crackle(o, t + 0.12, 0.05, 14, 1.4);
    this.hold(1.8);
  }
}

export const audio = new AudioEngine();
if (import.meta.env.DEV) (window as unknown as { __audio: AudioEngine }).__audio = audio;
