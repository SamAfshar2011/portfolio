import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { gsap } from '../../motion/gsap';
import { Picture } from '../../components/media/Picture';
import { device } from '../../lib/device';
import geometry from './cockpit.json';

/**
 * The cockpit, taken apart. The real dashboard capture sits flat; as you
 * scroll, each instrument card lifts out of its own socket to its own depth
 * and the assembly tilts into an exploded axonometric view.
 *
 * The backplate is a derived asset with the cards punched out
 * (scripts/fiscora-cockpit.mjs), and each card is cut along its own
 * chamfered outline — so a lifted card leaves a real, empty socket behind it
 * instead of a copy of itself. At progress 0 every card sits exactly in its
 * hole and the picture is the original screenshot.
 *
 * Three transforms are kept on three elements, so none can disturb another:
 *   .cockpit-module  the scroll explosion (GSAP, scrubbed — reversing the
 *                    scroll rebuilds the flat dashboard exactly)
 *   .cockpit-float   idle drift and pointer parallax, scaled by how open the
 *                    assembly is (zero when it is flat)
 *   .cockpit-lift    hover: the card rises, sharpens and catches the light
 *                    (fine pointers only; nothing depends on it on touch)
 */
const SRC = geometry.source;
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/** A card's outline as a clip-path in its own image box (percent). */
function outlineClip(m: (typeof geometry.modules)[number]) {
  const [x0, y0, x1, y1] = m.box;
  const w = x1 - x0;
  const h = y1 - y0;
  const { left, top, right, bottom, cut } = m.outline;
  const P = (x: number, y: number) => `${pct(x - x0, w)} ${pct(y - y0, h)}`;
  return `polygon(${[
    P(left + cut.tl, top),
    P(right - cut.tr, top),
    P(right, top + cut.tr),
    P(right, bottom - cut.br),
    P(right - cut.br, bottom),
    P(left + cut.bl, bottom),
    P(left, bottom - cut.bl),
    P(left, top + cut.tl),
  ].join(', ')})`;
}

const LABEL = `The Fiscora dashboard: ${geometry.modules.map((m) => m.label.toLowerCase()).join(', ')}.`;

export function Cockpit() {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || device.reducedMotion) return;
    const mobile = window.innerWidth < 720;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    let tl: gsap.core.Timeline | null = null;
    const ctx = gsap.context(() => {
      // The stage is CSS-sticky inside a tall track, so the explosion is
      // scrubbed while the panel holds still — no JavaScript pinning needed.
      tl = gsap.timeline({
        scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', scrub: 0.8 },
        defaults: { ease: 'none' },
      });
      tl.fromTo(
        '.cockpit-assembly',
        { rotateX: 0, rotateZ: 0, scale: 1 },
        { rotateX: mobile ? 34 : 46, rotateZ: mobile ? -10 : -20, scale: mobile ? 0.86 : 0.74, duration: 1 },
        0,
      );
      gsap.utils.toArray<HTMLElement>('.cockpit-module', el).forEach((p) => {
        const z = +(p.dataset.depth ?? 0) * (mobile ? 0.55 : 1);
        tl!.fromTo(p, { z: 0 }, { z, duration: 1 }, 0);
      });
      tl.fromTo('.cockpit-label', { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.05 }, 0.55);
    }, el);

    // Idle drift, parallax and the open-dependent light run on the shared
    // ticker, only while the cockpit is on screen.
    const floats = [...el.querySelectorAll<HTMLElement>('.cockpit-float')];
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    let open = -1;
    let visible = false;
    const tick = () => {
      if (!visible || !tl) return;
      const t = gsap.ticker.time;
      const p = tl.progress();
      // How far apart the assembly is; motion eases in as it opens.
      const k = gsap.parseEase('power2.out')(Math.min(1, p / 0.6));
      pointer.x += (pointer.tx - pointer.x) * 0.08;
      pointer.y += (pointer.ty - pointer.y) * 0.08;
      floats.forEach((f, i) => {
        const depth = +(f.dataset.depth ?? 0) / 270;
        const bob = Math.sin(t * 0.7 + i * 1.7) * 7;
        const rx = Math.sin(t * 0.5 + i * 2.3) * 0.7;
        const ry = Math.cos(t * 0.45 + i * 1.1) * 0.7;
        const px = pointer.x * depth * 14;
        const py = pointer.y * depth * 10;
        f.style.transform = `translate3d(${(px * k).toFixed(2)}px, ${(py * k).toFixed(2)}px, ${(bob * k).toFixed(2)}px) rotateX(${(rx * k).toFixed(3)}deg) rotateY(${(ry * k).toFixed(3)}deg)`;
      });
      if (Math.abs(k - open) > 0.002) {
        open = k;
        el.style.setProperty('--open', k.toFixed(3));
        el.toggleAttribute('data-open', k > 0.3);
      }
    };
    gsap.ticker.add(tick);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);

    const stage = el.querySelector<HTMLElement>('.cockpit-stage')!;
    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
      const lift = (e.target as HTMLElement).closest<HTMLElement>('.cockpit-lift');
      if (lift) {
        const b = lift.getBoundingClientRect();
        lift.style.setProperty('--mx', `${(((e.clientX - b.left) / b.width) * 100).toFixed(1)}%`);
        lift.style.setProperty('--my', `${(((e.clientY - b.top) / b.height) * 100).toFixed(1)}%`);
      }
    };
    const onLeave = () => {
      pointer.tx = 0;
      pointer.ty = 0;
    };
    if (fine) {
      stage.addEventListener('pointermove', onMove);
      stage.addEventListener('pointerleave', onLeave);
    }
    const onOver = (e: PointerEvent) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>('.cockpit-module');
      el.dataset.hover = m?.dataset.name ?? '';
    };
    if (fine) stage.addEventListener('pointerover', onOver);

    return () => {
      gsap.ticker.remove(tick);
      io.disconnect();
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      stage.removeEventListener('pointerover', onOver);
      floats.forEach((f) => (f.style.transform = ''));
      ctx.revert();
    };
  }, []);

  return (
    <div ref={ref} className="cockpit" data-reveal>
      <div className="cockpit-stage">
        <div className="cockpit-assembly" role="img" aria-label={LABEL}>
          <div className="cockpit-socket" aria-hidden="true" />
          <Picture id="fiscora/cockpit-plate" alt="" className="cockpit-plate" sizes="(min-width: 1100px) 64rem, 94vw" />
          {geometry.modules.map((m) => {
            const [x0, y0, x1, y1] = m.box;
            const style: CSSProperties = {
              left: pct(x0, SRC.w),
              top: pct(y0, SRC.h),
              width: pct(x1 - x0, SRC.w),
              height: pct(y1 - y0, SRC.h),
            };
            return (
              <div
                key={m.id}
                className="cockpit-module"
                data-depth={m.depth}
                data-name={m.name}
                data-end={(x0 + x1) / 2 > SRC.w * 0.6 || undefined}
                style={style}
              >
                <div className="cockpit-float" data-depth={m.depth}>
                  <div className="cockpit-lift" style={{ ['--clip' as string]: outlineClip(m) }}>
                    <Picture id={m.id} alt="" sizes="(min-width: 1100px) 36rem, 60vw" />
                    <span className="cockpit-sheen" aria-hidden="true" />
                  </div>
                  <span className="cockpit-label t-meta" aria-hidden="true">
                    {m.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
