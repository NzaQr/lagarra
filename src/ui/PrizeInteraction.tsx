import { useRef, type ReactNode } from "react";

/** Mouse, touch, and keyboard share the same two rotation axes. */
export function PrizeInteraction({
  name,
  onRotate,
  className = "",
  children,
}: {
  name: string;
  onRotate: (dx: number, dy: number) => void;
  className?: string;
  children?: ReactNode;
}) {
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  return (
    <div
      className={`prize-interaction ${className}`}
      role="group"
      tabIndex={0}
      aria-label={`Rotate ${name}. Drag or use arrow keys.`}
      onPointerDown={(event) => {
        if (drag.current || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.dataset.pointer = "true";
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const previous = drag.current;
        if (!previous || previous.id !== event.pointerId) return;
        onRotate(
          (event.clientX - previous.x) * 0.012,
          (event.clientY - previous.y) * 0.012,
        );
        previous.x = event.clientX;
        previous.y = event.clientY;
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onBlur={(event) => {
        drag.current = null;
        delete event.currentTarget.dataset.pointer;
      }}
      onKeyDown={(event) => {
        delete event.currentTarget.dataset.pointer;
        const directions: Record<string, [number, number]> = {
          ArrowLeft: [-0.18, 0],
          ArrowRight: [0.18, 0],
          ArrowUp: [0, -0.18],
          ArrowDown: [0, 0.18],
        };
        const direction = directions[event.key];
        if (direction) {
          event.preventDefault();
          event.stopPropagation();
          onRotate(...direction);
        }
      }}
    >
      {children}
    </div>
  );
}
