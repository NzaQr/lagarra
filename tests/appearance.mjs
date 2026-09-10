import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const report = [];
try {
  for (const [name, width, height, previousFinish] of [
    ["desktop", 1440, 1000, "jade"],
    ["phone", 390, 844, "ember"],
    ["small-phone", 320, 568, "jade"],
    ["landscape", 844, 390, "pearl"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: name !== "desktop",
      isMobile: name !== "desktop",
    });
    await context.addInitScript((previousFinish) => {
      localStorage.setItem("lagarra.keyboard-tutorial.v1", "accepted");
      localStorage.setItem(
        "lagarra.settings.v1",
        JSON.stringify({
          machineStyle: previousFinish,
          muted: true,
          volume: 0.3,
        }),
      );
    }, previousFinish);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.GAME_URL || "http://localhost:4178");
    await page.waitForFunction(
      () => window.__clawGame?.getSnapshot().state === "positioning",
    );
    await page.waitForTimeout(2200);
    assert.equal((await page.locator(".brand").innerText()).trim(), "");
    assert.equal(await page.locator(".machine-finishes").count(), 0);
    const state = await page.evaluate(() => ({
      shell: window.__clawGame.renderer.white.color.getHexString(),
      ui: getComputedStyle(document.documentElement)
        .getPropertyValue("--arcade-ink")
        .trim(),
      settings: JSON.parse(localStorage.getItem("lagarra.settings.v1")),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.equal(state.shell, "e5eaf0");
    assert.equal(state.ui, "#121922");
    assert.equal(state.settings.machineStyle, undefined);
    assert.equal(state.settings.muted, true);
    assert.equal(state.settings.volume, 0.3);
    assert.equal(state.overflow, false);
    await page.screenshot({ path: `artifacts/pearl-${name}.png` });
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.screenshot({ path: `artifacts/pearl-${name}-settings.png` });
    await page.getByRole("button", { name: "Close panel" }).click();
    await page
      .getByRole("button", { name: "Change view", exact: true })
      .click();
    await page.waitForFunction(
      () => window.__clawGame.getSnapshot().camera === 1,
    );
    await page.waitForTimeout(500);
    await page.screenshot({ path: `artifacts/pearl-${name}-side.png` });
    await page.getByRole("button", { name: "Drop claw", exact: true }).click();
    await page.waitForFunction(
      () => window.__clawGame.getSnapshot().state === "dropping",
    );
    assert.deepEqual(errors, []);
    report.push({ name, ...state, errors });
    await context.close();
  }
  await writeFile(
    "artifacts/appearance-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
