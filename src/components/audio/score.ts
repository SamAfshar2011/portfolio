import type { RoomId } from '../../experience/state';
import { air, bell, click, mtof, type VoiceOut } from './voices';

/**
 * The generative score: an original, endlessly varying piece built from a
 * few rules per room, never a recording and never a loop.
 *
 *   pad      four slow voices on the room's chord, gliding at each change
 *   drone    the chord's root, an octave down, swelling with each chord
 *   bells    sparse struck notes from the chord and scale, in the room's
 *            register and timbre; more of them while the visitor is moving
 *   texture  the room's own grain: air (home), a quiet data pulse
 *            (Fiscora), a low rumble (ANKA), a high shimmer (ALPR)
 *
 * Each room is an identity — key, mode, tempo, register, bell timbre, filter
 * — and moving between rooms morphs one into the other: chords glide, the
 * filter and textures crossfade, tempo eases. Notes are scheduled slightly
 * ahead of time on the audio clock, so timing never depends on frame rate.
 */
interface Identity {
  /** Chords as MIDI notes (four voices each), two bars apiece. */
  chords: number[][];
  /** Scale as pitch classes, for passing notes. */
  scale: number[];
  bpm: number;
  /** Chance of a bell on an eighth note at rest. */
  density: number;
  register: [number, number];
  ratio: number;
  index: number;
  cutoff: number;
  texture: 'air' | 'pulse' | 'rumble' | 'shimmer';
}

export const IDENTITY: Record<RoomId, Identity> = {
  // Warm and open: D lydian, suspended voicings.
  home: {
    chords: [
      [50, 57, 64, 66],
      [47, 54, 62, 64],
      [43, 50, 59, 62],
      [45, 52, 61, 64],
    ],
    scale: [2, 4, 6, 7, 9, 11, 1],
    bpm: 60,
    density: 0.24,
    register: [69, 88],
    ratio: 3.5,
    index: 1.3,
    cutoff: 900,
    texture: 'air',
  },
  // Champagne and emerald: F major, bright ninths, a steady forward pulse.
  fiscora: {
    chords: [
      [53, 60, 67, 69],
      [50, 57, 64, 65],
      [46, 53, 62, 65],
      [48, 55, 64, 67],
    ],
    scale: [5, 7, 9, 10, 0, 2, 4],
    bpm: 72,
    density: 0.3,
    register: [72, 91],
    ratio: 2,
    index: 1.1,
    cutoff: 1300,
    texture: 'pulse',
  },
  // Mineral and grounded: D aeolian, low and sparse, resonant metal.
  anka: {
    chords: [
      [38, 45, 52, 57],
      [36, 43, 50, 55],
      [34, 41, 48, 53],
      [33, 40, 48, 52],
    ],
    scale: [2, 4, 5, 7, 9, 10, 0],
    bpm: 50,
    density: 0.14,
    register: [57, 76],
    ratio: 1.41,
    index: 1.6,
    cutoff: 650,
    texture: 'rumble',
  },
  // Cool and optical: E minor pentatonic, high crystal, precise.
  'persian-alpr': {
    chords: [
      [52, 59, 66, 71],
      [48, 55, 62, 69],
      [55, 62, 69, 74],
      [50, 57, 64, 71],
    ],
    scale: [4, 7, 9, 11, 2],
    bpm: 84,
    density: 0.36,
    register: [76, 96],
    ratio: 5,
    index: 0.9,
    cutoff: 1800,
    texture: 'shimmer',
  },
};

const STEPS_PER_CHORD = 16; // two bars of eighths
const LOOKAHEAD = 0.18;

export class Score {
  private ctx: AudioContext;
  private bus: GainNode;
  private noise: AudioBuffer;
  private pad: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  private padFilter: BiquadFilterNode;
  private drone: OscillatorNode;
  private droneGain: GainNode;
  private textures: Record<Identity['texture'], GainNode>;
  private timer = 0;
  private next = 0;
  private step = 0;
  private chord = 0;
  private room: RoomId = 'home';
  private pending: RoomId | null = null;
  private bpm = IDENTITY.home.bpm;
  /** 0..1, how much the visitor is moving (scroll speed). */
  activity = 0;
  running = false;

  constructor(ctx: AudioContext, bus: GainNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.bus = bus;
    this.noise = noise;
    const id = IDENTITY.home;

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = id.cutoff;
    this.padFilter.Q.value = 0.5;
    const padOut = ctx.createGain();
    padOut.gain.value = 0.05;
    this.padFilter.connect(padOut).connect(bus);
    // A very slow breath in the pad's brightness.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(this.padFilter.frequency);
    lfo.start();

    id.chords[0].forEach((m, i) => {
      const gain = ctx.createGain();
      gain.gain.value = [0.5, 0.34, 0.24, 0.16][i];
      gain.connect(this.padFilter);
      const osc = [-1, 1].map((side) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'triangle' : 'sine';
        o.frequency.value = mtof(m);
        o.detune.value = side * (4 + i * 1.5);
        o.connect(gain);
        o.start();
        return o;
      });
      this.pad.push({ osc, gain });
    });

    this.drone = ctx.createOscillator();
    this.drone.frequency.value = mtof(id.chords[0][0] - 12);
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.drone.connect(this.droneGain).connect(bus);
    this.drone.start();

    this.textures = {
      air: this.loopNoise('bandpass', 900, 0.7, 0.9),
      pulse: ctx.createGain(),
      rumble: this.loopNoise('lowpass', 110, 0.8, 0.6),
      shimmer: this.loopNoise('bandpass', 6200, 1.6, 0.35),
    };
    this.textures.pulse.connect(bus);
    this.applyTextures('home', 0.01);
  }

  private loopNoise(type: BiquadFilterType, freq: number, q: number, level: number) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const trim = ctx.createGain();
    trim.gain.value = level;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(trim).connect(g).connect(this.bus);
    src.start(0, Math.random() * 1.5);
    return g;
  }

  private applyTextures(room: RoomId, tc: number) {
    const t = this.ctx.currentTime;
    const which = IDENTITY[room].texture;
    const level = { air: 0.02, pulse: 1, rumble: 0.05, shimmer: 0.012 };
    (Object.keys(this.textures) as Identity['texture'][]).forEach((k) =>
      this.textures[k].gain.setTargetAtTime(k === which ? level[k] : 0, t, tc),
    );
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 40);
    this.setChord(this.chord, 0.05);
  }

  stop() {
    this.running = false;
    window.clearInterval(this.timer);
  }

  /** Move to another room's identity; the change lands on the next chord. */
  setRoom(room: RoomId) {
    if (room === this.room && !this.pending) return;
    this.pending = room;
    // Textures and colour begin to morph at once; harmony follows on the beat.
    this.applyTextures(room, 1.6);
    this.padFilter.frequency.setTargetAtTime(IDENTITY[room].cutoff, this.ctx.currentTime, 1.4);
    // Arrive on the next bar rather than waiting out the whole chord: move
    // the step counter so that bar is also a chord boundary.
    const toBar = 8 - (this.step % 8);
    this.step = STEPS_PER_CHORD * (Math.floor(this.step / STEPS_PER_CHORD) + 1) - toBar;
  }

  /** The chord currently sounding (MIDI), for sonification that should agree with the music. */
  get currentChord() {
    return IDENTITY[this.room].chords[this.chord];
  }

  get identity() {
    return IDENTITY[this.room];
  }

  private setChord(index: number, tc = 0.9) {
    const id = IDENTITY[this.room];
    const chord = id.chords[index % id.chords.length];
    const t = this.ctx.currentTime;
    chord.forEach((m, i) => this.pad[i].osc.forEach((o) => o.frequency.setTargetAtTime(mtof(m), t, tc)));
    this.drone.frequency.setTargetAtTime(mtof(chord[0] - 12), t, tc);
    const g = this.droneGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.03, t, 1.2);
    g.setTargetAtTime(0.018, t + 4, 3);
  }

  private schedule() {
    const ctx = this.ctx;
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      this.play(this.next);
      const id = IDENTITY[this.room];
      this.bpm += (id.bpm - this.bpm) * 0.15;
      this.next += 60 / this.bpm / 2;
      this.step++;
      if (this.step % STEPS_PER_CHORD === 0) {
        if (this.pending) {
          this.room = this.pending;
          this.pending = null;
          this.chord = 0;
          this.setChord(0, 1.5);
        } else {
          this.chord = (this.chord + 1) % id.chords.length;
          this.setChord(this.chord);
        }
      }
    }
  }

  private out(pan = 0): VoiceOut {
    return { ctx: this.ctx, dest: this.bus, pan, noise: this.noise };
  }

  /** One eighth note of the piece. */
  private play(t: number) {
    const id = IDENTITY[this.room];
    const chord = id.chords[this.chord];
    const s = this.step % STEPS_PER_CHORD;
    const onBeat = s % 2 === 0;
    const a = this.activity;
    const p = id.density * (onBeat ? 1 : 0.55) * (0.7 + a * 0.9) * (s === 0 ? 1.6 : 1);
    if (Math.random() < p) {
      const note = this.pick(id, chord);
      const human = (Math.random() - 0.5) * 0.016;
      const vel = 0.5 + Math.random() * 0.5;
      bell(this.out((Math.random() - 0.5) * 0.7), mtof(note), t + human, {
        gain: 0.028 * vel,
        decay: 1.4 + Math.random() * 1.6,
        ratio: id.ratio,
        index: id.index * (0.8 + a * 0.5),
      });
      // Now and then a second voice a third or fifth below.
      if (Math.random() < 0.1) {
        const below = note - (Math.random() < 0.5 ? 3 : 5);
        bell(this.out((Math.random() - 0.5) * 0.7), mtof(below), t + human + 0.012, { gain: 0.018 * vel, decay: 2, ratio: id.ratio, index: id.index });
      }
    }
    // Fiscora's texture is rhythmic: a faint data pulse on the eighths.
    if (id.texture === 'pulse' && this.textures.pulse.gain.value > 0.05) {
      const accent = s % 4 === 0;
      click({ ...this.out(accent ? 0 : s % 8 < 4 ? -0.3 : 0.3), dest: this.textures.pulse }, accent ? 2400 : 3000, t, accent ? 0.012 : 0.006);
    }
    // ALPR: an occasional glint high in the shimmer.
    if (id.texture === 'shimmer' && Math.random() < 0.06) {
      click(this.out((Math.random() - 0.5) * 0.9), 3600 + Math.random() * 1600, t, 0.006);
    }
    // Every chord change brings a breath of air under the pad.
    if (s === 0) air(this.out(0), t, { from: 300, to: 900, dur: 3.2, gain: 0.008 + a * 0.01, q: 0.6 });
  }

  private pick(id: Identity, chord: number[]) {
    const [lo, hi] = id.register;
    let pc: number;
    if (Math.random() < 0.72) pc = chord[Math.floor(Math.random() * chord.length)] % 12;
    else pc = id.scale[Math.floor(Math.random() * id.scale.length)];
    // Place the pitch class in the register, preferring the middle of it.
    const centre = (lo + hi) / 2 + (Math.random() - 0.5) * (hi - lo) * 0.9;
    let m = Math.round(centre / 12) * 12 + pc;
    while (m < lo) m += 12;
    while (m > hi) m -= 12;
    return m;
  }

  dispose() {
    this.stop();
    this.pad.forEach((v) => v.osc.forEach((o) => o.stop()));
    this.drone.stop();
  }
}
