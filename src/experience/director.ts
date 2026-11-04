import type { RoomId } from './state';

/**
 * The director is the single source of truth for what the 3D stage should be
 * doing. Sections and route transitions write directives; the stage reads the
 * current one every frame and springs toward it. Keeping this outside React
 * means scrolling never re-renders components.
 */
export type FormationId =
  | 'awaken'
  | 'stack'
  | 'fan'
  | 'horizon'
  | 'building'
  | 'plate'
  | 'monolith'
  | 'drift'
  | 'python';

export interface Directive {
  formation: FormationId;
  room: RoomId;
  /** Stack position in normalised viewport coordinates (-1..1). */
  anchor: [number, number];
  /** Uniform scale multiplier for the stack. */
  scale: number;
  /** 0..1, how present the stack is (dims and recedes behind reading text). */
  presence: number;
  /** Show the WebGL name behind the stack (home hero). */
  title: number;
  /** Extra energy for formation-specific motion (seismic sway, scan speed). */
  energy: number;
  /** Index of a slab to single out (story highlights); -1 for none. */
  focus: number;
  /** 0..1 blend of the environment into the porcelain daylight room. */
  daylight: number;
}

export const defaultDirective: Directive = {
  formation: 'stack',
  room: 'home',
  anchor: [0, 0],
  scale: 1,
  presence: 1,
  title: 0,
  energy: 0,
  focus: -1,
  daylight: 0,
};

type Listener = (d: Directive) => void;

/**
 * Continuous channels: values that change every frame (scroll progress, the
 * opening's progress). They are read by the stage directly and never trigger
 * listeners, so driving them costs nothing.
 */
export interface Channels {
  /** Returns the story position from the page (null when no story is mounted). */
  story: (() => number) | null;
  /** Number of beats the story has. */
  beats: number;
  /** Which plate's characters are etched into the plate formation ('home' | 'hero'). */
  plateSet: string;
  /** A plate chamber singled out from the page (hovered crop); -1 = none. */
  plateFocus: number;
  /** The opening (see formations.ts `awaken`); `light` dims the studio while it runs. */
  intro: { arrive: number; orbit: number; ready: number; unwrap: number; light: number };
}

class Director {
  current: Directive = { ...defaultDirective };
  /**
   * Temporary exclusive control, keyed by owner ('route', 'intro', 'egg'…).
   * The most recent lock wins; releasing one never cancels another owner's.
   */
  private locks = new Map<string, Directive>();
  private listeners = new Set<Listener>();
  /** Increments on every change; lets consumers detect formation switches cheaply. */
  revision = 0;
  readonly channels: Channels = {
    story: null,
    beats: 5,
    plateSet: 'home',
    plateFocus: -1,
    intro: { arrive: 0, orbit: 0, ready: 0, unwrap: 0, light: 1 },
  };

  get active(): Directive {
    let last: Directive | null = null;
    for (const d of this.locks.values()) last = d;
    return last ?? this.current;
  }

  set(patch: Partial<Directive>) {
    this.current = { ...this.current, ...patch };
    this.emit();
  }

  lock(d: Partial<Directive>, owner = 'default') {
    this.locks.delete(owner);
    this.locks.set(owner, { ...this.active, ...d });
    this.emit();
  }

  release(next?: Partial<Directive>, owner = 'default') {
    if (next) this.current = { ...this.current, ...next };
    this.locks.delete(owner);
    this.emit();
  }

  isLocked(owner?: string) {
    return owner ? this.locks.has(owner) : this.locks.size > 0;
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    this.revision++;
    const a = this.active;
    this.listeners.forEach((l) => l(a));
  }
}

export const director = new Director();
