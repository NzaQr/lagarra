import type { CSSProperties } from "react";
import type { PrizeDefinition } from "../game-core/types";
export function Icon({
  name,
  size = 20,
}: {
  name:
    | "claw"
    | "camera"
    | "sound"
    | "mute"
    | "settings"
    | "help"
    | "close"
    | "collection";
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "claw" && (
        <>
          <path d="M12 2v6m-3 0h6l2 3-2 3H9l-2-3 2-3ZM8 13l-4 5 3 4 3-2m6-7 4 5-3 4-3-2m-2-6v6" />
        </>
      )}
      {name === "camera" && (
        <>
          <path d="M5 8h3l1.5-2h5L16 8h3v10H5Z" />
          <circle cx="12" cy="12.5" r="2.5" />
          <path d="M4 4a11 11 0 0 1 15 0m0-3v3h-3M20 20a11 11 0 0 1-15 0m0 3v-3h3" />
        </>
      )}
      {(name === "sound" || name === "mute") && (
        <>
          <path d="m11 4-6 5H2v6h3l6 5V4Z" />
          {name === "sound" ? (
            <>
              <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
            </>
          ) : (
            <path d="m16 9 6 6m0-6-6 6" />
          )}
        </>
      )}
      {name === "settings" && (
        <>
          <path d="M4 3v18m8-18v18m8-18v18" />
          <path strokeWidth="4" d="M4 7v3m8 4v3m8-10v3" />
        </>
      )}
      {name === "help" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3v.1" />
        </>
      )}
      {name === "close" && <path d="m6 6 12 12M6 18 18 6" />}
      {name === "collection" && (
        <>
          <path d="M4 9h16v11H4ZM2 5h20v4H2Z" />
          <path d="M12 5v15m0-15C5 5 5-1 9 2l3 3Zm0 0c7 0 7-6 3-3l-3 3Z" />
        </>
      )}
    </svg>
  );
}

/** Small flat silhouettes echo the physical prize collection. */
export function PrizeIcon({
  prize,
  ghost = false,
}: {
  prize?: PrizeDefinition;
  ghost?: boolean;
}) {
  const model = prize?.model ?? "bear";
  return (
    <svg
      className={`prize-icon ${ghost ? "is-ghost" : ""}`}
      viewBox="0 0 64 72"
      aria-hidden="true"
      style={
        {
          "--prize-color": prize?.color ?? "#aebdcd",
          "--prize-accent": prize?.accent ?? "#e2edf7",
        } as CSSProperties
      }
    >
      <g fill="var(--prize-color)">
        {model === "bunny" ? (
          <>
            <ellipse cx="23" cy="18" rx="7" ry="16" />
            <ellipse cx="41" cy="18" rx="7" ry="16" />
          </>
        ) : model === "cat" ? (
          <path d="m13 32 2-23 16 14L47 9l4 23Z" />
        ) : model === "bear" ? (
          <>
            <circle cx="17" cy="20" r="10" />
            <circle cx="47" cy="20" r="10" />
          </>
        ) : model === "frog" ? (
          <>
            <circle cx="19" cy="22" r="10" />
            <circle cx="45" cy="22" r="10" />
          </>
        ) : null}
        {model === "star" ? (
          <path d="m32 7 9 18 20 4-14 15 2 21-17-9-18 9 3-21L2 29l21-4Z" />
        ) : (
          <>
            <ellipse cx="32" cy="49" rx="22" ry="20" />
            <ellipse cx="32" cy="33" rx="23" ry="19" />
          </>
        )}
      </g>
      {model !== "star" && (
        <ellipse
          cx="32"
          cy="49"
          rx="12"
          ry="13"
          fill="var(--prize-accent)"
          opacity=".65"
        />
      )}
      <g fill="#253649">
        <circle cx="24" cy="33" r="1.7" />
        <circle cx="40" cy="33" r="1.7" />
      </g>
    </svg>
  );
}
