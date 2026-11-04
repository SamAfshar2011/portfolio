import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { gsap } from '../../motion/gsap';
import { scroll } from '../../motion/scroll';
import { director } from '../../experience/director';
import { experience } from '../../experience/state';
import { pointer } from '../../experience/pointer';
import { stageRef } from '../../gl/stageRef';
import { arrivalOf, SLAB_COUNT } from '../../gl/stack/formations';
import { audio } from '../audio/engine';
import { storage } from '../../lib/storage';
import { device } from '../../lib/device';
import { damp } from '../../lib/math';
import type { Stage } from '../../gl/Stage';

/** How long to wait for a renderer before showing the page without one. */
const STAGE_WAIT_MS = 7500;
/** Watchdog: whatever happens, the page is shown by then. */
const HARD_CAP_MS = 18000;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * The opening — one continuous physical event (see `awaken` in
 * gl/stack/formations.ts for the geometry).
 *
 *   A  calm: an almost empty studio, one faint point of light (index.html),
 *      held while the renderer starts and a moment longer for anticipation
 *   B  arrival: twelve bars of glass come through the screen from the
 *      visitor's side, in order round the dial, each caught by the turning array
 *   C  the radial structure becomes legible as the last bars land
 *   D  orbit: the array slows, breathes and precesses while fonts, the name
 *      and the pipelines finish (real readiness, bounded)
 *   F  the same twelve objects unwind into the hero sculpture; the room light
 *      comes up, the name resolves behind the glass, then the navigation,
 *      then the copy
 *
 * First visits get the full sequence; repeat visits the same sequence,
 * compressed; any input plays it faster; reduced motion starts with the
 * glass already in the array and lets it resolve and converge gently.
 * Direct loads of other pages share A–D, then the glass reconfigures into
 * that page's formation. It runs once per page load.
 */
export function Opening() {
  const { pathname } = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    if (!root.hasAttribute('data-boot')) return;
    const boot = document.getElementById('boot');
    const glow = boot?.querySelector<HTMLElement>('.boot-glow') ?? null;
    const pilot = boot?.querySelector<HTMLElement>('.boot-pilot') ?? null;
    const I = director.channels.intro;
    const reduced = device.reducedMotion;
    const home = pathname === '/';
    const first = !experience.get().introSeen;
    const long = first && !reduced;
    const tweens = new Set<gsap.core.Animation>();
    let cancelled = false;
    let finished = false;
    let speed = 1;
    let stage: Stage | null = null;
    // Angular velocity of the array (rad/s), shaped by the timeline.
    const spin = { v: 0.55 };

    Object.assign(I, { arrive: 0, unwrap: 0, ready: 0, light: 0.08, orbit: 0 });
    const page = director.current;
    // The array is presented large and central: it is the whole frame for now.
    director.lock({ ...page, formation: 'awaken', anchor: [0, 0.02], scale: 1.32, presence: 1, title: 0, energy: 0, focus: -1, daylight: 0 }, 'boot');
    experience.set({ introActive: true });
    const lightBase = { x: pointer.baseX, y: pointer.baseY };
    pointer.baseX = 0.5;
    pointer.baseY = 0.42;
    scroll.stop();

    const track = <T extends gsap.core.Animation>(a: T) => {
      tweens.add(a);
      a.timeScale(speed);
      return a;
    };
    // Any input: keep the choreography, just play it faster.
    const hurry = () => {
      if (speed > 1) return;
      speed = 3;
      tweens.forEach((t) => t.timeScale(3));
    };
    const events = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, hurry, { passive: true }));

    // Each bar passing the lens is heard (only if sound is on).
    const ticked = new Set<number>();
    const tick = (_t: number, deltaMs: number) => {
      const dt = Math.min(deltaMs / 1000, 0.1);
      I.orbit += spin.v * dt * speed;
      I.ready = damp(I.ready, stage?.progress ?? 0, 3, dt);
      for (let i = 0; i < SLAB_COUNT; i++) {
        if (!ticked.has(i) && arrivalOf(i, SLAB_COUNT, I.arrive) > 0.72) {
          ticked.add(i);
          audio.arrive(i, SLAB_COUNT);
        }
      }
    };
    gsap.ticker.add(tick);

    // Revealed elements keep their inline styles until the boot attribute
    // (whose CSS hides them) is gone; then the styles are cleared.
    const revealed: gsap.core.Tween[] = [];
    const clear = (t: gsap.core.Tween) => gsap.set(t.targets(), { clearProps: 'opacity,transform,filter' });
    const reveal = (targets: gsap.TweenTarget, delay = 0, opts: gsap.TweenVars = {}) => {
      const t = track(
        gsap.fromTo(
          targets,
          { opacity: 0, y: reduced ? 0 : 18, filter: reduced ? 'none' : 'blur(8px)' },
          {
            opacity: 1,
            y: 0,
            filter: 'blur(0px)',
            duration: reduced ? 0.6 : 1.2,
            delay,
            ease: 'settle',
            ...opts,
            onComplete: () => !root.hasAttribute('data-boot') && clear(t),
          },
        ),
      );
      revealed.push(t);
      return t;
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      if (director.isLocked('boot')) director.release(home ? { formation: 'stack' } : undefined, 'boot');
      I.light = 1;
      I.unwrap = home ? 1 : I.unwrap;
      I.arrive = 1;
      spin.v = 0;
      root.removeAttribute('data-boot');
      root.removeAttribute('data-boot-home');
      revealed.forEach((t) => t.progress() >= 1 && clear(t));
      boot?.remove();
      experience.set({ introActive: false, introSeen: true });
      storage.set('sa.introSeen', true);
      scroll.start();
      gsap.ticker.remove(tick);
      events.forEach((e) => window.removeEventListener(e, hurry));
    };

    // The page and chrome, in order: navigation first, then the copy.
    const revealChrome = (at: number) => {
      reveal('.site-header', at, { y: reduced ? 0 : -10 });
      if (home) {
        reveal('.hero-statement', at + 0.25);
        reveal('.hero-sub', at + 0.38);
        reveal('.hero-meta, .hero-cue', at + 0.55, { stagger: 0.1 });
      } else {
        reveal('#page', at + 0.1, { y: reduced ? 0 : 14, duration: reduced ? 0.5 : 1 });
      }
    };

    const fallback = () => {
      // No 3D: the point of light goes, and the DOM page arrives directly.
      if (boot) track(gsap.to(boot, { opacity: 0, duration: 0.6, ease: 'depart' }));
      if (home) {
        const name = document.querySelector('.hero-name');
        if (name) reveal(name, 0.2, { duration: 1.4, ease: 'optic', y: 0 });
      }
      revealChrome(0.5);
      window.setTimeout(finish, 1800);
    };

    const run = async () => {
      stage = await stageRef.ready(STAGE_WAIT_MS);
      if (cancelled) return;
      if (!stage) return fallback();

      // --- A: calm. Let the canvas come up under the boot light, and hold a
      // beat of near-emptiness before anything moves.
      if (glow) {
        glow.style.animation = 'none';
        track(gsap.to(glow, { opacity: 0, duration: 0.9, ease: 'none' }));
      }
      const sinceLoad = performance.now();
      const calm = reduced ? 300 : long ? Math.max(800, 1600 - sinceLoad) : 600;
      await wait(calm / speed);
      if (cancelled) return;

      if (reduced) {
        // The glass is already in the array; it resolves out of the light,
        // then converges into the page's formation without travel.
        I.arrive = 1;
        spin.v = 0.12;
        if (pilot) track(gsap.to(pilot, { opacity: 0, duration: 0.8 }));
        track(gsap.to(I, { light: 0.5, duration: 1.2, ease: 'none' }));
        await wait(1200);
        if (cancelled) return;
        if (home) {
          track(gsap.to(I, { unwrap: 1, duration: 1.4, ease: 'glide' }));
          track(gsap.to(I, { light: 1, duration: 1.4, ease: 'none' }));
          if (stage.title) track(gsap.fromTo(stage.title.reveal, { value: 0 }, { value: 1, duration: 1.2, delay: 0.5 }));
          director.lock({ ...director.current, formation: 'awaken', title: 1 }, 'boot');
          revealChrome(0.8);
          await wait(1500);
        } else {
          director.release(undefined, 'boot');
          I.light = 1;
          revealChrome(0.3);
          await wait(1000);
        }
        return finish();
      }

      // --- B / C: arrival. The point of light gives way to the first bar.
      const arriveDur = long ? 3.4 : 1.35;
      if (pilot) {
        pilot.style.animation = 'none';
        track(gsap.to(pilot, { opacity: 0, scale: 0.4, duration: 0.5, delay: arriveDur * 0.03, ease: 'depart' }));
      }
      track(gsap.to(I, { light: 0.32, duration: arriveDur, ease: 'none' }));
      await track(gsap.to(I, { arrive: 1, duration: arriveDur, ease: 'none' }));
      if (cancelled) return;
      boot?.remove();

      // --- D: orbit. The array sheds speed while the rest gets ready.
      track(gsap.to(spin, { v: 0.2, duration: 1.6, ease: 'power2.out' }));
      await Promise.all([Promise.race([stage.prepared, wait(4000)]), wait((long ? 900 : 200) / speed)]);
      if (cancelled) return;

      if (!home) {
        // Other pages: the array reconfigures straight into the page's shape.
        director.release(undefined, 'boot');
        track(gsap.to(I, { light: 1, duration: 1.4, ease: 'settle' }));
        track(gsap.to(spin, { v: 0, duration: 1, ease: 'power2.out' }));
        pointer.baseX = lightBase.x;
        pointer.baseY = lightBase.y;
        revealChrome(0.4);
        await wait(1700 / speed);
        return finish();
      }

      // --- F: unwind into the hero sculpture.
      const dur = long ? 2.7 : 1.45;
      const hero = director.current;
      const tl = track(gsap.timeline({ defaults: { ease: 'settle' } }));
      // Momentum: a slow in, a long unhurried middle, a precise landing.
      tl.to(I, { unwrap: 1, duration: dur, ease: 'glide' }, 0)
        // The orbit's momentum carries the bars round as they spiral in, then dies away.
        .to(spin, { v: 0, duration: dur * 0.75, ease: 'power2.inOut' }, 0)
        .to(I, { light: 1, duration: dur * 0.9, ease: 'optic' }, dur * 0.3)
        .to(pointer, { baseX: 0.62, baseY: 0.3, duration: dur * 0.85, ease: 'glide' }, dur * 0.18)
        // The sculpture drifts to its place in the composition as it forms.
        .add(() => director.lock({ ...hero, formation: 'awaken', title: 1 }, 'boot'), dur * 0.3)
        .add(() => audio.reveal(), dur * 0.55);
      if (stage.title) {
        stage.title.reveal.value = 0;
        tl.to(stage.title.reveal, { value: 1, duration: long ? 2.2 : 1.3, ease: 'optic' }, dur * 0.48);
      }
      revealChrome(dur * 0.74);
      await tl;
      if (!cancelled) finish();
    };
    run();

    const cap = window.setTimeout(() => {
      // Something stalled: go straight to the page.
      if (finished) return;
      tweens.forEach((t) => t.progress(1));
      gsap.set(['.site-header', '[data-hero-detail]', '.hero-name', '#page'], { clearProps: 'opacity,transform,filter' });
      finish();
    }, HARD_CAP_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(cap);
      tweens.forEach((t) => t.kill());
      if (!finished) {
        // Unmounted mid-opening (StrictMode, fast navigation): leave a working page.
        gsap.set(['.site-header', '[data-hero-detail]', '.hero-name', '#page'], { clearProps: 'opacity,transform,filter' });
        if (director.isLocked('boot')) director.release(undefined, 'boot');
        gsap.ticker.remove(tick);
        events.forEach((e) => window.removeEventListener(e, hurry));
        scroll.start();
        experience.set({ introActive: false });
      }
    };
    // Runs once per load, for whichever page the visitor arrived on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
