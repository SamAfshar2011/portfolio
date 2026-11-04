import { TLink } from '../transition/TLink';
import { ExternalLink } from '../transition/ExternalLink';
import { projects, projectPath } from '../../projects/registry';
import { site } from '../../config/site';
import { useStore } from '../../lib/store';
import { experience } from '../../experience/state';
import { scroll } from '../../motion/scroll';
import { Mark } from './Mark';

/** Page ending: the index again, the source, and a quiet colophon. */
export function Footer() {
  const backend = useStore(experience, (s) => s.backend);
  const stage = useStore(experience, (s) => s.stage);
  return (
    <footer className="site-footer">
      <div className="shell footer-inner">
        <div className="footer-brand">
          <Mark size={28} />
          <p className="footer-line t-subtitle">
            Sam Afshar <span className="t-serif">— building toward a company.</span>
          </p>
        </div>
        <nav className="footer-nav" aria-label="Footer">
          <ul>
            <li>
              <TLink to="/" className="link-line">
                Home
              </TLink>
            </li>
            {projects.map((p) => (
              <li key={p.slug}>
                <TLink to={projectPath(p.slug)} className="link-line">
                  {p.name}
                </TLink>
              </li>
            ))}
            <li>
              <ExternalLink href={site.github.url} label="GitHub" className="link-line">
                GitHub ↗
              </ExternalLink>
            </li>
          </ul>
        </nav>
        <div className="footer-meta t-meta">
          <p>© {new Date().getFullYear()} Sam Afshar</p>
          <p>
            Designed and built with React, three.js (TSL), GSAP, Lenis and Rapier.
            {stage === 'ready' && backend && <span className="footer-backend"> Rendering with {backend}.</span>}
          </p>
          <button type="button" className="footer-top link-line" onClick={() => scroll.to(0, { duration: 1.6 })}>
            Back to top ↑
          </button>
        </div>
      </div>
    </footer>
  );
}
