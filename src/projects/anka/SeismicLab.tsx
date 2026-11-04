import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { gsap } from '../../motion/gsap';
import { stageRef } from '../../gl/stageRef';
import { audio } from '../../components/audio/engine';
import { loadRapier, constrainedConnection } from '../../gl/physics';
import { generateGround, estimatePga, G, sample, type Soil, type GroundRecord } from './sim/ground';
import { Building, STOREY_H, damageState, type DamageState, type Structure, type Liquefaction } from './sim/structure';
import type { SeismicView } from './SeismicView';

interface Params {
  structure: Structure;
  floors: number;
  age: number;
  shearWall: boolean;
  soil: Soil;
  magnitude: number;
  duration: number;
  depth: number;
  liquefaction: Liquefaction;
}

/** The starting point matches ANKA's own simulator screen. */
const DEFAULTS: Params = {
  structure: 'concrete',
  floors: 10,
  age: 20,
  shearWall: false,
  soil: 'sand',
  magnitude: 6.5,
  duration: 30,
  depth: 10,
  liquefaction: 'low',
};

const STATE_COPY: Record<DamageState, string> = {
  none: 'No damage',
  minor: 'Minor damage',
  moderate: 'Moderate damage',
  severe: 'Severe damage',
  collapse: 'Collapse',
};

interface Readout {
  t: number;
  acc: number;
  peakAcc: number;
  drift: number;
  driftAt: number;
  peakDrift: number;
  damage: number;
  state: DamageState;
  failedAt: number | null;
  failedTime: number | null;
  residual: number;
  settlement: number;
  tilt: number;
  slide: number;
  ru: number;
  phase: 'ready' | 'running' | 'paused' | 'done';
}

const EMPTY: Readout = {
  t: 0,
  acc: 0,
  peakAcc: 0,
  drift: 0,
  driftAt: 0,
  peakDrift: 0,
  damage: 0,
  state: 'none',
  failedAt: null,
  failedTime: null,
  residual: 0,
  settlement: 0,
  tilt: 0,
  slide: 0,
  ru: 0,
  phase: 'ready',
};

/** Marks a control that is also one of the eight inputs to ANKA's risk model. */
function ModelMark() {
  return (
    <span className="seis-mark" title="Also an input to ANKA’s risk model">
      <span aria-hidden="true">●</span>
      <span className="sr-only">(also an input to ANKA’s risk model)</span>
    </span>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  mark,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  mark?: boolean;
}) {
  return (
    <fieldset className="seg">
      <legend className="seis-label">
        {label}
        {mark && <ModelMark />}
      </legend>
      <div className="seg-row" style={{ ['--n' as string]: options.length }}>
        {options.map((o) => (
          <label key={o.value} className="seg-opt" data-on={value === o.value}>
            <input type="radio" name={label} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  mark,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => ReactNode;
  onChange: (v: number) => void;
  mark?: boolean;
  note?: ReactNode;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="seis-range">
      <span className="seis-label">
        {label}
        {mark && <ModelMark />}
      </span>
      <output className="seis-value t-num">{format(value)}</output>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(+e.target.value)}
      />
      {note && <span className="seis-note">{note}</span>}
    </label>
  );
}

/**
 * Shake a building. Every control of ANKA's own simulator, a structural model
 * rebuilt for the browser (see sim/structure.ts), and a maquette that shows
 * what the model computes. Readouts are the model's own quantities.
 */
export function SeismicLab() {
  const [params, setParams] = useState<Params>(DEFAULTS);
  const viewEl = useRef<HTMLDivElement>(null);
  const view = useRef<SeismicView | null>(null);
  const model = useRef<Building | null>(null);
  const running = useRef<'ready' | 'running' | 'paused' | 'done'>('ready');
  const [has3d, setHas3d] = useState(true);
  const [readout, setReadout] = useState<Readout>(EMPTY);
  const trace = useRef<HTMLCanvasElement>(null);
  const profile = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const quake = useMemo(
    () => ({ magnitude: params.magnitude, duration: params.duration, depth: params.depth, soil: params.soil }),
    [params.magnitude, params.duration, params.depth, params.soil],
  );
  // The record is generated from the inputs (deterministic, a few milliseconds).
  const ground = useMemo<GroundRecord>(() => generateGround(quake), [quake]);
  const groundRef = useRef(ground);
  groundRef.current = ground;

  const building = () =>
    new Building({
      structure: params.structure,
      floors: params.floors,
      age: params.age,
      shearWall: params.shearWall,
      soil: params.soil,
      liquefaction: params.liquefaction,
    });

  // A new building whenever the parameters change (the quake stops).
  useEffect(() => {
    model.current = building();
    running.current = 'ready';
    view.current?.setModel(model.current, ground, params.soil);
    setReadout(EMPTY);
    drawTrace();
    drawProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, ground]);

  // Mount the maquette into the shared stage (or fall back to a 2D sketch).
  useEffect(() => {
    const host = viewEl.current;
    if (!host) return;
    let remove: (() => void) | undefined;
    let disposed = false;
    stageRef.ready().then(async (stage) => {
      if (disposed) return;
      if (!stage) {
        setHas3d(false);
        return;
      }
      const { SeismicView } = await import('./SeismicView');
      if (disposed) return;
      const v = new SeismicView(host);
      if (model.current) v.setModel(model.current, groundRef.current, params.soil);
      view.current = v;
      remove = stage.addView(v);
    });
    return () => {
      disposed = true;
      remove?.();
      view.current?.dispose();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The simulation runs on the shared ticker, in real time. Readouts refresh
  // at ~12 Hz; the view reads the model every frame.
  useEffect(() => {
    let acc = 0;
    let settled = '';
    // What has already been heard for the current model (reset on restart).
    let heard = { model: null as Building | null, yielded: [] as boolean[], releases: 0 };
    const tick = (_t: number, deltaMs: number) => {
      const m = model.current;
      if (!m) return;
      const g = groundRef.current;
      if (running.current === 'running') {
        m.advance(g, Math.min(deltaMs / 1000, 1 / 30));
        // The building, heard: its motion drives a low resonance at a pitch set
        // by its own period, the ground a rumble; yielding storeys creak and a
        // collapse lands (sound on only).
        if (heard.model !== m) heard = { model: m, yielded: [], releases: 0 };
        const top = Math.max(0, m.active - 1);
        audio.resonance(Math.abs(m.v[top]) / 0.6, m.period, Math.abs(sample(g.acc, g.dt, m.time)) / (0.6 * G));
        m.storeys.forEach((st, i) => {
          if (!heard.yielded[i] && Math.abs(st.z) > 0.95) {
            heard.yielded[i] = true;
            audio.yieldAt(i + 1, m.n);
          }
        });
        if (m.releases.length > heard.releases) {
          heard.releases = m.releases.length;
          audio.collapse();
        }
        if (m.time >= g.length || m.unstable) {
          running.current = 'done';
          audio.sweep(false);
        }
      } else audio.resonance(0, m.period);
      if (!has3d) drawSvg();
      acc += deltaMs;
      if (acc < 80 && running.current === 'running') return;
      acc = 0;
      // While running, ~12 Hz; once paused or finished, one last report.
      const key = running.current === 'running' ? '' : `${running.current}:${m.time}`;
      if (running.current === 'ready' || (key && key === settled)) return;
      settled = key;
      report();
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [has3d]);

  const report = () => {
    const m = model.current;
    if (!m) return;
    const g = groundRef.current;
    const s = m.summary();
    const rel = m.releases[0];
    const roof = m.active > 0 ? m.q[m.active - 1] : 0;
    setReadout({
      t: Math.min(m.time, g.length),
      acc: Math.abs(sample(g.acc, g.dt, m.time)) / G,
      peakAcc: m.peakAcc,
      drift: s.ratio,
      driftAt: s.worst,
      peakDrift: s.peakRatio,
      damage: s.damage,
      state: s.state,
      failedAt: rel ? rel.from : null,
      failedTime: rel ? rel.time : null,
      residual: roof,
      settlement: m.settlement,
      tilt: m.tiltPerm,
      slide: m.slide,
      ru: m.ru,
      phase: running.current,
    });
    drawTrace();
    drawProfile();
  };

  const drawTrace = () => {
    const c = trace.current;
    if (!c) return;
    const g = groundRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const peak = Math.max(g.pga * G, 1e-6);
    const t = model.current?.time ?? 0;
    const px = (tt: number) => (tt / g.length) * w;
    const mid = h / 2;
    // Whole record, faint; the part already played, in the room's ember.
    const drawRange = (from: number, to: number, color: string) => {
      ctx.beginPath();
      const step = Math.max(1, Math.floor(g.acc.length / (w * 1.5)));
      for (let k = Math.floor(from / g.dt); k <= Math.min(g.acc.length - 1, Math.floor(to / g.dt)); k += step) {
        const x = px(k * g.dt);
        const y = mid - (g.acc[k] / peak) * (h * 0.44);
        if (k === Math.floor(from / g.dt)) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    drawRange(0, g.length, 'rgb(237 232 225 / 0.18)');
    if (t > 0) drawRange(0, t, 'rgb(234 122 69 / 0.9)');
    ctx.fillStyle = 'rgb(237 232 225 / 0.1)';
    ctx.fillRect(0, mid, w, 1);
    if (t > 0 && t < g.length) {
      ctx.fillStyle = 'rgb(255 236 206 / 0.8)';
      ctx.fillRect(px(t), 4, 1, h - 8);
    }
  };

  const drawProfile = () => {
    const c = profile.current;
    const m = model.current;
    if (!c || !m) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const n = m.n;
    // Scale: yield and capacity of the first storey mark the axis.
    const cap = m.du[0] / STOREY_H;
    const yieldR = m.dy[0] / STOREY_H;
    const full = cap * 1.25;
    const x = (r: number) => Math.min(1, r / full) * (w - 4);
    const rowH = h / n;
    ctx.fillStyle = 'rgb(237 232 225 / 0.14)';
    ctx.fillRect(x(yieldR), 0, 1, h);
    ctx.fillStyle = 'rgb(234 122 69 / 0.5)';
    ctx.fillRect(x(cap), 0, 1, h);
    for (let f = 0; f < n; f++) {
      const st = m.storeys[f];
      const y = h - (f + 1) * rowH;
      const bh = Math.max(1, rowH - Math.max(1, rowH * 0.3));
      ctx.fillStyle = st.failed ? 'rgb(255 106 85 / 0.55)' : 'rgb(237 232 225 / 0.12)';
      ctx.fillRect(0, y + (rowH - bh) / 2, x(st.peak / STOREY_H), bh);
      const d = damageState(st.damage);
      ctx.fillStyle = st.failed ? '#ff6a55' : d === 'severe' ? '#f08a3c' : d === 'moderate' ? '#e6c547' : '#ede8e1';
      ctx.fillRect(0, y + (rowH - bh) / 2, x(Math.abs(st.drift) / STOREY_H), bh);
    }
  };

  const drawSvg = () => {
    const svg = svgRef.current;
    const m = model.current;
    if (!svg || !m) return;
    const g = sample(groundRef.current.disp, groundRef.current.dt, m.time) * 60;
    const lines = [];
    for (let f = 0; f < m.n; f++) {
      const x = g + (f < m.active ? m.q[f] : 0) * 400;
      const y = 200 - (f + 1) * (170 / m.n) + (m.storeys[f].failed ? 12 : 0);
      const dmg = Math.min(1, m.storeys[f].damage);
      lines.push(`<line x1="${60 + x}" y1="${y}" x2="${240 + x}" y2="${y}" stroke="${dmg > 0.4 ? '#ff7a52' : '#ede8e1'}" stroke-width="4" stroke-linecap="round" opacity="${1 - dmg * 0.5}"/>`);
    }
    svg.innerHTML = `<line x1="30" y1="200" x2="270" y2="200" stroke="#8a847b" stroke-width="2"/>${lines.join('')}`;
  };

  const start = () => {
    model.current = building();
    view.current?.setModel(model.current, ground, params.soil);
    running.current = 'running';
    // Physics for a collapse, fetched only when it could be needed.
    if (!constrainedConnection()) loadRapier().catch(() => undefined);
    audio.sweep(false);
    report();
  };
  const pause = () => {
    if (running.current === 'running') running.current = 'paused';
    else if (running.current === 'paused') running.current = 'running';
    report();
  };
  const reset = () => setParams((p) => ({ ...p }));
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const pga = estimatePga(quake);
  const phase = readout.phase;
  const liquefying = params.liquefaction !== 'low' || readout.ru > 0.1;

  return (
    <div className="seis" data-reveal>
      <div className="seis-grid">
        <div className="seis-stage">
          <div ref={viewEl} className="seis-view" data-phase={phase} aria-label="Simulated building. Drag to inspect; double-click to reset the view." role="img">
            {!has3d && <svg ref={svgRef} viewBox="0 0 300 220" className="seis-svg" />}
            <div className="seis-hud" aria-hidden="true">
              <span className="t-meta">t {readout.t.toFixed(1)} s</span>
              <span className="t-meta">ground {readout.acc.toFixed(2)} g</span>
            </div>
            <p className="seis-scale t-meta" aria-hidden="true">
              Deformation shown ×8
            </p>
          </div>

          <div className="seis-actions">
            <button type="button" className="btn btn-primary" onClick={start} data-magnetic>
              {phase === 'ready' ? (<><span className="seis-long">Start the earthquake</span><span className="seis-short">Start</span></>) : 'Restart'}
            </button>
            <button type="button" className="btn" onClick={pause} disabled={phase !== 'running' && phase !== 'paused'}>
              {phase === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button type="button" className="btn" onClick={reset}>
              Reset
            </button>
          </div>

          <div className="seis-trace">
            <div className="seis-trace-head">
              <span className="t-meta">Ground acceleration</span>
              <span className="t-meta">peak {pga.toFixed(2)} g · {ground.length.toFixed(0)} s</span>
            </div>
            <canvas ref={trace} className="seis-trace-canvas" aria-hidden="true" />
          </div>

          <dl className="seis-readout" aria-live="polite">
            <div className="seis-sev" data-sev={readout.state}>
              <dt className="t-meta">Damage state</dt>
              <dd>{readout.failedAt ? `Storey ${readout.failedAt} failed` : STATE_COPY[readout.state]}</dd>
            </div>
            <div>
              <dt className="t-meta">Peak inter-storey drift</dt>
              <dd className="t-num">
                {pct(readout.peakDrift)}
                {readout.driftAt > 0 && <span className="seis-sub"> now {pct(readout.drift)} · storey {readout.driftAt}</span>}
              </dd>
            </div>
            <div>
              <dt className="t-meta">Peak ground acceleration</dt>
              <dd className="t-num">{readout.peakAcc.toFixed(2)} g</dd>
            </div>
            <div>
              <dt className="t-meta">{phase === 'done' ? 'Residual roof offset' : 'Roof offset'}</dt>
              <dd className="t-num">{(readout.residual * 100).toFixed(1)} cm</dd>
            </div>
            {liquefying && (
              <div>
                <dt className="t-meta">Foundation</dt>
                <dd className="t-num">
                  {(readout.settlement * 100).toFixed(1)} cm settled · {((Math.abs(readout.tilt) * 180) / Math.PI).toFixed(2)}° lean
                </dd>
              </div>
            )}
          </dl>

          <div className="seis-profile">
            <div className="seis-trace-head">
              <span className="t-meta">Drift by storey</span>
              <span className="t-meta seis-legend">
                <i className="lg-yield" /> yield <i className="lg-cap" /> capacity
              </span>
            </div>
            <canvas ref={profile} className="seis-profile-canvas" aria-hidden="true" />
          </div>
        </div>

        <div className="seis-controls">
          <section className="seis-group" aria-labelledby="seis-building">
            <h3 id="seis-building" className="seis-group-title">
              Building
            </h3>
            <Segmented
              label="Structure type"
              mark
              value={params.structure}
              onChange={(v) => set('structure', v)}
              options={[
                { value: 'concrete', label: 'Concrete' },
                { value: 'steel', label: 'Steel' },
                { value: 'wood', label: 'Wood' },
                { value: 'masonry', label: 'Masonry' },
              ]}
            />
            <Range label="Number of floors" mark value={params.floors} min={2} max={25} step={1} format={(v) => v} onChange={(v) => set('floors', v)} />
            <Range label="Building age" mark value={params.age} min={0} max={100} step={1} format={(v) => `${v} yr`} onChange={(v) => set('age', v)} />
            <Segmented
              label="Shear wall"
              mark
              value={params.shearWall ? 'yes' : 'no'}
              onChange={(v) => set('shearWall', v === 'yes')}
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
            />
            <Segmented
              label="Soil type"
              mark
              value={params.soil}
              onChange={(v) => set('soil', v)}
              options={[
                { value: 'rock', label: 'Rock' },
                { value: 'gravel', label: 'Gravel' },
                { value: 'sand', label: 'Sand' },
                { value: 'clay', label: 'Clay' },
                { value: 'soft', label: 'Soft' },
              ]}
            />
          </section>

          <section className="seis-group" aria-labelledby="seis-quake">
            <h3 id="seis-quake" className="seis-group-title">
              Earthquake
            </h3>
            <Range label="Magnitude" mark value={params.magnitude} min={4} max={9} step={0.1} format={(v) => `M${v.toFixed(1)}`} onChange={(v) => set('magnitude', v)} />
            <Range label="Duration" value={params.duration} min={5} max={60} step={1} format={(v) => `${v} s`} onChange={(v) => set('duration', v)} />
            <Range
              label="Epicentre depth"
              value={params.depth}
              min={1}
              max={100}
              step={1}
              format={(v) => `${v} km`}
              onChange={(v) => set('depth', v)}
              note="Horizontal distance is not an input, so the simulation places the site directly above the hypocentre — the strongest case for a given depth."
            />
            <Segmented
              label="Soil liquefaction risk"
              mark
              value={params.liquefaction}
              onChange={(v) => set('liquefaction', v)}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
            />
            <p className="seis-note">
              As water pressure builds in loose, saturated soil it loses stiffness and strength. The foundation softens,
              can slide and settle unevenly, and may be left permanently offset and leaning. Rock does not liquefy.
            </p>
          </section>
          <p className="seis-key t-meta">
            <ModelMark /> also an input to ANKA’s risk model · duration and depth are simulator-only
          </p>
        </div>
      </div>
      <p className="seis-foot">
        An explanatory simulation, not a structural or seismic assessment: a simplified model with generalised
        parameters. For a real building, consult a licensed structural engineer.
      </p>
    </div>
  );
}
