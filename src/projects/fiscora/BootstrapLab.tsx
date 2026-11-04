import { useEffect, useMemo, useRef, useState } from 'react';
import { project, sampleMonth, overrunProbability, type Projection, type SampleMonth } from './projection';
import { gsap } from '../../motion/gsap';
import { device } from '../../lib/device';
import { audio } from '../../components/audio/engine';

const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// What happened is drawn in Fiscora's champagne gold; what might happen in its emerald.
const GOLD = '232, 201, 140';
const EMERALD = '63, 214, 174';

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  m: SampleMonth,
  p: Projection,
  budget: number,
  progress: number,
) {
  const pad = { l: 58, r: 20, t: 22, b: 34 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const maxEnd = Math.max(...p.samples);
  const yMax = Math.max(maxEnd, budget) * 1.08;
  const x = (day: number) => pad.l + (day / m.daysInMonth) * cw;
  const y = (v: number) => pad.t + ch - (v / yMax) * ch;

  ctx.clearRect(0, 0, w, h);
  ctx.font = '500 10px "Geist Mono Variable", ui-monospace, monospace';
  ctx.textBaseline = 'middle';

  // Grid
  const step = yMax > 3000 ? 1000 : 500;
  for (let v = 0; v <= yMax; v += step) {
    ctx.strokeStyle = 'rgba(237,232,225,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, Math.round(y(v)) + 0.5);
    ctx.lineTo(w - pad.r, Math.round(y(v)) + 0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(237,232,225,0.38)';
    ctx.textAlign = 'right';
    ctx.fillText(usd(v), pad.l - 10, y(v));
  }
  ctx.textAlign = 'center';
  [1, 10, 18, 30].forEach((d) => {
    ctx.fillStyle = d === m.today ? 'rgba(237,232,225,0.8)' : 'rgba(237,232,225,0.38)';
    ctx.fillText(d === m.today ? 'Today' : `Day ${d}`, x(d), h - 12);
  });

  // Daily spending as telemetry bars
  const maxDay = Math.max(...m.mtd);
  const barH = ch * 0.2;
  m.mtd.forEach((v, i) => {
    const bx = x(i + 1) - cw / m.daysInMonth / 2 + 2;
    const bw = cw / m.daysInMonth - 4;
    const bh = (v / maxDay) * barH;
    const g = ctx.createLinearGradient(0, pad.t + ch - bh, 0, pad.t + ch);
    g.addColorStop(0, `rgba(${GOLD},0.55)`);
    g.addColorStop(1, `rgba(${GOLD},0.08)`);
    ctx.fillStyle = g;
    ctx.fillRect(bx, pad.t + ch - bh, bw, bh);
  });

  // Actual cumulative spend so far
  ctx.strokeStyle = 'rgba(237,232,225,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  let c = 0;
  ctx.moveTo(x(0), y(0));
  m.mtd.forEach((v, i) => {
    c += v;
    ctx.lineTo(x(i + 1), y(c));
  });
  ctx.stroke();

  const remaining = m.daysInMonth - m.today;
  const shown = Math.max(0, Math.min(remaining, progress * remaining));
  const whole = Math.floor(shown);
  const frac = shown - whole;

  // P20–P80 band per remaining day
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i < remaining; i++) {
    const col = p.paths.map((path) => path[i]).sort((a, b) => a - b);
    lo.push(col[Math.floor(col.length * 0.2)]);
    hi.push(col[Math.floor(col.length * 0.8)]);
  }
  if (whole > 0) {
    ctx.fillStyle = `rgba(${EMERALD},0.1)`;
    ctx.beginPath();
    ctx.moveTo(x(m.today), y(p.spent));
    for (let i = 0; i < whole; i++) ctx.lineTo(x(m.today + i + 1), y(hi[i]));
    for (let i = whole - 1; i >= 0; i--) ctx.lineTo(x(m.today + i + 1), y(lo[i]));
    ctx.closePath();
    ctx.fill();
  }

  // 300 bootstrap paths: individually faint, together a fan of light
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(${EMERALD},0.045)`;
  ctx.globalCompositeOperation = 'lighter';
  for (const path of p.paths) {
    ctx.beginPath();
    ctx.moveTo(x(m.today), y(p.spent));
    for (let i = 0; i < whole; i++) ctx.lineTo(x(m.today + i + 1), y(path[i]));
    if (whole < remaining && frac > 0) {
      const prev = whole === 0 ? p.spent : path[whole - 1];
      ctx.lineTo(x(m.today + whole + frac), y(prev + (path[whole] - prev) * frac));
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Expected path (weekday means)
  if (whole > 0) {
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(237,232,225,0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x(m.today), y(p.spent));
    for (let i = 0; i < whole; i++) ctx.lineTo(x(m.today + i + 1), y(p.expected[i]));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Today marker
  ctx.strokeStyle = 'rgba(237,232,225,0.18)';
  ctx.beginPath();
  ctx.moveTo(Math.round(x(m.today)) + 0.5, pad.t);
  ctx.lineTo(Math.round(x(m.today)) + 0.5, pad.t + ch);
  ctx.stroke();

  // Budget line
  const by = Math.round(y(budget)) + 0.5;
  const over = overrunProbability(p, budget);
  const tone = over > 0.6 ? '255,122,82' : over > 0.25 ? '243,217,138' : '63,214,174';
  ctx.strokeStyle = `rgba(${tone},0.95)`;
  ctx.setLineDash([2, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad.l, by);
  ctx.lineTo(w - pad.r, by);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = `rgb(${tone})`;
  ctx.beginPath();
  ctx.arc(w - pad.r - 6, by, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(11,11,12,0.9)';
  ctx.beginPath();
  ctx.arc(w - pad.r - 6, by, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'right';
  ctx.fillStyle = `rgb(${tone})`;
  ctx.fillText(`Budget ${usd(budget)}`, w - pad.r - 18, by - 12);
  return { yMax, pad, ch };
}

/**
 * Interactive demonstration of Fiscora's month-end projection. Visitors drag
 * the budget and watch the overrun probability respond — computed exactly the
 * way Fiscora computes it, over 300 bootstrap resamples.
 */
export function BootstrapLab() {
  const [seed, setSeed] = useState(11);
  const month = useMemo(() => sampleMonth(seed), [seed]);
  const proj = useMemo(() => project(month), [month]);
  const [budget, setBudget] = useState(() => Math.round(project(sampleMonth(11)).projected / 50) * 50);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const progress = useRef({ v: device.reducedMotion ? 1 : 0 });
  const geom = useRef<{ yMax: number; pad: { t: number }; ch: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 360 });

  const range = { min: Math.round(proj.spent / 50) * 50, max: Math.round((proj.p80 * 1.35) / 50) * 50 };
  // Keep the budget meaningful when a new sample month is drawn.
  useEffect(() => {
    setBudget((b) => Math.max(range.min, Math.min(range.max, b)));
  }, [range.min, range.max]);
  const over = overrunProbability(proj, budget);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      setSize({ w, h: Math.round(Math.min(420, Math.max(280, w * 0.48))) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const render = () => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== size.w * dpr) {
      c.width = size.w * dpr;
      c.height = size.h * dpr;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    geom.current = draw(ctx, size.w, size.h, month, proj, budget, progress.current.v);
  };

  const renderRef = useRef(render);
  renderRef.current = render;
  useEffect(render);

  // Paths grow out of "today" when the lab first enters the view, and again
  // whenever a new sample month is drawn.
  useEffect(() => {
    if (device.reducedMotion) return;
    const el = wrapRef.current!;
    progress.current.v = 0;
    const tween = gsap.to(progress.current, {
      v: 1,
      duration: 1.8,
      ease: 'settle',
      paused: true,
      onUpdate: () => renderRef.current(),
    });
    const io = new IntersectionObserver(([e]) => e.isIntersecting && tween.play(), { threshold: 0.35 });
    io.observe(el);
    return () => {
      io.disconnect();
      tween.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // Drag the budget line directly on the chart.
  const drag = useRef(false);
  const fromPointer = (clientY: number) => {
    const c = canvasRef.current;
    const g = geom.current;
    if (!c || !g) return;
    const r = c.getBoundingClientRect();
    const v = ((g.pad.t + g.ch - (clientY - r.top)) / g.ch) * g.yMax;
    setBudget(Math.max(range.min, Math.min(range.max, Math.round(v / 10) * 10)));
  };

  return (
    <div className="lab" data-reveal>
      <div className="lab-head">
        <p className="t-meta">Live · runs in your browser</p>
        <p className="lab-sub">
          A sample month, day {month.today} of {month.daysInMonth}. Drag the budget line.
        </p>
      </div>
      <div className="lab-grid">
        <div ref={wrapRef} className="lab-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="lab-canvas"
            style={{ width: size.w, height: size.h }}
            role="img"
            aria-label={`Spending so far ${usd(proj.spent)}. 300 bootstrap simulations project month-end spending between ${usd(proj.p20)} and ${usd(proj.p80)}. With a budget of ${usd(budget)}, ${Math.round(over * 100)}% of simulations overrun.`}
            data-cursor="Drag"
            onPointerDown={(e) => {
              drag.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              fromPointer(e.clientY);
            }}
            onPointerMove={(e) => drag.current && fromPointer(e.clientY)}
            onPointerUp={() => {
              drag.current = false;
              audio.tick(0.9);
            }}
          />
        </div>
        <dl className="lab-readout">
          <div className="lab-big">
            <dt className="t-meta">Overrun probability</dt>
            <dd className="t-num" aria-live="polite">
              {Math.round(over * 100)}
              <span>%</span>
            </dd>
          </div>
          <div>
            <dt className="t-meta">Spent so far</dt>
            <dd className="t-num">{usd(proj.spent)}</dd>
          </div>
          <div>
            <dt className="t-meta">Expected month-end</dt>
            <dd className="t-num">{usd(proj.projected)}</dd>
          </div>
          <div>
            <dt className="t-meta">P20 – P80</dt>
            <dd className="t-num">
              {usd(proj.p20)} – {usd(proj.p80)}
            </dd>
          </div>
          <div>
            <dt className="t-meta">Daily burn (28 days)</dt>
            <dd className="t-num">{usd(proj.burn)}</dd>
          </div>
        </dl>
      </div>
      <div className="lab-controls">
        <label className="lab-range">
          <span className="t-meta">Budget</span>
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={10}
            value={budget}
            onChange={(e) => setBudget(+e.target.value)}
            aria-valuetext={`${usd(budget)}, ${Math.round(over * 100)} percent overrun probability`}
          />
          <span className="t-num">{usd(budget)}</span>
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setSeed((s) => s + 1);
            audio.press();
          }}
        >
          Draw another month
        </button>
      </div>
      <p className="lab-foot t-meta">
        Sample data generated in the browser · method: weekday means + 300 bootstrap resamples of the last 28 days
      </p>
    </div>
  );
}
