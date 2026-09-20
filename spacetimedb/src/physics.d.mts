export type Pose = { x: number; y: number; heading: number };
export type Motion = {
  seq: number;
  origin: Pose;
  forward: number;
  turn: number;
  durationMs: number;
  elapsedMs: number;
};
export const WALK_SPEED: number;
export const TURN_SPEED: number;
export function advancePose(pose: Pose, forward: number, turn: number, doorOpen?: boolean): { pose: Pose; blocked: boolean };
export function motionDuration(forward: number, turn: number): number;
export function sampleMotion(motion: Motion, elapsedMs: number, doorOpen?: boolean): { pose: Pose; blocked: boolean; done: boolean };
