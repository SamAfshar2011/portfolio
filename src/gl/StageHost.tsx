import { useEffect, useRef } from 'react';
import { gsap } from '../motion/gsap';
import { experience } from '../experience/state';
import { updatePointer } from '../experience/pointer';
import { useStore } from '../lib/store';
import type { Stage } from './Stage';
import { stageRef } from './stageRef';


/**
 * Mounts the fixed canvas and boots the renderer. three.js and the stage code
 * are loaded as a separate chunk so the page shell paints first. If the device
 * cannot create a WebGPU or WebGL 2 context, the CSS environment stays in place
 * and every page falls back to its DOM presentation.
 */
export function StageHost() {
  const hostRef = useRef<HTMLDivElement>(null);
  const status = useStore(experience, (s) => s.stage);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let stage: Stage | null = null;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.opacity = '0';
    canvas.style.transition = 'opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1)';
    host.appendChild(canvas);

    const tick = (_time: number, deltaMs: number) => {
      const dt = Math.min(deltaMs / 1000, 0.1);
      updatePointer(dt);
      if (stage && (!document.hidden || import.meta.env.DEV)) stage.frame(dt);
    };
    gsap.ticker.add(tick);

    const onResize = () => stage?.resize();
    // The canvas box changes with the window, with DPR changes (a window
    // dragged to another display) and when a classic scrollbar appears or
    // disappears (scroll locking hides it) — which fires no resize event.
    // The host is 100lvh tall, so iOS toolbar changes don't resize it.
    let lastBox = `${host.clientWidth}x${host.clientHeight}`;
    const ro = new ResizeObserver(() => {
      const box = `${host.clientWidth}x${host.clientHeight}`;
      if (box === lastBox) return;
      lastBox = box;
      onResize();
    });
    ro.observe(host);
    let dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDpr = () => {
      onResize();
      dprQuery.removeEventListener('change', onDpr);
      dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener('change', onDpr);
    };
    dprQuery.addEventListener('change', onDpr);
    window.addEventListener('orientationchange', onResize);

    (async () => {
      try {
        const { Stage } = await import('./Stage');
        if (cancelled) return;
        stage = await Stage.create(canvas, experience.get().quality);
        if (cancelled) {
          stage.dispose();
          return;
        }
        stageRef.set(stage);
        if (import.meta.env.DEV) (window as unknown as { __stage: Stage }).__stage = stage;
        experience.set({ stage: 'ready', backend: stage.backendName });
        // Reveal after the first real frame has been presented.
        setTimeout(() => (canvas.style.opacity = '1'), 50);
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[stage] falling back to CSS environment', err);
        canvas.remove();
        experience.set({ stage: 'fallback' });
      }
    })();

    return () => {
      cancelled = true;
      gsap.ticker.remove(tick);
      ro.disconnect();
      dprQuery.removeEventListener('change', onDpr);
      window.removeEventListener('orientationchange', onResize);
      stage?.dispose();
      stageRef.set(null);
      canvas.remove();
    };
  }, []);

  return (
    <>
      <div className="stage-fallback" data-hidden={status === 'ready'} aria-hidden="true" />
      <div ref={hostRef} className="stage-layer" style={{ height: '100lvh' }} aria-hidden="true" />
    </>
  );
}
