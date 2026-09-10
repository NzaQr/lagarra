import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { Simulation } from "./simulation/Simulation";
import type { GameRenderer } from "./rendering/GameRenderer";
import { ArcadeAudio } from "./game-core/audio";
import {
  EMPTY_INPUT,
  type GameActions,
  type GameSnapshot,
  type Quality,
} from "./game-core/types";
import "./styles.css";

const host = document.createElement("div");
host.id = "game-scene";
host.setAttribute("aria-label", "Three-dimensional claw machine");
document.body.prepend(host);
const root = createRoot(document.getElementById("root")!);
const input = { ...EMPTY_INPUT };
const audio = new ArcadeAudio();
let simulation: Simulation | undefined;
let renderer: GameRenderer | undefined;
let disposed = false;
let animation = 0;
let lastSnapshot: GameSnapshot | null = null;
let actions: GameActions | null = null;
let winReady = false;
let storingPrizes = false;
let lastTime = performance.now();
let accumulator = 0;
let sampleFrames = 0;
let sampleMilliseconds = 0;
let renderedFrames = 0;
const showFps =
  import.meta.env.DEV || new URLSearchParams(location.search).has("fps");
const fpsCounter = showFps ? document.createElement("pre") : null;
if (fpsCounter) {
  fpsCounter.className = "fps-counter";
  fpsCounter.setAttribute("aria-label", "Frame rate monitor");
  fpsCounter.textContent = "FPS —\n— ms / frame\nFrames 0";
  document.body.append(fpsCounter);
}
const debug =
  import.meta.env.DEV && new URLSearchParams(location.search).has("debug");
const stats = debug ? document.createElement("pre") : null;
if (stats) {
  stats.className = "debug-stats";
  document.body.append(stats);
}

function show(snapshot = lastSnapshot, error: string | null = null) {
  lastSnapshot = snapshot;
  root.render(
    <App
      snapshot={snapshot}
      actions={actions}
      error={error}
      winReady={winReady}
    />,
  );
}

function onSnapshot(snapshot: GameSnapshot) {
  if (snapshot.state !== "result") winReady = false;
  if (
    snapshot.state !== lastSnapshot?.state &&
    !(snapshot.state === "result" && snapshot.lastPrize)
  )
    audio.transition(snapshot.state, !!snapshot.lastPrize);
  show(snapshot);
}

function readQuality(): Quality {
  try {
    const stored = JSON.parse(
      localStorage.getItem("lagarra.settings.v1") ?? "{}",
    ).quality;
    if (stored === "balanced" || stored === "high") return stored;
  } catch {
    /* Storage may be disabled. */
  }
  return matchMedia("(pointer: coarse)").matches ? "balanced" : "high";
}

function tick(now: number) {
  if (disposed || !simulation || !renderer) return;
  const frameMilliseconds = Math.max(0, now - lastTime);
  const delta = Math.min(frameMilliseconds / 1000, 0.1);
  lastTime = now;
  if (!document.hidden) {
    accumulator += delta;
    while (accumulator >= 1 / 60) {
      simulation.step(1 / 60, input);
      input.drop = false;
      input.switchCamera = false;
      accumulator -= 1 / 60;
    }
    const frame = simulation.getFrame();
    if (import.meta.env.DEV && debug) {
      const lines = simulation.debugRender();
      renderer.updateDebug(lines.vertices, lines.colors);
    }
    const rendered = renderer.update(
      frame,
      delta,
      lastSnapshot?.camera ?? 0,
      lastSnapshot?.lastPrize?.id,
    );
    const nextWinReady = frame.state === "result" && renderer.isPrizeReady;
    if (nextWinReady !== winReady) {
      winReady = nextWinReady;
      if (winReady) audio.transition("result", true);
      show();
    }
    audio.tick(
      frame.state,
      frame.state === "positioning" &&
        Math.hypot(input.moveX, input.moveZ) > 0.05,
    );
    if (fpsCounter) {
      if (rendered) renderedFrames++;
      sampleFrames++;
      // Measure real frame intervals, including stalls beyond the physics time cap.
      sampleMilliseconds += frameMilliseconds;
      if (sampleMilliseconds >= 500) {
        const fps = (sampleFrames * 1000) / sampleMilliseconds;
        const frameMs = sampleMilliseconds / sampleFrames;
        fpsCounter.textContent = `FPS ${fps.toFixed(0)}\n${frameMs.toFixed(1)} ms / frame\nFrames ${renderedFrames}`;
        if (stats) {
          const info = simulation.debugInfo();
          const graphics = renderer.getPerformance();
          stats.textContent = `${frame.state} · ${graphics.quality}\n${frame.prizes.filter((p) => !p.collected).length} prizes · ${info.activeBodies} awake · ${info.contacts} contacts\n60 Hz physics · ${graphics.drawCalls} draw calls · ${graphics.triangles} triangles\nView ${(lastSnapshot?.camera ?? 0) + 1} · claw ${frame.claw.x.toFixed(2)}, ${frame.claw.y.toFixed(2)}, ${frame.claw.z.toFixed(2)}`;
        }
        sampleFrames = 0;
        sampleMilliseconds = 0;
      }
    }
  }
  animation = requestAnimationFrame(tick);
}

const unlock = () => audio.unlock();
const visibility = () => {
  input.moveX = 0;
  input.moveZ = 0;
  input.drop = false;
  input.switchCamera = false;
  accumulator = 0;
  sampleFrames = 0;
  sampleMilliseconds = 0;
  lastTime = performance.now();
  if (document.hidden) audio.pause();
};
document.addEventListener("pointerdown", unlock);
document.addEventListener("keydown", unlock);
document.addEventListener("visibilitychange", visibility);
window.addEventListener("blur", visibility);

show();
async function start() {
  try {
    const [{ GameRenderer }, { Simulation }] = await Promise.all([
      import("./rendering/GameRenderer"),
      import("./simulation/Simulation"),
    ]);
    if (disposed) return;
    renderer = new GameRenderer(host, readQuality());
    simulation = await Simulation.create(onSnapshot);
    if (disposed) {
      simulation.dispose();
      return;
    }
    actions = {
      move(x, z) {
        input.moveX = x;
        input.moveZ = z;
      },
      drop() {
        if (lastSnapshot?.state === "positioning") {
          audio.tone(330, 0.065, 0, "triangle");
          input.drop = true;
        }
      },
      switchCamera() {
        if (lastSnapshot?.state === "positioning") input.switchCamera = true;
      },
      async playAgain() {
        if (
          lastSnapshot?.state !== "result" ||
          !renderer?.isPrizeReady ||
          storingPrizes
        )
          return;
        storingPrizes = true;
        try {
          const target =
            document.querySelector<HTMLElement>(".collection-button");
          if (target) await renderer.storePrizes(target);
          if (!disposed) simulation?.playAgain();
        } finally {
          storingPrizes = false;
        }
      },
      rotatePrize(dx, dy) {
        renderer?.rotatePrize(dx, dy);
      },
      refill() {
        if (
          storingPrizes ||
          (lastSnapshot?.state === "result" && !renderer?.isPrizeReady)
        )
          return;
        simulation?.refill();
      },
      setQuality(quality) {
        renderer?.setQuality(quality);
      },
      setMuted(muted) {
        audio.setMuted(muted);
      },
      setVolume(volume) {
        audio.setVolume(volume);
      },
    };
    try {
      const settings = JSON.parse(
        localStorage.getItem("lagarra.settings.v1") ?? "{}",
      );
      audio.setMuted(settings.muted === true);
      if (
        typeof settings.volume === "number" &&
        Number.isFinite(settings.volume)
      )
        audio.setVolume(settings.volume);
    } catch {
      /* Optional storage. */
    }
    show(simulation.snapshot());
    if (import.meta.env.DEV) {
      Object.assign(window, {
        __clawGame: {
          simulation,
          renderer,
          actions,
          getSnapshot: () => simulation!.snapshot(),
          getFrame: () => simulation!.getFrame(),
        },
      });
    }
    lastTime = performance.now();
    animation = requestAnimationFrame(tick);
  } catch (error) {
    console.error(error);
    show(
      null,
      "The machine could not start. Enable WebGL in your browser, then reload the page.",
    );
  }
}
void start();

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposed = true;
    cancelAnimationFrame(animation);
    simulation?.dispose();
    renderer?.dispose();
    audio.dispose();
    root.unmount();
    host.remove();
    stats?.remove();
    fpsCounter?.remove();
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("blur", visibility);
  });
