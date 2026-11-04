/**
 * Development only. Automated preview panes are often "hidden", which pauses
 * requestAnimationFrame and freezes every animation. While hidden, frames are
 * driven by timers instead so QA screenshots show the live experience.
 * Imported first in main.tsx so GSAP captures the wrapped function.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  const timers = new Set<number>();
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    if (!document.hidden) return raf(cb);
    const id = window.setTimeout(() => {
      timers.delete(id);
      cb(performance.now());
    }, 16);
    timers.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id: number) => {
    if (timers.has(id)) {
      clearTimeout(id);
      timers.delete(id);
    } else caf(id);
  };
}
export {};
