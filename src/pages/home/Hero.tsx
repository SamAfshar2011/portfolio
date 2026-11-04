import { useLayoutEffect, useRef } from 'react';
import { gsap } from '../../motion/gsap';
import { useDirective } from '../../motion/hooks';
import type { Directive } from '../../experience/director';
import { experience } from '../../experience/state';
import { useStore } from '../../lib/store';
import { device } from '../../lib/device';
import { stageRef } from '../../gl/stageRef';
import { scroll } from '../../motion/scroll';

const HERO: Partial<Directive> = { formation: 'stack', room: 'home', anchor: [0.3, -0.04], scale: 1, presence: 1, title: 1, energy: 0, focus: -1, daylight: 0 };
const HERO_PORTRAIT: Partial<Directive> = { ...HERO, anchor: [0, 0.3], scale: 0.9 };

/**
 * The name behind glass. On a fresh load the opening (components/boot)
 * assembles the sculpture and brings this section in; arriving here from
 * another page, the glass reforms and the name comes back into focus.
 */
export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const stage = useStore(experience, (s) => s.stage);
  const portrait = typeof window !== 'undefined' && window.innerWidth / window.innerHeight < 0.9;

  useDirective(ref, portrait ? HERO_PORTRAIT : HERO, { immediate: true, light: [0.62, 0.3] });

  useLayoutEffect(() => {
    // The opening handles the first arrival.
    if (document.documentElement.hasAttribute('data-boot')) return;
    const reduced = device.reducedMotion;
    let cancelled = false;
    let tween: gsap.core.Tween | null = null;
    stageRef.ready().then((s) => {
      if (cancelled || !s?.title) return;
      tween = gsap.fromTo(s.title.reveal, { value: 0 }, { value: 1, duration: reduced ? 0.4 : 1.3, ease: 'optic', delay: 0.1 });
    });
    return () => {
      cancelled = true;
      tween?.kill();
    };
  }, []);

  return (
    <section ref={ref} className="hero" aria-labelledby="hero-name">
      <h1 id="hero-name" className={`hero-name t-display t-lit ${stage === 'ready' ? 'sr-only-visual' : ''}`}>
        Sam Afshar
      </h1>

      <div className="hero-bottom shell">
        <div className="hero-copy">
          <p className="hero-statement" data-hero-detail>
            I build AI systems that turn raw signal into something people can act&nbsp;on.
          </p>
          <p className="hero-sub t-body" data-hero-detail>
            Pixels into plate numbers. Transactions into forecasts. A building’s profile into an estimate of collapse
            risk.
          </p>
        </div>
        <dl className="hero-meta" data-hero-detail>
          <div>
            <dt className="t-meta">Born</dt>
            <dd>2011</dd>
          </div>
          <div>
            <dt className="t-meta">Writing code since</dt>
            <dd>2024 · Python</dd>
          </div>
          <div>
            <dt className="t-meta">Competition awards</dt>
            <dd>3 · two projects</dd>
          </div>
        </dl>
      </div>

      <a href="#story" className="hero-cue t-meta" data-hero-detail data-cursor="Scroll" onClick={(e) => {
        e.preventDefault();
        scroll.to('#story', { duration: 1.6 });
      }}>
        <span>Scroll</span>
        <span className="hero-cue-line" aria-hidden="true" />
      </a>
    </section>
  );
}
