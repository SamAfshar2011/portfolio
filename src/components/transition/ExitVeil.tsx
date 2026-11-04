import { useEffect, useRef } from 'react';
import { createStore, useStore } from '../../lib/store';
import { gsap } from '../../motion/gsap';
import { device } from '../../lib/device';

/**
 * Leaving the site. The page folds into a single line of light, the
 * destination resolves in the centre for a moment, then the browser
 * navigates. Total ≈ 0.65 s: long enough to feel intentional, short enough
 * never to feel like a delay. Returning via the back button (bfcache) resets it.
 */
export const exitState = createStore({ label: '', active: false });

export function leaveTo(url: string, label: string, onBeforeLeave?: () => void) {
  if (exitState.get().active) return;
  exitState.set({ label, active: true });
  onBeforeLeave?.();
  const delay = device.reducedMotion ? 180 : 650;
  window.setTimeout(() => {
    window.location.href = url;
  }, delay);
}

export function ExitVeil() {
  const { active, label } = useStore(exitState, (s) => s);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) exitState.set({ active: false, label: '' });
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const panel = el.querySelector('.exit-panel');
    const line = el.querySelector('.exit-line');
    const text = el.querySelector('.exit-text');
    gsap.killTweensOf([panel, line, text]);
    if (!active) {
      gsap.set(el, { visibility: 'hidden' });
      return;
    }
    gsap.set(el, { visibility: 'visible' });
    const tl = gsap.timeline();
    tl.fromTo(line, { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 0.32, ease: 'optic' })
      .fromTo(panel, { clipPath: 'inset(50% 0 50% 0)' }, { clipPath: 'inset(0% 0 0% 0)', duration: 0.42, ease: 'glide' }, 0.08)
      .fromTo(text, { opacity: 0, filter: 'blur(8px)', letterSpacing: '0.4em' }, { opacity: 1, filter: 'blur(0px)', letterSpacing: '0.14em', duration: 0.4, ease: 'settle' }, 0.22);
    return () => {
      tl.kill();
    };
  }, [active]);

  return (
    <div ref={root} className="exit-veil" aria-hidden={!active} style={{ visibility: 'hidden' }}>
      <div className="exit-panel" />
      <div className="exit-line" />
      <div className="exit-text t-meta" role="status" aria-live="polite">
        {active ? `Opening ${label}` : ''}
      </div>
    </div>
  );
}
