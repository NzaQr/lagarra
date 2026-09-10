import { useEffect, useRef, type PointerEvent } from "react";
import type { InputController } from "../input/controller";

export function Joystick({
  controller,
  disabled,
}: {
  controller: InputController | null;
  disabled: boolean;
}) {
  const base = useRef<HTMLDivElement>(null);
  const stick = useRef<HTMLSpanElement>(null);
  const pointer = useRef<number | null>(null);
  const clear = () => {
    pointer.current = null;
    controller?.setTouch(0, 0);
    if (stick.current) {
      stick.current.style.setProperty("--stick-x", "0px");
      stick.current.style.setProperty("--stick-z", "0px");
    }
    base.current?.classList.remove("is-held");
  };
  useEffect(() => {
    if (disabled) clear();
  }, [disabled, controller]);
  useEffect(() => {
    const cancel = () => clear();
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      controller?.setTouch(0, 0);
    };
  }, [controller]);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointer.current || disabled) return;
    const box = event.currentTarget.getBoundingClientRect();
    const stickSize =
      stick.current?.getBoundingClientRect().width ?? box.width / 2;
    const travel = Math.max(1, (box.width - stickSize) / 2 - 5);
    const dx = (event.clientX - box.left - box.width / 2) / travel;
    const dz = (event.clientY - box.top - box.height / 2) / travel;
    const limit = Math.max(1, Math.hypot(dx, dz));
    controller?.setTouch(dx / limit, dz / limit);
    if (stick.current) {
      stick.current.style.setProperty(
        "--stick-x",
        String((dx / limit) * travel) + "px",
      );
      stick.current.style.setProperty(
        "--stick-z",
        String((dz / limit) * travel) + "px",
      );
    }
  };
  return (
    <div className="move-control">
      <div
        ref={base}
        className={`joystick ${disabled ? "is-disabled" : ""}`}
        role="group"
        aria-label="Move claw. Drag the joystick to move."
        onPointerDown={(event) => {
          if (
            disabled ||
            pointer.current !== null ||
            (event.pointerType === "mouse" && event.button !== 0)
          )
            return;
          event.preventDefault();
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.classList.add("is-held");
          move(event);
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (event.pointerId !== pointer.current) return;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          clear();
        }}
        onPointerCancel={(event) => {
          if (event.pointerId === pointer.current) clear();
        }}
        onLostPointerCapture={clear}
      >
        <span className="joystick-axis axis-x" />
        <span className="joystick-axis axis-z" />
        <span className="joystick-north">↑</span>
        <span className="joystick-south">↓</span>
        <span className="joystick-west">←</span>
        <span className="joystick-east">→</span>
        <span className="joystick-stick" ref={stick}>
          <span />
        </span>
      </div>
    </div>
  );
}
