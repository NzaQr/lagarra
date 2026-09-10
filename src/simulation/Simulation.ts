import RAPIER from "@dimforge/rapier3d-compat";
import { Suspension } from "./Suspension";
import { PRIZE_DEFINITIONS, prizeDefinition } from "../game-core/prizes";
import {
  acceptsInput,
  canTransition,
  cycleCamera,
  isInsideRetrieval,
} from "../game-core/rules";
import {
  MACHINE,
  type ArmPose,
  type ClawInput,
  type GameSnapshot,
  type MachineState,
  type PrizeDefinition,
  type PrizePose,
  type SimulationFrame,
  type Vec3,
} from "../game-core/types";

interface PhysicalPrize {
  id: number;
  definition: PrizeDefinition;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  inChute: boolean;
  collected: boolean;
}
const STEP = 1 / 60;
const RETRIEVAL_SENSOR_Y = 0.82;
let initialization: Promise<void> | undefined;
const HOME = { x: 0, y: MACHINE.clawHomeY, z: 0 };
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const approach = (a: number, b: number, step: number) =>
  a + clamp(b - a, -step, step);
const smooth = (t: number) => {
  const v = clamp(t, 0, 1);
  return v * v * (3 - 2 * v);
};
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

/** Kinematic articulated fingers push real dynamic bodies. No prize parenting or attachment. */
export class Simulation {
  readonly world: RAPIER.World;
  private prizes: PhysicalPrize[] = [];
  private fingers: { body: RAPIER.RigidBody; collider: RAPIER.Collider }[] = [];
  private sensor: RAPIER.Collider;
  private state: MachineState = "positioning";
  private elapsed = 0;
  private clock = 0;
  private accumulator = 0;
  private claw: Vec3 = { ...HOME };
  private suspension = new Suspension();
  private openness = 1;
  private arms: ArmPose[] = [];
  private attempt = 0;
  private collected: PrizeDefinition[] = [];
  private lastPrize: PrizeDefinition | null = null;
  private lastCollectionTime = -Infinity;
  private camera = 0;
  private targetY = 2.2;
  private moveX = 0;
  private moveZ = 0;
  private disposed = false;
  private pendingDrop = false;
  private pendingCamera = false;
  private edgeRecoil = { x: 0, z: 0 };
  private edgeContact = { x: 0, z: 0 };

  static async create(
    onSnapshot: (snapshot: GameSnapshot) => void = () => {},
  ): Promise<Simulation> {
    await (initialization ??= RAPIER.init());
    const simulation = new Simulation(onSnapshot);
    simulation.publish();
    return simulation;
  }

  private constructor(private onSnapshot: (snapshot: GameSnapshot) => void) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.world.numSolverIterations = 10;
    // Compliant contacts prevent a pinched prize from receiving a hard correction impulse.
    this.world.integrationParameters.contact_natural_frequency = 20;
    this.world.integrationParameters.maxCcdSubsteps = 4;
    this.buildCabinet();
    this.sensor = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        MACHINE.chuteHalf - 0.035,
        0.32,
        MACHINE.chuteHalf - 0.035,
      )
        .setTranslation(MACHINE.chuteX, RETRIEVAL_SENSOR_Y, MACHINE.chuteZ)
        .setSensor(true),
    );
    this.updateArmPoses();
    for (const [index, pose] of this.arms.entries()) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(pose.position.x, pose.position.y, pose.position.z)
          .setRotation(pose.rotation),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.capsule(pose.length / 2, pose.radius)
          .setFriction(index % 2 ? 1.7 : 0.7)
          .setRestitution(0)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply),
        body,
      );
      this.fingers.push({ body, collider });
    }
    this.spawn();
  }

  private block(
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
    friction = 0.8,
    restitution = 0.02,
  ): void {
    if (hx <= 0 || hz <= 0) return;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setFriction(friction)
        .setRestitution(restitution),
    );
  }

  private buildCabinet(): void {
    const {
      halfWidth: w,
      halfDepth: d,
      bedY: y,
      chuteX: x,
      chuteZ: z,
      chuteHalf: h,
    } = MACHINE;
    // Four bed rectangles leave a real hole. All other cabinet boundaries are physical.
    this.block((-w + x - h) / 2, y - 0.06, 0, (x - h + w) / 2, 0.06, d);
    this.block((w + x + h) / 2, y - 0.06, 0, (w - x - h) / 2, 0.06, d);
    this.block(x, y - 0.06, (-d + z - h) / 2, h, 0.06, (z - h + d) / 2);
    this.block(x, y - 0.06, (d + z + h) / 2, h, 0.06, (d - z - h) / 2);
    this.block(-w - 0.04, 2.7, 0, 0.04, 1.4, d);
    this.block(w + 0.04, 2.7, 0, 0.04, 1.4, d);
    this.block(0, 2.7, -d - 0.04, w, 1.4, 0.04);
    this.block(0, 2.7, d + 0.04, w, 1.4, 0.04);
    this.block(0, MACHINE.railY + 0.12, 0, w, 0.05, d);
    // The visible glass panels are also physical surfaces. Their restitution is
    // low, so prizes and the open claw settle after a small contact bounce.
    this.block(-1.68, 2.94, 0, 0.012, 1.425, 1.225, 0.18, 0.16);
    this.block(1.68, 2.94, 0, 0.012, 1.425, 1.225, 0.18, 0.16);
    this.block(0, 2.94, -1.28, 1.6, 1.425, 0.012, 0.18, 0.16);
    this.block(0, 3.02, 1.285, 1.6, 1.35, 0.012, 0.18, 0.16);
    this.block(x, MACHINE.retrievalY - 0.06, z, h, 0.06, h);
    // The raised chute rim keeps a resting pile out of the shaft.
    const shaftY = MACHINE.chuteRimY - 0.5;
    this.block(x - h - 0.025, shaftY, z, 0.025, 0.5, h + 0.05);
    this.block(x + h + 0.025, shaftY, z, 0.025, 0.5, h + 0.05);
    this.block(x, shaftY, z - h - 0.025, h, 0.5, 0.025);
    this.block(x, shaftY, z + h + 0.025, h, 0.5, 0.025);
  }

  private spawn(): void {
    let seed = 1739;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 30; i++) {
      const definition = prizeDefinition(i);
      let x: number, y: number, z: number;
      let tries = 0;
      do {
        x = (random() - 0.5) * 2.6;
        z = (random() - 0.5) * 1.8;
        y = 1.9 + random() * 1.35;
        tries++;
      } while (
        tries < 2000 &&
        ((Math.abs(x - MACHINE.chuteX) < MACHINE.chuteHalf + 0.42 &&
          Math.abs(z - MACHINE.chuteZ) < MACHINE.chuteHalf + 0.42) ||
          this.prizes.some((p) => {
            const t = p.body.translation();
            return (
              Math.hypot(t.x - x, t.y - y, t.z - z) <
              p.definition.radius + definition.radius + 0.035
            );
          }))
      );
      this.addPrize(i, definition, { x, y, z }, random() * Math.PI * 2);
    }
  }

  private addPrize(
    id: number,
    definition: PrizeDefinition,
    position: Vec3,
    angle = 0,
  ): PhysicalPrize {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({
          x: 0,
          y: Math.sin(angle / 2),
          z: 0,
          w: Math.cos(angle / 2),
        })
        .setLinearDamping(0.65)
        .setAngularDamping(1.2)
        .setCcdEnabled(true)
        .setAdditionalSolverIterations(3),
    );
    const r = definition.radius;
    const shape =
      definition.model === "penguin" || definition.model === "bunny"
        ? RAPIER.ColliderDesc.capsule(r * 0.23, r * 0.88)
        : definition.model === "seal"
          ? RAPIER.ColliderDesc.roundCuboid(
              r * 0.64,
              r * 0.43,
              r * 0.7,
              r * 0.4,
            )
          : RAPIER.ColliderDesc.ball(r);
    const collider = this.world.createCollider(
      shape
        .setMass(definition.mass)
        .setFriction(definition.friction)
        .setRestitution(definition.restitution),
      body,
    );
    const prize = {
      id,
      definition,
      body,
      collider,
      inChute: false,
      collected: false,
    };
    this.prizes.push(prize);
    return prize;
  }

  step(dt: number, input: ClawInput): void {
    if (this.disposed) return;
    this.pendingDrop ||= input.drop;
    this.pendingCamera ||= input.switchCamera;
    this.accumulator += clamp(dt, 0, 0.1);
    while (this.accumulator + 1e-8 >= STEP) {
      this.accumulator -= STEP;
      this.fixedStep({
        ...input,
        drop: this.pendingDrop,
        switchCamera: this.pendingCamera,
      });
      this.pendingDrop = false;
      this.pendingCamera = false;
    }
  }

  private fixedStep(input: ClawInput): void {
    const previousX = this.claw.x,
      previousZ = this.claw.z;
    this.elapsed += STEP;
    this.clock += STEP;
    this.moveX = 0;
    this.moveZ = 0;
    if (acceptsInput(this.state)) {
      if (input.switchCamera) {
        this.camera = cycleCamera(this.camera, this.state);
        this.publish();
      }
      const magnitude = Math.max(1, Math.hypot(input.moveX, input.moveZ));
      this.moveX = input.moveX / magnitude;
      this.moveZ = input.moveZ / magnitude;
      this.claw.x = this.moveAgainstGlass(
        "x",
        this.claw.x,
        this.moveX,
        -MACHINE.boundsX,
        MACHINE.boundsX,
      );
      this.claw.z = this.moveAgainstGlass(
        "z",
        this.claw.z,
        this.moveZ,
        MACHINE.minZ,
        MACHINE.maxZ,
      );
      if (input.drop) {
        this.attempt++;
        this.lastPrize = null;
        this.targetY = MACHINE.bedY + 0.79;
        for (const prize of this.prizes) {
          if (prize.collected) continue;
          const p = prize.body.translation();
          if (
            Math.hypot(
              p.x - this.suspension.position.x,
              p.z - this.suspension.position.z,
            ) <
            prize.definition.radius + 0.1
          ) {
            this.targetY = Math.max(this.targetY, p.y + 0.51);
          }
        }
        this.targetY = Math.min(this.targetY, MACHINE.clawHomeY - 0.45);
        this.transition("dropping");
      }
    }
    switch (this.state) {
      case "settling":
        if (this.elapsed > 3.4 && (this.maxSpeed() < 0.12 || this.elapsed > 6))
          this.transition("positioning");
        break;
      case "dropping":
        this.claw.y = approach(this.claw.y, this.targetY, 0.7 * STEP);
        if (Math.abs(this.claw.y - this.targetY) < 0.001)
          this.transition("closing");
        break;
      case "closing":
        this.openness = 1 - smooth(this.elapsed / 1.05);
        if (this.elapsed > 1.25) this.transition("lifting");
        break;
      case "lifting":
        this.claw.y = approach(
          this.claw.y,
          MACHINE.clawHomeY,
          MACHINE.liftSpeed * STEP * Math.min(1, this.elapsed * 3),
        );
        if (Math.abs(this.claw.y - MACHINE.clawHomeY) < 0.001) {
          this.claw.y = MACHINE.clawHomeY;
          this.transition("transporting");
        }
        break;
      case "transporting": {
        const dx = MACHINE.chuteX - this.claw.x,
          dz = MACHINE.chuteZ - this.claw.z;
        const distance = Math.hypot(dx, dz);
        const speed = Math.min(
          MACHINE.transportSpeed * STEP * Math.min(1, this.elapsed * 3),
          distance,
        );
        if (distance > 0) {
          this.claw.x += (dx / distance) * speed;
          this.claw.z += (dz / distance) * speed;
        }
        // Stop the carriage before opening. This lets the suspended load settle over the shaft.
        if (
          distance < 0.003 &&
          Math.hypot(
            this.suspension.position.x - MACHINE.chuteX,
            this.suspension.position.z - MACHINE.chuteZ,
          ) < 0.025
        )
          this.transition("releasing");
        break;
      }
      case "releasing":
        this.openness = smooth(this.elapsed / 0.7);
        if (this.elapsed > 2.4 && this.clock - this.lastCollectionTime >= 2.8)
          this.transition(this.lastPrize ? "result" : "resetting");
        break;
      case "resetting":
        this.claw.x = approach(this.claw.x, HOME.x, MACHINE.returnSpeed * STEP);
        this.claw.z = approach(this.claw.z, HOME.z, MACHINE.returnSpeed * STEP);
        this.openness = 1;
        if (Math.hypot(this.claw.x, this.claw.z) < 0.001) {
          this.claw.x = HOME.x;
          this.claw.z = HOME.z;
          this.transition("positioning");
        }
        break;
    }
    this.suspension.step(
      this.claw,
      (this.claw.x - previousX) / STEP,
      (this.claw.z - previousZ) / STEP,
      STEP,
      this.openness,
    );
    this.updateArmPoses();
    this.resolveGlassContacts();
    this.updateArmPoses();
    this.arms.forEach((pose, i) => {
      this.fingers[i].body.setNextKinematicTranslation(pose.position);
      this.fingers[i].body.setNextKinematicRotation(pose.rotation);
    });
    this.guideChutePrizes();
    this.world.step();
    this.detectCollection();
  }

  private moveAgainstGlass(
    axis: "x" | "z",
    position: number,
    input: number,
    min: number,
    max: number,
  ): number {
    const recoil = this.edgeRecoil[axis];
    this.edgeRecoil[axis] = approach(recoil, 0, 0.0045);
    const next = position + input * MACHINE.moveSpeed * STEP + recoil;
    const clamped = clamp(next, min, max);
    if (clamped !== next) {
      const side = next > max ? 1 : -1;
      if (this.edgeContact[axis] !== side) {
        this.edgeContact[axis] = side;
        this.edgeRecoil[axis] = -side * 0.024;
      }
      return clamped;
    }
    if (this.edgeContact[axis] !== 0 && input * this.edgeContact[axis] <= 0)
      this.edgeContact[axis] = 0;
    return clamped;
  }

  /** Kinematic fingers do not receive a correction impulse from fixed glass. */
  private resolveGlassContacts(): void {
    let correctionX = 0;
    let correctionZ = 0;
    for (const arm of this.arms) {
      const extentY = capsuleExtent(arm, "y");
      if (
        arm.position.y + extentY <= MACHINE.glassBottomY ||
        arm.position.y - extentY >= MACHINE.glassTopY
      )
        continue;
      const extentX = capsuleExtent(arm, "x");
      const extentZ = capsuleExtent(arm, "z");
      correctionX = Math.min(
        correctionX,
        MACHINE.glassInnerX - (arm.position.x + extentX),
      );
      correctionX = Math.max(
        correctionX,
        -MACHINE.glassInnerX - (arm.position.x - extentX),
      );
      correctionZ = Math.min(
        correctionZ,
        MACHINE.glassInnerFrontZ - (arm.position.z + extentZ),
      );
      correctionZ = Math.max(
        correctionZ,
        MACHINE.glassInnerBackZ - (arm.position.z - extentZ),
      );
    }
    if (Math.abs(correctionX) > 1e-8) {
      this.claw.x += correctionX;
      this.suspension.position.x += correctionX;
    }
    if (Math.abs(correctionZ) > 1e-8) {
      this.claw.z += correctionZ;
      this.suspension.position.z += correctionZ;
    }
  }

  private updateArmPoses(): void {
    this.arms = [];
    for (let arm = 0; arm < 3; arm++) {
      const angle = (arm * Math.PI * 2) / 3 + Math.PI / 2;
      const c = Math.cos(angle),
        s = Math.sin(angle);
      const upperAngle = 0.3 + this.openness * 0.62;
      const elbowR = 0.14 + Math.sin(upperAngle) * 0.44;
      const elbowY = -0.07 - Math.cos(upperAngle) * 0.44;
      const tipAngle = -0.98 + this.openness * 1.17;
      const tipR = elbowR + Math.sin(tipAngle) * 0.31;
      const tipY = elbowY - Math.cos(tipAngle) * 0.31;
      const point = (radius: number, y: number): Vec3 => {
        const x = c * radius,
          z = s * radius;
        const q = this.suspension.rotation,
          p = this.suspension.position;
        const tx = -2 * q.z * y;
        const ty = 2 * (q.z * x - q.x * z);
        const tz = 2 * q.x * y;
        return {
          x: p.x + x + q.w * tx - q.z * ty,
          y: p.y + y + q.w * ty + q.z * tx - q.x * tz,
          z: p.z + z + q.w * tz + q.x * ty,
        };
      };
      const points = [
        point(0.14, -0.07),
        point(elbowR, elbowY),
        point(tipR, tipY),
      ];
      for (let segment = 0; segment < 2; segment++) {
        const a = points[segment],
          b = points[segment + 1];
        const dx = b.x - a.x,
          dy = b.y - a.y,
          dz = b.z - a.z;
        const length = Math.hypot(dx, dy, dz);
        // Quaternion from the Y axis to the segment direction.
        const qx = dz / length,
          qz = -dx / length,
          qw = 1 + dy / length;
        const ql = Math.hypot(qx, qz, qw);
        const rotation =
          ql > 1e-6
            ? { x: qx / ql, y: 0, z: qz / ql, w: qw / ql }
            : { x: 1, y: 0, z: 0, w: 0 };
        this.arms.push({
          position: {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            z: (a.z + b.z) / 2,
          },
          rotation,
          length,
          radius: segment ? 0.052 : 0.042,
        });
      }
    }
  }

  private guideChutePrizes(): void {
    for (const prize of this.prizes) {
      if (prize.collected) continue;
      const position = prize.body.translation();
      if (!prize.inChute) {
        // The center must be inside the opening and the bottom at the rim.
        // Contact with the outside of the rim or flight above it is not entry.
        const openingHalf = MACHINE.chuteHalf - 0.025;
        if (
          Math.abs(position.x - MACHINE.chuteX) >= openingHalf ||
          Math.abs(position.z - MACHINE.chuteZ) >= openingHalf ||
          position.y - this.prizeExtents(prize).y > MACHINE.chuteRimY
        )
          continue;
        prize.inChute = true;
        // Once inside, a prize cannot wedge against the shaft or another prize.
        // Kinematic motion guarantees passage, even if several prizes enter together.
        prize.body.setBodyType(
          RAPIER.RigidBodyType.KinematicPositionBased,
          true,
        );
        prize.collider.setSensor(true);
        // The fixed retrieval sensor must also detect this kinematic prize.
        prize.collider.setActiveCollisionTypes(
          RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED,
        );
      }
      const half = this.prizeExtents(prize);
      const safeX = MACHINE.chuteHalf - half.x - 0.025;
      const safeZ = MACHINE.chuteHalf - half.z - 0.025;
      const targetX = clamp(
        position.x,
        MACHINE.chuteX - safeX,
        MACHINE.chuteX + safeX,
      );
      const targetZ = clamp(
        position.z,
        MACHINE.chuteZ - safeZ,
        MACHINE.chuteZ + safeZ,
      );
      prize.body.setNextKinematicTranslation({
        x: approach(position.x, targetX, 1.4 * STEP),
        y: approach(position.y, RETRIEVAL_SENSOR_Y, 1.4 * STEP),
        z: approach(position.z, targetZ, 1.4 * STEP),
      });
    }
  }

  private detectCollection(): void {
    for (const prize of this.prizes) {
      if (prize.collected) continue;
      if (
        this.world.intersectionPair(this.sensor, prize.collider) &&
        isInsideRetrieval(prize.body.translation(), this.prizeExtents(prize))
      ) {
        prize.collected = true;
        this.collected.push(prize.definition);
        this.lastPrize = prize.definition;
        this.lastCollectionTime = this.clock;
        // Retain a render pose for the retrieval animation; the body leaves the active pile.
        prize.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        prize.collider.setEnabled(false);
        this.publish();
      }
    }
  }

  private prizeExtents(prize: PhysicalPrize): Vec3 {
    const { radius: r, model } = prize.definition;
    const q = prize.body.rotation();
    const axes = [
      {
        x: 1 - 2 * (q.y * q.y + q.z * q.z),
        y: 2 * (q.x * q.y + q.z * q.w),
        z: 2 * (q.x * q.z - q.y * q.w),
      },
      {
        x: 2 * (q.x * q.y - q.z * q.w),
        y: 1 - 2 * (q.x * q.x + q.z * q.z),
        z: 2 * (q.y * q.z + q.x * q.w),
      },
      {
        x: 2 * (q.x * q.z + q.y * q.w),
        y: 2 * (q.y * q.z - q.x * q.w),
        z: 1 - 2 * (q.x * q.x + q.y * q.y),
      },
    ];
    if (model === "penguin" || model === "bunny")
      return {
        x: r * (0.88 + Math.abs(axes[1].x) * 0.23),
        y: r * (0.88 + Math.abs(axes[1].y) * 0.23),
        z: r * (0.88 + Math.abs(axes[1].z) * 0.23),
      };
    if (model === "seal") {
      const extent = (axis: "x" | "y" | "z") =>
        r *
        (0.4 +
          Math.abs(axes[0][axis]) * 0.64 +
          Math.abs(axes[1][axis]) * 0.43 +
          Math.abs(axes[2][axis]) * 0.7);
      return { x: extent("x"), y: extent("y"), z: extent("z") };
    }
    return { x: r, y: r, z: r };
  }

  private transition(next: MachineState): void {
    if (!canTransition(this.state, next))
      throw new Error(`Invalid machine transition: ${this.state} → ${next}`);
    this.state = next;
    this.elapsed = 0;
    this.publish();
  }
  private publish(): void {
    this.onSnapshot(this.snapshot());
  }
  snapshot(): GameSnapshot {
    return {
      state: this.state,
      attempt: this.attempt,
      collected: [...this.collected],
      remaining: this.prizes.filter((p) => !p.collected).length,
      lastPrize: this.lastPrize,
      camera: this.camera,
    };
  }
  getFrame(): SimulationFrame {
    const prizes: PrizePose[] = this.prizes.map((p) => ({
      id: p.id,
      definition: p.definition,
      position: { ...p.body.translation() },
      rotation: { ...p.body.rotation() },
      collected: p.collected,
    }));
    return {
      prizes,
      claw: { ...this.suspension.position },
      carriage: { ...this.claw },
      clawRotation: { ...this.suspension.rotation },
      openness: this.openness,
      arms: this.arms,
      state: this.state,
      moveX: this.moveX,
      moveZ: this.moveZ,
    };
  }
  playAgain(): void {
    if (this.state === "result") {
      this.lastPrize = null;
      this.transition("resetting");
    }
  }
  refill(): void {
    if (this.state !== "result" && this.state !== "positioning") return;
    this.prizes.forEach((p) => this.world.removeRigidBody(p.body));
    this.prizes = [];
    this.lastPrize = null;
    this.claw = { ...HOME };
    this.edgeRecoil = { x: 0, z: 0 };
    this.edgeContact = { x: 0, z: 0 };
    this.suspension.reset(this.claw);
    this.openness = 1;
    this.updateArmPoses();
    this.spawn();
    this.state = "positioning";
    this.elapsed = 0;
    this.publish();
  }
  private maxSpeed(): number {
    return Math.max(
      0,
      ...this.prizes
        .filter((p) => !p.collected)
        .map((p) => {
          const v = p.body.linvel();
          return Math.hypot(v.x, v.y, v.z);
        }),
    );
  }
  debugInfo(): {
    maxSpeed: number;
    activeBodies: number;
    contacts: number;
    time: number;
  } {
    let contacts = 0;
    this.fingers.forEach((f) =>
      this.world.contactPairsWith(f.collider, () => contacts++),
    );
    return {
      maxSpeed: this.maxSpeed(),
      activeBodies: this.prizes.filter(
        (p) => !p.collected && !p.body.isSleeping(),
      ).length,
      contacts,
      time: this.clock,
    };
  }
  debugRender(): ReturnType<RAPIER.World["debugRender"]> {
    return this.world.debugRender();
  }
  /** Deterministic scenario fixtures for development validation; never called by game input. */
  debugSetPrizes(
    entries: { definition?: PrizeDefinition; position: Vec3 }[],
  ): void {
    this.prizes.forEach((p) => this.world.removeRigidBody(p.body));
    this.prizes = [];
    entries.forEach((p, i) =>
      this.addPrize(i, p.definition ?? PRIZE_DEFINITIONS[0], p.position),
    );
    this.collected = [];
    this.lastPrize = null;
    this.state = "positioning";
    this.elapsed = 0;
    this.edgeRecoil = { x: 0, z: 0 };
    this.edgeContact = { x: 0, z: 0 };
    this.publish();
  }
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.world.free();
    }
  }
}
