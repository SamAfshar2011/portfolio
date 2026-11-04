import { Spring } from '../lib/math';

/**
 * Global pointer + key light. The light position is a spring that follows the
 * pointer lazily; it drives the WebGL key light AND the CSS variables --lx/--ly
 * so DOM surfaces are lit by the same light as the stage.
 */
export const pointer = {
  /** Normalised -1..1, y up. */
  x: 0,
  y: 0,
  /** Pixels. */
  px: typeof window === 'undefined' ? 0 : window.innerWidth / 2,
  py: typeof window === 'undefined' ? 0 : window.innerHeight / 2,
  active: false,
  lightX: new Spring(0.62, 14, 7),
  lightY: new Spring(0.32, 14, 7),
  /** Smoothed pointer used for parallax (-1..1). */
  sx: new Spring(0, 40, 12),
  sy: new Spring(0, 40, 12),
  /** Base light position the pointer offsets from (set per section). */
  baseX: 0.62,
  baseY: 0.32,
};

let lastCssX = -1;
let lastCssY = -1;

export function initPointer() {
  const onMove = (e: PointerEvent) => {
    pointer.px = e.clientX;
    pointer.py = e.clientY;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    pointer.active = true;
  };
  const onLeave = () => {
    pointer.active = false;
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
  };
}

/** Called once per frame from the shared ticker. */
export function updatePointer(dt: number) {
  const influence = pointer.active ? 0.22 : 0;
  pointer.lightX.target = pointer.baseX + pointer.x * influence;
  pointer.lightY.target = pointer.baseY - pointer.y * influence * 0.8;
  pointer.lightX.step(dt);
  pointer.lightY.step(dt);
  pointer.sx.target = pointer.active ? pointer.x : 0;
  pointer.sy.target = pointer.active ? pointer.y : 0;
  pointer.sx.step(dt);
  pointer.sy.step(dt);

  const lx = Math.round(pointer.lightX.value * 1000) / 1000;
  const ly = Math.round(pointer.lightY.value * 1000) / 1000;
  if (lx !== lastCssX || ly !== lastCssY) {
    const root = document.documentElement.style;
    root.setProperty('--lx', String(lx));
    root.setProperty('--ly', String(ly));
    lastCssX = lx;
    lastCssY = ly;
  }
}
