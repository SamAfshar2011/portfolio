import { useEffect, useRef, useState } from 'react';
import data from './classifier.json';

/**
 * The character classifier's validation confusion matrix, rebuilt from the
 * run's saved per-class accuracy and misclassification list (see
 * scripts/alpr-data.mjs). 32 × 32 cells: the diagonal is every correct read,
 * lit by how many validation crops the class has; anything off it is a
 * mistake. There are two. A class with no validation crops is drawn as an
 * empty outline rather than a lit cell.
 */
const N = data.labels.length;
const errors: { t: number; p: number; n: number }[] = [];
data.matrix.forEach((row, t) => row.forEach((n, p) => t !== p && n > 0 && errors.push({ t, p, n })));
const support = data.matrix.map((row) => row.reduce((a, b) => a + b, 0));
const empty = data.labels.filter((_, i) => support[i] === 0);
const name = (i: number) => (data.english[i] !== data.labels[i] ? `${data.labels[i]} (${data.english[i]})` : data.labels[i]);

export function ConfusionGrid() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ t: number; p: number } | null>(null);
  const [size, setSize] = useState(420);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize(Math.round(Math.min(560, e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The room's own light: correct reads in the accent, mistakes in the second colour.
    const css = getComputedStyle(c);
    const lit = css.getPropertyValue('--accent').trim() || '#8fe3f2';
    const miss = css.getPropertyValue('--accent-2').trim() || '#b9a8ff';
    const cell = size / N;
    const g = Math.max(1, cell * 0.14);
    ctx.clearRect(0, 0, size, size);
    for (let t = 0; t < N; t++) {
      for (let p = 0; p < N; p++) {
        const n = data.matrix[t][p];
        const x = p * cell + g / 2;
        const y = t * cell + g / 2;
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        if (t === p && support[t] === 0) {
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = lit;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.strokeRect(x + 0.5, y + 0.5, cell - g - 1, cell - g - 1);
          ctx.setLineDash([]);
          continue;
        }
        if (t === p) {
          const k = Math.min(1, n / 100);
          ctx.globalAlpha = 0.28 + 0.72 * k;
          ctx.fillStyle = lit;
          ctx.shadowColor = lit;
          ctx.shadowBlur = 8 * k;
        } else if (n > 0) {
          ctx.fillStyle = miss;
          ctx.shadowColor = miss;
          ctx.shadowBlur = 14;
        } else {
          ctx.fillStyle = 'rgba(237, 232, 225, 0.045)';
        }
        ctx.fillRect(x, y, cell - g, cell - g);
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (hover) {
      ctx.strokeStyle = 'rgba(237,232,225,0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(hover.p * cell + 0.5, hover.t * cell + 0.5, cell - 1, cell - 1);
    }
  }, [size, hover]);

  const onMove = (e: React.PointerEvent) => {
    const r = (e.target as HTMLElement).getBoundingClientRect();
    const p = Math.floor(((e.clientX - r.left) / r.width) * N);
    const t = Math.floor(((e.clientY - r.top) / r.height) * N);
    if (p >= 0 && p < N && t >= 0 && t < N) setHover({ t, p });
  };

  const h = hover ?? { t: errors[0].t, p: errors[0].p };
  const n = data.matrix[h.t][h.p];
  const count =
    support[h.t] === 0
      ? 'No validation crops left for this class'
      : `${n} of ${support[h.t]} ${support[h.t] === 1 ? 'crop' : 'crops'} ${h.t === h.p ? 'read correctly' : 'misread'}`;
  return (
    <div className="cm" data-reveal>
      <div ref={wrap} className="cm-canvas-wrap">
        <p className="cm-axis-y t-meta" aria-hidden="true">
          True class ↓
        </p>
        <p className="cm-axis-x t-meta" aria-hidden="true">
          Predicted class →
        </p>
        <canvas
          ref={ref}
          style={{ width: size, height: size }}
          className="cm-canvas"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          data-cursor="Inspect"
          role="img"
          aria-label={`Confusion matrix over ${data.total} validation character crops: ${data.correct} correct. Errors: ${errors
            .map((e) => `${name(e.t)} read as ${name(e.p)} (${e.n})`)
            .join('; ')}. No validation crops for: ${empty.join(', ')}.`}
        />
      </div>
      <div className="cm-side">
        <p className="cm-big t-num">
          {data.correct.toLocaleString('en-US')}
          <span> / {data.total.toLocaleString('en-US')}</span>
        </p>
        <p className="t-meta">Validation crops read correctly</p>
        <div className="cm-readout" aria-live="polite">
          <p className="t-meta">{hover ? 'Cell' : `One of the ${errors.length} errors`}</p>
          <p className="cm-pair" lang="fa" dir="ltr">
            <span>{data.labels[h.t]}</span>
            <span className="cm-arrow" aria-hidden="true">
              →
            </span>
            <span>{data.labels[h.p]}</span>
          </p>
          {(data.english[h.t] !== data.labels[h.t] || data.english[h.p] !== data.labels[h.p]) && (
            <p className="cm-names t-meta">
              {data.english[h.t]} → {data.english[h.p]}
            </p>
          )}
          <p className="cm-count">{count}</p>
        </div>
        <ul className="cm-errors">
          {errors.map((e) => (
            <li key={`${e.t}-${e.p}`}>
              <b>
                <bdi lang="fa">{data.labels[e.t]}</bdi>
              </b>{' '}
              read as{' '}
              <b>
                <bdi lang="fa">{data.labels[e.p]}</bdi>
              </b>{' '}
              · {e.n}
            </li>
          ))}
        </ul>
        <p className="cm-key t-meta">
          Brightness follows how many crops a class has. Dashed: no validation crops ({empty.join(', ')}).
        </p>
      </div>
    </div>
  );
}
