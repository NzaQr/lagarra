import { describe, expect, it } from "vitest";
import { Simulation } from "../src/simulation/Simulation";
import { EMPTY_INPUT, MACHINE, type ClawInput } from "../src/game-core/types";
import { PRIZE_DEFINITIONS } from "../src/game-core/prizes";
import {
  acceptsInput,
  canTransition,
  cycleCamera,
  isInsideRetrieval,
} from "../src/game-core/rules";

const run = (
  sim: Simulation,
  seconds: number,
  input: ClawInput = EMPTY_INPUT,
) => {
  for (let i = 0; i < seconds * 60; i++) sim.step(1 / 60, input);
};
const attempt = (sim: Simulation) => {
  sim.step(1 / 60, { ...EMPTY_INPUT, drop: true });
  let peakY = 0;
  for (
    let i = 0;
    i < 1400 && !["result", "positioning"].includes(sim.snapshot().state);
    i++
  ) {
    sim.step(1 / 60, EMPTY_INPUT);
    if (
      sim.snapshot().state === "lifting" ||
      sim.snapshot().state === "transporting"
    ) {
      peakY = Math.max(peakY, sim.getFrame().prizes[0]?.position.y ?? 0);
    }
  }
  return peakY;
};

describe("machine rules", () => {
  it("allows only the defined cycle and locks movement and camera during a drop", () => {
    expect(canTransition("positioning", "dropping")).toBe(true);
    expect(canTransition("dropping", "result")).toBe(false);
    expect(acceptsInput("closing")).toBe(false);
    expect(cycleCamera(1, "positioning")).toBe(0);
    expect(cycleCamera(1, "lifting")).toBe(1);
  });
  it("requires the whole prize below the bed and inside the retrieval shaft", () => {
    expect(
      isInsideRetrieval({ x: MACHINE.chuteX, y: 0.85, z: MACHINE.chuteZ }, 0.2),
    ).toBe(true);
    expect(
      isInsideRetrieval({ x: MACHINE.chuteX, y: 1.2, z: MACHINE.chuteZ }, 0.2),
    ).toBe(false);
    expect(
      isInsideRetrieval(
        { x: MACHINE.chuteX + 0.3, y: 0.85, z: MACHINE.chuteZ },
        0.2,
      ),
    ).toBe(false);
  });
});

describe("physical claw scenarios", () => {
  it("treats glass edges as physical boundaries with a small rebound", async () => {
    const sim = await Simulation.create();
    run(sim, 4);
    const positions: number[] = [];
    for (let i = 0; i < 130; i++) {
      sim.step(1 / 60, { ...EMPTY_INPUT, moveZ: 1 });
      positions.push(sim.getFrame().carriage.z);
    }
    expect(Math.max(...positions)).toBeLessThanOrEqual(MACHINE.maxZ);
    const edgeIndex = positions.findIndex(
      (position) => position >= MACHINE.maxZ - 1e-6,
    );
    expect(edgeIndex).toBeGreaterThanOrEqual(0);
    expect(
      Math.min(...positions.slice(edgeIndex + 1, edgeIndex + 12)),
    ).toBeLessThan(MACHINE.maxZ - 0.001);
    expect(sim.debugInfo().contacts).toBeGreaterThan(0);
    sim.dispose();
  });

  it("settles a seeded 30-prize pile without escaped bodies", async () => {
    const sim = await Simulation.create();
    run(sim, 10);
    expect(sim.snapshot().state).toBe("positioning");
    expect(sim.snapshot().remaining).toBe(30);
    expect(sim.debugInfo().maxSpeed).toBeLessThan(0.15);
    for (const prize of sim.getFrame().prizes) {
      expect(prize.position.y).toBeGreaterThan(MACHINE.bedY);
      expect(Math.abs(prize.position.x)).toBeLessThan(MACHINE.halfWidth);
      expect(Math.abs(prize.position.z)).toBeLessThan(MACHINE.halfDepth);
    }
    sim.dispose();
  });
  it("can lift a centered plush with physical fingers and collect through the shaft", async () => {
    const sim = await Simulation.create();
    sim.debugSetPrizes([{ position: { x: 0, y: 1.7, z: 0 } }]);
    run(sim, 4);
    const peak = attempt(sim);
    expect(peak).toBeGreaterThan(2.8);
    expect(sim.snapshot().state).toBe("result");
    expect(sim.snapshot().collected).toHaveLength(1);
    expect(sim.snapshot().remaining).toBe(0);
    sim.refill();
    run(sim, 8);
    expect(sim.snapshot().collected).toHaveLength(1);
    expect(sim.snapshot().remaining).toBe(30);
    expect(sim.snapshot().attempt).toBe(1);
    sim.dispose();
  });
  it("misses a distant prize and preserves its position between attempts", async () => {
    const sim = await Simulation.create();
    sim.debugSetPrizes([{ position: { x: 0.85, y: 1.7, z: -0.6 } }]);
    run(sim, 4);
    attempt(sim);
    expect(sim.snapshot().collected).toHaveLength(0);
    expect(sim.snapshot().attempt).toBe(1);
    expect(sim.snapshot().state).toBe("positioning");
    expect(sim.getFrame().carriage).toEqual({
      x: 0,
      y: MACHINE.clawHomeY,
      z: 0,
    });
    const before = sim.getFrame().prizes[0].position;
    run(sim, 2);
    expect(sim.snapshot().state).toBe("positioning");
    expect(sim.getFrame().prizes[0].position.x).toBeCloseTo(before.x, 2);
    sim.refill();
    run(sim, 8);
    expect(sim.snapshot().remaining).toBe(30);
    expect(sim.snapshot().attempt).toBe(1);
    sim.dispose();
  });
  it("ignores move, camera, repeat drop and refill while automatic", async () => {
    const sim = await Simulation.create();
    run(sim, 7);
    sim.step(1 / 60, { ...EMPTY_INPUT, drop: true });
    const start = sim.getFrame().carriage;
    run(sim, 0.5, { moveX: 1, moveZ: 1, drop: true, switchCamera: true });
    sim.refill();
    expect(sim.getFrame().carriage.x).toBe(start.x);
    expect(sim.getFrame().carriage.z).toBe(start.z);
    expect(sim.snapshot().camera).toBe(0);
    expect(sim.snapshot().attempt).toBe(1);
    sim.dispose();
  });
  it("records alignment and material tuning scenarios", async () => {
    const results = [];
    for (const offset of [
      0, 0.1, 0.14, 0.16, 0.18, 0.2, 0.24, 0.26, 0.28, 0.3,
    ]) {
      for (const definition of [PRIZE_DEFINITIONS[0], PRIZE_DEFINITIONS[7]]) {
        const sim = await Simulation.create();
        sim.debugSetPrizes([
          { definition, position: { x: offset, y: 1.7, z: 0 } },
        ]);
        run(sim, 4);
        const peak = attempt(sim);
        results.push({
          id: definition.id,
          offset,
          peak: +peak.toFixed(3),
          won: sim.snapshot().collected.length > 0,
        });
        sim.dispose();
      }
    }
    expect(results.find((r) => r.id === "miso" && r.offset === 0.2)?.won).toBe(
      true,
    );
    expect(results.find((r) => r.id === "orbit" && r.offset === 0.2)?.won).toBe(
      false,
    );
    expect(results.find((r) => r.id === "miso" && r.offset === 0.28)?.won).toBe(
      false,
    );
  });
});
