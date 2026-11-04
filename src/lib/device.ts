/**
 * Capability detection. Nothing here labels a visitor's device; it only
 * decides which rendering path and input model make the experience best.
 */
const mq = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null);

export const media = {
  finePointer: mq('(hover: hover) and (pointer: fine)'),
  reducedMotion: mq('(prefers-reduced-motion: reduce)'),
  coarse: mq('(pointer: coarse)'),
};

export const device = {
  get finePointer() {
    return !!media.finePointer?.matches;
  },
  get reducedMotion() {
    return !!media.reducedMotion?.matches;
  },
  get touch() {
    return !!media.coarse?.matches || navigator.maxTouchPoints > 0;
  },
  isIOS:
    typeof navigator !== 'undefined' &&
    (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)),
  cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
  memory: typeof navigator !== 'undefined' ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4) : 4,
};

export type QualityTier = 'high' | 'balanced' | 'lean';

/** Initial guess; the stage refines it from measured frame times. */
export function initialQuality(): QualityTier {
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  if (device.memory <= 2 || device.cores <= 2) return 'lean';
  if (small || device.touch) return 'balanced';
  return device.cores >= 8 ? 'high' : 'balanced';
}
