import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from '../../motion/gsap';
import { revealLines, riseIn, useDirective } from '../../motion/hooks';
import { stageRef } from '../../gl/stageRef';
import { site } from '../../config/site';
import { leaveTo } from '../../components/transition/ExitVeil';
import { audio } from '../../components/audio/engine';
import { device } from '../../lib/device';
import type { CommitField } from '../../gl/views/CommitField';
import { constrainedConnection as constrained } from '../../gl/physics';

const session = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k) === '1';
    } catch {
      return false;
    }
  },
  set: (k: string, v: boolean) => {
    try {
      sessionStorage.setItem(k, v ? '1' : '0');
    } catch {
      /* private mode: ask again next time */
    }
  },
};

type FieldStatus = 'idle' | 'waiting' | 'loading' | 'ready' | 'error';

/**
 * Source — the GitHub moment. See gl/views/CommitField.ts for the physics.
 * The link is a real anchor: modified clicks open GitHub in a new tab
 * immediately; a plain click plays the wave, then leaves.
 */
export function Source() {
  const ref = useRef<HTMLElement>(null);
  const fieldEl = useRef<HTMLDivElement>(null);
  const field = useRef<CommitField | null>(null);
  const [live, setLive] = useState(false);
  const portrait = typeof window !== 'undefined' && window.innerWidth / window.innerHeight < 0.9;

  useDirective(ref, {
    formation: 'drift',
    room: 'home',
    anchor: [0, 0.05],
    scale: portrait ? 1 : 1.4,
    presence: 0.55,
    title: 0,
    focus: -1,
    energy: 0,
    daylight: 0,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      revealLines(el.querySelector('.source-title')!);
      revealLines(el.querySelector('.source-body')!, { stagger: 0.05 });
      riseIn(el.querySelectorAll('.source-link, .source-hint'), el.querySelector('.source-cta')!);
    }, el);
    return () => ctx.revert();
  }, []);

  // Physics (≈1 MB of WebAssembly) loads only when the section is near, and
  // never automatically on data-saver or very slow connections. Every
  // transition is explicit and a load belongs to one attempt: a result that
  // arrives after the attempt is over (unmount, route change) is disposed,
  // never attached.
  //
  //   idle     — waiting for an opt-in (constrained connections)
  //   waiting  — will load when the field comes near the viewport
  //   loading  — fetching and building (the opt-in button shows progress)
  //   ready    — running; the fallback fades once the first frame is drawn
  //   error    — the download or setup failed; a retry is offered
  // Once someone has opted in, the field loads by itself for the rest of the visit.
  const [status, setStatus] = useState<FieldStatus>(() => (constrained() && !session.get('sa.fieldOptIn') ? 'idle' : 'waiting'));
  const [attempt, setAttempt] = useState(0);
  const optedIn = useRef(false);
  // The opt-in button fades out with the fallback, then leaves the DOM.
  const [optinGone, setOptinGone] = useState(false);
  useEffect(() => {
    if (!live) return;
    const t = window.setTimeout(() => setOptinGone(true), 700);
    return () => window.clearTimeout(t);
  }, [live]);
  useEffect(() => {
    const host = fieldEl.current;
    if (!host || status !== 'waiting') return;
    let over = false;
    let remove: (() => void) | undefined;
    let made: CommitField | null = null;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || over) return;
        io.disconnect();
        setStatus('loading');
        (async () => {
          try {
            const stage = await stageRef.ready();
            if (over) return;
            if (!stage) throw new Error('no renderer');
            const { CommitField } = await import('../../gl/views/CommitField');
            if (over) return;
            const f = await CommitField.create(host, stage.backdropTexture, window.innerWidth < 720, device.reducedMotion);
            if (over) return f.dispose();
            made = f;
            field.current = f;
            f.onFirstFrame = () => !over && setLive(true);
            remove = stage.addView(f);
            setStatus('ready');
          } catch (err) {
            if (over) return;
            if (import.meta.env.DEV) console.warn('[source] physics unavailable', err);
            setStatus('error');
          }
        })();
      },
      { rootMargin: optedIn.current ? '0px' : '80% 0px' },
    );
    io.observe(host);
    return () => {
      over = true;
      io.disconnect();
      remove?.();
      made?.dispose();
      if (field.current === made) field.current = null;
      setLive(false);
    };
    // A new attempt (retry) restarts the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status === 'waiting' || status === 'loading' || status === 'ready' ? 'on' : status, attempt]);

  const request = () => {
    if (status !== 'idle' && status !== 'error') return;
    optedIn.current = true;
    session.set('sa.fieldOptIn', true);
    if (status === 'error') setAttempt((a) => a + 1);
    setStatus('waiting');
  };

  const order = (on: boolean) => field.current?.setOrdered(on);

  const onActivate = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    audio.chime();
    if (field.current && !device.reducedMotion) await field.current.launch();
    leaveTo(site.github.url, 'GitHub');
  };

  return (
    <section ref={ref} id="source" className="source" aria-labelledby="source-title">
      <div className="shell source-inner">
        <div className="source-copy">
          <p className="t-meta">Source</p>
          <h2 id="source-title" className="source-title t-headline">
            The work is public.
          </h2>
          <p className="source-body t-lead">
            Every project here has its code on GitHub — notebooks, training logs, evaluation reports and the software
            around the models.
          </p>
        </div>

        <div
          ref={fieldEl}
          className="source-field"
          data-live={live}
          data-cursor={live ? 'Push' : undefined}
          onPointerMove={(e) => field.current?.setPointer(e.clientX, e.clientY, e.pointerType === 'mouse' || e.pointerType === 'pen')}
          onPointerLeave={() => field.current?.setPointer(0, 0, false)}
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse') field.current?.impulse(e.clientX, e.clientY);
            audio.tick(0.7);
          }}
        >
          <div className="source-field-fallback" aria-hidden="true" />
          {(optedIn.current || status === 'idle' || status === 'error') && !optinGone && (
            <button
              type="button"
              className="btn source-optin"
              data-state={live ? 'done' : status}
              tabIndex={live ? -1 : undefined}
              aria-disabled={status === 'waiting' || status === 'loading' || status === 'ready' ? true : undefined}
              aria-busy={status === 'waiting' || status === 'loading' ? true : undefined}
              onClick={request}
            >
              <span className="source-optin-label" aria-live="polite">
                {status === 'error'
                  ? 'The field didn’t load — try again'
                  : status === 'idle'
                    ? 'Load the interactive field (≈1 MB)'
                    : 'Loading the field…'}
              </span>
            </button>
          )}
        </div>

        <div className="source-cta">
          <a
            href={site.github.url}
            rel="noopener"
            className="source-link"
            data-cursor="Open GitHub"
            onPointerEnter={() => order(true)}
            onPointerLeave={() => order(false)}
            onFocus={() => order(true)}
            onBlur={() => order(false)}
            onClick={onActivate}
          >
            <span className="source-link-label t-meta">GitHub</span>
            <span className="source-link-handle">
              github.com/<wbr />
              <strong>{site.github.handle}</strong>
            </span>
            <span className="source-link-arrow" aria-hidden="true">
              ↗
            </span>
          </a>
          <p className="source-hint t-meta" aria-hidden="true">
            {live ? (device.touch ? 'Tap the blocks. Then open GitHub.' : 'Move through the blocks. Hover the link to see them line up.') : ''}
          </p>
        </div>
      </div>
    </section>
  );
}
