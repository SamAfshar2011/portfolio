import { useLayoutEffect, useRef } from 'react';
import { gsap, ScrollTrigger } from '../../motion/gsap';
import { revealLines, riseIn } from '../../motion/hooks';
import { director } from '../../experience/director';

/**
 * Influences — the one daylight room. A porcelain slab rises over the dark
 * stage; the glass steps aside so the typography can breathe. Names are set
 * in order of preference, without logos. Hovering a name stretches it along
 * the variable font's width axis.
 */
const COMPANIES = ['Apple', 'NVIDIA', 'Microsoft', 'Google', 'Anthropic'];
const PEOPLE = ['Steve Jobs', 'Jony Ive', 'Tim Cook'];

export function Influences() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: el,
        start: 'top 60%',
        end: 'bottom 40%',
        onToggle: (self) =>
          self.isActive &&
          director.set({ formation: 'drift', presence: 0, title: 0, focus: -1, energy: 0, room: 'home', daylight: 0 }),
      });
      revealLines(el.querySelector('.infl-title')!);
      revealLines(el.querySelector('.infl-body')!, { stagger: 0.05 });
      el.querySelectorAll<HTMLElement>('.infl-list').forEach((list) =>
        riseIn(list.querySelectorAll('li'), list, { stagger: 0.06 }),
      );
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="influences" aria-labelledby="infl-title">
      <div className="influences-slab">
        <div className="shell influences-inner">
          <p className="t-meta infl-eyebrow">Influences</p>
          <h2 id="infl-title" className="infl-title t-headline">
            Enormous engineering. <span className="t-serif">Obvious experiences.</span>
          </h2>
          <p className="infl-body t-lead">
            The companies and people I study most closely are different in almost every way but one: the engineering
            underneath is enormous, and what reaches the person using it feels obvious. That is the standard I want my
            own work to meet.
          </p>
          <div className="infl-cols">
            <div>
              <h3 className="t-meta infl-col-title">Companies I study</h3>
              <ol className="infl-list">
                {COMPANIES.map((c, i) => (
                  <li key={c}>
                    <span className="infl-num t-meta">{String(i + 1).padStart(2, '0')}</span>
                    <span className="infl-name">{c}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="t-meta infl-col-title">People whose work I return to</h3>
              <ol className="infl-list">
                {PEOPLE.map((c, i) => (
                  <li key={c}>
                    <span className="infl-num t-meta">{String(i + 1).padStart(2, '0')}</span>
                    <span className="infl-name">{c}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
