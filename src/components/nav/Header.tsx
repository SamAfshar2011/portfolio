import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { TLink } from '../transition/TLink';
import { Mark } from './Mark';
import { AudioToggle } from '../audio/AudioToggle';
import { experience } from '../../experience/state';
import { useStore } from '../../lib/store';
import { projectBySlug } from '../../projects/registry';
import { scroll } from '../../motion/scroll';
import { gsap } from '../../motion/gsap';

/**
 * Navigation lives at the corners of the frame, like the controls of an
 * instrument: identity (home) on the left, where-you-are in the middle, sound
 * and the index on the right. It recedes while you scroll down through a page
 * and returns the moment you scroll back up.
 */
export function Header() {
  const { pathname } = useLocation();
  const menuOpen = useStore(experience, (s) => s.menuOpen);
  const project = projectBySlug(pathname.match(/^\/projects\/([^/]+)/)?.[1]);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let hidden = false;
    let last = scroll.y;
    const tick = () => {
      const y = scroll.y;
      const dy = y - last;
      last = y;
      const shouldHide = y > 240 && dy > 2 && !experience.get().menuOpen;
      const shouldShow = dy < -4 || y < 120 || experience.get().menuOpen;
      if (shouldHide && !hidden) {
        hidden = true;
        el.dataset.hidden = 'true';
      } else if (shouldShow && hidden) {
        hidden = false;
        el.dataset.hidden = 'false';
      }
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  return (
    <header ref={ref} className="site-header" data-hidden="false">
      <div className="site-header-inner">
        <TLink to="/" className="brand" data-cursor="Home" aria-label="Sam Afshar — home">
          <Mark />
          <span className="brand-name">Sam Afshar</span>
        </TLink>

        <p className="where t-meta" aria-live="polite">
          <span className="where-dot" aria-hidden="true" />
          {project ? (
            <>
              <span className="hidden sm:inline">Index</span>
              <span className="where-sep hidden sm:inline" aria-hidden="true">/</span>
              <span className="where-current">{project.name}</span>
            </>
          ) : (
            <span className="where-current">Index</span>
          )}
        </p>

        <div className="header-actions">
          <AudioToggle className="hidden sm:inline-flex" />
          <button
            type="button"
            className="index-btn"
            aria-expanded={menuOpen}
            aria-controls="index-menu"
            data-cursor={menuOpen ? 'Close' : 'Index'}
            onClick={() => experience.set({ menuOpen: !menuOpen })}
          >
            <span className="index-btn-label">{menuOpen ? 'Close' : 'Index'}</span>
            <span className="index-btn-icon" aria-hidden="true">
              <i />
              <i />
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
