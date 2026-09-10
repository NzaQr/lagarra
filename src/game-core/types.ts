export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}
export type MachineState =
  | "settling"
  | "positioning"
  | "dropping"
  | "closing"
  | "lifting"
  | "transporting"
  | "releasing"
  | "result"
  | "resetting";
export type PrizeModel =
  | "bear"
  | "bunny"
  | "cat"
  | "frog"
  | "penguin"
  | "bird"
  | "mushroom"
  | "capsule"
  | "star"
  | "seal";
export interface PrizeDefinition {
  id: string;
  name: string;
  model: PrizeModel;
  color: string;
  accent: string;
  radius: number;
  mass: number;
  friction: number;
  restitution: number;
  material: "plush" | "plastic" | "rubber";
}
export interface PrizePose {
  id: number;
  definition: PrizeDefinition;
  position: Vec3;
  rotation: Quat;
  collected: boolean;
}
export interface ArmPose {
  position: Vec3;
  rotation: Quat;
  length: number;
  radius: number;
}
export interface SimulationFrame {
  prizes: PrizePose[];
  claw: Vec3;
  carriage: Vec3;
  clawRotation: Quat;
  openness: number;
  arms: ArmPose[];
  state: MachineState;
  moveX: number;
  moveZ: number;
}
export interface GameSnapshot {
  state: MachineState;
  attempt: number;
  collected: PrizeDefinition[];
  remaining: number;
  lastPrize: PrizeDefinition | null;
  camera: number;
}
export interface ClawInput {
  moveX: number;
  moveZ: number;
  drop: boolean;
  switchCamera: boolean;
}
export const EMPTY_INPUT: ClawInput = {
  moveX: 0,
  moveZ: 0,
  drop: false,
  switchCamera: false,
};
// World coordinates: Y up, +Z toward the player. The bed surface is Y=1.35.
export const MACHINE = {
  moveSpeed: 1.05,
  liftSpeed: 0.68,
  transportSpeed: 0.9,
  returnSpeed: 1.35,
  halfWidth: 1.65,
  halfDepth: 1.25,
  bedY: 1.35,
  railY: 4.35,
  clawHomeY: 3.88,
  // These carriage limits leave room for the open fingers and their swing.
  boundsX: 1.02,
  minZ: -0.78,
  maxZ: 0.56,
  chuteX: -1.08,
  chuteZ: 0.64,
  chuteHalf: 0.43,
  chuteRimY: 1.45,
  retrievalY: 0.42,
  // Inner faces of the four visible glass panels.
  glassInnerX: 1.668,
  glassInnerBackZ: -1.268,
  glassInnerFrontZ: 1.273,
  glassBottomY: 1.5,
  glassTopY: 4.37,
} as const;
export type Quality = "balanced" | "high";
export interface GameActions {
  move: (x: number, z: number) => void;
  drop: () => void;
  switchCamera: () => void;
  playAgain: () => Promise<void>;
  rotatePrize: (dx: number, dy: number) => void;
  refill: () => void;
  setQuality: (quality: Quality) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
}
