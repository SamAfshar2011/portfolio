/**
 * Adaptive resolution that always finds its way back.
 *
 * The stage renders at one of a few pixel ratios. This governor lowers the
 * ratio when frames are genuinely being dropped and raises it again when
 * they are not — measured against the display's own refresh interval (and
 * never demanding more than ~50 fps), so a screen that is keeping up counts
 * as keeping up.
 *
 * The previous controller only stepped back up after frames faster than
 * 1/70 s, which a vsync-limited 60 Hz display can never produce: one slow
 * moment (a transition, a compile, a blurred overlay) left the stage at a
 * lower resolution — soft, aliased glass — until the page was reloaded.
 *
 * What it deliberately ignores:
 *   - route transitions and the opening (layout, compiles and blurred DOM
 *     overlays make a second or two slow on purpose)
 *   - hidden tabs, resizes and the frames right after a resolution change
 *
 * Stepping up is a probe: if the higher ratio immediately causes drops, the
 * governor steps back and remembers that ceiling for a while — until the
 * visitor moves to another page, when the ceiling is forgotten and quality
 * is tried again. A transient slow moment can therefore never leave the site
 * blurry until a refresh.
 */
export class ResolutionGovernor {
  /** Current step index into the stage's pixel-ratio ladder. */
  index: number;
  private samples: number[] = [];
  private quietUntil = 0;
  private overFor = 0;
  private underFor = 0;
  private ceiling: number;
  private ceilingUntil = 0;
  private lastUp = -Infinity;
  /**
   * Best frame interval seen (≈ the display's refresh). It rises only very
   * slowly, so a renderer that is uniformly slow is still recognised as slow,
   * while a display that really runs slower (a 30 Hz power-saving mode) is
   * learned within a few seconds.
   */
  private best = 1 / 60;
  private seeded = false;

  constructor(
    start: number,
    /** Highest step this device may use. */
    readonly cap: number,
  ) {
    this.index = Math.min(start, cap);
    this.ceiling = cap;
  }

  /** Stop measuring for a moment (and discard what was measured). */
  hold(now: number, seconds: number) {
    this.quietUntil = Math.max(this.quietUntil, now + seconds);
    this.samples.length = 0;
    this.overFor = this.underFor = 0;
  }

  /** A new page: forget any ceiling learned on the previous one. */
  release() {
    this.ceiling = this.cap;
    this.ceilingUntil = 0;
  }

  /** Estimated display refresh interval (s). */
  get refresh() {
    return this.best;
  }

  /** Feed one frame. Returns -1 / +1 when the step should change, else 0. */
  update(dt: number, now: number): -1 | 0 | 1 {
    if (dt <= 0 || dt > 0.25 || now < this.quietUntil) return 0;
    this.samples.push(dt);
    if (this.samples.length > 120) this.samples.shift();
    if (this.samples.length < 60) return 0;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const fast = Math.min(1 / 24, Math.max(1 / 250, sorted[Math.floor(sorted.length * 0.1)]));
    if (!this.seeded || fast < this.best) {
      this.best = fast;
      this.seeded = true;
    } else this.best += (fast - this.best) * Math.min(1, dt * 0.25);

    // Dropped = well past the refresh interval. Anything at ~50 fps or better
    // is fine: a 120 Hz screen running at 60 is not worth a blurrier image.
    const limit = Math.max(this.best * 1.4, 1 / 50);
    let dropped = 0;
    for (const s of this.samples) if (s > limit) dropped++;
    const share = dropped / this.samples.length;

    if (share > 0.3) {
      this.overFor += dt;
      this.underFor = 0;
    } else if (share < 0.04) {
      this.underFor += dt;
      this.overFor = 0;
    } else {
      this.overFor = this.underFor = 0;
    }

    if (this.overFor > 1.5 && this.index > 0) {
      // The last step up did not hold: remember the ceiling for a while.
      if (now - this.lastUp < 6) {
        this.ceiling = this.index - 1;
        this.ceilingUntil = now + 45;
      }
      this.index--;
      this.hold(now, 1);
      return -1;
    }
    const cap = now < this.ceilingUntil ? this.ceiling : this.cap;
    if (this.underFor > 2 && this.index < cap) {
      this.index++;
      this.lastUp = now;
      this.hold(now, 1);
      return 1;
    }
    return 0;
  }
}
