import { useEffect } from 'react';
import { device } from '../../lib/device';

/**
 * The touch counterpart of the cursor merge: pressing a capsule control
 * spreads light from under the finger (see .btn[data-touch] in
 * materials.css). No hover states, no follow — just an honest press.
 */
export function useTouchPress() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || device.reducedMotion) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>('.btn');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--tx', `${e.clientX - r.left}px`);
      el.style.setProperty('--ty', `${e.clientY - r.top}px`);
      // Restart the animation even on repeated taps.
      delete el.dataset.touch;
      void el.offsetWidth;
      el.dataset.touch = 'true';
      window.setTimeout(() => delete el.dataset.touch, 700);
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);
}
