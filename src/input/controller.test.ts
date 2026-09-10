import { describe, expect, it, vi } from "vitest";
import { InputController, normalizeJoystick } from "./controller";
function setup() {
  const actions = { move: vi.fn(), drop: vi.fn(), switchCamera: vi.fn() };
  const input = new InputController(actions);
  input.setEnabled(true);
  return { input, actions };
}
describe("shared claw input", () => {
  it("applies a dead zone and clamps analog movement", () => {
    expect(normalizeJoystick(0.06, 0.06)).toEqual({ x: 0, z: 0 });
    const vector = normalizeJoystick(3, 4);
    expect(Math.hypot(vector.x, vector.z)).toBeCloseTo(1);
    expect(vector).toEqual({ x: 0.6, z: 0.8 });
  });
  it("normalizes diagonal keys and combines touch without extra speed", () => {
    const { input, actions } = setup();
    input.keyDown("KeyW");
    input.keyDown("KeyD");
    let [x, z] = actions.move.mock.lastCall!;
    expect(x).toBeGreaterThan(0);
    expect(z).toBeLessThan(0);
    expect(Math.hypot(x, z)).toBeCloseTo(1);
    input.setTouch(1, 1);
    [x, z] = actions.move.mock.lastCall!;
    expect(Math.hypot(x, z)).toBeCloseTo(1);
  });
  it("clears held input and rejects all controls during the automatic sequence", () => {
    const { input, actions } = setup();
    input.keyDown("ArrowLeft");
    input.setEnabled(false);
    expect(actions.move).toHaveBeenLastCalledWith(0, 0);
    input.keyDown("Space");
    input.keyDown("KeyC");
    input.setTouch(1, 0);
    expect(actions.drop).not.toHaveBeenCalled();
    expect(actions.switchCamera).not.toHaveBeenCalled();
    expect(actions.move).toHaveBeenLastCalledWith(0, 0);
    input.setEnabled(true);
    input.keyDown("KeyW");
    expect(actions.move).toHaveBeenLastCalledWith(0, -1);
  });
  it("does not repeat drop or camera on a held key", () => {
    const { input, actions } = setup();
    input.keyDown("Space");
    input.keyDown("Space", true);
    input.keyDown("KeyC");
    input.keyDown("KeyC", true);
    expect(actions.drop).toHaveBeenCalledTimes(1);
    expect(actions.switchCamera).toHaveBeenCalledTimes(1);
  });
  it("releasing one alias does not release another held alias", () => {
    const { input, actions } = setup();
    input.keyDown("KeyW");
    input.keyDown("ArrowUp");
    input.keyUp("KeyW");
    expect(actions.move).toHaveBeenLastCalledWith(0, -1);
    input.keyUp("ArrowUp");
    expect(actions.move).toHaveBeenLastCalledWith(0, 0);
  });
});
