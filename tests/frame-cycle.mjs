import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const report = [];
try {
  for (const mobile of process.env.PERF_DEVICE === "phone"
    ? [true]
    : process.env.PERF_DEVICE === "desktop"
      ? [false]
      : [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
      deviceScaleFactor: mobile ? 3 : 2,
      isMobile: mobile,
      hasTouch: mobile,
    });
    await context.addInitScript(() => {
      localStorage.setItem("lagarra.keyboard-tutorial.v1", "accepted");
      localStorage.setItem(
        "lagarra.settings.v1",
        JSON.stringify({ machineStyle: "pearl", muted: true, volume: 0 }),
      );
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.log("PAGE ERROR", error.message);
    });
    await page.goto(process.env.GAME_URL || "http://localhost:4178");
    await page.waitForFunction(
      () => window.__clawGame?.getSnapshot().state === "positioning",
    );
    await page.evaluate(() => {
      const game = window.__clawGame;
      const update = game.renderer.update.bind(game.renderer);
      window.__frameSamples = [];
      game.renderer.update = (...args) => {
        const start = performance.now();
        update(...args);
        const info = game.renderer.renderer.info;
        window.__frameSamples.push({
          ms: performance.now() - start,
          time: start,
          calls: info.render.calls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          programs: info.programs.length,
          state: game.getSnapshot().state,
        });
      };
    });
    const phases = {};
    async function sample(name, count = 60) {
      console.log("sample", mobile ? "phone" : "desktop", name);
      phases[name] = await page.evaluate(async (count) => {
        window.__frameSamples = [];
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `Frame loop stopped: ${window.__frameSamples.length} samples`,
                ),
              ),
            20000,
          );
          const tick = () => {
            if (window.__frameSamples.length >= count) {
              clearTimeout(timeout);
              resolve();
            } else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const samples = window.__frameSamples;
        const stats = (values) => ({
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          p95: [...values].sort((a, b) => a - b)[
            Math.floor(values.length * 0.95)
          ],
          max: Math.max(...values),
        });
        return {
          cpu: stats(samples.map((v) => v.ms)),
          frames: stats(
            samples.slice(1).map((v, i) => v.time - samples[i].time),
          ),
          calls: stats(samples.map((v) => v.calls)),
          triangles: samples.at(-1).triangles,
          memory: {
            geometries: samples.at(-1).geometries,
            textures: samples.at(-1).textures,
            programs: samples.at(-1).programs,
          },
        };
      }, count);
      console.log(name, JSON.stringify(phases[name]));
      await writeFile(
        `artifacts/frame-cycle-${process.env.PERF_LABEL || "current"}-partial.json`,
        JSON.stringify({ mobile, phases, errors }, null, 2),
      );
    }
    await page.waitForFunction(
      () => window.__clawGame.simulation.debugInfo().activeBodies === 0,
      null,
      { timeout: 30000 },
    );
    await sample("idle");
    await page.evaluate(() => window.__clawGame.actions.move(1, 0));
    await sample("moving");
    await page.evaluate(() => window.__clawGame.actions.move(0, 0));
    if (process.env.PERF_FULL_PILE) {
      await page.evaluate(() => window.__clawGame.actions.refill());
      await page.waitForFunction(
        () => window.__clawGame.simulation.debugInfo().activeBodies === 0,
      );
      await page
        .getByRole("button", { name: "Drop claw", exact: true })
        .click();
      await sample("full-pile-attempt", 900);
      await page.waitForFunction(() =>
        ["positioning", "result"].includes(
          window.__clawGame.getSnapshot().state,
        ),
      );
      if (
        await page
          .getByRole("button", { name: "Play again", exact: true })
          .count()
      )
        await page
          .getByRole("button", { name: "Play again", exact: true })
          .click();
      await page.waitForFunction(
        () => window.__clawGame.getSnapshot().state === "positioning",
      );
      await sample("full-pile-after", 120);
    }
    for (const outcome of ["win", "miss", "win"]) {
      const index = Object.keys(phases).length;
      await page.evaluate((outcome) => {
        const { simulation, renderer } = window.__clawGame;
        const idle = { moveX: 0, moveZ: 0, drop: false, switchCamera: false };
        simulation.refill();
        renderer.update(simulation.getFrame(), 1 / 60, 0);
        simulation.debugSetPrizes([
          {
            position: {
              x: outcome === "win" ? 0 : 0.9,
              y: 1.7,
              z: outcome === "win" ? 0 : -0.65,
            },
          },
        ]);
        for (let i = 0; i < 240; i++) simulation.step(1 / 60, idle);
        simulation.step(1 / 60, { ...idle, drop: true });
        for (
          let i = 0;
          i < 1400 && simulation.snapshot().state !== "releasing";
          i++
        )
          simulation.step(1 / 60, idle);
        renderer.update(simulation.getFrame(), 1 / 60, 0);
      }, outcome);
      await sample(`${outcome}-${index}-release`, 120);
      if (outcome === "win") {
        await page
          .getByRole("button", { name: "Play again", exact: true })
          .waitFor({ timeout: 15000 });
        await sample(`${outcome}-${index}-result`);
        await page
          .getByRole("button", { name: "Play again", exact: true })
          .click();
        await sample(`${outcome}-${index}-store`);
      }
      await page.waitForFunction(
        () => window.__clawGame.getSnapshot().state === "positioning",
        null,
        { timeout: 20000 },
      );
      await sample(`${outcome}-${index}-after`);
    }
    report.push({ mobile, phases, errors });
    await context.close();
  }
  const path = `artifacts/frame-cycle-${process.env.PERF_LABEL || "current"}.json`;
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(`Saved ${path}`);
  if (process.env.PERF_CHECK)
    for (const result of report) {
      assert.deepEqual(result.errors, []);
      for (const [name, phase] of Object.entries(result.phases)) {
        assert.ok(
          phase.frames.mean < 20,
          `${result.mobile ? "phone" : "desktop"} ${name}: average frame time exceeds 20 ms`,
        );
        assert.ok(
          phase.cpu.max < 50,
          `${name}: main thread stall exceeds 50 ms`,
        );
        assert.ok(
          phase.memory.programs <= result.phases.idle.memory.programs + 2,
          `${name}: a win must not recompile the scene lighting`,
        );
      }
    }
} finally {
  await browser.close();
}
