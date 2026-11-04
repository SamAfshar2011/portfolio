import type RAPIERNS from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIERNS;

/**
 * Rapier (≈1 MB of WebAssembly) is fetched and instantiated at most once per
 * page load, however many features ask for it; a failed attempt is forgotten
 * so it can be retried.
 */
let rapier: Promise<Rapier> | null = null;
let loaded: Rapier | null = null;

export function loadRapier() {
  if (!rapier) {
    rapier = import('@dimforge/rapier3d-compat')
      .then(async (mod) => {
        const R = (mod.default ?? mod) as Rapier;
        await R.init();
        loaded = R;
        return R;
      })
      .catch((err) => {
        rapier = null;
        throw err;
      });
  }
  return rapier;
}

/** Rapier if it has already finished loading, else null (never waits). */
export function rapierNow() {
  return loaded;
}

/** Data saver, or a connection too slow for an optional 1 MB download. */
export function constrainedConnection() {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData === true || /(^|-)2g|3g/.test(c.effectiveType ?? ''));
}
