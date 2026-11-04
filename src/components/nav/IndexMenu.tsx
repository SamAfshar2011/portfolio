import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useStore } from '../../lib/store';
import { experience } from '../../experience/state';
import { projects, projectPath } from '../../projects/registry';
import { TLink } from '../transition/TLink';
import { ExternalLink } from '../transition/ExternalLink';
import { AudioToggle } from '../audio/AudioToggle';
import { gsap } from '../../motion/gsap';
import { scroll } from '../../motion/scroll';
import { site } from '../../config/site';
import { device } from '../../lib/device';

/**
 * The Index: a full-screen table of contents. It is a modal dialog (focus is
 * kept inside, Escape closes, focus returns to the Index button), designed for
 * both pointer and thumb: every row is a large target.
 */
export function IndexMenu() {
  const open = useStore(experience, (s) => s.menuOpen);
  const { pathname } = useLocation();
  const root = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  // Close whenever the route changes.
  useEffect(() => {
    experience.set({ menuOpen: false });
  }, [pathname]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduced = device.reducedMotion;
    const rows = el.querySelectorAll('.index-row, .index-foot');
    if (open) {
      lastFocus.current = document.activeElement as HTMLElement;
      scroll.stop();
      el.hidden = false;
      const tl = gsap.timeline();
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: reduced ? 0.15 : 0.45, ease: 'settle' });
      if (!reduced) {
        tl.fromTo(
          rows,
          { yPercent: 40, opacity: 0, filter: 'blur(6px)' },
          { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.8, stagger: 0.05, ease: 'settle' },
          0.05,
        );
      }
      const first = el.querySelector<HTMLElement>('a, button');
      window.setTimeout(() => first?.focus({ preventScroll: true }), 60);
      return () => {
        tl.kill();
      };
    }
    if (!el.hidden) {
      scroll.start();
      gsap.to(el, {
        opacity: 0,
        duration: reduced ? 0.12 : 0.35,
        ease: 'depart',
        onComplete: () => {
          el.hidden = true;
        },
      });
      lastFocus.current?.focus({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') experience.set({ menuOpen: false });
      if (e.key === 'Tab' && root.current) {
        const f = [...root.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const here = (p: string) => (pathname.replace(/\/?$/, '/') === p ? 'page' : undefined);

  return (
    <div
      ref={root}
      id="index-menu"
      className="index-menu"
      role="dialog"
      aria-modal="true"
      aria-label="Index"
      hidden
      data-lenis-prevent
    >
      <div className="index-inner shell">
        <nav aria-label="Index" className="index-list">
          <TLink to="/" className="index-row" aria-current={here('/')} data-cursor="Home">
            <span className="index-num t-meta">00</span>
            <span className="index-name">Home</span>
            <span className="index-kicker t-meta">Sam Afshar — overview</span>
          </TLink>
          {projects.map((p) => (
            <TLink
              key={p.slug}
              to={projectPath(p.slug)}
              className="index-row"
              aria-current={here(projectPath(p.slug))}
              data-cursor="Enter"
              style={{ ['--row-accent' as string]: p.accent }}
            >
              <span className="index-num t-meta">{p.index}</span>
              <span className="index-name">{p.name}</span>
              <span className="index-kicker t-meta">
                {p.kicker}
                {p.awards.length > 0 && <span className="index-award"> · {p.awards.map((a) => `${a.title}, ${a.event}`).join(' · ')}</span>}
              </span>
            </TLink>
          ))}
        </nav>
        <div className="index-foot">
          <ExternalLink href={site.github.url} label="GitHub" className="index-github" data-cursor="Visit">
            <span className="t-meta">Source</span>
            <span className="index-github-handle">github.com/{site.github.handle}</span>
            <span aria-hidden="true">↗</span>
          </ExternalLink>
          <AudioToggle />
        </div>
      </div>
    </div>
  );
}
