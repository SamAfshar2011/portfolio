import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { gsap, ScrollTrigger } from '../../motion/gsap';
import { scroll } from '../../motion/scroll';
import { director } from '../../experience/director';
import { experience } from '../../experience/state';
import { projects } from '../../projects/registry';
import { audio } from '../audio/engine';
import { device } from '../../lib/device';

/**
 * Route transitions.
 *
 * The WebGL stage lives outside the router, so it never unmounts: when you
 * leave a page the glass reconfigures into the destination's formation and the
 * light shifts to the destination room while the DOM defocuses away. The new
 * page is loaded before the old one leaves, so there is never a blank frame.
 *
 * Browser back/forward is never delayed: those navigations happen instantly
 * and only receive the arrival half of the choreography.
 */
interface TransitionApi {
  go: (to: string) => void;
  preload: (to: string) => void;
}

const Ctx = createContext<TransitionApi>({ go: () => {}, preload: () => {} });
export const useTransition = () => useContext(Ctx);

const PAGE_ID = 'page';

function targetFor(path: string) {
  const slug = path.match(/^\/projects\/([^/]+)/)?.[1];
  return projects.find((p) => p.slug === slug);
}

export function TransitionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navType = useNavigationType();
  const busy = useRef(false);
  const pending = useRef<string | null>(null);
  const internal = useRef(false);

  const preload = useCallback((to: string) => {
    targetFor(to)?.load();
  }, []);

  const go = useCallback(
    async (to: string) => {
      // While a transition runs, the latest click always wins — even one that
      // points back at the page being left.
      if (busy.current) {
        pending.current = to;
        return;
      }
      const normalized = to.endsWith('/') ? to : `${to}/`;
      const here = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;
      if (normalized === here) {
        scroll.to(0, { duration: 1.2 });
        return;
      }
      busy.current = true;
      experience.set({ transitioning: true, menuOpen: false });
      const page = document.getElementById(PAGE_ID);
      const target = targetFor(to);
      const reduced = device.reducedMotion;

      director.lock(
        target
          ? { formation: target.formation, room: target.room, anchor: [0, 0.02], scale: 1.16, presence: 1, title: 0, energy: 0.5 }
          : { formation: 'stack', room: 'home', anchor: [0.3, -0.04], scale: 1, presence: 1, title: 0.4, energy: 0 },
        'route',
      );
      audio.sweep(true);
      scroll.stop();

      const leave = page
        ? gsap.to(page, {
            opacity: 0,
            y: reduced ? 0 : -18,
            filter: reduced ? 'none' : 'blur(10px)',
            duration: reduced ? 0.25 : 0.55,
            ease: 'depart',
          })
        : null;
      await Promise.all([leave, target?.load()].filter(Boolean));

      internal.current = true;
      navigate(to);
    },
    [location.pathname, navigate],
  );

  // Arrival: runs for every location change (internal or browser history).
  useLayoutEffect(() => {
    const page = document.getElementById(PAGE_ID);
    const wasInternal = internal.current;
    internal.current = false;
    const reduced = device.reducedMotion;

    if (wasInternal || navType === 'PUSH') scroll.reset();
    ScrollTrigger.refresh();

    // On a fresh load the opening reveals the page itself.
    const booting = document.documentElement.hasAttribute('data-boot');
    if (page && !booting) {
      gsap.killTweensOf(page);
      gsap.fromTo(
        page,
        { opacity: 0, y: reduced ? 0 : 14, filter: reduced ? 'none' : 'blur(8px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: reduced ? 0.3 : wasInternal ? 0.9 : 0.6,
          delay: wasInternal ? 0.08 : 0,
          ease: 'settle',
          clearProps: 'filter,transform',
        },
      );
    }

    const t = window.setTimeout(() => {
      // Hand over to the destination's own structure. Its page may register
      // its directives a moment later; until then the base directive must not
      // fall back to the page just left (the glass would start to turn back).
      const dest = targetFor(location.pathname);
      director.release(dest ? { formation: dest.formation, room: dest.room } : { formation: 'stack', room: 'home' }, 'route');
      scroll.start();
      busy.current = false;
      experience.set({ transitioning: false });
      if (pending.current) {
        const next = pending.current;
        pending.current = null;
        go(next);
      }
    }, wasInternal ? 120 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // Keep the audio room in sync with the page.
  useEffect(() => {
    audio.setRoom(targetFor(location.pathname)?.room ?? 'home');
  }, [location.pathname]);

  const api = useMemo(() => ({ go, preload }), [go, preload]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
