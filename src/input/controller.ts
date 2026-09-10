import type { GameActions } from "../game-core/types";

export function normalizeJoystick(x: number, z: number, deadZone = 0.12) {
  const magnitude = Math.hypot(x, z);
  if (magnitude <= deadZone) return { x: 0, z: 0 };
  const strength = Math.min(1, (magnitude - deadZone) / (1 - deadZone));
  return { x: (x / magnitude) * strength, z: (z / magnitude) * strength };
}

const movementKeys = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
]);

/** Both input surfaces submit one vector to the same game action. */
export class InputController {
  private keys = new Set<string>();
  private touch = { x: 0, z: 0 };
  private enabled = false;
  constructor(
    private actions: Pick<GameActions, "move" | "drop" | "switchCamera">,
  ) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  setTouch(x: number, z: number) {
    this.touch = this.enabled ? normalizeJoystick(x, z) : { x: 0, z: 0 };
    this.flush();
  }

  keyDown(code: string, repeat = false) {
    if (!this.enabled) return false;
    if (movementKeys.has(code)) {
      this.keys.add(code);
      this.flush();
      return true;
    }
    if (code === "Space") {
      if (!repeat) this.actions.drop();
      return true;
    }
    if (code === "KeyC") {
      if (!repeat) this.actions.switchCamera();
      return true;
    }
    return false;
  }

  keyUp(code: string) {
    const held = this.keys.delete(code);
    if (held) this.flush();
    return held;
  }

  clear() {
    this.keys.clear();
    this.touch = { x: 0, z: 0 };
    this.actions.move(0, 0);
  }

  private flush() {
    const pressed = (...codes: string[]) =>
      codes.some((code) => this.keys.has(code)) ? 1 : 0;
    const x =
      this.touch.x +
      pressed("KeyD", "ArrowRight") -
      pressed("KeyA", "ArrowLeft");
    const z =
      this.touch.z + pressed("KeyS", "ArrowDown") - pressed("KeyW", "ArrowUp");
    const length = Math.max(1, Math.hypot(x, z));
    this.actions.move(
      this.enabled ? x / length : 0,
      this.enabled ? z / length : 0,
    );
  }

  attach(target: Window = window) {
    const editable = (event: KeyboardEvent) =>
      event.target instanceof Element &&
      Boolean(
        event.target.closest(
          'input, textarea, select, [contenteditable="true"], dialog[open]',
        ),
      );
    const down = (event: KeyboardEvent) => {
      const nativeButtonSpace =
        event.code === "Space" &&
        event.target instanceof Element &&
        Boolean(event.target.closest("button"));
      if (
        !editable(event) &&
        !nativeButtonSpace &&
        this.keyDown(event.code, event.repeat)
      )
        event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      if (this.keyUp(event.code)) event.preventDefault();
    };
    const clear = () => this.clear();
    const visibility = () => {
      if (document.hidden) clear();
    };
    target.addEventListener("keydown", down);
    target.addEventListener("keyup", up);
    target.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clear();
      target.removeEventListener("keydown", down);
      target.removeEventListener("keyup", up);
      target.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }
}
