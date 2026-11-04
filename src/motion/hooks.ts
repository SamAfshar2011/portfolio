import { useLayoutEffect, useRef, type DependencyList, type RefObject } from 'react';
import { gsap, ScrollTrigger, SplitText } from './gsap';
import { director, type Directive } from '../experience/director';
import { device } from '../lib/device';
import { pointer } from '../experience/pointer';

/**
 * Runs GSAP code in a context scoped to `scope` and reverts everything
 * (tweens, ScrollTriggers, SplitText) when the component unmounts or deps
 * change. Every animation on the site goes through this, which is what keeps
 * route changes free of leaked triggers.
 */
export function useGsap<T extends HTMLElement>(fn: (ctx: gsap.Context, el: T) => void, deps: DependencyList = []) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context((self) => fn(self, el), el);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export interface DirectiveOptions {
  /** Light position (0..1 screen UV) the pointer offsets from. */
  light?: [number, number];
  start?: string;
  end?: string;
  /** Apply immediately on mount (first section of a page). */
  immediate?: boolean;
}

/**
 * Binds a section to a stage directive: while the section is the active one
 * (its middle is in the middle of the viewport) the glass takes the given
 * formation, room light and position.
 */
export function useDirective(ref: RefObject<HTMLElement | null>, directive: Partial<Directive>, opts: DirectiveOptions = {}) {
  const key = JSON.stringify(directive) + JSON.stringify(opts);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || Object.keys(directive).length === 0) return;
    const apply = () => {
      director.set(directive);
      if (opts.light) {
        pointer.baseX = opts.light[0];
        pointer.baseY = opts.light[1];
      }
    };
    if (opts.immediate) apply();
    const st = ScrollTrigger.create({
      trigger: el,
      start: opts.start ?? 'top 55%',
      end: opts.end ?? 'bottom 45%',
      onToggle: (self) => self.isActive && apply(),
    });
    return () => st.kill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * Headline reveal: lines rise out of masks, with a short optical defocus.
 * Used for section headings. Plays once when the heading enters the view.
 */
export function revealLines(el: HTMLElement, opts: { delay?: number; scroll?: boolean; stagger?: number } = {}) {
  if (device.reducedMotion) {
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.6, delay: opts.delay ?? 0, scrollTrigger: opts.scroll === false ? undefined : { trigger: el, start: 'top 88%', once: true } });
    return;
  }
  const split = SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'split-line', autoSplit: true,
    onSplit: (self) =>
      gsap.from(self.lines, {
        yPercent: 105,
        filter: 'blur(6px)',
        duration: 1.1,
        stagger: opts.stagger ?? 0.09,
        ease: 'settle',
        delay: opts.delay ?? 0,
        scrollTrigger: opts.scroll === false ? undefined : { trigger: el, start: 'top 88%', once: true },
      }),
  });
  return split;
}

/**
 * The signature title treatment — a focus pull. Characters start wide,
 * soft and dim, then settle into focus from the centre outward.
 */
export function focusPull(el: HTMLElement, opts: { delay?: number; scroll?: boolean; duration?: number } = {}) {
  if (device.reducedMotion) {
    return gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.7, delay: opts.delay ?? 0 });
  }
  const split = SplitText.create(el, { type: 'chars,words', charsClass: 'split-char', aria: 'auto' });
  return gsap.from(split.chars, {
    opacity: 0,
    filter: 'blur(14px)',
    scale: 1.08,
    duration: opts.duration ?? 1.4,
    ease: 'optic',
    delay: opts.delay ?? 0,
    stagger: { each: 0.035, from: 'center' },
    scrollTrigger: opts.scroll ? { trigger: el, start: 'top 85%', once: true } : undefined,
  });
}

/** Simple rise-in for groups of small elements (meta rows, chips). */
export function riseIn(targets: gsap.TweenTarget, trigger: Element, opts: { delay?: number; stagger?: number } = {}) {
  if (device.reducedMotion) {
    return gsap.fromTo(targets, { opacity: 0 }, { opacity: 1, duration: 0.6, scrollTrigger: { trigger, start: 'top 90%', once: true } });
  }
  return gsap.from(targets, {
    y: 26,
    opacity: 0,
    duration: 1,
    ease: 'settle',
    delay: opts.delay ?? 0,
    stagger: opts.stagger ?? 0.07,
    scrollTrigger: { trigger, start: 'top 88%', once: true },
  });
}
