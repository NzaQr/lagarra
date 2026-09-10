import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const results = [];
try {
  for (const [width, height, mobile] of [
    [1440, 1000, false],
    [390, 844, true],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: mobile ? 2 : 1,
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => errors.push(request.url()));
    await page.goto(
      process.env.PRODUCTION_URL || "http://localhost:4179/?debug",
    );
    const tutorial = page.getByRole("dialog", { name: "How to play" });
    if (await tutorial.count())
      await tutorial
        .getByRole("button", { name: "Got it, let’s play" })
        .click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Drop claw"]')?.disabled === false,
    );
    assert.equal(await page.evaluate(() => "__clawGame" in window), false);
    assert.equal(await page.locator(".debug-stats").count(), 0);
    const timing = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const deltas = [];
          let previous = 0;
          function sample(time) {
            if (previous) deltas.push(time - previous);
            previous = time;
            if (deltas.length < 180) requestAnimationFrame(sample);
            else {
              const sorted = [...deltas].sort((a, b) => a - b);
              resolve({
                averageFps: +(
                  1000 /
                  (deltas.reduce((sum, value) => sum + value, 0) /
                    deltas.length)
                ).toFixed(1),
                p95FrameMs:
                  +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
                samples: deltas.length,
              });
            }
          }
          requestAnimationFrame(sample);
        }),
    );
    await page.getByRole("button", { name: "Drop claw" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Drop claw"]')?.disabled === true,
    );
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Drop claw"]')?.disabled ===
          false || document.querySelector('[aria-label="Attempt result"]'),
      null,
      { timeout: 30000 },
    );
    assert.deepEqual(errors, []);
    results.push({
      viewport: `${width}×${height}`,
      mobileEmulation: mobile,
      timing,
      productionCycle: "passed",
      debugToolsAbsent: true,
      browserErrors: errors,
    });
    await context.close();
  }
  await writeFile(
    new URL("../artifacts/production-report.json", import.meta.url),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
