import { MACHINE, type MachineState, type Vec3 } from "./types";

const NEXT: Record<MachineState, readonly MachineState[]> = {
  settling: ["positioning"],
  positioning: ["dropping", "settling"],
  dropping: ["closing"],
  closing: ["lifting"],
  lifting: ["transporting"],
  transporting: ["releasing"],
  releasing: ["result", "resetting"],
  result: ["resetting", "settling"],
  resetting: ["positioning"],
};
export function canTransition(from: MachineState, to: MachineState): boolean {
  return NEXT[from].includes(to);
}
export function acceptsInput(state: MachineState): boolean {
  return state === "positioning";
}
export function cycleCamera(camera: number, state: MachineState): number {
  return acceptsInput(state) ? (camera + 1) % 2 : camera;
}
export function isInsideRetrieval(
  position: Vec3,
  radius: number | Vec3,
): boolean {
  const half =
    typeof radius === "number" ? { x: radius, y: radius, z: radius } : radius;
  // Match the compliant shaft contacts; this small tolerance cannot reach the bed lip.
  const shaftTolerance = 0.02;
  return (
    Math.abs(position.x - MACHINE.chuteX) + half.x <
      MACHINE.chuteHalf + shaftTolerance &&
    Math.abs(position.z - MACHINE.chuteZ) + half.z <
      MACHINE.chuteHalf + shaftTolerance &&
    position.y + half.y < MACHINE.bedY - 0.14 &&
    position.y - half.y > MACHINE.retrievalY - 0.16
  );
}
