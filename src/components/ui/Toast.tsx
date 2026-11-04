import { useEffect, useRef } from 'react';
import { createStore, useStore } from '../../lib/store';
import { gsap } from '../../motion/gsap';

const store = createStore({ code: '', note: '', id: 0 });

export const toast = {
  show(code: string, note: string) {
    store.set((s) => ({ code, note, id: s.id + 1 }));
  },
};

/** A small, code-shaped notice. Used by the easter egg; announced politely. */
export function Toast() {
  const { code, note, id } = useStore(store, (s) => s);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!id || !ref.current) return;
    const el = ref.current;
    const tl = gsap
      .timeline()
      .fromTo(el, { y: 24, opacity: 0, filter: 'blur(8px)' }, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'settle' })
      .to(el, { y: 12, opacity: 0, filter: 'blur(6px)', duration: 0.5, ease: 'depart' }, 3.6);
    return () => {
      tl.kill();
    };
  }, [id]);
  return (
    <div ref={ref} className="toast" role="status" aria-live="polite" style={{ opacity: 0 }}>
      {code && (
        <>
          <code className="toast-code">{code}</code>
          <span className="toast-note">{note}</span>
        </>
      )}
    </div>
  );
}
