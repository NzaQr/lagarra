import { describe, expect, it } from "vitest";
import { RenderBudget } from "../src/rendering/RenderBudget";

describe("scene resolution budget", () => {
  it("limits total pixels on a high-resolution display", () => {
    const budget = new RenderBudget();
    const ratio = budget.reset(1440, 1000, 2, "high");
    expect(1440 * 1000 * ratio ** 2).toBeLessThanOrEqual(1_600_001);
    expect(budget.reset(390, 844, 3, "balanced")).toBeLessThanOrEqual(1.25);
  });
  it("reduces sustained slow frames without reacting to a single stall", () => {
    const budget = new RenderBudget();
    const initial = budget.reset(1440, 1000, 2, "high");
    expect(budget.observe(270)).toBeNull();
    for (let i = 0; i < 100; i++) expect(budget.observe(16.67)).toBeNull();
    const changes = Array.from({ length: 90 }, () => budget.observe(50)).filter(
      (value) => value !== null,
    );
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]).toBeLessThan(initial);
    expect(changes.at(-1)).toBeGreaterThanOrEqual(initial * 0.55);
  });
  it("keeps a stable resolution when fast frames return", () => {
    const budget = new RenderBudget();
    budget.reset(390, 844, 3, "balanced");
    for (let i = 0; i < 1000; i++) budget.observe(50);
    for (let i = 0; i < 1000; i++) expect(budget.observe(16.67)).toBeNull();
  });
});
