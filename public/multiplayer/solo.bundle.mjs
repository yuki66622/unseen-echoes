// Generated from local/solo-session.mjs and spacetimedb/src/rules.ts; do not edit.

// spacetimedb/src/geometry.mjs
var ROOM_SIZE = 8;
var PLAYER_RADIUS = 0.18;
var LOCATIONS = Object.freeze([
  { id: "a", x: 1.5, y: 4.8 },
  { id: "b", x: 7.6, y: 5.5 },
  { id: "c", x: 2, y: 7 }
]);
var WALLS = Object.freeze([]);
var DOOR = Object.freeze({
  id: "main",
  a: { x: 8, y: 4.7 },
  b: { x: 8, y: 6.3 },
  center: { x: 7.6, y: 5.5 },
  nearRadius: 1.25,
  rearmRadius: 1.8
});
var distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, den = dx * dx + dy * dy;
  const t = den ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function inside(point, margin = 0) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y) && point.x >= margin && point.y >= margin && point.x <= ROOM_SIZE - margin && point.y <= ROOM_SIZE - margin;
}
function canTravel(from, to, _doorOpen = false) {
  return inside(from, PLAYER_RADIUS) && inside(to, PLAYER_RADIUS);
}
function hasLineOfSight(from, to, _doorOpen = false) {
  return inside(from) && inside(to);
}
var isNearDoor = (player) => distance(player, DOOR.center) <= DOOR.nearRadius;
var occupiesDoor = (player) => pointSegmentDistance(player, DOOR.a, DOOR.b) <= PLAYER_RADIUS + 0.08;

// spacetimedb/src/physics.mjs
var WALK_SPEED = 1;
var TURN_SPEED = 2 * Math.PI / 3;
var TAU = 2 * Math.PI;
var normalize = (angle) => (angle % TAU + TAU) % TAU;
var clamp = (value) => Math.max(0.4, Math.min(7.6, value));
function advancePose(pose, forward, turn, doorOpen = false) {
  if (![pose?.x, pose?.y, pose?.heading, forward, turn].every(Number.isFinite)) {
    throw new TypeError("Pose and movement must be finite.");
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
    const point = {
      x: pose.x + (candidate.x - pose.x) * fraction,
      y: pose.y + (candidate.y - pose.y) * fraction
    };
    if (canTravel(pose, point, doorOpen)) safe = fraction;
    else blocked = fraction;
  }
  return {
    pose: {
      x: pose.x + (candidate.x - pose.x) * safe,
      y: pose.y + (candidate.y - pose.y) * safe,
      heading
    },
    blocked: true
  };
}
function motionDuration(forward, turn) {
  if (![forward, turn].every(Number.isFinite) || forward !== 0 && turn !== 0) {
    throw new TypeError("A motion must be a finite walk or a finite turn.");
  }
  return 1e3 * (Math.abs(forward) / WALK_SPEED + Math.abs(turn) / TURN_SPEED);
}
function sampleMotion(motion, elapsedMs, doorOpen = false) {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(motion.durationMs) || motion.durationMs < 0) {
    throw new TypeError("Motion time must be finite and non-negative.");
  }
  const fraction = motion.durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / motion.durationMs)) : 1;
  const result = advancePose(motion.origin, motion.forward * fraction, motion.turn * fraction, doorOpen);
  return { ...result, done: result.blocked || fraction >= 1 };
}

// spacetimedb/src/rules.ts
var ROUND_MS = 18e4;
var HEADSTART_MS = 3e3;
var RECONNECT_MS = 3e4;
var STEP_MS = 50;
var MAX_CATCHUP_MS = 100;
var MAX_INTERACTION_ATTEMPTS = 5;
var RuleError = class extends Error {
};
function createChase(roundId, players, nowMs) {
  if (!roundId || !Number.isFinite(nowMs) || players.length !== 2 || new Set(players.map((player) => player.id)).size !== 2 || !players.every((player) => player.online) || !players.some((player) => player.role === "hunter") || !players.some((player) => player.role === "survivor")) {
    throw new RuleError("A round requires two online players with different roles.");
  }
  return {
    roundId,
    startedAtMs: nowMs,
    serverTimeMs: nowMs,
    pausedAtMs: null,
    doorOpen: false,
    doorEvent: { seq: 0, openedAtMs: 0, ...DOOR.center },
    hasKey: false,
    outcome: null,
    winner: null,
    revision: 1,
    players: players.map((player) => ({
      id: player.id,
      role: player.role,
      online: true,
      pose: player.role === "hunter" ? { x: 2, y: 7, heading: Math.PI } : { x: 2, y: 1, heading: 0 },
      motion: null,
      lastProcessedInputSeq: 0,
      interactionAttempts: 0,
      notice: player.role === "hunter" ? "Wait for the head start, then listen for the survivor heartbeat." : "Find the old motor, then reach the rain at the exit."
    }))
  };
}
function playerById(state, id) {
  const player = state.players.find((candidate) => candidate.id === id);
  if (!player) throw new RuleError("You are not a player in this round.");
  return player;
}
function effectiveTime(state) {
  return state.pausedAtMs ?? state.serverTimeMs;
}
function headstartSeconds(state) {
  return state.outcome ? 0 : Math.max(0, Math.ceil((state.startedAtMs + HEADSTART_MS - effectiveTime(state)) / 1e3));
}
function finishChase(state, outcome, winner) {
  if (state.outcome) return;
  state.outcome = outcome;
  state.winner = winner;
  if (state.pausedAtMs !== null) state.startedAtMs += state.serverTimeMs - state.pausedAtMs;
  state.pausedAtMs = null;
  for (const player of state.players) player.motion = null;
  state.revision++;
}
function advanceChase(state, requestedNowMs) {
  if (!Number.isFinite(requestedNowMs)) throw new RuleError("Invalid server time.");
  if (state.outcome) return;
  const previous = state.serverTimeMs;
  const nowMs = Math.max(previous, requestedNowMs);
  state.serverTimeMs = nowMs;
  if (state.pausedAtMs !== null) {
    if (nowMs - state.pausedAtMs >= RECONNECT_MS) finishChase(state, "interrupted", null);
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
          if (sampled.blocked) player.notice = "You reached the edge of the play area.";
        }
      }
    }
    cursor = next;
  }
  for (const player of state.players) {
    if (player.motion && nowMs >= player.motion.expiresAtMs) player.motion = null;
  }
  if (nowMs >= deadline) finishChase(state, "timeout", "hunter");
  if (nowMs !== previous) state.revision++;
}
function nearSource(state, player, sourceId) {
  const source = LOCATIONS.find((candidate) => candidate.id === sourceId);
  return distance(player.pose, source) <= 1.5 && hasLineOfSight(player.pose, source, state.doorOpen);
}
function canInteract(state, id) {
  const player = playerById(state, id);
  if (state.outcome || state.pausedAtMs !== null || !player.online) return false;
  if (player.role === "hunter") {
    const target = state.players.find((candidate) => candidate.role === "survivor");
    return headstartSeconds(state) === 0 && target.online && distance(player.pose, target.pose) <= 1.25 && hasLineOfSight(player.pose, target.pose, state.doorOpen);
  }
  return !state.hasKey ? nearSource(state, player, "a") : nearSource(state, player, "b");
}
function doorEventFor(state) {
  const event = state.doorEvent;
  const valid = event && Number.isSafeInteger(event.seq) && event.seq >= 0 && Number.isFinite(event.openedAtMs) && event.openedAtMs >= 0;
  return { seq: valid ? event.seq : 0, openedAtMs: valid ? event.openedAtMs : 0, ...DOOR.center };
}
function rebaseMotions(state) {
  for (const player of state.players) {
    const motion = player.motion;
    if (!motion) continue;
    const remaining = 1 - motion.elapsedMs / motion.durationMs;
    player.motion = {
      ...motion,
      origin: { ...player.pose },
      forward: motion.forward * remaining,
      turn: motion.turn * remaining,
      durationMs: motion.durationMs - motion.elapsedMs,
      elapsedMs: 0
    };
  }
}
function validateCommand(command) {
  if (!Number.isInteger(command.seq) || command.seq < 1 || command.seq > 4294967295) {
    throw new RuleError("Input sequence must be an unsigned 32-bit integer starting at one.");
  }
  const allowed = {
    move: ["forward", "back"],
    turn: ["left", "right"],
    stop: ["", "stop"],
    door: ["toggle", "open", "close"],
    interact: ["inspect"]
  };
  if (!Object.hasOwn(allowed, command.kind) || !allowed[command.kind].includes(command.value)) {
    throw new RuleError("Unknown input command.");
  }
}
function applyInput(state, id, command, nowMs) {
  validateCommand(command);
  const player = playerById(state, id);
  if (command.roundId !== state.roundId) throw new RuleError("This input belongs to a different round.");
  if (command.seq <= player.lastProcessedInputSeq) throw new RuleError("Input sequence has already been processed.");
  if (state.outcome) throw new RuleError("The round has ended.");
  advanceChase(state, nowMs);
  if (state.outcome) return;
  if (!player.online || state.pausedAtMs !== null) throw new RuleError("The chase is paused while a player reconnects.");
  if (player.role === "hunter" && headstartSeconds(state) > 0 && command.kind !== "stop") {
    throw new RuleError("The survivor still has a head start.");
  }
  if (command.kind === "door") {
    if (!isNearDoor(player.pose) || !hasLineOfSight(player.pose, DOOR.center, true)) {
      throw new RuleError("Move closer to the door.");
    }
    const open = command.value === "toggle" ? !state.doorOpen : command.value === "open";
    if (!open && state.players.some((candidate) => occupiesDoor(candidate.pose))) {
      throw new RuleError("The doorway is occupied.");
    }
    if (open !== state.doorOpen) {
      rebaseMotions(state);
      state.doorOpen = open;
      if (open) state.doorEvent = { seq: doorEventFor(state).seq + 1, openedAtMs: state.serverTimeMs, ...DOOR.center };
    }
    player.notice = state.doorOpen ? "The door is open." : "The door is closed.";
  } else if (command.kind === "move" || command.kind === "turn") {
    const forward = command.kind === "move" ? command.value === "forward" ? 0.5 : -0.5 : 0;
    const turn = command.kind === "turn" ? (command.value === "right" ? 1 : -1) * Math.PI / 6 : 0;
    const durationMs = motionDuration(forward, turn);
    player.motion = {
      seq: command.seq,
      origin: { ...player.pose },
      forward,
      turn,
      durationMs,
      elapsedMs: 0,
      expiresAtMs: state.serverTimeMs + durationMs
    };
    player.notice = "";
  } else if (command.kind === "stop") {
    player.motion = null;
    player.notice = "";
  } else {
    const attempts = player.interactionAttempts ?? 0;
    if (attempts >= MAX_INTERACTION_ATTEMPTS) throw new RuleError("No interaction attempts remain.");
    player.interactionAttempts = attempts + 1;
    if (canInteract(state, id)) {
      if (player.role === "hunter") finishChase(state, "captured", "hunter");
      else if (state.hasKey) finishChase(state, "escaped", "survivor");
      else {
        state.hasKey = true;
        player.notice = "You found the old motor. Reach the rain at the exit.";
      }
    } else {
      player.notice = player.role === "hunter" ? "No survivor within reach." : state.hasKey ? "The exit is not within reach." : "The old motor is not within reach.";
    }
    if (player.interactionAttempts >= MAX_INTERACTION_ATTEMPTS && !state.outcome) {
      finishChase(state, "attempts_exhausted", player.role === "hunter" ? "survivor" : "hunter");
    }
  }
  player.lastProcessedInputSeq = command.seq;
  state.revision++;
}
function publicMotion(motion) {
  if (!motion) return null;
  const { seq, origin, forward, turn, durationMs, elapsedMs } = motion;
  return { seq, origin: { ...origin }, forward, turn, durationMs, elapsedMs };
}
function snapshotFor(state, id, restartVotes) {
  const me = playerById(state, id);
  const paused = state.pausedAtMs !== null && state.outcome === null;
  const walking = (player) => !!player.motion?.forward && player.online && !paused && !state.outcome;
  const objective = me.role === "hunter" ? "Listen for the survivor heartbeat. Get close and interact to catch the survivor." : state.hasKey ? "Reach the rain and interact to escape." : "Find the old motor and interact to inspect it.";
  const survivor = state.players.find((player) => player.role === "survivor");
  const proximity = me.role === "hunter" && me.online && survivor?.online && !paused && !state.outcome ? Math.max(0, Math.min(1, (8 - distance(me.pose, survivor.pose)) / 6)) : 0;
  return {
    serverTimeMs: state.serverTimeMs,
    roundId: state.roundId,
    mapId: "square-open-v2",
    self: { ...me.pose, moving: walking(me) },
    role: me.role,
    doorOpen: state.doorOpen,
    doorEvent: doorEventFor(state),
    ...me.role === "hunter" ? {
      heartbeatIntensity: proximity * proximity * (3 - 2 * proximity),
      heartbeatSource: proximity > 0 ? { x: survivor.pose.x, y: survivor.pose.y } : null
    } : {},
    motion: publicMotion(me.motion),
    lastProcessedInputSeq: me.lastProcessedInputSeq,
    sources: LOCATIONS.map((source, index) => ({ ...source, soundId: ["motor", "rain", "fire"][index] })),
    audiblePlayers: state.players.filter((player) => me.role === "survivor" && player.id !== id && walking(player) && distance(me.pose, player.pose) <= 5).map((player) => ({ id: player.id, ...player.pose, moving: true })),
    objective,
    notice: paused ? `Chase paused. Waiting for reconnection (${Math.max(0, Math.ceil((RECONNECT_MS - (state.serverTimeMs - state.pausedAtMs)) / 1e3))}s).` : state.outcome === "interrupted" ? "The chase ended because a player could not reconnect." : state.outcome === "abandoned" ? "A player left the chase." : me.notice,
    outcome: state.outcome,
    winner: state.winner,
    remainingSeconds: Math.max(0, Math.ceil((state.startedAtMs + ROUND_MS - effectiveTime(state)) / 1e3)),
    headstartSeconds: headstartSeconds(state),
    hasKey: state.hasKey,
    attemptsRemaining: Math.max(0, MAX_INTERACTION_ATTEMPTS - (me.interactionAttempts ?? 0)),
    canInteract: canInteract(state, id),
    restartVotes,
    revision: state.revision,
    paused
  };
}

// local/solo-session.mjs
var SoloConnection = class {
  constructor(onRoom, dependencies = {}) {
    this.onRoom = onRoom;
    this.now = dependencies.now ?? (() => performance.now());
    this.setInterval = dependencies.setInterval ?? ((callback, ms) => globalThis.setInterval(callback, ms));
    this.clearInterval = dependencies.clearInterval ?? ((timer) => globalThis.clearInterval(timer));
    this.identity = "local-player";
    this.local = true;
    this.ready = true;
    this.state = null;
    this.timer = null;
    this.round = 0;
  }
  start(role) {
    if (role !== "hunter" && role !== "survivor") throw new Error("Choose a hunter or survivor role.");
    const state = createChase(`local-${++this.round}`, [
      { id: this.identity, role, online: true },
      { id: "local-target", role: role === "hunter" ? "survivor" : "hunter", online: true }
    ], this.now());
    this.disconnect();
    this.state = state;
    this.resume();
  }
  async call(name, args = {}) {
    if (!this.ready) throw new Error("Local session is disconnected.");
    if (name === "restartRound") return this.reset();
    if (name !== "input") throw new Error("Unknown local session command.");
    if (!this.state) throw new Error("Choose a role before playing.");
    applyInput(this.state, this.identity, args, this.now());
    this.publish();
  }
  publish() {
    if (this.state?.outcome) this.stopTimer();
    const players = this.state?.players ?? [{ id: this.identity, role: "", online: true }];
    this.onRoom({
      code: "LOCAL",
      mode: "chase",
      host: this.identity,
      phase: !this.state ? "lobby" : this.state.outcome ? "finished" : "running",
      game: this.state ? snapshotFor(this.state, this.identity, 0) : null,
      members: players.map((player) => ({
        identity: player.id,
        role: player.role,
        online: player.online,
        name: player.id === this.identity ? "\u672C\u673A\u73A9\u5BB6" : "\u9759\u6B62\u6D4B\u8BD5\u76EE\u6807",
        ready: Boolean(this.state),
        restartVote: false
      }))
    });
  }
  tick() {
    advanceChase(this.state, this.now());
    this.publish();
  }
  stopTimer() {
    if (this.timer !== null) this.clearInterval(this.timer);
    this.timer = null;
  }
  reset() {
    this.disconnect();
    this.state = null;
    this.ready = true;
    this.publish();
  }
  disconnect() {
    this.stopTimer();
    this.ready = false;
  }
  resume() {
    this.ready = true;
    if (!this.state || this.state.outcome || this.timer !== null) return false;
    this.tick();
    if (!this.state.outcome) this.timer = this.setInterval(() => this.tick(), STEP_MS);
    return true;
  }
  reconnect() {
    return this.resume();
  }
  goOffline() {
  }
};
export {
  SoloConnection
};
