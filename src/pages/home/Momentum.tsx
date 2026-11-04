import { useLayoutEffect, useRef } from 'react';
import { gsap, ScrollTrigger } from '../../motion/gsap';
import { revealLines, riseIn } from '../../motion/hooks';
import { director } from '../../experience/director';
import { pointer } from '../../experience/pointer';
import { device } from '../../lib/device';
import { etchStory } from '../../gl/etch';

/**
 * Momentum — Sam's story told as acceleration rather than a résumé. Five
 * short beats beside a row of glass: the past gathers on the left, blank
 * glass waits on the right, and the present beat stands forward with its
 * label etched inside it. Scroll position drives the row continuously (see
 * `fan` in gl/stack/formations.ts); the page scrolls normally the whole time.
 */
const BEATS = [
  {
    label: '2024',
    title: 'It started with Python.',
    body: 'A first script, then another. The habit that stuck: build the thing to understand the thing.',
  },
  {
    label: 'Data',
    title: 'Then data, and models.',
    body: 'Notebooks, training runs, validation splits — and learning to distrust a good-looking metric until it beats a simple baseline.',
  },
  {
    label: 'Systems',
    title: 'Then whole systems.',
    body: 'A model is one part. The rest is a backend, an interface, storage, failure modes and the glue between them. That is where most of the work lives.',
  },
  {
    label: 'Juries',
    title: 'Then juries.',
    body: 'Fiscora took Second Place at Innoverse in the United States. ANKA won a Gold Award at 1idea1world and a Gold Award from IFIA.',
  },
  {
    label: 'Now',
    title: 'Now: harder problems.',
    body: 'Vision for Persian script. Forecasts that admit their uncertainty. Safety tools a non-engineer can read. And, eventually, a company.',
  },
];

/** Tools that verifiably appear in the three repositories. */
const TOOLKIT = [
  'Python',
  'PyTorch',
  'TensorFlow / Keras',
  'Ultralytics YOLO',
  'ConvNeXt',
  'scikit-learn',
  'pandas · NumPy',
  'OpenCV',
  'FastAPI',
  'JavaScript',
  'Canvas 2D',
  'Jupyter',
];

/**
 * Story position from the page: 0 while the first beat is in focus, 1 for
 * the second… Between beats the position eases through a hand-off, and it
 * rests (a detent) while a beat's text sits in the reading line, so the
 * presented slab holds still while you read.
 */
function storyPosition(beats: HTMLElement[]) {
  const line = window.innerHeight * 0.5;
  const centres = beats.map((b) => {
    const r = b.getBoundingClientRect();
    return r.top + r.height / 2;
  });
  const last = centres.length - 1;
  let raw = 0;
  if (line <= centres[0]) raw = 0;
  else if (line >= centres[last]) raw = last;
  else {
    for (let i = 0; i < last; i++) {
      if (line >= centres[i] && line <= centres[i + 1]) {
        raw = i + (line - centres[i]) / Math.max(1, centres[i + 1] - centres[i]);
        break;
      }
    }
  }
  const i = Math.min(last, Math.floor(raw));
  const f = raw - i;
  // Soft staircase: flat around each beat, a smooth hand-off between.
  const t = Math.min(1, Math.max(0, (f - 0.22) / 0.56));
  return i + t * t * (3 - 2 * t);
}

export function Momentum() {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const portrait = window.innerWidth / window.innerHeight < 0.9;
    const beats = gsap.utils.toArray<HTMLElement>('.beat', el);
    director.channels.beats = beats.length;
    director.channels.story = () => storyPosition(beats);
    etchStory(BEATS.map((b) => b.label));

    const ctx = gsap.context(() => {
      beats.forEach((beat) => {
        revealLines(beat.querySelector('.beat-title')!);
        riseIn(beat.querySelectorAll('.beat-label, .beat-body'), beat, { delay: 0.1 });
      });
      // The row of glass takes over while the story is on screen.
      ScrollTrigger.create({
        trigger: el.querySelector('.beats'),
        start: 'top 62%',
        end: 'bottom 38%',
        onToggle: (self) => {
          if (!self.isActive) return;
          director.set({
            formation: 'fan',
            room: 'home',
            anchor: portrait ? [0, 0.5] : [0.4, 0.02],
            scale: portrait ? 0.9 : 1,
            presence: portrait ? 0.78 : 1,
            title: 0,
            energy: 0,
            focus: -1,
            daylight: 0,
          });
          pointer.baseX = 0.75;
          pointer.baseY = 0.35;
        },
      });
      revealLines(el.querySelector('.toolkit-title')!);
      riseIn(el.querySelectorAll('.toolkit .m-chip'), el.querySelector('.toolkit')!, { stagger: 0.03 });

      if (!device.reducedMotion) {
        // The progress rail fills as the story advances.
        gsap.fromTo(
          '.story-rail-fill',
          { scaleY: 0 },
          { scaleY: 1, ease: 'none', scrollTrigger: { trigger: '.beats', start: 'top 60%', end: 'bottom 60%', scrub: true } },
        );
      }
    }, el);
    return () => {
      ctx.revert();
      director.channels.story = null;
    };
  }, []);

  return (
    <section ref={ref} id="story" className="story" aria-labelledby="story-title">
      <div className="shell">
        <header className="section-head">
          <p className="t-meta">Momentum</p>
          <h2 id="story-title" className="sr-only">
            How Sam got here
          </h2>
        </header>
        <div className="story-grid">
          <div className="story-rail" aria-hidden="true">
            <span className="story-rail-fill" />
          </div>
          <ol className="beats">
            {BEATS.map((b) => (
              <li key={b.label} className="beat">
                <p className="beat-label t-meta">{b.label}</p>
                <h3 className="beat-title t-headline">{b.title}</h3>
                <p className="beat-body t-lead">{b.body}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="toolkit">
          <h3 className="toolkit-title t-subtitle">Tools that show up in the work</h3>
          <ul className="toolkit-list" aria-label="Tools">
            {TOOLKIT.map((t) => (
              <li key={t} className="m-chip">
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
