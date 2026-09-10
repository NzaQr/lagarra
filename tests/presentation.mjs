import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const report = [];
try {
  for (const [name, width, height, reducedMotion] of [
    ["portrait-win", 390, 844, "no-preference"],
    ["landscape-win", 844, 390, "no-preference"],
    ["reduced-motion-win", 1440, 1000, "reduce"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion,
      hasTouch: width < 1000,
      isMobile: width < 1000,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.GAME_URL || "http://localhost:4178");
    const tutorial = page.getByRole("dialog", { name: "How to play" });
    if (await tutorial.count())
      await tutorial
        .getByRole("button", { name: "Got it, let’s play" })
        .click();
    await page.waitForFunction(
      () => window.__clawGame?.getSnapshot().state === "positioning",
    );
    // Run the physical fixture to release, then watch the actual render loop collect it.
    await page.evaluate(() => {
      const { simulation, renderer } = window.__clawGame;
      const idle = { moveX: 0, moveZ: 0, drop: false, switchCamera: false };
      simulation.debugSetPrizes([{ position: { x: 0, y: 1.7, z: 0 } }]);
      for (let i = 0; i < 240; i++) simulation.step(1 / 60, idle);
      simulation.step(1 / 60, { ...idle, switchCamera: true });
      simulation.step(1 / 60, { ...idle, drop: true });
      for (
        let i = 0;
        i < 1200 && simulation.snapshot().state !== "releasing";
        i++
      )
        simulation.step(1 / 60, idle);
      renderer.update(simulation.getFrame(), 1 / 60, 1);
    });
    await page
      .getByRole("button", { name: /Play again/i })
      .waitFor({ timeout: 15000 });
    assert.equal(await page.locator(".collection-count").textContent(), "0");
    await page.waitForTimeout(400);
    const presentation = await page.evaluate(() => {
      const { renderer, getSnapshot } = window.__clawGame;
      const celebration = [...renderer.celebrations.values()][0];
      const mesh = celebration.mesh;
      const center = mesh.position.clone().project(renderer.camera);
      return {
        camera: getSnapshot().camera,
        wins: getSnapshot().collected.length,
        center: { x: center.x, y: center.y },
        confetti: celebration.confetti.some((piece) => piece.visible),
        distance: mesh.position.distanceTo(renderer.camera.position),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(presentation.camera, 1);
    assert.equal(presentation.wins, 1);
    assert.ok(
      Math.abs(presentation.center.x) < 0.01 &&
        presentation.center.y > 0.2 &&
        presentation.center.y < 0.5,
    );
    assert.ok(presentation.distance < 4.1);
    assert.equal(presentation.overflow, false);
    if (reducedMotion === "reduce") assert.equal(presentation.confetti, false);
    await page.screenshot({ path: `artifacts/${name}.png` });
    const drag = async (selector) => {
      const box = await page.locator(selector).boundingBox();
      if (width < 1000) {
        const cdp = await context.newCDPSession(page);
        const point = {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          id: 1,
        };
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [point],
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ ...point, x: point.x + 70, y: point.y + 20 }],
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchCancel",
          touchPoints: [],
        });
        await cdp.detach();
      } else {
        await page.locator(selector).focus();
        await page.keyboard.press("ArrowRight");
      }
      await page.waitForTimeout(100);
    };
    const before = await page.evaluate(() =>
      [
        ...window.__clawGame.renderer.celebrations.values(),
      ][0].mesh.quaternion.toArray(),
    );
    await drag(".win-prize-interaction");
    assert.notDeepEqual(
      await page.evaluate(() =>
        [
          ...window.__clawGame.renderer.celebrations.values(),
        ][0].mesh.quaternion.toArray(),
      ),
      before,
    );
    await page.getByRole("button", { name: /Your collection,/ }).click();
    await page.getByRole("button", { name: "View Miso Bear in 3D" }).click();
    await page.locator(".prize-viewer-canvas canvas").waitFor();
    await page.waitForTimeout(200);
    const beforeDrag = await page.locator(".prize-viewer-canvas").screenshot();
    await drag(".collection-prize-viewer");
    assert.ok(
      !beforeDrag.equals(
        await page.locator(".prize-viewer-canvas").screenshot(),
      ),
    );
    await page.screenshot({ path: `artifacts/${name}-collection.png` });
    await page
      .getByRole("button", { name: "Back to the machine", exact: true })
      .click();
    await page.evaluate(() => {
      const button = document.querySelector(".collection-button");
      const initialIcon = button.querySelector(
        ".collection-symbol, .collection-received",
      );
      window.__receiptTrace = [];
      const sample = () => {
        window.__receiptTrace.push({
          count: Number(button.querySelector(".collection-count").textContent),
          pulseChanged:
            button.querySelector(".collection-symbol, .collection-received") !==
            initialIcon,
          flying: [...window.__clawGame.renderer.celebrations.values()].some(
            (effect) => effect.storing && effect.mesh.visible,
          ),
        });
      };
      sample();
      window.__receiptObserver = new MutationObserver(sample);
      window.__receiptObserver.observe(button, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });
    await page.getByRole("button", { name: /Play again/i }).click();
    const tracePromise = page.evaluate(
      () =>
        new Promise((resolve) => {
          const trace = [];
          const sample = () => {
            const renderer = window.__clawGame.renderer;
            const celebration = [...renderer.celebrations.values()][0];
            if (!celebration) {
              resolve(trace);
              return;
            }
            const point = celebration.mesh.position
              .clone()
              .project(renderer.camera);
            const rect = document
              .querySelector(".collection-button")
              .getBoundingClientRect();
            trace.push(
              Math.hypot(
                ((point.x + 1) * innerWidth) / 2 - rect.left - rect.width / 2,
                ((1 - point.y) * innerHeight) / 2 - rect.top - rect.height / 2,
              ),
            );
            requestAnimationFrame(sample);
          };
          sample();
        }),
    );
    if (reducedMotion !== "reduce") {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `artifacts/${name}-storage.png` });
    }
    const trace = await tracePromise;
    if (reducedMotion !== "reduce")
      assert.ok(
        trace.length > 2 && trace.at(-1) < 10,
        "Storage reaches the collection button",
      );
    await page.waitForFunction(
      () => window.__clawGame.getSnapshot().state === "positioning",
    );
    await page.waitForFunction(
      () => document.querySelector(".collection-count").textContent === "1",
    );
    const receipt = await page.evaluate(() => {
      window.__receiptObserver.disconnect();
      return window.__receiptTrace;
    });
    assert.ok(receipt.some((sample) => sample.count === 1));
    assert.ok(
      receipt.every((sample) =>
        sample.count === 0
          ? !sample.pulseChanged
          : sample.count === 1 && sample.pulseChanged && !sample.flying,
      ),
      "The count changes with the gift pulse, after the trophy arrives",
    );
    assert.equal(
      await page.evaluate(
        () => window.__clawGame.getSnapshot().collected.length,
      ),
      1,
    );
    // The saved prize can still be opened after a new pile is loaded.
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("button", { name: /Refill machine/ }).click();
    await page.getByRole("button", { name: /Your collection,/ }).click();
    await page.getByRole("button", { name: "View Miso Bear in 3D" }).click();
    await page.locator(".prize-viewer-canvas canvas").waitFor();
    assert.deepEqual(errors, []);
    report.push({
      name,
      ...presentation,
      rotationAndCollectionViewer: "passed",
      storageAndRefill: "passed",
      countAndGiftPulse: "passed",
      errors,
    });
    await context.close();
  }
  await writeFile(
    "artifacts/presentation-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
