import { MACHINE, type Quat, type Vec3 } from "../game-core/types";

/** A damped pendulum driven by carriage acceleration, integrated at 60 Hz. */
export class Suspension {
  readonly position: Vec3 = { x: 0, y: MACHINE.clawHomeY, z: 0 };
  readonly rotation: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private angle = { x: 0, z: 0 };
  private angularVelocity = { x: 0, z: 0 };
  private velocity = { x: 0, z: 0 };

  step(carriage: Vec3, vx: number, vz: number, dt: number, openness: number) {
    const cable = MACHINE.railY - carriage.y;
    // The centre of mass lies below the cable attachment on the hub.
    const length = cable + 0.3;
    const limit = Math.min(0.18, Math.asin(0.1 / cable));
    // The closed grip has more damping; its load must not whip out of the fingers.
    for (const axis of ["x", "z"] as const) {
      const velocity = axis === "x" ? vx : vz;
      this.angularVelocity[axis] -= (velocity - this.velocity[axis]) / length;
      this.velocity[axis] = velocity;
      this.angularVelocity[axis] +=
        (-(9.81 / length) * Math.sin(this.angle[axis]) -
          (3.8 + 8 * (1 - openness)) * this.angularVelocity[axis]) *
        dt;
      this.angle[axis] += this.angularVelocity[axis] * dt;
    }
    // The cable guide limits travel to keep the open fingers inside the cabinet.
    const amplitude = Math.hypot(this.angle.x, this.angle.z);
    if (amplitude > limit) {
      const scale = limit / amplitude;
      this.angle.x *= scale;
      this.angle.z *= scale;
      const outward =
        this.angularVelocity.x * this.angle.x +
        this.angularVelocity.z * this.angle.z;
      if (outward > 0) {
        this.angularVelocity.x -= (outward * this.angle.x) / (limit * limit);
        this.angularVelocity.z -= (outward * this.angle.z) / (limit * limit);
      }
    }
    if (
      Math.hypot(
        this.angle.x,
        this.angle.z,
        this.angularVelocity.x,
        this.angularVelocity.z,
      ) < 1e-6 &&
      vx === 0 &&
      vz === 0
    ) {
      this.angle.x =
        this.angle.z =
        this.angularVelocity.x =
        this.angularVelocity.z =
          0;
    }
    const x = Math.sin(this.angle.x),
      z = Math.sin(this.angle.z);
    const up = Math.sqrt(Math.max(0, 1 - x * x - z * z));
    const norm = Math.hypot(x, z, 1 + up);
    Object.assign(this.rotation, {
      x: -z / norm,
      y: 0,
      z: x / norm,
      w: (1 + up) / norm,
    });
    Object.assign(this.position, {
      x: carriage.x + cable * x,
      y: MACHINE.railY - cable * up,
      z: carriage.z + cable * z,
    });
  }

  reset(carriage: Vec3) {
    this.angle.x = this.angle.z = 0;
    this.angularVelocity.x = this.angularVelocity.z = 0;
    this.velocity.x = this.velocity.z = 0;
    Object.assign(this.position, carriage);
    Object.assign(this.rotation, { x: 0, y: 0, z: 0, w: 1 });
  }
}
