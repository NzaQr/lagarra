import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const output = "artifacts/win-experience";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const report = [];
try {
  for (const [name, width, height, reducedMotion, spins] of [
    ["desktop", 1440, 1000, "no-preference", 3],
    ["phone", 390, 844, "no-preference", 2],
    ["small-phone", 320, 568, "no-preference", 1],
    ["landscape", 844, 390, "no-preference", 1],
    ["reduced", 390, 844, "reduce", 1],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion,
      isMobile: width < 1000,
      hasTouch: width < 1000,
      recordVideo:
        name === "desktop"
          ? { dir: output, size: { width: 960, height: 668 } }
          : undefined,
    });
    await context.addInitScript(() => {
      localStorage.setItem("lagarra.keyboard-tutorial.v1", "accepted");
      localStorage.setItem(
        "lagarra.settings.v1",
        JSON.stringify({ quality: "balanced", muted: true }),
      );
    });
    await context.addInitScript((slow) => {
      window.__slowWinReplay = slow;
    }, process.env.SLOW_REPLAY === "1");
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.GAME_URL || "http://localhost:4178");
    await page.waitForFunction(
      () => window.__clawGame?.getSnapshot().state === "positioning",
    );
    const runs = [];
    for (let spin = 0; spin < spins; spin++) {
      const fixture = await page.evaluate(async (spin) => {
        const { simulation, renderer, actions } = window.__clawGame;
        const { PRIZE_DEFINITIONS } = await import("/src/game-core/prizes.ts");
        const { MACHINE, EMPTY_INPUT } =
          await import("/src/game-core/types.ts");
        const { WIN_MOTION } = await import("/src/rendering/WinMotion.ts");
        simulation.debugSetPrizes([]);
        renderer.update(simulation.getFrame(), 0, 0);
        const definition = PRIZE_DEFINITIONS[spin % PRIZE_DEFINITIONS.length];
        simulation.debugSetPrizes([
          {
            definition,
            position: { x: MACHINE.chuteX, y: 1.9, z: MACHINE.chuteZ },
          },
        ]);
        renderer.update(simulation.getFrame(), 0, spin % 2);
        const attempt = simulation.snapshot().attempt;
        simulation.step(1 / 60, { ...EMPTY_INPUT, drop: true });
        // Repeated commands during the physical attempt must not start a second attempt.
        for (let i = 0; i < 1400 && !simulation.snapshot().lastPrize; i++) {
          actions.drop();
          simulation.step(1 / 60, { ...EMPTY_INPUT, drop: true });
        }
        renderer.update(simulation.getFrame(), 0, spin % 2);
        for (
          let i = 0;
          i < 1400 && simulation.snapshot().state !== "result";
          i++
        )
          simulation.step(1 / 60, EMPTY_INPUT);
        const effect = [...renderer.celebrations.values()].at(-1);
        const originalUpdate = effect.update.bind(effect);
        window.__winTrace = [];
        effect.update = (dt, camera, reduced) => {
          // Record one final approach at 10% speed for visual review.
          const slow =
            window.__slowWinReplay &&
            innerWidth === 1440 &&
            spin === 0 &&
            effect.elapsed > effect.stopTime - 0.4 &&
            effect.elapsed < effect.stopTime - 0.1;
          originalUpdate(dt * (slow ? 0.1 : 1), camera, reduced);
          window.__winTrace.push({
            elapsed: effect.elapsed,
            ready: effect.isReady,
            angle: effect.mesh.quaternion.angleTo(camera.quaternion),
            particles: effect.confetti.filter((p) => p.visible).length,
            backdrop: effect.backdrop.material.opacity,
            halo: effect.halo.material.opacity,
            atCamera:
              effect.mesh.position.distanceTo(effect.destination) < 1e-7,
            behindPrize: effect.confetti.every(
              (p) =>
                p.position.z <
                (-effect.radius * effect.mesh.scale.x) / effect.scale,
            ),
            launchRadius: Math.max(
              0,
              ...effect.confetti
                .filter((p) => p.visible)
                .map(
                  (p) =>
                    Math.hypot(p.position.x, p.position.y) /
                    ((effect.radius * effect.mesh.scale.x) / effect.scale),
                ),
            ),
          });
        };
        return {
          expected: definition.name,
          attemptDelta: simulation.snapshot().attempt - attempt,
          turns: effect.plan.turns,
          duration: effect.plan.duration,
          radius: effect.radius,
          scale: effect.scale,
          stop: effect.stopTime,
          arrival: WIN_MOTION.exitDuration + WIN_MOTION.flightDuration,
          pause: WIN_MOTION.pause,
          confettiDelay: WIN_MOTION.confettiDelay,
        };
      }, spin);
      assert.equal(fixture.attemptDelta, 1);
      if (reducedMotion !== "reduce") {
        await page.waitForFunction(
          () =>
            [...window.__clawGame.renderer.celebrations.values()].at(-1)
              ?.elapsed > 1.5,
        );
        await page.screenshot({ path: `${output}/${name}-${spin}-spin.png` });
        assert.equal(
          await page.getByRole("button", { name: "Play again" }).count(),
          0,
        );
        const guarded = await page.evaluate(async () => {
          const { actions, getSnapshot } = window.__clawGame;
          const before = getSnapshot();
          actions.drop();
          actions.drop();
          actions.refill();
          await Promise.all([actions.playAgain(), actions.playAgain()]);
          const after = getSnapshot();
          return (
            before.state === after.state &&
            before.attempt === after.attempt &&
            before.lastPrize.id === after.lastPrize.id &&
            before.remaining === after.remaining
          );
        });
        assert.equal(guarded, true);
      }
      await page
        .getByRole("button", { name: "Play again" })
        .waitFor({ timeout: 30000 });
      await page.waitForTimeout(reducedMotion === "reduce" ? 100 : 550);
      const presentation = await page.evaluate(() => {
        const { renderer, getSnapshot } = window.__clawGame;
        const effect = [...renderer.celebrations.values()].at(-1);
        const rect = document
          .querySelector(".result-note")
          .getBoundingClientRect();
        const center = effect.mesh.position.clone().project(renderer.camera);
        return {
          name: getSnapshot().lastPrize.name,
          angle: effect.mesh.quaternion.angleTo(renderer.camera.quaternion),
          scale: effect.mesh.scale.x,
          center: { x: center.x, y: center.y },
          elapsed: effect.elapsed,
          particles: effect.confetti.length,
          overflow: document.documentElement.scrollWidth > innerWidth,
          resultVisible:
            rect.top >= 0 &&
            rect.bottom <= innerHeight &&
            rect.left >= 0 &&
            rect.right <= innerWidth,
          trace: window.__winTrace,
        };
      });
      assert.equal(presentation.name, fixture.expected);
      assert.ok(presentation.angle < 1e-6);
      assert.equal(presentation.overflow, false);
      assert.equal(presentation.resultVisible, true);
      assert.ok(Math.abs(presentation.center.x) < 1e-6);
      if (reducedMotion === "reduce") assert.equal(presentation.particles, 0);
      else {
        assert.ok(presentation.particles <= (width < height ? 32 : 40));
        const stop = fixture.stop;
        assert.ok(
          stop < 3,
          "The trophy reveal finishes in less than three seconds",
        );
        const firstReady = presentation.trace.find((point) => point.ready);
        const firstConfetti = presentation.trace.find(
          (point) => point.particles > 0,
        );
        assert.ok(
          firstReady.elapsed >= stop + fixture.pause &&
            firstReady.elapsed < stop + fixture.pause + 0.11,
        );
        assert.ok(
          firstConfetti.elapsed >= stop + fixture.pause + fixture.confettiDelay,
        );
        assert.equal(firstConfetti.behindPrize, true);
        assert.ok(
          firstConfetti.launchRadius < 1.25,
          "Confetti starts behind the prize, inside its silhouette",
        );
        assert.ok(
          presentation.trace
            .filter((point) => point.elapsed < fixture.arrival)
            .every((point) => point.backdrop === 0 && point.halo === 0),
        );
        assert.ok(
          presentation.trace
            .filter((point) => point.backdrop > 0)
            .every((point) => point.atCamera),
          "The backdrop never covers the trophy in flight",
        );
        assert.ok(presentation.trace.every((point) => point.behindPrize));
        assert.ok(
          presentation.trace
            .filter((point) => point.elapsed >= stop)
            .every((point) => point.angle < 1e-6),
        );
      }
      await page.screenshot({ path: `${output}/${name}-${spin}-win.png` });
      if (name === "phone" && spin === 0) {
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForTimeout(100);
        await page.screenshot({ path: `${output}/phone-resized.png` });
        await page.setViewportSize({ width, height });
      }
      if (name === "phone" && spin === 1) {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.waitForFunction(
          () =>
            [...window.__clawGame.renderer.celebrations.values()].at(-1)
              .confetti.length === 0,
        );
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
      if (spin === 0) {
        await page.waitForFunction(
          () =>
            [...window.__clawGame.renderer.celebrations.values()].every(
              (effect) => !effect.isAnimating,
            ),
          null,
          { timeout: 15000 },
        );
        assert.equal(
          await page.evaluate(() =>
            [...window.__clawGame.renderer.celebrations.values()].reduce(
              (sum, e) => sum + e.confetti.length,
              0,
            ),
          ),
          0,
        );
        // Scene drawing must stop once the effect has finished.
        await page.waitForFunction(() => {
          const renderer = window.__clawGame.renderer;
          const frame = renderer.renderer.info.render.frame;
          if (window.__lastIdleFrame !== frame) {
            window.__lastIdleFrame = frame;
            window.__lastDrawAt = performance.now();
          }
          return (
            renderer.camera.position.equals(renderer.cameraPosition) &&
            !renderer.renderRequested &&
            performance.now() - window.__lastDrawAt > 500
          );
        });
        const frames = await page.evaluate(
          () => window.__clawGame.renderer.renderer.info.render.frame,
        );
        await page.waitForTimeout(250);
        assert.equal(
          await page.evaluate(
            () => window.__clawGame.renderer.renderer.info.render.frame,
          ),
          frames,
        );
        await page.screenshot({ path: `${output}/${name}-clean.png` });
      }
      await page.getByRole("button", { name: "Play again" }).click();
      await page.waitForFunction(
        () => window.__clawGame.getSnapshot().state === "positioning",
      );
      assert.equal(
        await page.evaluate(() => window.__clawGame.renderer.celebrations.size),
        0,
      );
      delete presentation.trace;
      runs.push({ ...fixture, ...presentation });
    }
    assert.deepEqual(errors, []);
    report.push({ name, runs, errors });
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
    console.log(`${name}: ${spins} spin(s) passed`);
    const video = page.video();
    await context.close();
    if (video) {
      await video.saveAs(`${output}/desktop-sequence.webm`);
      await video.delete();
    }
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
