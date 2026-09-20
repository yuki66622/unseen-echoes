/** Deterministic, metre-based navigation for the two-floor Pinewood Inn. */
export const PLAYER_RADIUS = 0.18;
export const STAIR_DURATION = 2.6;
export const STAIR_ASCENT_DURATION = 3;
const MOVE_SPEED = 1.6;
const DOOR_DURATION = 0.7;
const DOOR_PASSABLE = 0.92;
const TAU = Math.PI * 2;
const EPSILON = 1e-8;

const segment = (floor, x1, y1, x2, y2) => Object.freeze({ floor, x1, y1, x2, y2 });
export const WALLS = Object.freeze([
  segment(0, 0, -3, 0, 12), segment(0, 18, -3, 18, 12),
  segment(0, 0, -3, 18, -3), segment(0, 0, 12, 18, 12),
  segment(0, 0, 0, 4.3, 0), segment(0, 5.7, 0, 18, 0),
  segment(0, 10, 0, 10, 3.9), segment(0, 10, 5.3, 10, 12),
  segment(0, 14, 8, 14, 12), segment(0, 14, 8, 15.3, 8),
  segment(0, 16.7, 8, 18, 8),
  segment(1, 0, 0, 0, 12), segment(1, 18, 0, 18, 12),
  segment(1, 0, 0, 18, 0), segment(1, 0, 12, 18, 12),
  segment(1, 0, 8, 2.3, 8), segment(1, 3.7, 8, 12.2, 8),
  segment(1, 13.6, 8, 18, 8), segment(1, 12, 0, 12, 8),
  segment(1, 14, 8, 14, 9.3), segment(1, 14, 10.7, 14, 12),
]);

export const DOORS = Object.freeze({
  entrance: { floor: 0, x: 5, y: 0, wall: segment(0, 4.3, 0, 5.7, 0) },
  lounge: { floor: 0, x: 10, y: 4.6, wall: segment(0, 10, 3.9, 10, 5.3) },
  recording: { floor: 1, x: 3, y: 8, wall: segment(1, 2.3, 8, 3.7, 8) },
  linen: { floor: 1, x: 12.9, y: 8, wall: segment(1, 12.2, 8, 13.6, 8) },
});

const SOURCES = Object.freeze({
  martin: { x: 4, y: 8, floor: 0 },
  claire: { x: 12.1, y: 5, floor: 0 },
  elena: { x: 14.2, y: 5, floor: 0 },
  cleaner: { x: 12.4, y: 9.2, floor: 1 },
  cart: { x: 13, y: 8.7, floor: 1 },
  recorder: { x: 3, y: 3.6, floor: 1 },
  'exterior-bed': { x: 5, y: -1.5, floor: 0 },
  'hotel-bed': { x: 7, y: 6, floor: 0 },
  'upper-bed': { x: 8, y: 10, floor: 1 },
});

const normalizeAngle = value => ((value % TAU) + TAU) % TAU;
const shortestAngle = (a, b) => ((b - a + Math.PI * 3) % TAU) - Math.PI;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pose = p => ({ x: p.x, y: p.y, floor: p.floor, heading: p.heading });
const smooth = t => t * t * (3 - 2 * t);

export function createState() {
  return {
    player: { x: 5, y: -1.6, floor: 0, heading: 0 },
    doors: { entrance: 0, lounge: 0, recording: 0, linen: 1 },
    doorTargets: { entrance: 0, lounge: 0, recording: 0, linen: 1 },
    sources: Object.fromEntries(Object.entries(SOURCES).map(([id, p]) => [id, { ...p }])),
    stairs: null,
    phase: 'testimony',
    paused: false,
    motion: null,
    motionQueue: [],
    elapsed: 0,
    region: 'exterior',
    _events: [],
    _doorNear: new Set(),
    _stepDistance: 0,
    _stairStepElapsed: 0,
    _stairCooldown: 0,
    _collisionCooldown: 0,
  };
}

/** Queue one bounded movement. Direction is captured when that move begins. */
export function queueMove(state, metres = 0.5) {
  if (!Number.isFinite(metres) || Math.abs(metres) < EPSILON || !canQueue(state)) return false;
  state.motionQueue.push({ type: 'move', metres: Math.max(-1, Math.min(1, metres)) });
  return true;
}

/** Heading 0 faces north; positive angles turn clockwise toward east. */
export function queueTurn(state, degrees = 30) {
  if (!Number.isFinite(degrees) || Math.abs(degrees) < EPSILON || !canQueue(state)) return false;
  state.motionQueue.push({ type: 'turn', radians: Math.max(-90, Math.min(90, degrees)) * Math.PI / 180 });
  return true;
}

function canQueue(state) {
  return !state.paused && !state.stairs && state.motionQueue.length < 4;
}

/** Stops voluntary movement; an already-entered stair traversal remains continuous. */
export function cancelMotion(state) {
  state.motion = null;
  state.motionQueue.length = 0;
}

export function doorPosition(id) {
  const door = DOORS[id];
  return door ? { x: door.x, y: door.y, floor: door.floor } : null;
}

export function regionAt(player) {
  if (player.floor === 0) {
    if (player.y < 0) return 'exterior';
    if (player.x >= 14 && player.y >= 8) return 'stairs';
    return player.x < 10 ? 'lobby' : 'lounge';
  }
  if (player.x >= 14 && player.y >= 8) return 'stairs';
  if (player.y >= 8) return 'corridor';
  return player.x < 12 ? 'recording' : 'linen';
}

export function nearestDoor(state) {
  if (state.stairs) return null;
  let result = null;
  for (const [id, door] of Object.entries(DOORS)) {
    if (door.floor !== state.player.floor) continue;
    const d = distance(state.player, door);
    if (d <= 1.4 + EPSILON && (!result || d < result.distance)) {
      result = { id, distance: d, position: doorPosition(id) };
    }
  }
  return result;
}

export function setDoor(state, id, open) {
  const door = DOORS[id];
  if (!door || state.paused || state.stairs || state.player.floor !== door.floor || distance(state.player, door) > 1.4 + EPSILON) return false;
  const target = open ? 1 : 0;
  if (target === 0 && pointSegmentDistance(state.player, door.wall) <= PLAYER_RADIUS + 0.06) return false;
  if (state.doorTargets[id] === target) return true;
  state.doorTargets[id] = target;
  state._events.push({ type: 'door', id, open: !!open, position: doorPosition(id) });
  return true;
}

export function nearestInteraction(state) {
  if (state.stairs) return null;
  let result = null;
  for (const id of ['martin', 'claire', 'elena', 'cleaner', 'recorder']) {
    const source = state.sources[id];
    if (!source || source.floor !== state.player.floor || regionAt(source) !== regionAt(state.player)) continue;
    const d = distance(source, state.player);
    if (d > 1.6 + EPSILON || (result && d >= result.distance) || !hasLineOfSight(state, state.player, source)) continue;
    result = { id, type: id === 'recorder' ? 'recorder' : 'npc', distance: d };
  }
  return result;
}

function pointSegmentDistance(point, wall) {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const t = Math.max(0, Math.min(1, ((point.x - wall.x1) * dx + (point.y - wall.y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - wall.x1 - t * dx, point.y - wall.y1 - t * dy);
}

function blocked(state, point, radius = PLAYER_RADIUS) {
  for (const wall of WALLS) {
    if (wall.floor === point.floor && pointSegmentDistance(point, wall) < radius - EPSILON) return true;
  }
  for (const [id, door] of Object.entries(DOORS)) {
    if (door.floor === point.floor && state.doors[id] < DOOR_PASSABLE && pointSegmentDistance(point, door.wall) < radius - EPSILON) return true;
  }
  return false;
}

function hasLineOfSight(state, a, b) {
  const pieces = Math.max(1, Math.ceil(distance(a, b) / 0.04));
  for (let i = 1; i < pieces; i++) {
    if (blocked(state, { x: a.x + (b.x - a.x) * i / pieces, y: a.y + (b.y - a.y) * i / pieces, floor: a.floor }, 0.015)) return false;
  }
  return true;
}

function startMotion(state) {
  if (state.motion || !state.motionQueue.length || state.stairs) return;
  const item = state.motionQueue.shift();
  const start = pose(state.player);
  state.motion = { ...item, start, elapsed: 0, duration: item.type === 'move' ? Math.abs(item.metres) / MOVE_SPEED : Math.max(0.12, Math.abs(item.radians) / (Math.PI * 2.4)) };
}

function materialAt(player) {
  const region = regionAt(player);
  if (region === 'exterior') return 'stone';
  if (region === 'lobby') return 'tile';
  if (region === 'lounge' || region === 'stairs') return 'wood';
  return 'carpet';
}

function footstep(state, events, material = materialAt(state.player)) {
  const position = pose(state.player);
  if (state.stairs) position.elevation = 3.2 * (state.stairs.from + (state.stairs.to - state.stairs.from) * state.stairs.progress);
  events.push({ type: 'footstep', material, position, ...(state.stairs ? { stairTo: state.stairs.to } : {}) });
}

function maybeStartStairs(state, previous, events) {
  if (state._stairCooldown > 0) return false;
  const p = state.player;
  let end;
  if (p.floor === 0 && previous.y < 8.2 && p.y >= 8.2 && p.x >= 15.5 && p.x <= 16.5) {
    end = { x: 13.1, y: 10, floor: 1, heading: Math.PI * 1.5 };
  } else if (p.floor === 1 && previous.x < 14.2 && p.x >= 14.2 && p.y >= 9.5 && p.y <= 10.5) {
    end = { x: 16, y: 7.1, floor: 0, heading: Math.PI };
  } else return false;
  state.stairs = { from: p.floor, to: end.floor, progress: 0, start: pose(p), end };
  state._stairStepElapsed = 0;
  state._stepDistance = 0;
  cancelMotion(state);
  events.push({ type: 'stairs-start', to: end.floor });
  return true;
}

function updateStairs(state, dt, events) {
  const stairs = state.stairs;
  stairs.progress = Math.min(1, stairs.progress + dt / (stairs.to === 1 ? STAIR_ASCENT_DURATION : STAIR_DURATION));
  // Audio interpolates these same endpoint snapshots by progress. Keep the
  // physical listener on exactly that path throughout the storey transition.
  const t = stairs.progress;
  state.player.x = stairs.start.x + (stairs.end.x - stairs.start.x) * t;
  state.player.y = stairs.start.y + (stairs.end.y - stairs.start.y) * t;
  state.player.heading = normalizeAngle(stairs.start.heading + shortestAngle(stairs.start.heading, stairs.end.heading) * t);
  state._stairStepElapsed += dt;
  if (state._stairStepElapsed >= 0.43) {
    state._stairStepElapsed -= 0.43;
    footstep(state, events, 'wood');
  }
  if (stairs.progress >= 1 - EPSILON) {
    Object.assign(state.player, stairs.end);
    state.stairs = null;
    state._stairCooldown = 0.6;
    state._stepDistance = 0;
    events.push({ type: 'stairs-end', floor: state.player.floor });
  }
}

function updateMotion(state, dt, events) {
  startMotion(state);
  const motion = state.motion;
  if (!motion) return;
  motion.elapsed = Math.min(motion.duration, motion.elapsed + dt);
  const fraction = smooth(motion.elapsed / motion.duration);
  if (motion.type === 'turn') {
    state.player.heading = normalizeAngle(motion.start.heading + motion.radians * fraction);
  } else {
    const target = {
      x: motion.start.x + Math.sin(motion.start.heading) * motion.metres * fraction,
      y: motion.start.y + Math.cos(motion.start.heading) * motion.metres * fraction,
      floor: state.player.floor,
    };
    const previous = pose(state.player);
    const pieces = Math.max(1, Math.ceil(distance(previous, target) / 0.04));
    for (let i = 1; i <= pieces; i++) {
      const next = { x: previous.x + (target.x - previous.x) * i / pieces, y: previous.y + (target.y - previous.y) * i / pieces, floor: previous.floor };
      if (blocked(state, next)) {
        cancelMotion(state);
        if (state._collisionCooldown <= 0) {
          events.push({ type: 'collision' });
          state._collisionCooldown = 0.4;
        }
        return;
      }
      const before = pose(state.player);
      state._stepDistance += distance(state.player, next);
      state.player.x = next.x;
      state.player.y = next.y;
      if (state._stepDistance >= 0.5 - EPSILON) {
        state._stepDistance -= 0.5;
        footstep(state, events);
      }
      if (maybeStartStairs(state, before, events)) return;
    }
  }
  if (motion.elapsed >= motion.duration - EPSILON) state.motion = null;
}

function updateDoors(state, dt) {
  for (const [id, door] of Object.entries(DOORS)) {
    const target = state.doorTargets[id];
    if (target === state.doors[id]) continue;
    // A closing door waits while the player occupies its opening.
    if (target < state.doors[id] && state.player.floor === door.floor && pointSegmentDistance(state.player, door.wall) <= PLAYER_RADIUS + 0.06) continue;
    const step = dt / DOOR_DURATION;
    state.doors[id] = target > state.doors[id] ? Math.min(target, state.doors[id] + step) : Math.max(target, state.doors[id] - step);
  }
}

function updateSpatialEvents(state, events) {
  if (state.stairs) return;
  for (const [id, door] of Object.entries(DOORS)) {
    const d = door.floor === state.player.floor ? distance(state.player, door) : Infinity;
    if (d > 1.85) state._doorNear.delete(id);
    else if (d <= 1.4 && !state._doorNear.has(id)) {
      state._doorNear.add(id);
      events.push({ type: 'door-near', id, position: doorPosition(id) });
    }
  }
  const region = regionAt(state.player);
  if (region !== state.region) {
    state.region = region;
    events.push({ type: 'region', region });
  }
}

/** Advance all physical state. Pausing freezes doors, stairs, input and pending events. */
export function updateWorld(state, dtSeconds) {
  if (state.paused || !Number.isFinite(dtSeconds) || dtSeconds < 0) return [];
  const events = state._events.splice(0);
  let remaining = dtSeconds;
  while (remaining > EPSILON) {
    // Small time slices and geometric substeps prevent tunnelling on slow frames.
    const dt = Math.min(remaining, 1 / 90);
    remaining -= dt;
    state.elapsed += dt;
    state._stairCooldown = Math.max(0, state._stairCooldown - dt);
    state._collisionCooldown = Math.max(0, state._collisionCooldown - dt);
    updateDoors(state, dt);
    if (state.stairs) updateStairs(state, dt, events);
    else updateMotion(state, dt, events);
    updateSpatialEvents(state, events);
  }
  if (dtSeconds === 0) updateSpatialEvents(state, events);
  return events;
}
