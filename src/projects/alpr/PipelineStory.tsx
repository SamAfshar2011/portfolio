import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from '../../motion/gsap';
import { device } from '../../lib/device';
import { Picture } from '../../components/media/Picture';
import { HERO } from './scenes';
import { audio } from '../../components/audio/engine';

/**
 * From pixels to a plate number, told with the pipeline's intermediate
 * outputs for one night-time photograph (an example published with the
 * repository). Localisation is shown optically —
 * the frame defocuses and darkens around the plate — rather than with a
 * targeting overlay; the plate lifts out, splits into the eight crops the
 * classifier actually received, and each crop resolves into its class.
 *
 * The stage is CSS-sticky inside a tall track and the timeline is scrubbed,
 * so the scroll position is the playhead and the page never scroll-jacks.
 */
const STEPS = [
  { k: 'Frame', t: 'A frame at night', d: 'A 6000 × 4000 photograph. The plate is a small, dim rectangle between two headlights.' },
  { k: 'Model 1', t: 'Find the plate', d: 'A YOLO26s detector, trained at 960 px on whole scenes, proposes the plate region.' },
  { k: 'Crop', t: 'Lift it out', d: 'The region is cropped with a little padding on every side, so no character is clipped at the edge.' },
  {
    k: 'Model 2',
    t: 'Recover exactly eight',
    d: 'A YOLO26l detector finds where the characters are, not what they are. Row alignment and height consistency choose the best eight boxes, sorted left to right; if eight can’t be found, the plate is rejected.',
  },
  {
    k: 'Model 3',
    t: 'Read each one',
    d: 'Each crop keeps its proportions on a square canvas, and a ConvNeXt V2 Base classifier scores it against 32 classes: digits, Persian letters and plate symbols.',
  },
  {
    k: 'Decode',
    t: 'Decode by position, then answer',
    d: 'Slot three may only be a letter, every other slot only a digit, so impossible reads are blocked while decoding. The three stage confidences are combined by geometric mean.',
  },
];

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

export function PipelineStory() {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(device.reducedMotion ? STEPS.length - 1 : 0);
  const { crop, plateCrop, chars } = HERO;
  const [px0, py0, px1] = plateCrop.box;
  const plate = {
    left: pct(px0 - crop.x, crop.w),
    top: pct(py0 - crop.y, crop.h),
    width: pct(px1 - px0, crop.w),
  };

  // Each stage the pipeline reaches is heard as an optical tick (sound on only).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    audio.scan(step, window.innerWidth * 0.4);
  }, [step]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || device.reducedMotion) return;
    const ctx = gsap.context(() => {
      const mobile = window.innerWidth < 800;
      const tl = gsap.timeline({
        defaults: { ease: 'none', duration: 1 },
        scrollTrigger: {
          trigger: el,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.6,
          onUpdate: (self) => setStep(Math.min(STEPS.length - 1, Math.floor(self.progress * STEPS.length * 0.999))),
        },
      });
      // 1 → 2: optical localisation
      tl.to('.ps-photo', { filter: 'blur(6px) brightness(0.45)', scale: 1.02 }, 1)
        .fromTo('.ps-plate', { opacity: 0 }, { opacity: 1, duration: 0.3 }, 1)
        .fromTo('.ps-halo', { opacity: 0, scale: 1.6 }, { opacity: 1, scale: 1 }, 1)
        // 2 → 3: lift
        .to('.ps-photo', { filter: 'blur(16px) brightness(0.28)', scale: 0.94 }, 2)
        .to('.ps-halo', { opacity: 0, duration: 0.5 }, 2)
        .to('.ps-lift', { left: mobile ? '10%' : '17%', top: '30%', width: mobile ? '80%' : '66%', duration: 1 }, 2)
        // 3 → 4: split into eight crops
        .fromTo('.ps-char', { opacity: 0 }, { opacity: 1, duration: 0.25 }, 3)
        .to('.ps-plate', { opacity: 0.12, duration: 0.5 }, 3.1)
        .to('.ps-char', { xPercent: (i) => (i - 3.5) * (mobile ? 16 : 36), yPercent: -6, duration: 0.9, ease: 'settle' }, 3.2)
        // 4 → 5: classify
        .fromTo('.ps-glyph', { opacity: 0, filter: 'blur(10px)' }, { opacity: 1, filter: 'blur(0px)', stagger: 0.06, duration: 0.5 }, 4)
        .to('.ps-char img', { opacity: 0.25, stagger: 0.06, duration: 0.5 }, 4)
        // 5 → 6: validate
        .fromTo('.ps-format span', { opacity: 0, y: 8 }, { opacity: 1, y: 0, stagger: 0.05, duration: 0.4 }, 5)
        .fromTo('.ps-result', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5 }, 5.3);
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref} className="ps" data-step={step} data-static={device.reducedMotion}>
      <div className="ps-sticky">
        <div className="ps-stage" role="img" aria-label="The pipeline reading plate 52 Gh 462 11 from a night-time photograph">
          <Picture id="alpr/hero" alt="" className="ps-photo" sizes="(min-width: 1000px) 60vw, 100vw" />
          <div className="ps-halo" style={plate} aria-hidden="true" />
          <div className="ps-lift" style={plate}>
            <Picture id="alpr/plates/5-plate_01" alt="" className="ps-plate" />
            {chars.map(([x0, y0, x1, y1], i) => (
              <div
                key={i}
                className="ps-char"
                style={{
                  left: pct(x0, plateCrop.w),
                  top: pct(y0, plateCrop.h),
                  width: pct(x1 - x0, plateCrop.w),
                  height: pct(y1 - y0, plateCrop.h),
                }}
              >
                <Picture id={`alpr/chars/5-plate_01-${i + 1}`} alt="" />
                <span className="ps-glyph" lang="fa">
                  <b>{HERO.glyphs[i]}</b>
                  <small>{HERO.classes[i]}</small>
                </span>
              </div>
            ))}
          </div>
          <div className="ps-bottom">
            <p className="ps-format t-meta" aria-hidden="true">
              {['D', 'D', 'L', 'D', 'D', 'D', 'D', 'D'].map((c, i) => (
                <span key={i} data-gap={i === 2 || i === 3 || i === 6}>
                  {c}
                </span>
              ))}
            </p>
            <p className="ps-result">
              <span className="ps-plate-text" dir="ltr" lang="fa">
                {['۵۲', 'ق', '۴۶۲', '۱۱'].map((g, i) => (
                  <span key={i}>{g}</span>
                ))}
              </span>
              <span className="ps-latin t-num">
                {HERO.latin} <em>· confidence {HERO.confidence}</em>
              </span>
            </p>
          </div>
        </div>
        <ol className="ps-steps">
          {STEPS.map((s, i) => (
            <li key={s.k} data-on={i === step} data-done={i < step}>
              <span className="ps-k t-meta">{s.k}</span>
              <span className="ps-t">{s.t}</span>
              <span className="ps-d">{s.d}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
