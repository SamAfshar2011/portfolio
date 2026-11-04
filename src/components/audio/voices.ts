/**
 * Synthesis voices. Every sound on the site is made here, from oscillators
 * and noise — no samples, no recordings, nothing borrowed. Each voice
 * schedules itself at time `t` into `out` and returns how long it rings, so
 * the engine can keep a budget of concurrent voices.
 */
export interface VoiceOut {
  ctx: AudioContext;
  /** Dry destination (a bus). */
  dest: AudioNode;
  /** Pan, -1..1 (kept gentle by the caller). */
  pan?: number;
  noise: AudioBuffer;
}

const env = (g: GainNode, t: number, peak: number, attack: number, decay: number) => {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
};

/** Output stage of a voice: an optional stereo position, then the bus. */
function tail(o: VoiceOut) {
  const { ctx } = o;
  if (!o.pan) return o.dest;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, o.pan));
  p.connect(o.dest);
  return p;
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * A struck glass bell: two-operator FM whose modulation index falls as the
 * note rings, so the attack is bright and the tail pure. The ratio sets the
 * character: 3.5 glass, 2 a warm gold bell, 1.41 metal, 5 crystal.
 */
export function bell(o: VoiceOut, freq: number, t: number, opts: { gain: number; decay?: number; ratio?: number; index?: number }) {
  const { ctx } = o;
  const decay = opts.decay ?? 1.6;
  const ratio = opts.ratio ?? 3.5;
  const index = opts.index ?? 1.4;
  const car = ctx.createOscillator();
  car.frequency.value = freq;
  const mod = ctx.createOscillator();
  mod.frequency.value = freq * ratio;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(freq * index, t);
  depth.gain.exponentialRampToValueAtTime(freq * index * 0.04 + 0.01, t + decay * 0.5);
  mod.connect(depth).connect(car.frequency);
  const g = ctx.createGain();
  env(g, t, opts.gain, 0.004, decay);
  car.connect(g).connect(tail(o));
  car.start(t);
  mod.start(t);
  car.stop(t + decay + 0.05);
  mod.stop(t + decay + 0.05);
  return decay;
}

/** A light glass tap: three inharmonic partials with fast decays. */
export function glass(o: VoiceOut, freq: number, t: number, gain: number) {
  const { ctx } = o;
  const out = tail(o);
  [1, 2.76, 5.4].forEach((m, i) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq * m;
    const g = ctx.createGain();
    env(g, t, gain * [1, 0.42, 0.16][i], 0.003, 0.16 + (2 - i) * 0.05);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.4);
  });
  return 0.3;
}

/** A muted press: a short sine whose pitch falls. */
export function thock(o: VoiceOut, t: number, gain: number, from = 420, to = 180) {
  const { ctx } = o;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + 0.09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(g).connect(tail(o));
  osc.start(t);
  osc.stop(t + 0.2);
  return 0.2;
}

/** Filtered air moving between two frequencies. */
export function air(o: VoiceOut, t: number, opts: { from: number; to: number; dur: number; gain: number; q?: number }) {
  const { ctx } = o;
  const src = ctx.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = opts.q ?? 1.2;
  bp.frequency.setValueAtTime(opts.from, t);
  bp.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur * 0.8);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.gain, t + opts.dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  src.connect(bp).connect(g).connect(tail(o));
  src.start(t, Math.random() * 1.5);
  src.stop(t + opts.dur + 0.05);
  return opts.dur;
}

/** A short optical tick: a band-limited click with a faint pitched ring. */
export function click(o: VoiceOut, freq: number, t: number, gain: number) {
  const { ctx } = o;
  const out = tail(o);
  const src = ctx.createBufferSource();
  src.buffer = o.noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = freq * 2;
  hp.Q.value = 6;
  const g = ctx.createGain();
  env(g, t, gain, 0.001, 0.035);
  src.connect(hp).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + 0.06);
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const g2 = ctx.createGain();
  env(g2, t, gain * 0.35, 0.002, 0.09);
  osc.connect(g2).connect(out);
  osc.start(t);
  osc.stop(t + 0.12);
  return 0.12;
}

/** A low, soft body blow: a falling sine with a short noise edge. */
export function thump(o: VoiceOut, t: number, gain: number, from = 72, to = 34, len = 0.7) {
  const { ctx } = o;
  const out = tail(o);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + len * 0.6);
  const g = ctx.createGain();
  env(g, t, gain, 0.008, len);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + len + 0.05);
  const src = ctx.createBufferSource();
  src.buffer = o.noise;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  const gn = ctx.createGain();
  env(gn, t, gain * 0.5, 0.004, 0.18);
  src.connect(lp).connect(gn).connect(out);
  src.start(t, Math.random());
  src.stop(t + 0.25);
  return len;
}

/** Strain in a member: friction noise whose band wanders, like a creak. */
export function creak(o: VoiceOut, t: number, gain: number, pitch = 1) {
  const { ctx } = o;
  const src = ctx.createBufferSource();
  src.buffer = o.noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 9;
  const base = 520 * pitch;
  bp.frequency.setValueAtTime(base, t);
  bp.frequency.linearRampToValueAtTime(base * 1.35, t + 0.08);
  bp.frequency.linearRampToValueAtTime(base * 0.9, t + 0.22);
  const g = ctx.createGain();
  env(g, t, gain, 0.02, 0.28);
  src.connect(bp).connect(g).connect(tail(o));
  src.start(t, Math.random());
  src.stop(t + 0.35);
  return 0.32;
}

/** A spray of tiny grains (debris settling after an impact). */
export function crackle(o: VoiceOut, t: number, gain: number, grains = 7, spread = 0.6) {
  const { ctx } = o;
  const out = tail(o);
  for (let i = 0; i < grains; i++) {
    const at = t + Math.random() * spread * (0.3 + i / grains);
    const src = ctx.createBufferSource();
    src.buffer = o.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + Math.random() * 3200;
    bp.Q.value = 3;
    const g = ctx.createGain();
    env(g, at, gain * (0.4 + Math.random() * 0.6), 0.001, 0.02 + Math.random() * 0.03);
    src.connect(bp).connect(g).connect(out);
    src.start(at, Math.random());
    src.stop(at + 0.07);
  }
  return spread + 0.1;
}

/** A droplet: a sine that falls quickly in pitch (the cursor pinching off). */
export function droplet(o: VoiceOut, freq: number, t: number, gain: number, rise = false) {
  const { ctx } = o;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(rise ? freq * 0.6 : freq * 1.5, t);
  osc.frequency.exponentialRampToValueAtTime(rise ? freq : freq * 0.7, t + 0.07);
  const g = ctx.createGain();
  env(g, t, gain, 0.003, 0.12);
  osc.connect(g).connect(tail(o));
  osc.start(t);
  osc.stop(t + 0.18);
  return 0.16;
}
