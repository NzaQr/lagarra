import type { Quality } from "../game-core/types";

/** Keep the 3D buffer within a pixel budget. The DOM stays at native resolution. */
export class RenderBudget {
  private ceiling = 1;
  private ratio = 1;
  private slowTime = 0;
  private average = 1000 / 60;

  reset(width: number, height: number, deviceRatio: number, quality: Quality) {
    const pixels = quality === "high" ? 1_600_000 : 600_000;
    this.ceiling = Math.min(
      deviceRatio,
      quality === "high" ? 1.5 : 1.25,
      Math.sqrt(pixels / Math.max(1, width * height)),
    );
    this.ratio = this.ceiling;
    this.slowTime = 0;
    this.average = 1000 / 60;
    return this.ratio;
  }

  observe(frameMs: number): number | null {
    // Ignore suspension, startup, and individual long tasks.
    if (frameMs <= 0 || frameMs > 100) return null;
    this.average += (frameMs - this.average) * 0.08;
    this.slowTime = this.average > 19 ? this.slowTime + frameMs : 0;
    if (this.slowTime < 750) return null;
    this.slowTime = 0;
    const next = Math.max(this.ceiling * 0.55, this.ratio * 0.82);
    if (Math.abs(next - this.ratio) < 0.01) return null;
    this.ratio = next;
    return next;
  }
}
