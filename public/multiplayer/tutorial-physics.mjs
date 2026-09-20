import { canTravel } from '../room-layout.mjs';

export const WALK_SPEED = 1;
export const TURN_SPEED = 2 * Math.PI / 3;
const TAU = 2 * Math.PI;
const normalize = angle => ((angle % TAU) + TAU) % TAU;
const clamp = value => Math.max(0.4, Math.min(7.6, value));

// forward is signed metres; turn is signed radians. Heading zero faces +y.
// A segment sweep and binary search stop at the first wall, even when both
// requested endpoints lie on opposite sides of a thin wall.
export function advancePose(pose, forward, turn, doorOpen = false) {
  if (![pose?.x, pose?.y, pose?.heading, forward, turn].every(Number.isFinite)) {
    throw new TypeError('Pose and movement must be finite.');
  }
  const heading = normalize(pose.heading + turn);
  const x = pose.x + Math.sin(heading) * forward;
  const y = pose.y + Math.cos(heading) * forward;
  const candidate = { x: clamp(x), y: clamp(y), heading };
  const boundaryHit = Math.abs(candidate.x - x) > 1e-9 || Math.abs(candidate.y - y) > 1e-9;
  if (!forward || canTravel(pose, candidate, doorOpen)) {
    return { pose: candidate, blocked: boundaryHit };
  }
  let safe = 0, blocked = 1;
  for (let i = 0; i < 36; i++) {
    const fraction = (safe + blocked) / 2;
    const point = { x: pose.x + (candidate.x - pose.x) * fraction,
      y: pose.y + (candidate.y - pose.y) * fraction };
    if (canTravel(pose, point, doorOpen)) safe = fraction;
    else blocked = fraction;
  }
  return {
    pose: { x: pose.x + (candidate.x - pose.x) * safe,
      y: pose.y + (candidate.y - pose.y) * safe, heading },
    blocked: true,
  };
}

export function motionDuration(forward, turn) {
  if (![forward, turn].every(Number.isFinite) || (forward !== 0 && turn !== 0)) {
    throw new TypeError('A motion must be a finite walk or a finite turn.');
  }
  return 1000 * (Math.abs(forward) / WALK_SPEED + Math.abs(turn) / TURN_SPEED);
}

export function sampleMotion(motion, elapsedMs, doorOpen = false) {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(motion.durationMs) || motion.durationMs < 0) {
    throw new TypeError('Motion time must be finite and non-negative.');
  }
  const fraction = motion.durationMs > 0
    ? Math.max(0, Math.min(1, elapsedMs / motion.durationMs)) : 1;
  const result = advancePose(motion.origin, motion.forward * fraction, motion.turn * fraction, doorOpen);
  return { ...result, done: result.blocked || fraction >= 1 };
}
