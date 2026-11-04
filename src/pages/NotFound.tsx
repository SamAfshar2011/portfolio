import { useRef } from 'react';
import { useDirective } from '../motion/hooks';
import { TLink } from '../components/transition/TLink';

export function NotFound() {
  const ref = useRef<HTMLElement>(null);
  useDirective(ref, { formation: 'drift', room: 'home', anchor: [0, 0], scale: 1.2, presence: 0.8, title: 0, focus: -1, energy: 0, daylight: 0 }, { immediate: true });
  return (
    <section ref={ref} className="not-found shell">
      <p className="t-meta">404 — Not resolved</p>
      <h1 className="t-headline">This page came apart.</h1>
      <p className="t-lead">The address doesn’t match anything here. The pieces are floating; the index is intact.</p>
      <TLink to="/" className="btn btn-primary" data-magnetic>
        Back to the index <span className="btn-icon" aria-hidden="true">→</span>
      </TLink>
    </section>
  );
}
