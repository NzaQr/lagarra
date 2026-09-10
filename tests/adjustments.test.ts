import { expect, it } from "vitest";
import { Simulation } from "../src/simulation/Simulation";
import { EMPTY_INPUT, MACHINE, type ArmPose } from "../src/game-core/types";

const capsuleExtent = (arm: ArmPose, axis: "x" | "y" | "z") => {
  const q = arm.rotation;
  const direction = {
    x: 2 * (q.x * q.y - q.z * q.w),
    y: 1 - 2 * (q.x * q.x + q.z * q.z),
    z: 2 * (q.y * q.z + q.x * q.w),
  }[axis];
  return (
    Math.abs(direction) * (arm.length / 2) +
    arm.radius * Math.sqrt(Math.max(0, 1 - direction * direction))
  );
};

const armBounds = (arm: ArmPose, axis: "x" | "y" | "z") => {
  const extent = capsuleExtent(arm, axis);
  const position = arm.position[axis];
  return { min: position - extent, max: position + extent };
};

const glassSafe = (arm: ArmPose) => {
  const y = armBounds(arm, "y");
  if (y.max <= MACHINE.glassBottomY || y.min >= MACHINE.glassTopY) return true;
  const x = armBounds(arm, "x");
  const z = armBounds(arm, "z");
  const tolerance = 1e-6;
  return (
    x.min >= -MACHINE.glassInnerX - tolerance &&
    x.max <= MACHINE.glassInnerX + tolerance &&
    z.min >= MACHINE.glassInnerBackZ - tolerance &&
    z.max <= MACHINE.glassInnerFrontZ + tolerance
  );
};

it("is ready as soon as the prize pile appears", async () => {
  const sim = await Simulation.create();
  try {
    expect(sim.snapshot().state).toBe("positioning");
    sim.step(1 / 60, { ...EMPTY_INPUT, moveX: 1 });
    expect(sim.getFrame().carriage.x).toBeGreaterThan(0);
  } finally {
    sim.dispose();
  }
});

it("keeps every claw arm inside the four glass panels", async () => {
  for (const input of [
    { moveX: 1, moveZ: 0 },
    { moveX: -1, moveZ: 0 },
    { moveX: 0, moveZ: 1 },
    { moveX: 0, moveZ: -1 },
  ]) {
    const sim = await Simulation.create();
    try {
      sim.debugSetPrizes([]);
      let stayedInside = true;
      for (let i = 0; i < 420; i++) {
        sim.step(1 / 60, { ...EMPTY_INPUT, ...input });
        stayedInside &&= sim.getFrame().arms.every(glassSafe);
      }
      expect(stayedInside).toBe(true);
    } finally {
      sim.dispose();
    }
  }
});
