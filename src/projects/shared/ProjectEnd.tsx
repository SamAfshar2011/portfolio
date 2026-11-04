import { useLayoutEffect, useRef } from 'react';
import { gsap } from '../../motion/gsap';
import { revealLines, riseIn, useDirective } from '../../motion/hooks';
import type { ProjectMeta } from '../types';
import { neighbours, projectPath } from '../registry';
import { TLink } from '../../components/transition/TLink';
import { ExternalLink } from '../../components/transition/ExternalLink';

/**
 * The end of a room: what it was built with, the way to its source, and the
 * doors to the neighbouring rooms. Hovering a door previews that room's
 * structure in the glass before you go through.
 */
export function ProjectEnd({ p }: { p: ProjectMeta }) {
  const ref = useRef<HTMLElement>(null);
  const { prev, next } = neighbours(p.slug);
  useDirective(ref, { formation: p.formation, room: p.room, anchor: [0, 0.25], scale: 0.8, presence: 0.4, energy: 0, focus: -1, title: 0, daylight: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      revealLines(el.querySelector('.end-title')!);
      riseIn(el.querySelectorAll('.end-tech li'), el.querySelector('.end-tech')!, { stagger: 0.03 });
      riseIn(el.querySelectorAll('.end-door, .end-repo'), el.querySelector('.end-doors')!, { stagger: 0.08 });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="project-end" aria-labelledby="end-title">
      <div className="shell end-inner">
        <p className="t-meta">Built with</p>
        <ul className="end-tech" aria-label="Technologies">
          {p.tech.map((t) => (
            <li key={t} className="m-chip">
              {t}
            </li>
          ))}
        </ul>

        <h2 id="end-title" className="end-title t-headline">
          Read the code.
        </h2>
        <ExternalLink href={p.repo} label={`the ${p.name} repository`} className="end-repo" data-cursor="Source">
          <span className="end-repo-label t-meta">Repository</span>
          <span className="end-repo-path">
            github.com/SamAfshar2011/<strong>{p.repo.split('/').pop()}</strong>
          </span>
          <span className="end-repo-arrow" aria-hidden="true">
            ↗
          </span>
        </ExternalLink>

        <nav className="end-doors" aria-label="Other projects">
          {[
            { label: 'Previous room', q: prev },
            { label: 'Next room', q: next },
          ].map(({ label, q }) => (
            <TLink
              key={label}
              to={projectPath(q.slug)}
              className="end-door"
              data-cursor="Enter"
              style={{ ['--door-accent' as string]: q.accent }}
            >
              <span className="t-meta">
                {label} · {q.index}
              </span>
              <span className="end-door-name">{q.name}</span>
              <span className="end-door-kicker">{q.kicker}</span>
            </TLink>
          ))}
          <TLink to="/" className="end-door end-door-home" data-cursor="Home">
            <span className="t-meta">Back to</span>
            <span className="end-door-name">Index</span>
            <span className="end-door-kicker">All three rooms</span>
          </TLink>
        </nav>
      </div>
    </section>
  );
}
