import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const report = [];
try {
  for (const [name, width, height, count] of [
    ["centered-grab", 1440, 1000, 1],
    ["stacked-desktop", 1440, 1000, 3],
    ["stacked-phone", 390, 844, 3],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(() => {
      localStorage.setItem("lagarra.keyboard-tutorial.v1", "accepted");
      localStorage.setItem(
        "lagarra.settings.v1",
        JSON.stringify({ quality: "balanced", muted: true }),
      );
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.GAME_URL || "http://localhost:4178");
    await page.waitForFunction(
      () => window.__clawGame?.getSnapshot().state === "positioning",
    );
    // Advance actual physics and rendering at explicit checkpoints. The check
    // remains valid when a software browser cannot render at game speed.
    const result = await page.evaluate(async (count) => {
      const { MACHINE, EMPTY_INPUT } = await import("/src/game-core/types.ts");
      const { PRIZE_DEFINITIONS } = await import("/src/game-core/prizes.ts");
      const { simulation, renderer } = window.__clawGame;
      simulation.debugSetPrizes([]);
      renderer.update(simulation.getFrame(), 0, 0);
      simulation.debugSetPrizes(
        count === 1
          ? [{ position: { x: 0, y: 1.7, z: 0 } }]
          : [-1, 0, 1].map((side) => ({
              definition: PRIZE_DEFINITIONS[3],
              position: {
                x: MACHINE.chuteX + side * 0.225,
                y: MACHINE.bedY + (side === 0 ? 0.75 : 0.3),
                z: MACHINE.chuteZ,
              },
            })),
      );
      if (count === 1) {
        for (let i = 0; i < 240; i++) simulation.step(1 / 60, EMPTY_INPUT);
      }
      renderer.update(simulation.getFrame(), 0, 0);
      simulation.step(1 / 60, { ...EMPTY_INPUT, drop: true });
      for (
        let i = 0;
        i < 1200 && simulation.snapshot().collected.length === 0;
        i++
      ) {
        simulation.step(1 / 60, EMPTY_INPUT);
      }
      renderer.update(simulation.getFrame(), 0, 0);
      const celebrations = [...renderer.celebrations.values()];
      const startsBelowBed =
        celebrations.length > 0 &&
        celebrations.every((item) => item.mesh.position.y < MACHINE.bedY);
      renderer.update(simulation.getFrame(), 0.95, 0);
      const passesFrontOpening =
        celebrations.length > 0 &&
        celebrations.every(
          (item) => item.mesh.position.z > 1.5 && item.mesh.position.y < 0.9,
        );
      for (
        let i = 0;
        i < 1400 && simulation.snapshot().state !== "result";
        i++
      ) {
        simulation.step(1 / 60, EMPTY_INPUT);
      }
      renderer.update(simulation.getFrame(), 3, 0);
      return {
        startsBelowBed,
        passesFrontOpening,
        state: simulation.snapshot().state,
        collected: simulation.snapshot().collected.length,
        remaining: simulation.snapshot().remaining,
        trophies: renderer.celebrations.size,
      };
    }, count);
    assert.deepEqual(result, {
      startsBelowBed: true,
      passesFrontOpening: true,
      state: "result",
      collected: count,
      remaining: 0,
      trophies: count,
    });
    await page.getByRole("button", { name: /Play again/i }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Your collection, 0 prizes" })
        .count(),
      1,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `artifacts/chute-${name}.png` });
    await page.getByRole("button", { name: /Play again/i }).click();
    await page.waitForFunction(
      (count) =>
        document.querySelector(".collection-count")?.textContent ===
        String(count),
      count,
    );
    assert.equal(
      await page
        .getByRole("button", { name: `Your collection, ${count} prizes` })
        .count(),
      1,
    );
    report.push({ name, ...result, errors });
    await context.close();
  }
  await writeFile(
    "artifacts/chute-browser-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
