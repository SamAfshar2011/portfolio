import { useEffect, useRef, useState } from 'react';
import { gsap } from '../../motion/gsap';
import { device, media } from '../../lib/device';
import { Spring, clamp, damp } from '../../lib/math';
import { pointer as keyLight } from '../../experience/pointer';
import { audio } from '../audio/engine';
import { LiquidLayer, type LiquidState, type SkinState } from './liquid';

/**
 * A lens-shaped cursor for precise pointers. It never replaces the native
 * cursor until it has received its first pointer event, it is never used on
 * touch devices, and it only adds information: a short verb for what a click
 * will do ("Open", "Drag", "Enter"…).
 *
 * Controls marked [data-magnetic] (and every .btn) take part in a material
 * merge: as the pointer comes near, the cursor's glass leans toward the
 * control and the control's edge reaches back; close enough, a bridge forms;
 * inside, the cursor is absorbed into the control's rim, which then moves
 * with the pointer through small deformations; leaving, the rim stretches
 * after the pointer, necks and pinches off, and the cursor re-forms from the
 * departing material. It is all one signed-distance field (see liquid.ts).
 *
 * Without WebGL 2 the same controller drives the plain DOM lens; with reduced
 * motion the merge is a calm crossfade with no stretching or travel.
 */
interface Target {
  el: HTMLElement;
  label: string;
  magnetic: boolean;
}

const INTERACTIVE = 'a, button, [role="button"], input, select, textarea, label, summary, [data-cursor]';
const MAGNETIC = '[data-magnetic], .btn, .index-btn, .audio-toggle';
/** Distance (px) at which a control starts to notice the pointer. */
const FIELD = 78;
/** A bridge forms inside this distance on the way in… */
const CONNECT = 26;
/** …and holds until this distance on the way out (surface tension). */
const BREAK = 52;
const RING = 20;

function describe(el: Element | null): Target | null {
  const hit = el?.closest<HTMLElement>(INTERACTIVE);
  if (!hit) return null;
  const explicit = hit.dataset.cursor;
  let label = explicit ?? '';
  if (!explicit && hit.tagName === 'A') {
    const href = hit.getAttribute('href') ?? '';
    label = /^https?:/.test(href) && !href.includes(location.host) ? 'Visit' : 'Open';
  }
  return { el: hit, label, magnetic: isMagnetic(hit) };
}

function isMagnetic(el: HTMLElement) {
  if (!el.matches(MAGNETIC)) return false;
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function parseColor(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(/[\s,/]+/).map(Number);
    return [r / 255, g / 255, b / 255];
  }
  const h = css.trim().match(/^#([0-9a-f]{6})$/i);
  if (h) {
    const n = parseInt(h[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  return null;
}

/** Signed distance from a point to a rounded rectangle (negative inside). */
function sdRect(px: number, py: number, cx: number, cy: number, hx: number, hy: number, r: number) {
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Closest point on a rounded rectangle's boundary to (px, py). */
function closestOnRect(px: number, py: number, cx: number, cy: number, hx: number, hy: number, r: number) {
  const lx = px - cx;
  const ly = py - cy;
  const ix = hx - r;
  const iy = hy - r;
  const kx = clamp(lx, -ix, ix);
  const ky = clamp(ly, -iy, iy);
  let dx = lx - kx;
  let dy = ly - ky;
  let l = Math.hypot(dx, dy);
  if (l < 1e-3) {
    // Inside the core: push out along the nearest side.
    const ex = ix + r - Math.abs(lx);
    const ey = iy + r - Math.abs(ly);
    if (ex < ey) {
      dx = Math.sign(lx) || 1;
      dy = 0;
    } else {
      dx = 0;
      dy = Math.sign(ly) || 1;
    }
    l = 1;
  }
  return { x: cx + kx + (dx / l) * r, y: cy + ky + (dy / l) * r };
}

interface Magnet {
  el: HTMLElement;
  /** Layout box without our own offset (viewport px). */
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  radius: number;
  /** The control's own corner radius. */
  base: number;
  /** The control's own CSS translate (kept; our offset is added to it). */
  baseX: string;
  baseY: string;
  tint: [number, number, number];
  merged: boolean;
  /** Pointer left while merged: the neck holds until BREAK. */
  releasing: boolean;
  broken: boolean;
  alpha: Spring;
  bulge: Spring;
  lobe: Spring;
  neck: Spring;
  offX: Spring;
  offY: Spring;
  qx: number;
  qy: number;
  entryX: number;
  entryY: number;
  dist: number;
}

/** Splits a computed `translate` value ("none", "10px", "-50% -50%"…) into x and y. */
function baseTranslate(el: HTMLElement): [string, string] {
  el.style.translate = '';
  const t = getComputedStyle(el).translate;
  if (!t || t === 'none') return ['0px', '0px'];
  const [x = '0px', y = '0px'] = t.split(/\s+/);
  return [x, y];
}

function acquire(el: HTMLElement): Magnet {
  const [baseX, baseY] = baseTranslate(el);
  const cs = getComputedStyle(el);
  const radius = parseFloat(cs.borderTopLeftRadius) || 0;
  const primary = el.classList.contains('btn-primary');
  const tint = (primary ? parseColor(cs.getPropertyValue('--accent')) : null) ?? [0.93, 0.91, 0.88];
  const m: Magnet = {
    el,
    cx: 0,
    cy: 0,
    hx: 1,
    hy: 1,
    radius,
    base: radius,
    baseX,
    baseY,
    tint,
    merged: false,
    releasing: false,
    broken: false,
    alpha: new Spring(0, 160, 22),
    bulge: new Spring(0, 260, 16),
    lobe: new Spring(0, 190, 11),
    neck: new Spring(0, 320, 24),
    offX: new Spring(0, 170, 17),
    offY: new Spring(0, 170, 17),
    qx: 0,
    qy: 0,
    entryX: 0,
    entryY: 0,
    dist: 1e4,
  };
  measure(m);
  return m;
}

function measure(m: Magnet) {
  const r = m.el.getBoundingClientRect();
  // Our own translate is part of the rect; remove it to get the rest pose.
  m.cx = r.left + r.width / 2 - m.offX.value;
  m.cy = r.top + r.height / 2 - m.offY.value;
  // A hair outside the control's own edge.
  m.hx = r.width / 2 + 2.5;
  m.hy = r.height / 2 + 2.5;
  m.radius = Math.min(m.base + 2.5, m.hx, m.hy);
}

function releaseStyles(el: HTMLElement) {
  el.style.translate = '';
  el.style.removeProperty('--mx');
  el.style.removeProperty('--my');
  delete el.dataset.merged;
}

export function Cursor() {
  const [enabled, setEnabled] = useState(() => device.finePointer);
  const ring = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = media.finePointer;
    if (!mq) return;
    const onChange = () => setEnabled(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const reduced = () => device.reducedMotion;
    const liquid = LiquidLayer.create();
    if (liquid && host.current) {
      host.current.appendChild(liquid.canvas);
      root.classList.add('has-liquid');
    }

    const cx = new Spring(innerWidth / 2, 420, 34);
    const cy = new Spring(innerHeight / 2, 420, 34);
    const cr = new Spring(RING, 230, 17);
    const stretch = new Spring(0, 240, 20);
    const dx = new Spring(innerWidth / 2, 1400, 70);
    const dy = new Spring(innerHeight / 2, 1400, 70);
    const dr = new Spring(2.5, 400, 30);
    const vis = new Spring(0, 120, 20);
    let dirX = 1;
    let dirY = 0;
    let x = innerWidth / 2;
    let y = innerHeight / 2;
    let current: Target | null = null;
    let pressed = false;
    let started = false;
    let active: Magnet | null = null;
    let leaving: Magnet | null = null;
    let candidates: HTMLElement[] = [];
    let candidatesAt = -1;
    let rehit = false;
    let lastSig = '';

    const setTarget = (t: Target | null) => {
      if (t?.el === current?.el) return;
      current = t;
      if (tag.current) {
        tag.current.textContent = t?.label ?? '';
        tag.current.dataset.show = String(!!t?.label && !t.magnetic);
      }
      if (t) audio.merge('bridge', x);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      x = e.clientX;
      y = e.clientY;
      if (!started) {
        started = true;
        cx.snap(x);
        cy.snap(y);
        dx.snap(x);
        dy.snap(y);
        root.classList.add('has-cursor');
      }
      vis.target = 1;
      setTarget(describe(e.target as Element));
    };
    const onLeave = () => {
      vis.target = 0;
      pressed = false;
    };
    const onDown = () => (pressed = true);
    const onUp = () => (pressed = false);
    // Scrolling moves controls under a still pointer: hit-test again.
    const onScroll = () => (rehit = true);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('blur', onLeave);
    document.addEventListener('pointerleave', onLeave);

    const findMagnet = (now: number) => {
      if (now - candidatesAt > 250) {
        candidates = Array.from(document.querySelectorAll<HTMLElement>(MAGNETIC)).filter(isMagnetic);
        candidatesAt = now;
      }
      let best: HTMLElement | null = null;
      let bestD = FIELD;
      for (const el of candidates) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.bottom < -FIELD || r.top > innerHeight + FIELD) continue;
        // Use the rest pose for the element we are already holding.
        const off = active?.el === el ? active : null;
        const ccx = r.left + r.width / 2 - (off ? off.offX.value : 0);
        const ccy = r.top + r.height / 2 - (off ? off.offY.value : 0);
        const rad = Math.min(parseFloat(el.style.borderRadius) || r.height / 2, r.width / 2, r.height / 2);
        const d = sdRect(x, y, ccx, ccy, r.width / 2, r.height / 2, rad);
        if (d < bestD) {
          bestD = d;
          best = el;
        }
      }
      return best;
    };

    const drop = (m: Magnet | null) => {
      if (m) releaseStyles(m.el);
    };

    /** Advances one control's material; returns false once it has fully let go. */
    const stepMagnet = (m: Magnet, dt: number, held: boolean) => {
      if (!m.el.isConnected) return false;
      measure(m);
      const calm = reduced();
      const d = sdRect(x, y, m.cx, m.cy, m.hx, m.hy, m.radius);
      m.dist = d;
      const P = held ? clamp(1 - d / FIELD) : 0;
      const inside = held && d <= 0;
      const q = closestOnRect(x, y, m.cx, m.cy, m.hx, m.hy, m.radius);

      if (inside && !m.merged) {
        // Contact: the cursor's volume arrives as a lobe at the entry point.
        m.merged = true;
        m.releasing = false;
        m.broken = false;
        m.entryX = q.x;
        m.entryY = q.y;
        if (!calm) m.lobe.velocity += 150;
        audio.merge('absorb', x);
      } else if (!inside && m.merged) {
        m.merged = false;
        m.releasing = true;
      }
      if (m.releasing && d > BREAK) {
        m.releasing = false;
        m.broken = true;
        audio.merge('release', x);
      }
      if (m.broken && held && d < CONNECT * 0.6) m.broken = false;

      // Skin visibility: it notices the pointer, then carries it.
      m.alpha.target = m.merged ? 1 : m.releasing ? 1 - clamp(d / BREAK) * 0.5 : Math.pow(P, 1.3) * 0.85;

      // Bulge: reach toward the pointer (outside), be pushed by it (inside),
      // be pulled after it (leaving).
      let bulge = 0;
      if (!calm) {
        if (m.merged) {
          const edge = -d; // distance from pointer to the edge, inside
          bulge = 1.2 + 4.5 * Math.exp(-edge / 10);
        } else if (m.releasing) bulge = 9 * (1 - clamp(d / BREAK));
        else bulge = 5 * P * P;
      }
      m.bulge.target = bulge;
      m.lobe.target = 0;
      const lobeW = clamp(Math.abs(m.lobe.value) / 4);
      m.qx = q.x + (m.entryX - q.x) * lobeW;
      m.qy = q.y + (m.entryY - q.y) * lobeW;

      // Neck: forms close in, holds on the way out, then pinches.
      let neck = 0;
      if (!calm && !m.merged && !m.broken) {
        if (m.releasing) neck = 8.5 * (1 - clamp(d / BREAK));
        else if (held) neck = 7 * clamp((CONNECT - d) / (CONNECT * 0.7));
      }
      m.neck.target = neck;

      // The control follows the pointer a little; the rest is deformation.
      const lx = x - m.cx;
      const ly = y - m.cy;
      const follow = calm ? 0 : m.merged ? 1 : held ? 0.25 * P * P : 0;
      m.offX.target = clamp(lx * 0.12 * follow, -10, 10);
      m.offY.target = clamp(ly * 0.18 * follow, -6, 6);

      for (const s of [m.alpha, m.bulge, m.lobe, m.neck, m.offX, m.offY]) {
        if (calm) s.value = damp(s.value, s.target, 10, dt);
        else s.step(dt);
      }
      // Added to whatever translate the control already has (some are centred with one).
      m.el.style.translate = `calc(${m.baseX} + ${m.offX.value.toFixed(2)}px) calc(${m.baseY} + ${m.offY.value.toFixed(2)}px)`;
      m.el.style.setProperty('--mx', (clamp(lx / m.hx, -1, 1)).toFixed(3));
      m.el.style.setProperty('--my', (clamp(ly / m.hy, -1, 1)).toFixed(3));
      if (m.merged) m.el.dataset.merged = 'true';
      else if (m.el.dataset.merged) delete m.el.dataset.merged;

      const settled = !held && m.alpha.value < 0.01 && Math.abs(m.offX.value) < 0.05 && Math.abs(m.offY.value) < 0.05 && m.neck.value < 0.05 && Math.abs(m.bulge.value) < 0.05;
      return !settled;
    };

    const skinOf = (m: Magnet | null): SkinState | null =>
      m
        ? {
            x: m.cx + m.offX.value,
            y: m.cy + m.offY.value,
            hx: m.hx,
            hy: m.hy,
            radius: m.radius,
            alpha: clamp(m.alpha.value),
            bulge: m.bulge.value + Math.max(0, m.lobe.value),
            sigma: 9 + Math.max(0, m.lobe.value) * 1.5,
            qx: m.qx + m.offX.value,
            qy: m.qy + m.offY.value,
            tint: m.tint,
          }
        : null;

    const state: LiquidState = {
      cx: 0,
      cy: 0,
      r: RING,
      visible: 0,
      dx: 1,
      dy: 0,
      s: 0,
      px: 0,
      py: 0,
      dot: 2.5,
      neck: { ax: 0, ay: 0, bx: 0, by: 0, r0: 0, r1: 0 },
      skins: [null, null],
      lx: 0,
      ly: 0,
    };

    const tick = (_t: number, deltaMs: number) => {
      const dt = Math.min(deltaMs / 1000, 0.05);
      const now = performance.now();
      if (rehit && started) {
        rehit = false;
        setTarget(describe(document.elementFromPoint(x, y)));
      }

      // Which control (if any) holds the pointer's attention?
      const el = started && vis.target > 0 ? findMagnet(now) : null;
      if (el !== active?.el) {
        const prev = active;
        if (el && leaving?.el === el) {
          // Back to the control we were just leaving: pick up where it is.
          active = leaving;
          leaving = prev;
        } else {
          if (prev) {
            drop(leaving);
            leaving = prev;
          }
          active = el ? acquire(el) : null;
        }
      }
      if (active && !stepMagnet(active, dt, true)) {
        drop(active);
        active = null;
      }
      if (leaving && !stepMagnet(leaving, dt, false)) {
        drop(leaving);
        leaving = null;
      }

      // The cursor itself.
      const m = active;
      const calm = reduced();
      let r = RING;
      if (current && !current.magnetic) r = RING * (current.label ? 2.1 : 1.45);
      if (m?.merged) r = 0;
      if (pressed) r *= 0.8;
      cr.target = r;
      // Lean toward a control that's noticed us; trail after one we've left.
      let s = 0;
      const toward = m ?? leaving;
      if (toward && !calm) {
        const tx = (toward.merged ? x : toward.qx) - cx.value;
        const ty = (toward.merged ? y : toward.qy) - cy.value;
        const l = Math.hypot(tx, ty);
        if (l > 1) {
          dirX = damp(dirX, tx / l, 18, dt);
          dirY = damp(dirY, ty / l, 18, dt);
        }
        const P = clamp(1 - toward.dist / FIELD);
        s = toward.releasing ? 0.4 * (1 - clamp(toward.dist / BREAK)) : toward.merged ? 0 : 0.42 * P * P;
      }
      stretch.target = s;
      cx.target = x;
      cy.target = y;
      dx.target = x;
      dy.target = y;
      dr.target = m?.merged || (current && !current.magnetic) ? 0 : pressed ? 2 : 2.5;
      for (const sp of [cx, cy, cr, stretch, dx, dy, dr, vis]) {
        if (calm && sp !== vis && sp !== dx && sp !== dy) sp.value = damp(sp.value, sp.target, 16, dt);
        else sp.step(dt);
      }
      const dl = Math.hypot(dirX, dirY) || 1;

      // Neck between the cursor and whichever control is still attached.
      const nm = [m, leaving].find((k) => k && k.neck.value > 0.05) ?? null;
      state.neck.r0 = nm ? nm.neck.value * clamp(cr.value / RING + 0.35) : 0;
      state.neck.r1 = nm ? nm.neck.value * 1.25 : 0;
      if (nm) {
        state.neck.ax = cx.value;
        state.neck.ay = cy.value;
        state.neck.bx = nm.qx + nm.offX.value;
        state.neck.by = nm.qy + nm.offY.value;
      }

      state.cx = cx.value;
      state.cy = cy.value;
      state.r = Math.max(0, cr.value);
      state.visible = clamp(vis.value);
      state.dx = dirX / dl;
      state.dy = dirY / dl;
      state.s = clamp(stretch.value, 0, 0.6);
      state.px = dx.value;
      state.py = dy.value;
      state.dot = Math.max(0, dr.value);
      state.skins[0] = skinOf(m);
      state.skins[1] = skinOf(leaving);
      state.lx = keyLight.lightX.value * innerWidth;
      state.ly = keyLight.lightY.value * innerHeight;

      if (liquid && !liquid.lost) {
        // Frame the window round everything that's drawn.
        let minX = state.cx - 60;
        let maxX = state.cx + 60;
        let minY = state.cy - 60;
        let maxY = state.cy + 60;
        for (const sk of state.skins) {
          if (!sk || sk.alpha < 0.005) continue;
          minX = Math.min(minX, sk.x - sk.hx - 24);
          maxX = Math.max(maxX, sk.x + sk.hx + 24);
          minY = Math.min(minY, sk.y - sk.hy - 24);
          maxY = Math.max(maxY, sk.y + sk.hy + 24);
        }
        const sig = [state.cx, state.cy, state.r, state.visible, state.s, state.px, state.py, state.dot, state.neck.r0, state.lx, state.ly, ...state.skins.flatMap((k) => (k ? [k.x, k.y, k.alpha, k.bulge] : [0]))]
          .map((v) => v.toFixed(2))
          .join();
        if (sig !== lastSig) {
          lastSig = sig;
          liquid.place(minX, minY, maxX, maxY);
          liquid.render(state);
        }
      }

      // DOM lens: the fallback when there is no liquid layer.
      const lensVis = liquid && !liquid.lost ? 0 : vis.value * (m?.merged ? 0 : 1);
      if (ring.current) {
        ring.current.style.transform = `translate3d(${cx.value}px, ${cy.value}px, 0) translate(-50%, -50%) scale(${(Math.max(0.01, cr.value) / RING).toFixed(3)})`;
        ring.current.style.opacity = String(lensVis);
      }
      if (dot.current) {
        dot.current.style.transform = `translate3d(${dx.value}px, ${dy.value}px, 0) translate(-50%, -50%) scale(${(Math.max(0, dr.value) / 2.5).toFixed(3)})`;
        dot.current.style.opacity = String(lensVis);
      }
      if (tag.current) {
        tag.current.style.transform = `translate3d(${cx.value}px, ${cy.value}px, 0) translate(-50%, -50%)`;
        tag.current.style.opacity = String(vis.value);
      }
    };
    gsap.ticker.add(tick);
    if (import.meta.env.DEV) (window as unknown as { __cursor: unknown }).__cursor = { state, get active() { return active?.el ?? null; }, get leaving() { return leaving?.el ?? null; } };
    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('pointerleave', onLeave);
      root.classList.remove('has-cursor', 'has-liquid');
      drop(active);
      drop(leaving);
      liquid?.dispose();
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div ref={host} className="cursor" aria-hidden="true">
      <div ref={ring} className="cursor-ring" />
      <div ref={dot} className="cursor-dot" />
      <div ref={tag} className="cursor-tag" data-show="false" />
    </div>
  );
}
