import type { Stage } from './Stage';
import { experience } from '../experience/state';

let current: Stage | null = null;

export const stageRef = {
  get: () => current,
  set: (s: Stage | null) => {
    current = s;
  },
  /** Resolves with the stage once ready, or null if the fallback is in use. */
  ready(timeoutMs = 6000): Promise<Stage | null> {
    const s = experience.get().stage;
    if (s === 'ready') return Promise.resolve(current);
    if (s === 'fallback') return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        unsub();
        resolve(null);
      }, timeoutMs);
      const unsub = experience.subscribe(() => {
        const st = experience.get().stage;
        if (st === 'pending') return;
        window.clearTimeout(timer);
        unsub();
        resolve(st === 'ready' ? current : null);
      });
    });
  },
};
