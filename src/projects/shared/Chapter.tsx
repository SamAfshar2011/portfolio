import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { gsap } from '../../motion/gsap';
import { revealLines, riseIn, useDirective } from '../../motion/hooks';
import type { Directive } from '../../experience/director';

interface Props {
  id: string;
  index: string;
  label: string;
  title: ReactNode;
  children: ReactNode;
  /** Stage behaviour while this chapter is being read. */
  directive?: Partial<Directive>;
  wide?: boolean;
  className?: string;
}

/**
 * A chapter of a project page: a numbered label column and a reading column.
 * Headings rise out of masks; paragraphs and figures fade up as they enter.
 */
export function Chapter({ id, index, label, title, children, directive, wide, className = '' }: Props) {
  const ref = useRef<HTMLElement>(null);
  useDirective(ref, directive ?? {}, {});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      const h = el.querySelector<HTMLElement>('.chapter-title');
      if (h) revealLines(h);
      riseIn(el.querySelectorAll('.chapter-head > *'), el);
      el.querySelectorAll<HTMLElement>('[data-reveal]').forEach((node) => riseIn(node, node));
    }, el);
    return () => ctx.revert();
  }, []);
  return (
    <section ref={ref} id={id} className={`chapter ${wide ? 'chapter-wide' : ''} ${className}`} aria-labelledby={`${id}-title`}>
      <div className="shell chapter-grid">
        <div className="chapter-head">
          <span className="chapter-num t-meta">{index}</span>
          <span className="chapter-label t-meta">{label}</span>
        </div>
        <div className="chapter-body">
          <h2 id={`${id}-title`} className="chapter-title t-title">
            {title}
          </h2>
          {children}
        </div>
      </div>
    </section>
  );
}
