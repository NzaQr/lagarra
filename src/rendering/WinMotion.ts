export const WIN_MOTION = {
  exitDuration: 1.05,
  flightDuration: 0.78,
  backdropDuration: 0.2,
  pause: 0.15,
  pulseDuration: 0.55,
  confettiDelay: 0.06,
  secondBurstDelay: 0.14,
  confettiDuration: 1.9,
  reducedDuration: 0.18,
} as const;

/** Integral of a continuous velocity curve: accelerate, hold, then brake.
 * Both velocity and acceleration are zero at the endpoints. No reversal.
 */
export function spinProgress(value: number) {
  const t = Math.max(0, Math.min(1, value));
  const acceleration = 0.12;
  const cruiseEnd = 0.32;
  const braking = 1 - cruiseEnd;
  const distance = acceleration / 2 + cruiseEnd - acceleration + braking / 2;
  if (t < acceleration) {
    const u = t / acceleration;
    return (acceleration * (u ** 3 - u ** 4 / 2)) / distance;
  }
  if (t < cruiseEnd) return (t - acceleration / 2) / distance;
  const u = (t - cruiseEnd) / braking;
  return Math.min(
    1,
    (cruiseEnd - acceleration / 2 + braking * (u - u ** 3 + u ** 4 / 2)) /
      distance,
  );
}

/** Presentation variation has no connection to the physics or prize selection. */
export function spinPlan(sequence: number) {
  const turns = sequence % 2 === 0 ? 1 : 2;
  return { turns, duration: turns === 1 ? 1.6 : 1.8 };
}
