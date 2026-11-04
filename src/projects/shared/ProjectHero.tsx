import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { gsap } from '../../motion/gsap';
import { focusPull, useDirective } from '../../motion/hooks';
import type { ProjectMeta } from '../types';
import { AwardPlaque } from '../../components/ui/AwardPlaque';
import { device } from '../../lib/device';

/** How large each project's structure is drawn in the hero, by screen shape. */
const HERO_FIT: Record<string, { wide: number; square: number; portrait: number }> = {
  horizon: { wide: 1.08, square: 0.78, portrait: 1 },
  building: { wide: 1.14, square: 0.72, portrait: 0.82 },
  plate: { wide: 1.12, square: 0.72, portrait: 0.7 },
  default: { wide: 1.12, square: 0.75, portrait: 0.7 },
};

interface Props {
  p: ProjectMeta;
  lead: ReactNode;
  facts: { label: string; value: ReactNode }[];
}

/**
 * The first view of a room: the project's own structure of glass on the
 * right (continuing from the transition), its name resolving into focus,
 * awards, and a few verified facts.
 */
export function ProjectHero({ p, lead, facts }: Props) {
  const ref = useRef<HTMLElement>(null);
  const aspect = typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 1.6;
  const portrait = aspect < 0.9;
  // Squarish screens (tablets, small windows): the title spans most of the
  // width, so the glass rides above it on the right instead of beside it.
  const square = !portrait && aspect < 1.5;
  const fit = HERO_FIT[p.formation] ?? HERO_FIT.default;
  useDirective(
    ref,
    {
      formation: p.formation,
      room: p.room,
      anchor: portrait ? [0, 0.46] : square ? [0.42, 0.36] : [0.4, 0.04],
      scale: portrait ? fit.portrait : square ? fit.square : fit.wide,
      presence: 1,
      title: 0,
      focus: -1,
      energy: 0.15,
      daylight: 0,
    },
    { immediate: true, light: [0.72, 0.3] },
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      focusPull(el.querySelector<HTMLElement>('.ph-title')!, { delay: 0.25, duration: 1.6 });
      const rest = el.querySelectorAll('[data-ph-detail]');
      if (device.reducedMotion) gsap.from(rest, { opacity: 0, duration: 0.6, delay: 0.3 });
      else gsap.from(rest, { opacity: 0, y: 24, duration: 1.1, stagger: 0.08, delay: 0.55, ease: 'settle' });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <header ref={ref} className="ph" style={{ ['--room-accent' as string]: p.accent }}>
      <div className="shell ph-inner">
        <p className="ph-kicker t-meta" data-ph-detail>
          <span className="ph-index">{p.index}</span>
          <span aria-hidden="true">·</span>
          <span>{p.kicker}</span>
        </p>
        <h1 className="ph-title">{p.name}</h1>
        {p.alias && (
          <p className="ph-alias t-meta" data-ph-detail>
            Pipeline name: {p.alias}
          </p>
        )}
        <div className="ph-lead t-lead" data-ph-detail>
          {lead}
        </div>
        {p.awards.length > 0 && (
          <div className="ph-awards" data-ph-detail>
            {p.awards.map((a) => (
              <AwardPlaque key={a.event} award={a} size="lg" />
            ))}
          </div>
        )}
        <dl className="ph-facts" data-ph-detail>
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="t-meta">{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}
