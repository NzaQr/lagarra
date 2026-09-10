import { it, expect } from "vitest";
import { Simulation } from "../src/simulation/Simulation";
import { EMPTY_INPUT, MACHINE, type Vec3 } from "../src/game-core/types";
import { PRIZE_DEFINITIONS } from "../src/game-core/prizes";

const run = (simulation: Simulation, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) simulation.step(1 / 60, EMPTY_INPUT);
};
const aim = (simulation: Simulation, target: Vec3) => {
  for (let i = 0; i < 250; i++) {
    const claw = simulation.getFrame().carriage;
    const dx =
      Math.max(-MACHINE.boundsX, Math.min(MACHINE.boundsX, target.x)) - claw.x;
    const dz =
      Math.max(MACHINE.minZ, Math.min(MACHINE.maxZ, target.z)) - claw.z;
    if (Math.hypot(dx, dz) < 0.005) break;
    simulation.step(1 / 60, {
      ...EMPTY_INPUT,
      moveX: Math.max(-1, Math.min(1, (dx * 60) / MACHINE.moveSpeed)),
      moveZ: Math.max(-1, Math.min(1, (dz * 60) / MACHINE.moveSpeed)),
    });
  }
};

it("lets an off-center bunny lift, then slip before the fingers open", async () => {
  const simulation = await Simulation.create();
  simulation.debugSetPrizes([
    {
      definition: PRIZE_DEFINITIONS[1],
      position: { x: Math.cos(0.5) * 0.22, y: 1.7, z: Math.sin(0.5) * 0.22 },
    },
  ]);
  run(simulation, 4);
  simulation.step(1 / 60, { ...EMPTY_INPUT, drop: true });
  let peak = 0;
  let slippedBeforeRelease = false;
  for (
    let i = 0;
    i < 1500 &&
    !["result", "positioning"].includes(simulation.snapshot().state);
    i++
  ) {
    simulation.step(1 / 60, EMPTY_INPUT);
    const frame = simulation.getFrame();
    if (frame.state === "lifting" || frame.state === "transporting") {
      const y = frame.prizes[0].position.y;
      peak = Math.max(peak, y);
      if (peak - y > 0.35) {
        slippedBeforeRelease = true;
        expect(frame.openness).toBe(0);
      }
    }
  }
  expect(peak).toBeGreaterThan(2.5);
  expect(slippedBeforeRelease).toBe(true);
  expect(simulation.snapshot().collected).toHaveLength(0);
  expect(simulation.getFrame().prizes[0].position.y).toBeLessThan(1.8);
  simulation.dispose();
});

it("keeps the altered 30-prize pile stable through six targeted attempts", async () => {
  const simulation = await Simulation.create();
  run(simulation, 8);
  const results: boolean[] = [];
  for (let round = 0; round < 6; round++) {
    const target = simulation
      .getFrame()
      .prizes.filter(
        (p) =>
          !p.collected &&
          Math.abs(p.position.x) < MACHINE.boundsX &&
          p.position.z > MACHINE.minZ &&
          p.position.z < MACHINE.maxZ,
      )
      .sort((a, b) => b.position.y - a.position.y)[round % 3];
    aim(simulation, target.position);
    const count = simulation.snapshot().collected.length;
    simulation.step(1 / 60, { ...EMPTY_INPUT, drop: true });
    run(simulation, 22);
    results.push(simulation.snapshot().collected.length > count);
    expect(simulation.snapshot().state).toBe(
      results[round] ? "result" : "positioning",
    );
    expect(simulation.debugInfo().maxSpeed).toBeLessThan(0.12);
    expect(
      simulation.snapshot().remaining + simulation.snapshot().collected.length,
    ).toBe(30);
    for (const prize of simulation
      .getFrame()
      .prizes.filter((p) => !p.collected)) {
      expect(prize.position.y).toBeGreaterThan(MACHINE.bedY);
      expect(prize.position.y).toBeLessThan(MACHINE.railY);
      expect(Math.abs(prize.position.x)).toBeLessThan(MACHINE.halfWidth);
      expect(Math.abs(prize.position.z)).toBeLessThan(MACHINE.halfDepth);
    }
    simulation.playAgain();
    run(simulation, 3);
  }
  expect(results.some(Boolean)).toBe(true);
  expect(results.some((result) => !result)).toBe(true);
  expect(simulation.snapshot().attempt).toBe(6);
  simulation.dispose();
});
