import type { ReactNode } from 'react';

/** Large verified numbers with a label and an optional footnote. */
export function StatGrid({ items }: { items: { value: ReactNode; label: string; note?: string }[] }) {
  return (
    <dl className="stat-grid" data-reveal>
      {items.map((s) => (
        <div key={s.label} className="stat">
          <dd className="stat-value t-num">{s.value}</dd>
          <dt className="stat-label">{s.label}</dt>
          {s.note && <p className="stat-note t-meta">{s.note}</p>}
        </div>
      ))}
    </dl>
  );
}

export interface CompareRow {
  metric: string;
  model: number;
  baseline: number | null;
  baselineLabel?: string;
  format: (v: number) => string;
  /** Which direction is better. */
  better: 'lower' | 'higher';
}

/**
 * Model vs. baseline, drawn as paired bars on a shared scale. The better of
 * the two is lit; the other is left in graphite.
 */
export function CompareBars({ rows, modelLabel = 'Model' }: { rows: CompareRow[]; modelLabel?: string }) {
  return (
    <div className="compare" data-reveal role="table" aria-label="Model compared with baselines">
      <div className="compare-legend t-meta" role="row">
        <span role="columnheader">Metric</span>
        <span role="columnheader">{modelLabel}</span>
        <span role="columnheader">Baseline</span>
      </div>
      {rows.map((r) => {
        const max = Math.max(r.model, r.baseline ?? 0) || 1;
        const modelWins = r.baseline == null ? true : r.better === 'lower' ? r.model < r.baseline : r.model > r.baseline;
        return (
          <div key={r.metric} className="compare-row" role="row">
            <span className="compare-metric" role="rowheader">
              {r.metric}
            </span>
            <span className="compare-cell" role="cell" data-win={modelWins}>
              <span className="compare-bar" style={{ ['--w' as string]: r.model / max }} />
              <span className="compare-val t-num">{r.format(r.model)}</span>
            </span>
            <span className="compare-cell" role="cell" data-win={!modelWins && r.baseline != null}>
              {r.baseline == null ? (
                <span className="compare-val t-meta">—</span>
              ) : (
                <>
                  <span className="compare-bar" style={{ ['--w' as string]: r.baseline / max }} />
                  <span className="compare-val t-num">
                    {r.format(r.baseline)}
                    {r.baselineLabel && <span className="compare-bl t-meta"> {r.baselineLabel}</span>}
                  </span>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** "How to read this" — the honesty notes that sit next to results. */
export function Note({ children, title = 'How to read this' }: { children: ReactNode; title?: string }) {
  return (
    <aside className="note" data-reveal>
      <p className="note-title t-meta">
        <span className="note-mark" aria-hidden="true">
          i
        </span>
        {title}
      </p>
      <div className="note-body">{children}</div>
    </aside>
  );
}

/** A sequence of steps drawn as a continuous line of nodes. */
export function Flow({ steps, vertical }: { steps: { title: string; body?: ReactNode }[]; vertical?: boolean }) {
  return (
    <ol className={`flow ${vertical ? 'flow-v' : ''}`} data-reveal>
      {steps.map((s, i) => (
        <li key={s.title} className="flow-step">
          <span className="flow-node t-meta" aria-hidden="true">
            {String(i + 1).padStart(2, '0')}
          </span>
          <span className="flow-title">{s.title}</span>
          {s.body && <span className="flow-body">{s.body}</span>}
        </li>
      ))}
    </ol>
  );
}

/** Simple, well-set data table. */
export function DataTable({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption?: string }) {
  return (
    <div className="table-wrap" data-reveal>
      <table className="data-table">
        {caption && <caption className="t-meta">{caption}</caption>}
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
