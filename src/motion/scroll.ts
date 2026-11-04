import Lenis from 'lenis';
import { gsap, ScrollTrigger } from './gsap';
import { device } from '../lib/device';

/**
 * Smooth scrolling with Lenis, synchronised to GSAP's ticker so ScrollTrigger,
 * Lenis and the WebGL stage all advance on the same frame. Reduced-motion
 * visitors keep native scrolling.
 */
let lenis: Lenis | null = null;

export function initScroll() {
  if (device.reducedMotion) {
    ScrollTrigger.refresh();
    return () => {};
  }
  lenis = new Lenis({
    duration: 1.05,
    easing: (t) => 1 - Math.pow(1 - t, 3.2),
    smoothWheel: true,
    wheelMultiplier: 0.95,
    touchMultiplier: 1,
    // Touch keeps native momentum: it already feels right and stays responsive.
    syncTouch: false,
  });
  lenis.on('scroll', ScrollTrigger.update);
  if (import.meta.env.DEV) (window as unknown as { __lenis: Lenis }).__lenis = lenis;
  const raf = (time: number) => lenis?.raf(time * 1000);
  gsap.ticker.add(raf);
  gsap.ticker.lagSmoothing(0);
  return () => {
    gsap.ticker.remove(raf);
    lenis?.destroy();
    lenis = null;
  };
}

export const scroll = {
  get lenis() {
    return lenis;
  },
  to(target: number | string | HTMLElement, opts: { immediate?: boolean; offset?: number; duration?: number } = {}) {
    if (lenis) {
      lenis.scrollTo(target, { immediate: opts.immediate, offset: opts.offset ?? 0, duration: opts.duration, force: true });
      return;
    }
    const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
    const y = typeof target === 'number' ? target : (el as HTMLElement | null)?.getBoundingClientRect().top ?? 0;
    const top = typeof target === 'number' ? y : y + window.scrollY;
    window.scrollTo({ top: top + (opts.offset ?? 0), behavior: opts.immediate ? 'instant' : 'smooth' });
  },
  stop() {
    lenis?.stop();
  },
  start() {
    lenis?.start();
  },
  reset() {
    if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo(0, 0);
  },
  get y() {
    return lenis ? lenis.scroll : window.scrollY;
  },
  get velocity() {
    return lenis ? lenis.velocity : 0;
  },
};
