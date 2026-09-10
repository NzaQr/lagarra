import { expect, it } from "vitest";
import { Simulation } from "../src/simulation/Simulation";
import { EMPTY_INPUT, MACHINE } from "../src/game-core/types";

const settle = async () => {
  const sim = await Simulation.create();
  sim.debugSetPrizes([]);
  for (let i = 0; i < 240; i++) sim.step(1 / 60, EMPTY_INPUT);
  return sim;
};

it("moves faster with the stick and retains swing after the stick stops", async () => {
  const sim = await settle();
  try {
    for (let i = 0; i < 30; i++) sim.step(1 / 60, { ...EMPTY_INPUT, moveX: 1 });
    const moving = sim.getFrame();
    expect(moving.carriage.x).toBeCloseTo(0.525, 3);
    expect(Math.abs(moving.clawRotation.z)).toBeGreaterThan(0.005);
    let peak = 0;
    for (let i = 0; i < 45; i++) {
      sim.step(1 / 60, EMPTY_INPUT);
      const frame = sim.getFrame();
      expect(frame.carriage.x).toBe(moving.carriage.x);
      peak = Math.max(peak, Math.abs(frame.claw.x - frame.carriage.x));
    }
    expect(peak).toBeGreaterThan(0.015);
    for (let i = 0; i < 600; i++) sim.step(1 / 60, EMPTY_INPUT);
    expect(sim.getFrame().claw.x).toBeCloseTo(moving.carriage.x, 5);
  } finally {
    sim.dispose();
  }
});

it("lifts, transports and returns home faster, with finite poses at the limits", async () => {
  const sim = await settle();
  try {
    for (let i = 0; i < 180; i++)
      sim.step(1 / 60, { ...EMPTY_INPUT, moveX: 1, moveZ: -1 });
    sim.step(1 / 60, { ...EMPTY_INPUT, drop: true });
    const durations: Record<string, number> = {};
    for (let i = 0; i < 1200 && sim.snapshot().state !== "positioning"; i++) {
      const frame = sim.getFrame();
      durations[frame.state] = (durations[frame.state] ?? 0) + 1 / 60;
      expect(
        Math.hypot(
          frame.claw.x - frame.carriage.x,
          frame.claw.z - frame.carriage.z,
        ),
      ).toBeLessThanOrEqual(0.101);
      for (const arm of frame.arms) {
        expect(Object.values(arm.position).every(Number.isFinite)).toBe(true);
        expect(Math.hypot(...Object.values(arm.rotation))).toBeCloseTo(1, 6);
      }
      sim.step(1 / 60, EMPTY_INPUT);
    }
    expect(durations.lifting).toBeLessThan(2.9);
    expect(durations.transporting).toBeLessThan(3.2);
    expect(durations.resetting).toBeLessThan(0.9);
    expect(sim.snapshot().state).toBe("positioning");
    expect(sim.getFrame().carriage.x).toBe(0);
    expect(sim.getFrame().carriage.z).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("keeps pendulum motion equal at 30, 60 and 120 render frames per second", async () => {
  const frames = [];
  for (const rate of [30, 60, 120]) {
    const sim = await settle();
    try {
      for (let i = 0; i < rate / 2; i++)
        sim.step(1 / rate, { ...EMPTY_INPUT, moveZ: 1 });
      for (let i = 0; i < rate / 2; i++) sim.step(1 / rate, EMPTY_INPUT);
      frames.push(sim.getFrame());
    } finally {
      sim.dispose();
    }
  }
  expect(frames[0]).toEqual(frames[1]);
  expect(frames[2]).toEqual(frames[1]);
});

it("moves the Rapier fingers with the suspended claw, and clears swing on refill", async () => {
  const sim = await settle();
  try {
    for (let i = 0; i < 20; i++) sim.step(1 / 60, { ...EMPTY_INPUT, moveZ: 1 });
    const frame = sim.getFrame();
    expect(Math.abs(frame.clawRotation.x)).toBeGreaterThan(0.005);
    const positions: { x: number; y: number; z: number }[] = [];
    sim.world.forEachRigidBody((body) => {
      if (body.isKinematic()) positions.push(body.translation());
    });
    expect(positions).toHaveLength(6);
    for (const arm of frame.arms)
      expect(
        positions.some(
          (p) =>
            Math.hypot(
              p.x - arm.position.x,
              p.y - arm.position.y,
              p.z - arm.position.z,
            ) < 1e-5,
        ),
      ).toBe(true);
    const locked = { ...frame.carriage };
    sim.step(1 / 60, { ...EMPTY_INPUT, drop: true });
    for (let i = 0; i < 30; i++)
      sim.step(1 / 60, { ...EMPTY_INPUT, moveX: 1, moveZ: -1 });
    expect(sim.getFrame().carriage.x).toBe(locked.x);
    expect(sim.getFrame().carriage.z).toBe(locked.z);
    for (let i = 0; i < 1200 && sim.snapshot().state !== "positioning"; i++)
      sim.step(1 / 60, EMPTY_INPUT);
    sim.refill();
    expect(sim.getFrame().claw).toEqual({ x: 0, y: MACHINE.clawHomeY, z: 0 });
    expect(sim.getFrame().clawRotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  } finally {
    sim.dispose();
  }
});
