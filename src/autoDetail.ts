/**
 * Auto detail: keeps the headset at its full frame rate by changing how many
 * splats are drawn.
 *
 * Every half second it looks at recent frame times. If frames are running long
 * (the 75th percentile is over the frame budget by 20%), it cuts the share of
 * splats in proportion to how slow they are, and remembers that level as a
 * ceiling. If the typical frame (the median) has been on time for 1.5 s, it moves
 * halfway towards just under the ceiling (or up 20% if there isn't one). If a cut
 * doesn't make frames faster, something other than splats is the limit, so it
 * goes back to the level before the cut and stops cutting for this scan. A headset's frames are locked
 * to its refresh rate, so "on time" can't say how much spare time there is; the
 * ceiling stops it climbing back into a stutter. The ceiling loosens by 5% every
 * 30 s, so it will find more room if the view gets easier.
 *
 * It also remembers how many splats ran smoothly (the budget), so the next scan
 * starts close to the right level instead of at 100%.
 */
export class AutoDetail {
  enabled = true;
  /** Splats that last held the frame rate; the starting guess for the next scan. */
  budget = 100_000;
  /** Measured frames per second over the last window, for display. */
  fps = 0;

  private times: number[] = [];
  private windowStart = 0;
  private ignoreUntil = 0;
  private goodSince = 0;
  /** Lowest share that ran too slow for this scan (1 = none found yet). */
  private ceiling = 1;
  private ceilingSince = 0;
  /** The last cut (or chain of unimproved cuts), to check whether cutting helped. */
  private lastCut: { from: number; p75: number } | null = null;
  private cutsWithoutImprovement = 0;
  /** Cutting stopped helping at this share; don't go below it for this scan. */
  private floor = 0;

  /** Starting share for a scan of `splats` splats, from the remembered budget. */
  start(splats: number, now: number) {
    this.times = [];
    this.goodSince = 0;
    this.ceiling = 1;
    this.ceilingSince = now;
    this.lastCut = null;
    this.cutsWithoutImprovement = 0;
    this.floor = 0;
    this.windowStart = now;
    this.ignoreUntil = now + 600; // loading and the first sort are slow
    return clamp(this.budget / Math.max(1, splats), 0.01, 1);
  }

  /**
   * Feeds one frame. Returns a new share of splats to draw, or null for no change.
   * `dtMs` is the time since the last frame; `targetFps` the display's refresh rate.
   */
  frame(now: number, dtMs: number, targetFps: number, density: number, splats: number): number | null {
    if (!this.enabled) return null;
    if (dtMs > 250) return null; // paused (headset off, tab hidden)
    if (now < this.ignoreUntil) return null;
    this.times.push(dtMs);
    if (now - this.windowStart < 500 || this.times.length < 10) return null;

    const sorted = [...this.times].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    const mean = this.times.reduce((a, b) => a + b, 0) / this.times.length;
    this.fps = 1000 / mean;
    this.times = [];
    this.windowStart = now;
    const budgetMs = 1000 / targetFps;
    if (this.ceiling < 1 && now - this.ceilingSince > 30000) {
      this.ceiling = Math.min(1, this.ceiling * 1.05);
      this.ceilingSince = now;
    }

    let next: number | null = null;
    const cut = this.lastCut;
    this.lastCut = null;
    if (p75 > budgetMs * 1.2) {
      this.goodSince = 0;
      let rollbackFrom = density;
      if (cut) {
        if (p75 > cut.p75 * 0.9) {
          this.cutsWithoutImprovement++;
          if (this.cutsWithoutImprovement >= 2) {
            // Consecutive cuts didn't help: splats aren't what's slow. Undo them and stop here.
            this.cutsWithoutImprovement = 0;
            this.floor = cut.from;
            return this.finish(now, cut.from);
          }
          rollbackFrom = cut.from;
        } else {
          this.cutsWithoutImprovement = 0;
        }
      }
      if (density <= this.floor + 1e-6) return null;
      // Too slow: remember this level, and drop in proportion to how slow it was.
      this.ceiling = Math.min(this.ceiling, density);
      this.ceilingSince = now;
      next = Math.max(this.floor, Math.min(density * clamp(budgetMs / p75, 0.35, 0.85), this.ceiling * 0.85));
      this.lastCut = { from: rollbackFrom, p75 };
    } else if (p50 <= budgetMs * 1.1) {
      this.cutsWithoutImprovement = 0;
      // Learn from smooth running, but don't let a starved scan drag the budget down.
      if (!this.floor) this.budget = Math.max(this.budget * 0.97, density * splats);
      if (!this.goodSince) this.goodSince = now;
      if (density < 1 && now - this.goodSince > 1500) {
        // Halfway to just under the known limit, or +20% when there isn't one.
        const up = this.ceiling < 1 ? density + (this.ceiling * 0.9 - density) * 0.5 : Math.min(1, density * 1.2);
        if (up > density * 1.02) {
          next = up;
          this.goodSince = now;
        }
      }
    } else {
      this.cutsWithoutImprovement = 0;
      this.goodSince = 0;
    }
    return next === null ? null : this.finish(now, next);
  }

  private finish(now: number, next: number) {
    this.ignoreUntil = now + 300; // a change regenerates and re-sorts; skip that hitch
    return clamp(next, 0.01, 1);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
