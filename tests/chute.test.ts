import { describe, expect, it } from "vitest";
import { PRIZE_DEFINITIONS } from "../src/game-core/prizes";
import { EMPTY_INPUT, MACHINE } from "../src/game-core/types";
import { isInsideRetrieval } from "../src/game-core/rules";
import { Simulation } from "../src/simulation/Simulation";

const run = (simulation: Simulation, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) simulation.step(1 / 60, EMPTY_INPUT);
};

describe("prize chute", () => {
  it.each(["x", "z"] as const)(
    "clears two prizes across the %s axis that reach the opening together",
    async (axis) => {
      const simulation = await Simulation.create();
      try {
        simulation.debugSetPrizes(
          [-1, 1].map((side) => ({
            definition: PRIZE_DEFINITIONS[3],
            position: {
              x: MACHINE.chuteX + (axis === "x" ? side * 0.225 : 0),
              y: MACHINE.bedY + 0.3,
              z: MACHINE.chuteZ + (axis === "z" ? side * 0.225 : 0),
            },
          })),
        );
        run(simulation, 4);
        expect(simulation.snapshot().collected).toHaveLength(2);
        expect(simulation.snapshot().remaining).toBe(0);
        for (const prize of simulation.getFrame().prizes) {
          expect(
            isInsideRetrieval(prize.position, prize.definition.radius),
          ).toBe(true);
        }
        run(simulation, 4);
        expect(simulation.snapshot().collected).toHaveLength(2);
      } finally {
        simulation.dispose();
      }
    },
  );
  it("finishes a winning attempt with several prizes at the opening", async () => {
    const simulation = await Simulation.create();
    try {
      simulation.debugSetPrizes(
        [-1, 0, 1].map((side) => ({
          definition: PRIZE_DEFINITIONS[3],
          position: {
            x: MACHINE.chuteX + side * 0.225,
            y: MACHINE.bedY + (side === 0 ? 0.75 : 0.3),
            z: MACHINE.chuteZ,
          },
        })),
      );
      simulation.step(1 / 60, { ...EMPTY_INPUT, drop: true });
      run(simulation, 20);
      expect(simulation.snapshot().state).toBe("result");
      expect(simulation.snapshot().collected).toHaveLength(3);
      expect(simulation.snapshot().remaining).toBe(0);
    } finally {
      simulation.dispose();
    }
  });
  it("leaves prizes above the opening under normal physics until they enter", async () => {
    const simulation = await Simulation.create();
    try {
      simulation.debugSetPrizes([
        { position: { x: MACHINE.chuteX, y: 2.4, z: MACHINE.chuteZ } },
      ]);
      simulation.world.forEachRigidBody((body) => {
        if (body.isDynamic()) body.setGravityScale(0, true);
      });
      run(simulation, 2);
      expect(simulation.snapshot().collected).toHaveLength(0);
      expect(simulation.getFrame().prizes[0].position.y).toBeCloseTo(2.4);
      simulation.world.forEachRigidBody((body) => {
        if (body.isDynamic()) {
          body.setGravityScale(1, true);
          body.setLinvel({ x: 0, y: -0.1, z: 0 }, true);
        }
      });
      run(simulation, 3);
      expect(simulation.snapshot().collected).toHaveLength(1);
    } finally {
      simulation.dispose();
    }
  });
  it.each(["x", "z"] as const)(
    "does not collect a prize outside the %s rim",
    async (axis) => {
      const simulation = await Simulation.create();
      try {
        simulation.debugSetPrizes([
          {
            position: {
              x: MACHINE.chuteX + (axis === "x" ? 0.6 : 0),
              y: MACHINE.bedY + 0.215,
              z: MACHINE.chuteZ - (axis === "z" ? 0.6 : 0),
            },
          },
        ]);
        run(simulation, 4);
        expect(simulation.snapshot().collected).toHaveLength(0);
        expect(simulation.snapshot().remaining).toBe(1);
      } finally {
        simulation.dispose();
      }
    },
  );
  it.each([0, Math.PI / 4, Math.PI / 2])(
    "clears a seal rotated by %s radians",
    async (angle) => {
      const simulation = await Simulation.create();
      try {
        simulation.debugSetPrizes([
          {
            definition: PRIZE_DEFINITIONS[9],
            position: {
              x: MACHINE.chuteX + 0.35,
              y: MACHINE.bedY + 0.2,
              z: MACHINE.chuteZ + 0.35,
            },
          },
        ]);
        simulation.world.forEachRigidBody((body) => {
          if (body.isDynamic())
            body.setRotation(
              {
                x: Math.sin(angle / 2) / Math.SQRT2,
                y: Math.sin(angle / 2) / Math.SQRT2,
                z: 0,
                w: Math.cos(angle / 2),
              },
              true,
            );
        });
        run(simulation, 4);
        expect(simulation.snapshot().collected).toHaveLength(1);
      } finally {
        simulation.dispose();
      }
    },
  );
  it.each(PRIZE_DEFINITIONS)(
    "clears $name from the inside corner of the opening",
    async (definition) => {
      const simulation = await Simulation.create();
      try {
        simulation.debugSetPrizes([
          {
            definition,
            position: {
              x: MACHINE.chuteX + 0.3,
              y: MACHINE.bedY + 0.1 + definition.radius,
              z: MACHINE.chuteZ + 0.3,
            },
          },
        ]);
        run(simulation, 4);
        expect(
          simulation.snapshot().collected.map((prize) => prize.id),
        ).toEqual([definition.id]);
        expect(simulation.snapshot().remaining).toBe(0);
      } finally {
        simulation.dispose();
      }
    },
  );
});
