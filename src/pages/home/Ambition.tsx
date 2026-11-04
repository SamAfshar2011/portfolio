import { useLayoutEffect, useRef } from 'react';
import { gsap } from '../../motion/gsap';
import { focusPull, revealLines, useDirective } from '../../motion/hooks';

/**
 * Next — twelve layers of glass press together into one solid object while
 * the long-term plan is stated plainly.
 */
export function Ambition() {
  const ref = useRef<HTMLElement>(null);
  const portrait = typeof window !== 'undefined' && window.innerWidth / window.innerHeight < 0.9;
  useDirective(
    ref,
    {
      formation: 'monolith',
      room: 'home',
      anchor: portrait ? [0, 0.42] : [0.36, 0.02],
      scale: portrait ? 0.9 : 1.25,
      presence: 1,
      title: 0,
      focus: -1,
      energy: 0,
      daylight: 0,
    },
    { light: [0.66, 0.28] },
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      focusPull(el.querySelector<HTMLElement>('.next-title')!, { scroll: true, duration: 1.6 });
      revealLines(el.querySelector('.next-body')!, { stagger: 0.05 });
      revealLines(el.querySelector('.next-coda')!, { delay: 0.2 });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="next" aria-labelledby="next-title">
      <div className="shell next-inner">
        <p className="t-meta">Next</p>
        <h2 id="next-title" className="next-title t-display">
          A company.
        </h2>
        <p className="next-body t-lead">
          The long-term plan is to found a startup and grow it into a technology company that matters. The projects
          here are practice for that job at a smaller scale: find a real problem, build the entire system around it, and
          be honest about what it can and cannot do.
        </p>
        <p className="next-coda t-serif">Many layers. One object.</p>
      </div>
    </section>
  );
}
