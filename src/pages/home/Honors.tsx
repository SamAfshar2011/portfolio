import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from '../../motion/gsap';
import { revealLines, riseIn, useDirective } from '../../motion/hooks';
import { stageRef } from '../../gl/stageRef';
import { device } from '../../lib/device';
import { Picture } from '../../components/media/Picture';
import { mediaEntry, mediaUrl } from '../../components/media/media';
import type { MedalSpec } from '../../gl/views/MedalHall';

/**
 * Honors — the medals as objects. Three struck metal discs hang in the hall
 * (gl/views/MedalHall.ts); the pointer lights them and they turn towards it.
 * A click turns a medal over to the invention it was awarded for. Below: the
 * plain record, and photographs of the real medals and certificates.
 */
const MEDALS: MedalSpec[] = [
  {
    metal: 'gold',
    ribbon: ['#1e3a8a', '#9f1239'],
    front: { ring: 'IFIA · International Invention & Innovation · Geneva 2026 ·', title: 'Gold', motif: 'laurel' },
    back: { ring: 'Inv. Sam Afshar · IFIA Inv title holder ·', title: 'ANKA', lines: ['AI system for seismic', 'collapse-risk assessment', '& digital certification'] },
  },
  {
    metal: 'gold',
    ribbon: ['#b91c1c', '#7f1d1d'],
    front: { ring: '1Idea1World · Innovation · Design · Startup ·', title: 'Gold', motif: 'bulb' },
    back: { ring: 'Sam Afshar · Earthquake structural safety ·', title: 'ANKA', lines: ['Structural-safety', 'assistant', 'Gold award'] },
  },
  {
    metal: 'silver',
    ribbon: ['#1e2a6a', '#1e2a6a'],
    ribbonStyle: 'dots',
    front: { ring: 'Innoverse · International Invention & Innovation Expo ·', title: 'Silver', motif: 'wings' },
    back: { ring: 'Sam Afshar · Results 24 August 2026 ·', title: 'Fiscora', lines: ['Personal-finance', 'intelligence', 'Silver medal'] },
  },
];

const RECORD = [
  { metal: 'gold', title: 'Gold Medal', event: 'IFIA · 6th International Invention & Innovation Competition', detail: 'Geneva, Switzerland · 3–5 July 2026', project: 'ANKA' },
  { metal: 'gold', title: 'Gold Award', event: '1Idea1World (1I1W) international competition', detail: 'Innovation · Design · Startup', project: 'ANKA' },
  { metal: 'silver', title: 'Silver Medal', event: 'INNOVERSE · International Invention & Innovation Expo', detail: 'Presented by video · results 24 August 2026', project: 'Fiscora' },
  { metal: 'title', title: '“Inv” title', event: 'International Federation of Inventors’ Associations', detail: 'Verification IR2026MAY2987SXA', project: '' },
] as const;

const PROOF = [
  { id: 'honors/medal-1i1w-gold', caption: '1Idea1World · gold · ANKA' },
  { id: 'honors/medal-innoverse-silver', caption: 'INNOVERSE · silver · Fiscora' },
  { id: 'honors/cert-ifia-gold', caption: 'IFIA · gold certificate · Geneva 2026' },
  { id: 'honors/cert-ifia-inv', caption: 'IFIA · “Inv” title certificate' },
];

const largest = (id: string) => {
  const e = mediaEntry(id);
  return mediaUrl(id, e.widths[e.widths.length - 1], 'webp');
};

export function Honors() {
  const ref = useRef<HTMLElement>(null);
  const hall = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const portrait = typeof window !== 'undefined' && window.innerWidth / window.innerHeight < 0.9;

  // The glass steps back and drifts low so the metal has the room.
  useDirective(
    ref,
    {
      formation: 'drift',
      room: 'home',
      anchor: portrait ? [0, -0.55] : [0.62, -0.5],
      scale: portrait ? 0.7 : 0.9,
      presence: 0.3,
      title: 0,
      focus: -1,
      energy: 0,
      daylight: 0,
    },
    { light: [0.5, 0.18] },
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      revealLines(el.querySelector('.honors-title')!);
      revealLines(el.querySelector('.honors-lead')!, { stagger: 0.05 });
      riseIn(el.querySelectorAll('.honors-item'), el.querySelector('.honors-list')!);
      riseIn(el.querySelectorAll('.honors-proof figure'), el.querySelector('.honors-proof')!);
    }, el);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    const host = hall.current;
    if (!host) return;
    let remove: (() => void) | undefined;
    let view: { dispose(): void } | null = null;
    let disposed = false;
    stageRef.ready().then(async (stage) => {
      if (disposed || !stage) return;
      const { MedalHall } = await import('../../gl/views/MedalHall');
      if (disposed) return;
      const v = await MedalHall.create(host, MEDALS, {
        compact: window.innerWidth < 720,
        reducedMotion: device.reducedMotion,
        onFirstFrame: () => setReady(true),
      });
      if (disposed) {
        v.dispose();
        return;
      }
      view = v;
      remove = stage.addView(v);
    });
    return () => {
      disposed = true;
      remove?.();
      view?.dispose();
    };
  }, []);

  return (
    <section ref={ref} className="honors" aria-labelledby="honors-title">
      <div className="shell honors-head">
        <p className="t-meta">Honors</p>
        <h2 id="honors-title" className="honors-title t-display">
          Gold. Gold. Silver.
        </h2>
        <p className="honors-lead t-lead">
          ANKA took gold twice — at IFIA’s 6th International Invention &amp; Innovation Competition in Geneva and at the
          1Idea1World international competition. Fiscora took silver at INNOVERSE. Along the way, IFIA granted the
          “Inv” title.
        </p>
      </div>

      <div ref={hall} className="honors-hall" data-ready={ready} aria-hidden="true">
        <div className="honors-fallback">
          {MEDALS.map((m, i) => (
            <span key={i} className="honors-coin" data-metal={m.metal} />
          ))}
        </div>
        <p className="honors-hint t-meta">{device.touch ? 'Tap a medal to turn it over' : 'Move to light them · click a medal to turn it over'}</p>
      </div>

      <div className="shell">
        <ol className="honors-list">
          {RECORD.map((r) => (
            <li key={r.event} className="honors-item" data-metal={r.metal}>
              <span className="honors-item-title t-meta">{r.title}</span>
              <span className="honors-item-event t-serif">{r.event}</span>
              <span className="honors-item-detail t-meta">{r.detail}</span>
              {r.project && <span className="honors-item-project t-meta">Project · {r.project}</span>}
            </li>
          ))}
        </ol>

        <div className="honors-proof">
          {PROOF.map((p) => (
            <figure key={p.id}>
              <a href={largest(p.id)} target="_blank" rel="noreferrer" aria-label={`Open full size: ${p.caption}`}>
                <Picture id={p.id} alt={p.caption} sizes="(max-width: 899px) 50vw, 25vw" />
              </a>
              <figcaption className="t-meta">{p.caption}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
