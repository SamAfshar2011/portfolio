import { useLayoutEffect, useRef } from 'react';
import { gsap, ScrollTrigger } from '../../motion/gsap';
import { focusPull, revealLines, riseIn } from '../../motion/hooks';
import { director } from '../../experience/director';
import { pointer } from '../../experience/pointer';
import { projects, projectPath } from '../../projects/registry';
import type { ProjectMeta } from '../../projects/types';
import { TLink } from '../../components/transition/TLink';
import { ExternalLink } from '../../components/transition/ExternalLink';
import { AwardPlaque } from '../../components/ui/AwardPlaque';
import { RoomTeaser, TEASER_PLATE } from './RoomTeaser';
import { etchPlate } from '../../gl/etch';
import type { FormationId } from '../../experience/director';
import { device } from '../../lib/device';


const ROOM_ANCHOR: Partial<Record<FormationId, [number, number]>> = {
  plate: [0.42, 0.22],
  horizon: [0.4, 0.34],
  building: [0.3, 0.08],
};
const ROOM_SCALE: Partial<Record<FormationId, number>> = { horizon: 0.8, building: 0.9 };
/**
 * Selected work, presented as three rooms. As each room scrolls into place the
 * glass reconfigures into that project's own structure (a gauge, a building,
 * a plate) and the light changes to the room's colour. The CTA is the door:
 * hovering it wakes the structure up and preloads the page behind it.
 */
function Room({ p }: { p: ProjectMeta }) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const portrait = window.innerWidth / window.innerHeight < 0.9;
    const directive = {
      formation: p.formation,
      room: p.room,
      // The teasers sit low on the right, so wide structures (the plate,
      // Fiscora's timeline) ride higher to keep the glass and the image apart.
      anchor: (portrait ? [0, 0.5] : ROOM_ANCHOR[p.formation] ?? [0.4, 0.02]) as [number, number],
      scale: portrait ? 0.62 : (ROOM_SCALE[p.formation] ?? 1),
      presence: portrait ? 0.85 : 1,
      title: 0,
      energy: 0,
      focus: -1,
      daylight: 0,
    };
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: el,
        start: 'top 55%',
        end: 'bottom 45%',
        onToggle: (self) => {
          if (!self.isActive) return;
          if (p.formation === 'plate') etchPlate('home', TEASER_PLATE);
          director.set(directive);
          pointer.baseX = 0.7;
          pointer.baseY = 0.34;
        },
      });
      const name = el.querySelector<HTMLElement>('.room-name-text');
      if (name) focusPull(name, { scroll: true });
      riseIn(el.querySelectorAll('.room-index, .room-alias, .plaque, .room-actions'), el, { delay: 0.15 });
      revealLines(el.querySelector('.room-summary')!, { stagger: 0.05 });
      if (!device.reducedMotion) {
        gsap.fromTo(
          el.querySelector('.room-teaser'),
          { yPercent: 18 },
          { yPercent: -12, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } },
        );
      }
    }, el);
    return () => ctx.revert();
  }, [p]);

  const wake = (on: boolean) => {
    if (director.active.room === p.room) director.set({ energy: on ? 1 : 0 });
  };

  return (
    <section
      ref={ref}
      className="room"
      aria-labelledby={`room-${p.slug}`}
      style={{ ['--room-accent' as string]: p.accent }}
    >
      <div className="shell room-grid">
        <div className="room-copy">
          <p className="room-index t-meta">
            <span className="room-index-num">{p.index}</span>
            <span aria-hidden="true">/ 03</span>
            <span className="room-kicker">{p.kicker}</span>
          </p>
          <h3 id={`room-${p.slug}`} className="room-name">
            <TLink to={projectPath(p.slug)} data-cursor="Enter" className="room-name-link">
              <span className="room-name-text">{p.name}</span>
            </TLink>
          </h3>
          {p.alias && <p className="room-alias t-meta">Pipeline name: {p.alias}</p>}
          <p className="room-summary t-lead">{p.summary}</p>
          {p.awards.length > 0 && (
            <div className="room-awards">
              {p.awards.map((a) => (
                <AwardPlaque key={a.event} award={a} />
              ))}
            </div>
          )}
          <div className="room-actions">
            <TLink
              to={projectPath(p.slug)}
              className="btn btn-primary"
              data-magnetic
              data-cursor="Enter"
              onPointerEnter={() => wake(true)}
              onPointerLeave={() => wake(false)}
              onFocus={() => wake(true)}
              onBlur={() => wake(false)}
            >
              Enter the room
              <span className="btn-icon" aria-hidden="true">
                →
              </span>
            </TLink>
            <ExternalLink href={p.repo} label={`the ${p.name} repository`} className="btn" data-cursor="Source">
              Source
              <span className="btn-icon" aria-hidden="true">
                ↗
              </span>
            </ExternalLink>
          </div>
        </div>
        <div className="room-visual" aria-hidden="true">
          <RoomTeaser slug={p.slug} />
        </div>
      </div>
    </section>
  );
}

export function Rooms() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => revealLines(el.querySelector('.rooms-title')!), el);
    return () => ctx.revert();
  }, []);
  return (
    <section ref={ref} id="work" className="rooms" aria-labelledby="rooms-title">
      <div className="shell section-head">
        <p className="t-meta">Selected work</p>
        <h2 id="rooms-title" className="rooms-title t-headline">
          Three rooms. <span className="t-serif">Three different kinds of signal.</span>
        </h2>
      </div>
      {projects.map((p) => (
        <Room key={p.slug} p={p} />
      ))}
    </section>
  );
}
