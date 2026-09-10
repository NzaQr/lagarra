import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const output = new URL("../artifacts/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const origin = process.env.GAME_URL || "http://localhost:4178";
const report = [];
const errors = [];
const ready = async (page) => {
  await page.waitForFunction(
    () =>
      window.__clawGame?.getSnapshot().state === "positioning" &&
      document.querySelector('[aria-label="Drop claw"]')?.disabled === false,
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(100);
};

async function open(viewport, mobile = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  const tutorial = page.getByRole("dialog", { name: "How to play" });
  if (await tutorial.count())
    await tutorial.getByRole("button", { name: "Got it, let’s play" }).click();
  await ready(page);
  await page.waitForTimeout(700);
  return { context, page };
}

try {
  const { context, page } = await open({ width: 1440, height: 1000 });
  assert.match(await page.title(), /La Garra/);
  assert.equal(
    await page.evaluate(() => window.__clawGame.getSnapshot().remaining),
    30,
  );
  const before = await page.evaluate(
    () => window.__clawGame.getFrame().carriage,
  );
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(350);
  await page.keyboard.up("KeyD");
  const moved = await page.evaluate(
    () => window.__clawGame.getFrame().carriage,
  );
  assert.ok(moved.x > before.x + 0.1, "Keyboard moves the claw");
  const swing = await page.evaluate(() => {
    const { simulation, renderer } = window.__clawGame;
    const frame = simulation.getFrame();
    return {
      offset: Math.hypot(
        frame.claw.x - frame.carriage.x,
        frame.claw.z - frame.carriage.z,
      ),
      hubError: renderer.hub.position.distanceTo(frame.claw),
      rotationError: Math.abs(renderer.hub.quaternion.z - frame.clawRotation.z),
      contactError: Math.max(
        ...frame.arms.map((arm, i) =>
          renderer.armMeshes[i].position.distanceTo(arm.position),
        ),
      ),
    };
  });
  assert.ok(swing.offset > 0.01, "The claw swings below the carriage");
  assert.ok(
    swing.hubError < 1e-6 &&
      swing.rotationError < 1e-6 &&
      swing.contactError < 1e-6,
    "The hub and fingers use the physical suspension pose",
  );
  await page.screenshot({ path: `${output}/claw-swing.png` });
  await page.keyboard.press("KeyC");
  await page.waitForFunction(
    () => window.__clawGame.getSnapshot().camera === 1,
  );
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/desktop-side.png` });
  assert.ok(
    Math.abs(
      (await page.evaluate(() => window.__clawGame.getFrame().carriage.x)) -
        moved.x,
    ) < 0.02,
    "View change preserves position",
  );
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/desktop-front.png` });

  // Deterministic physical fixture checks the UI through a real full attempt.
  await page.evaluate(() => {
    const game = window.__clawGame;
    game.actions.refill();
    game.simulation.debugSetPrizes([{ position: { x: 0, y: 1.7, z: 0 } }]);
  });
  await ready(page);
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () => window.__clawGame.getSnapshot().state === "dropping",
  );
  const locked = await page.evaluate(
    () => window.__clawGame.getFrame().carriage,
  );
  await page.keyboard.down("KeyD");
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(350);
  await page.keyboard.up("KeyD");
  assert.equal(
    await page.evaluate(() => window.__clawGame.getFrame().carriage.x),
    locked.x,
  );
  assert.equal(
    await page.evaluate(() => window.__clawGame.getSnapshot().camera),
    0,
  );
  await page.waitForFunction(
    () => window.__clawGame.getSnapshot().collected.length === 1,
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(100);
  const entry = await page.evaluate(() => {
    const renderer = window.__clawGame.renderer;
    return [...renderer.celebrations.values()][0]?.mesh.position;
  });
  assert.ok(
    entry && entry.y < 1.35,
    "Prize stays visible below the physical chute",
  );
  await page.waitForTimeout(850);
  await page.screenshot({ path: `${output}/prize-exit.png` });
  const exit = await page.evaluate(
    () =>
      [...window.__clawGame.renderer.celebrations.values()][0].mesh.position,
  );
  assert.ok(
    exit.z > 1.5 && exit.y < 0.9,
    "Prize passes through the front opening before rising",
  );
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${output}/prize-flight.png` });
  await page.waitForFunction(
    () => window.__clawGame.getSnapshot().state === "result",
    null,
    { timeout: 30000 },
  );
  const won = await page.evaluate(() => window.__clawGame.getSnapshot());
  assert.equal(
    won.collected.length,
    1,
    "Physical grab reaches the retrieval compartment",
  );
  await page.getByRole("button", { name: "Play again", exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/desktop-result.png` });
  const hero = await page.evaluate(() => {
    const renderer = window.__clawGame.renderer;
    const celebration = [...renderer.celebrations.values()][0];
    return {
      distance: celebration.mesh.position.distanceTo(renderer.camera.position),
      confetti: celebration.confetti.some((piece) => piece.visible),
    };
  });
  assert.ok(
    hero.distance < 4.1 && hero.confetti,
    "Prize reaches the camera with a confetti burst",
  );
  assert.equal(await page.getByText("WASD", { exact: true }).count(), 0);
  assert.equal(await page.getByText("SPACE", { exact: true }).count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Change view", exact: true })
      .locator("kbd")
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByText(/FRONT VIEW|SIDE VIEW|LITTLE THINGS, BIG WINS/)
      .count(),
    0,
  );
  assert.equal(await page.locator(".collection-preview").count(), 0);
  const trophy = page.getByRole("group", { name: /Rotate Miso Bear/ });
  const trophyBox = await trophy.boundingBox();
  const initialRotation = await page.evaluate(() =>
    [
      ...window.__clawGame.renderer.celebrations.values(),
    ][0].mesh.quaternion.toArray(),
  );
  await page.mouse.move(
    trophyBox.x + trophyBox.width / 2,
    trophyBox.y + trophyBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    trophyBox.x + trophyBox.width / 2 + 130,
    trophyBox.y + trophyBox.height / 2 + 45,
    { steps: 12 },
  );
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.notDeepEqual(
    await page.evaluate(() =>
      [
        ...window.__clawGame.renderer.celebrations.values(),
      ][0].mesh.quaternion.toArray(),
    ),
    initialRotation,
    "Dragging rotates the 3D trophy",
  );
  assert.equal(
    await page.evaluate(() => window.__clawGame.getSnapshot().state),
    "result",
    "Win waits while inspecting the trophy",
  );
  await page.screenshot({ path: `${output}/rotated-trophy.png` });
  await page.getByRole("button", { name: /Your collection,/ }).click();
  assert.deepEqual(
    await page.locator(".prize-grid strong").allTextContents(),
    won.collected.map((prize) => prize.name),
  );
  assert.equal(await page.getByText(/FIND 01|all yours/).count(), 0);
  const back = page.getByRole("button", {
    name: "Back to the machine",
    exact: true,
  });
  assert.equal(await back.locator("svg").count(), 0);
  await page.screenshot({ path: `${output}/collection.png` });
  await page.getByRole("button", { name: "View Miso Bear in 3D" }).click();
  const viewer = page.locator(".collection-prize-viewer");
  await viewer.locator("canvas").waitFor();
  await page.waitForTimeout(250);
  const beforeRotation = await viewer.screenshot();
  await viewer.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(100);
  const afterRotation = await viewer.screenshot();
  assert.ok(
    !beforeRotation.equals(afterRotation),
    "Keyboard rotates the collection model",
  );
  await page.screenshot({ path: `${output}/collection-3d.png` });
  await page
    .getByRole("button", { name: "Back to collection", exact: true })
    .click();
  assert.equal(await page.locator(".prize-viewer-canvas").count(), 0);
  await back.click();
  report.push({
    check: "desktop keyboard, views, input lock, physical success, result",
    result: "passed",
    snapshot: won,
  });

  const again = page.getByRole("button", { name: /play again/i });
  const beforeStore = await page.evaluate(() =>
    [
      ...window.__clawGame.renderer.celebrations.values(),
    ][0].mesh.position.toArray(),
  );
  await again.click();
  await page.waitForTimeout(200);
  const storing = await page.evaluate(() => {
    const game = window.__clawGame;
    const celebration = [...game.renderer.celebrations.values()][0];
    return {
      state: game.getSnapshot().state,
      count: game.getSnapshot().collected.length,
      position: celebration.mesh.position.toArray(),
      size: celebration.mesh.scale.x,
      initialSize: celebration.storing.scale,
    };
  });
  assert.equal(storing.state, "result", "The next attempt waits for storage");
  assert.equal(storing.count, 1);
  assert.notDeepEqual(
    storing.position,
    beforeStore,
    "The trophy moves toward the collection button",
  );
  assert.ok(
    storing.size < storing.initialSize,
    "The trophy shrinks during storage",
  );
  await page.screenshot({ path: `${output}/storing-trophy.png` });
  await ready(page);
  assert.equal(
    await page.evaluate(() => window.__clawGame.renderer.celebrations.size),
    0,
    "Play again clears the prize presentation",
  );
  await page
    .getByRole("button", { name: "Drop claw" })
    .waitFor({ state: "visible" });
  await page.waitForTimeout(200);
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(220);
  await page.keyboard.up("KeyA");
  assert.ok(
    (await page.evaluate(() => window.__clawGame.getFrame().carriage.x)) <
      -0.08,
    "Keyboard works after clicking Play again",
  );
  report.push({
    check:
      "keyboard after button focus, trophy rotation, collection viewer, storage animation",
    result: "passed",
  });
  await page.evaluate(() => {
    const { simulation, renderer } = window.__clawGame;
    const idle = { moveX: 0, moveZ: 0, drop: false, switchCamera: false };
    simulation.refill();
    simulation.debugSetPrizes([{ position: { x: 0.9, y: 1.7, z: -0.65 } }]);
    for (let i = 0; i < 240; i++) simulation.step(1 / 60, idle);
    simulation.step(1 / 60, { ...idle, drop: true });
    for (
      let i = 0;
      i < 1200 && simulation.snapshot().state !== "releasing";
      i++
    )
      simulation.step(1 / 60, idle);
    renderer.update(simulation.getFrame(), 1 / 60, 0);
  });
  await ready(page);
  assert.equal(
    await page.getByRole("button", { name: /Play again/i }).count(),
    0,
  );
  const home = await page.evaluate(() => window.__clawGame.getFrame().carriage);
  assert.ok(
    Math.hypot(home.x, home.z) < 0.002,
    "Miss returns home without player input",
  );
  report.push({ check: "automatic recovery after a miss", result: "passed" });
  await context.close();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    const { context, page } = await open(viewport, true);
    assert.equal(
      await page.getByRole("dialog", { name: "How to play" }).count(),
      0,
      "Mobile does not show the keyboard tutorial",
    );
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight + 1,
    );
    assert.equal(overflow, false, "Mobile game does not scroll");
    const targets = await page.getByRole("button").evaluateAll((buttons) =>
      buttons
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return (
            r.width && r.height && getComputedStyle(b).visibility !== "hidden"
          );
        })
        .map((b) => ({
          label: b.getAttribute("aria-label") || b.textContent,
          width: b.getBoundingClientRect().width,
          height: b.getBoundingClientRect().height,
        })),
    );
    assert.ok(
      targets.every((b) => b.width >= 40 && b.height >= 40),
      "Touch targets remain large",
    );
    await page.screenshot({
      path: `${output}/mobile-${viewport.width < viewport.height ? "portrait" : "landscape"}.png`,
    });
    const joystick = await page
      .getByRole("group", { name: /Move claw/ })
      .boundingBox();
    assert.ok(joystick);
    const cdp = await context.newCDPSession(page);
    const center = {
      x: joystick.x + joystick.width / 2,
      y: joystick.y + joystick.height / 2,
      id: 1,
    };
    const right = { ...center, x: center.x + joystick.width * 0.3 };
    const initialX = await page.evaluate(
      () => window.__clawGame.getFrame().carriage.x,
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [center],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [right],
    });
    await page.waitForTimeout(300);
    const movedX = await page.evaluate(
      () => window.__clawGame.getFrame().carriage.x,
    );
    assert.ok(
      movedX > initialX + 0.1,
      "Touch joystick moves the physical claw",
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await page.waitForFunction(
      () => window.__clawGame.getFrame().moveX === 0,
      null,
      { timeout: 1000 },
    );
    const stoppedX = await page.evaluate(
      () => window.__clawGame.getFrame().carriage.x,
    );
    await page.waitForTimeout(200);
    assert.ok(
      Math.abs(
        (await page.evaluate(() => window.__clawGame.getFrame().carriage.x)) -
          stoppedX,
      ) < 0.03,
      "Touch cancel stops motion",
    );
    const currentCamera = await page.evaluate(
      () => window.__clawGame.getSnapshot().camera,
    );
    await page.getByRole("button", { name: "Change view", exact: true }).tap();
    await page.waitForFunction(
      (previous) => window.__clawGame.getSnapshot().camera !== previous,
      currentCamera,
    );
    await page.getByRole("button", { name: "Open settings" }).tap();
    await page.getByRole("button", { name: "High detail", exact: true }).tap();
    assert.equal(
      await page.evaluate(
        () => window.__clawGame.renderer.getPerformance().quality,
      ),
      "high",
    );
    await page.getByRole("button", { name: "Balanced", exact: true }).tap();
    assert.equal(
      await page.getByRole("button", { name: /How to play/i }).count(),
      0,
    );
    await page.getByRole("button", { name: "Close panel" }).tap();
    await page.getByRole("button", { name: "Drop claw" }).tap();
    await page.waitForFunction(
      () => window.__clawGame.getSnapshot().state === "dropping",
    );
    report.push({
      check: `touch layout ${viewport.width}×${viewport.height}`,
      result: "passed",
      targets,
      performance: await page.evaluate(() =>
        window.__clawGame.renderer.getPerformance(),
      ),
    });
    await context.close();
  }
  assert.deepEqual(errors, [], "No browser errors");
  await writeFile(
    `${output}/browser-report.json`,
    JSON.stringify({ report, errors }, null, 2),
  );
  console.log(JSON.stringify({ report, errors }, null, 2));
} finally {
  await browser.close();
}
