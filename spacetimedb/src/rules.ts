import { motionDuration, sampleMotion, type Motion, type Pose } from './physics.mjs';
import { DOOR, LOCATIONS, distance, hasLineOfSight, isNearDoor, occupiesDoor } from './geometry.mjs';

export const ROUND_MS = 180_000;
export const HEADSTART_MS = 8_000;
export const RECONNECT_MS = 30_000;
export const STEP_MS = 50;
export const MAX_CATCHUP_MS = 100;
export const MAX_INTERACTION_ATTEMPTS = 5;
export type Role = 'hunter' | 'survivor';
export type Outcome = 'captured' | 'escaped' | 'timeout' | 'abandoned' | 'interrupted' | 'attempts_exhausted';
export type DoorEvent = { seq: number; openedAtMs: number; x: number; y: number };
type ActiveMotion = Motion & { expiresAtMs: number };
export type PlayerState = {
  id: string;
  role: Role;
  pose: Pose;
  online: boolean;
  motion: ActiveMotion | null;
  lastProcessedInputSeq: number;
  notice: string;
  interactionAttempts?: number;
};
export type ChaseState = {
  roundId: string;
  startedAtMs: number;
  serverTimeMs: number;
  pausedAtMs: number | null;
  doorOpen: boolean;
  doorEvent?: DoorEvent;
  hasKey: boolean;
  players: PlayerState[];
  outcome: Outcome | null;
  winner: Role | null;
  revision: number;
};
export type InputCommand = { roundId: string; seq: number; kind: string; value: string };
export class RuleError extends Error {}

export function createChase(
  roundId: string,
  players: { id: string; role: string; online: boolean }[],
  nowMs: number,
): ChaseState {
  if (!roundId || !Number.isFinite(nowMs) || players.length !== 2
    || new Set(players.map(player => player.id)).size !== 2
    || !players.every(player => player.online)
    || !players.some(player => player.role === 'hunter')
    || !players.some(player => player.role === 'survivor')) {
    throw new RuleError('A round requires two online players with different roles.');
  }
  return {
    roundId, startedAtMs: nowMs, serverTimeMs: nowMs, pausedAtMs: null,
    doorOpen: false, doorEvent: {seq:0,openedAtMs:0,...DOOR.center},
    hasKey: false, outcome: null, winner: null, revision: 1,
    players: players.map(player => ({
      id: player.id, role: player.role as Role, online: true,
      pose: player.role === 'hunter'
        ? { x: 2, y: 7, heading: Math.PI } : { x: 2, y: 1, heading: 0 },
      motion: null, lastProcessedInputSeq: 0, interactionAttempts: 0,
      notice: player.role === 'hunter' ? 'Wait for the head start, then listen for the survivor heartbeat.'
        : 'Find the old motor, then reach the rain at the exit.',
    })),
  };
}

function playerById(state: ChaseState, id: string): PlayerState {
  const player = state.players.find(candidate => candidate.id === id);
  if (!player) throw new RuleError('You are not a player in this round.');
  return player;
}

function effectiveTime(state: ChaseState): number {
  return state.pausedAtMs ?? state.serverTimeMs;
}

export function headstartSeconds(state: ChaseState): number {
  return state.outcome ? 0 : Math.max(0, Math.ceil((state.startedAtMs + HEADSTART_MS - effectiveTime(state)) / 1000));
}

export function finishChase(state: ChaseState, outcome: Outcome, winner: Role | null): void {
  if (state.outcome) return;
  state.outcome = outcome;
  state.winner = winner;
  if (state.pausedAtMs !== null) state.startedAtMs += state.serverTimeMs - state.pausedAtMs;
  state.pausedAtMs = null;
  for (const player of state.players) player.motion = null;
  state.revision++;
}

// One authoritative clock owns progress. Extra input calls cannot add simulated
// time. A delayed callback catches up at most 100 ms; overdue movement expires
// instead of teleporting through the missed wall-clock interval.
export function advanceChase(state: ChaseState, requestedNowMs: number): void {
  if (!Number.isFinite(requestedNowMs)) throw new RuleError('Invalid server time.');
  if (state.outcome) return;
  const previous = state.serverTimeMs;
  const nowMs = Math.max(previous, requestedNowMs);
  state.serverTimeMs = nowMs;
  if (state.pausedAtMs !== null) {
    if (nowMs - state.pausedAtMs >= RECONNECT_MS) finishChase(state, 'interrupted', null);
    if (nowMs !== previous) state.revision++;
    return;
  }
  const deadline = state.startedAtMs + ROUND_MS;
  let cursor = previous;
  const end = Math.min(nowMs, previous + MAX_CATCHUP_MS, deadline);
  while (cursor < end) {
    const next = Math.min(end, cursor + STEP_MS);
    for (const player of state.players) {
      const motion = player.motion;
      if (!motion || !player.online) continue;
      const dt = Math.max(0, Math.min(next, motion.expiresAtMs) - cursor);
      if (dt > 0) {
        motion.elapsedMs = Math.min(motion.durationMs, motion.elapsedMs + dt);
        const sampled = sampleMotion(motion, motion.elapsedMs, state.doorOpen);
        player.pose = sampled.pose;
        if (sampled.done) {
          player.motion = null;
          if (sampled.blocked) player.notice = 'You reached the edge of the play area.';
        }
      }
    }
    cursor = next;
  }
  for (const player of state.players) {
    if (player.motion && nowMs >= player.motion.expiresAtMs) player.motion = null;
  }
  if (nowMs >= deadline) finishChase(state, 'timeout', 'hunter');
  if (nowMs !== previous) state.revision++;
}

export function setPlayerOnline(state: ChaseState, id: string, online: boolean, nowMs: number): void {
  advanceChase(state, nowMs);
  const player = playerById(state, id);
  player.online = online;
  player.motion = null;
  if (!state.outcome) {
    if (!online && state.pausedAtMs === null) {
      state.pausedAtMs = state.serverTimeMs;
      for (const candidate of state.players) candidate.motion = null;
    } else if (state.pausedAtMs !== null && state.players.every(candidate => candidate.online)) {
      // Both the round deadline and the head start pause for a missing player.
      state.startedAtMs += state.serverTimeMs - state.pausedAtMs;
      state.pausedAtMs = null;
      for (const candidate of state.players) candidate.notice = 'Both players are back. The chase has resumed.';
    }
  }
  state.revision++;
}

export function abandonChase(state: ChaseState, id: string, nowMs: number): void {
  advanceChase(state, nowMs);
  const player = playerById(state, id);
  player.online = false;
  player.motion = null;
  if (!state.outcome) {
    const other = state.players.find(candidate => candidate.id !== id)!;
    finishChase(state, 'abandoned', other.role);
  }
  state.revision++;
}

function nearSource(state: ChaseState, player: PlayerState, sourceId: string): boolean {
  const source = LOCATIONS.find(candidate => candidate.id === sourceId)!;
  return distance(player.pose, source) <= 1.1
    && hasLineOfSight(player.pose, source, state.doorOpen);
}

export function canInteract(state: ChaseState, id: string): boolean {
  const player = playerById(state, id);
  if (state.outcome || state.pausedAtMs !== null || !player.online) return false;
  if (player.role === 'hunter') {
    const target = state.players.find(candidate => candidate.role === 'survivor')!;
    return headstartSeconds(state) === 0 && target.online
      && distance(player.pose, target.pose) <= 0.8
      && hasLineOfSight(player.pose, target.pose, state.doorOpen);
  }
  return !state.hasKey ? nearSource(state, player, 'a') : nearSource(state, player, 'b');
}

function doorEventFor(state: ChaseState): DoorEvent {
  const event=state.doorEvent;
  // Older persisted rounds have no event. Do not synthesize an opening sound.
  const valid=event&&Number.isSafeInteger(event.seq)&&event.seq>=0
    &&Number.isFinite(event.openedAtMs)&&event.openedAtMs>=0;
  return {seq:valid?event.seq:0,openedAtMs:valid?event.openedAtMs:0,...DOOR.center};
}

function rebaseMotions(state: ChaseState): void {
  // Sampling against a newly closed door must start at the present pose. Using
  // the original path could move a player back across a door already passed.
  for (const player of state.players) {
    const motion = player.motion;
    if (!motion) continue;
    const remaining = 1 - motion.elapsedMs / motion.durationMs;
    player.motion = {
      ...motion, origin: { ...player.pose }, forward: motion.forward * remaining,
      turn: motion.turn * remaining, durationMs: motion.durationMs - motion.elapsedMs, elapsedMs: 0,
    };
  }
}

function validateCommand(command: InputCommand): void {
  if (!Number.isInteger(command.seq) || command.seq < 1 || command.seq > 0xffff_ffff) {
    throw new RuleError('Input sequence must be an unsigned 32-bit integer starting at one.');
  }
  const allowed: Record<string, string[]> = {
    move: ['forward', 'back'], turn: ['left', 'right'], stop: ['', 'stop'],
    door: ['toggle', 'open', 'close'], interact: ['inspect'],
  };
  if (!Object.hasOwn(allowed, command.kind) || !allowed[command.kind].includes(command.value)) {
    throw new RuleError('Unknown input command.');
  }
}

export function applyInput(state: ChaseState, id: string, command: InputCommand, nowMs: number): void {
  validateCommand(command);
  const player = playerById(state, id);
  if (command.roundId !== state.roundId) throw new RuleError('This input belongs to a different round.');
  if (command.seq <= player.lastProcessedInputSeq) throw new RuleError('Input sequence has already been processed.');
  if (state.outcome) throw new RuleError('The round has ended.');
  advanceChase(state, nowMs);
  // Persist a timeout/grace expiration reached by this call, without applying
  // the late command or throwing and rolling back the authoritative result.
  if (state.outcome) return;
  if (!player.online || state.pausedAtMs !== null) throw new RuleError('The chase is paused while a player reconnects.');
  if (player.role === 'hunter' && headstartSeconds(state) > 0 && command.kind !== 'stop') {
    throw new RuleError('The survivor still has a head start.');
  }
  if (command.kind === 'door') {
    if (!isNearDoor(player.pose) || !hasLineOfSight(player.pose, DOOR.center, true)) {
      throw new RuleError('Move closer to the door.');
    }
    const open = command.value === 'toggle' ? !state.doorOpen : command.value === 'open';
    if (!open && state.players.some(candidate => occupiesDoor(candidate.pose))) {
      throw new RuleError('The doorway is occupied.');
    }
    if (open !== state.doorOpen) {
      rebaseMotions(state);
      state.doorOpen = open;
      if(open)state.doorEvent={seq:doorEventFor(state).seq+1,openedAtMs:state.serverTimeMs,...DOOR.center};
    }
    player.notice = state.doorOpen ? 'The door is open.' : 'The door is closed.';
  } else if (command.kind === 'move' || command.kind === 'turn') {
    const forward = command.kind === 'move' ? (command.value === 'forward' ? 0.5 : -0.5) : 0;
    const turn = command.kind === 'turn' ? (command.value === 'right' ? 1 : -1) * Math.PI / 6 : 0;
    const durationMs = motionDuration(forward, turn);
    player.motion = {
      seq: command.seq, origin: { ...player.pose }, forward, turn, durationMs,
      elapsedMs: 0, expiresAtMs: state.serverTimeMs + durationMs,
    };
    player.notice = '';
  } else if (command.kind === 'stop') {
    player.motion = null;
    player.notice = '';
  } else {
    const attempts = player.interactionAttempts ?? 0;
    if (attempts >= MAX_INTERACTION_ATTEMPTS) throw new RuleError('No interaction attempts remain.');
    player.interactionAttempts = attempts + 1;
    if (canInteract(state, id)) {
      if (player.role === 'hunter') finishChase(state, 'captured', 'hunter');
      else if (state.hasKey) finishChase(state, 'escaped', 'survivor');
      else {
        state.hasKey = true;
        player.notice = 'You found the old motor. Reach the rain at the exit.';
      }
    } else {
      player.notice = player.role === 'hunter' ? 'No survivor within reach.'
        : state.hasKey ? 'The exit is not within reach.' : 'The old motor is not within reach.';
    }
    if (player.interactionAttempts >= MAX_INTERACTION_ATTEMPTS && !state.outcome) {
      finishChase(state, 'attempts_exhausted', player.role === 'hunter' ? 'survivor' : 'hunter');
    }
  }
  player.lastProcessedInputSeq = command.seq;
  state.revision++;
}

function publicMotion(motion: ActiveMotion | null): Motion | null {
  if (!motion) return null;
  const { seq, origin, forward, turn, durationMs, elapsedMs } = motion;
  return { seq, origin: { ...origin }, forward, turn, durationMs, elapsedMs };
}

export function snapshotFor(state: ChaseState, id: string, restartVotes: number) {
  const me = playerById(state, id);
  const paused = state.pausedAtMs !== null && state.outcome === null;
  const walking = (player: PlayerState) => !!player.motion?.forward && player.online && !paused && !state.outcome;
  const objective = me.role === 'hunter' ? 'Listen for the survivor heartbeat. Get close and interact to catch the survivor.'
    : state.hasKey ? 'Reach the rain and interact to escape.' : 'Find the old motor and interact to inspect it.';
  const survivor=state.players.find(player=>player.role==='survivor');
  const proximity=me.role==='hunter'&&me.online&&survivor?.online&&!paused&&!state.outcome
    ? Math.max(0,Math.min(1,(8-distance(me.pose,survivor.pose))/6)):0;
  return {
    serverTimeMs: state.serverTimeMs, roundId: state.roundId,mapId:'square-open-v2',
    self: { ...me.pose, moving: walking(me) }, role: me.role, doorOpen: state.doorOpen,
    doorEvent:doorEventFor(state),
    ...(me.role==='hunter'?{heartbeatIntensity:proximity*proximity*(3-2*proximity),
      heartbeatSource:proximity>0?{x:survivor!.pose.x,y:survivor!.pose.y}:null}:{}),
    motion: publicMotion(me.motion), lastProcessedInputSeq: me.lastProcessedInputSeq,
    sources: LOCATIONS.map((source, index) => ({ ...source, soundId: ['motor', 'rain', 'fire'][index] })),
    audiblePlayers: state.players.filter(player => me.role === 'survivor' && player.id !== id && walking(player)
      && distance(me.pose, player.pose) <= 5).map(player => ({ id: player.id, ...player.pose, moving: true })),
    objective,
    notice: paused ? `Chase paused. Waiting for reconnection (${Math.max(0, Math.ceil((RECONNECT_MS - (state.serverTimeMs - state.pausedAtMs!)) / 1000))}s).`
      : state.outcome === 'interrupted' ? 'The chase ended because a player could not reconnect.'
      : state.outcome === 'abandoned' ? 'A player left the chase.' : me.notice,
    outcome: state.outcome, winner: state.winner,
    remainingSeconds: Math.max(0, Math.ceil((state.startedAtMs + ROUND_MS - effectiveTime(state)) / 1000)),
    headstartSeconds: headstartSeconds(state), hasKey: state.hasKey,
    attemptsRemaining: Math.max(0, MAX_INTERACTION_ATTEMPTS - (me.interactionAttempts ?? 0)),
    canInteract: canInteract(state, id), restartVotes, revision: state.revision, paused,
  };
}
