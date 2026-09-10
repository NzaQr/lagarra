import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const report = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
      deviceScaleFactor: mobile ? 2 : 1,
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.GAME_URL || "http://localhost:4178");
    await page.waitForFunction(
      () => window.__clawGame?.getSnapshot().state === "positioning",
    );
    // Positioning is available before the initial pile stops moving.
    // Measure idle shadow reuse only after all dynamic prizes are asleep.
    await page.waitForFunction(
      () => window.__clawGame.simulation.debugInfo().activeBodies === 0,
      null,
      { timeout: 30000 },
    );
    const result = await page.evaluate(async () => {
      const game = window.__clawGame;
      const graphics = game.renderer.renderer;
      graphics.info.autoReset = false; // Include shadow passes in the count.
      const update = game.renderer.update.bind(game.renderer);
      const step = game.simulation.step.bind(game.simulation);
      let recording = false,
        samples = [],
        physics = [],
        draws = [],
        triangles = [];
      game.renderer.update = (...args) => {
        graphics.info.reset();
        const start = performance.now();
        update(...args);
        if (recording) {
          samples.push(performance.now() - start);
          draws.push(graphics.info.render.calls);
          triangles.push(graphics.info.render.triangles);
        }
      };
      game.simulation.step = (...args) => {
        const start = performance.now();
        step(...args);
        if (recording) physics.push(performance.now() - start);
      };
      const stats = (values) => ({
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        p95: [...values].sort((a, b) => a - b)[
          Math.floor(values.length * 0.95)
        ],
      });
      const phases = {};
      for (const phase of ["idle", "moving"]) {
        samples = [];
        physics = [];
        draws = [];
        triangles = [];
        const frames = [];
        recording = true;
        await new Promise((resolve) => {
          let previous = 0,
            count = 0;
          const tick = (now) => {
            if (previous) frames.push(now - previous);
            previous = now;
            if (phase === "moving")
              game.actions.move(Math.floor(count / 25) % 2 ? -1 : 1, 0);
            if (++count < 181) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        recording = false;
        game.actions.move(0, 0);
        phases[phase] = {
          renderCpuMs: stats(samples),
          physicsCpuMs: stats(physics),
          frameMs: stats(frames),
          drawCalls: stats(draws),
          triangles: stats(triangles),
        };
      }
      return {
        quality: game.renderer.getPerformance().quality,
        phases,
        geometries: graphics.info.memory.geometries,
        textures: graphics.info.memory.textures,
      };
    });
    assert.deepEqual(errors, []);
    report.push({ mobileEmulation: mobile, ...result });
    await context.close();
  }
  await writeFile(
    new URL(
      `../artifacts/performance-${process.env.PERF_LABEL || "current"}.json`,
      import.meta.url,
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (process.env.PERF_CHECK)
    for (const result of report) {
      assert.ok(
        result.phases.idle.drawCalls.mean <
          result.phases.moving.drawCalls.mean * 0.8,
        "Idle frames must reuse the shadow map",
      );
      assert.ok(
        result.phases.moving.drawCalls.p95 < 350,
        "The cabinet must stay within the moving-frame draw budget",
      );
    }
} finally {
  await browser.close();
}
