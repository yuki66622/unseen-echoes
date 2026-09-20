export const PLAYER_RADIUS = 0.18;
export const WALK_METRES_PER_SECOND = 1;
export const TURN_RADIANS_PER_SECOND = Math.PI * 2 / 3;
const INTERACTION_RADIUS = 1.1;
const DOOR_RADIUS = 1.3;
const EPS = 1e-9;
const TAU = Math.PI * 2;
const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const key = (x, y) => `${x},${y}`;
const heading = value => ((value % TAU) + TAU) % TAU;

export function createRun(world) {
  if (!Array.isArray(world?.grid) || !world.grid.length || !finitePoint(world.spawn)
    || !finitePoint(world.exit) || !Array.isArray(world.doors) || !Array.isArray(world.sources)) {
    throw new Error('This world is incomplete.');
  }
  const width = world.grid[0].length;
  if (!width || world.grid.some(row => typeof row !== 'string' || row.length !== width || /[^#.D]/.test(row))) {
    throw new Error('This world has an invalid map.');
  }
  // A new run never writes to a saved world or reuses another run's door state.
  const copy = structuredClone(world);
  const doorStates = Object.create(null);
  for (const door of copy.doors) doorStates[door.id] = false;
  return { world: copy, player: { ...copy.spawn, heading: heading(copy.spawn.heading ?? 0) },
    stage: 'ready', doorStates, carrying: false, checked: [], route: [{ x: copy.spawn.x, y: copy.spawn.y }], attempts: 0 };
}

function doorAt(run, x, y) {
  return run.world.doors.find(door => Math.floor(door.x) === x && Math.floor(door.y) === y);
}

function solid(run, x, y, { allDoorsOpen = false, ignoreDoorId = null } = {}) {
  const tile = run.world.grid[y]?.[x];
  if (tile === '.') return false;
  if (tile !== 'D') return true;
  const door = doorAt(run, x, y);
  return !door || !(allDoorsOpen || door.id === ignoreDoorId || run.doorStates[door.id] === true);
}

function pointRectDistanceSquared(point, x, y) {
  const dx = Math.max(x - point.x, 0, point.x - x - 1);
  const dy = Math.max(y - point.y, 0, point.y - y - 1);
  return dx * dx + dy * dy;
}

// Exact disk sweep against a tile's rounded Minkowski boundary: four flat
// faces and four corner circles. This cannot tunnel through a one-cell wall.
function sweepTile(from, dx, dy, x, y, radius) {
  if (pointRectDistanceSquared(from, x, y) < radius * radius - EPS) return 0;
  let first = Infinity;
  const candidate = (t, within) => {
    if (t >= -EPS && t <= 1 + EPS && within) first = Math.min(first, Math.max(0, t));
  };
  if (dx > EPS) {
    const t = (x - radius - from.x) / dx, at = from.y + dy * t;
    candidate(t, at >= y - EPS && at <= y + 1 + EPS);
  } else if (dx < -EPS) {
    const t = (x + 1 + radius - from.x) / dx, at = from.y + dy * t;
    candidate(t, at >= y - EPS && at <= y + 1 + EPS);
  }
  if (dy > EPS) {
    const t = (y - radius - from.y) / dy, at = from.x + dx * t;
    candidate(t, at >= x - EPS && at <= x + 1 + EPS);
  } else if (dy < -EPS) {
    const t = (y + 1 + radius - from.y) / dy, at = from.x + dx * t;
    candidate(t, at >= x - EPS && at <= x + 1 + EPS);
  }
  const a = dx * dx + dy * dy;
  if (a > EPS * EPS) for (const cx of [x, x + 1]) for (const cy of [y, y + 1]) {
    const qx = from.x - cx, qy = from.y - cy;
    const b = 2 * (qx * dx + qy * dy), c = qx * qx + qy * qy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    // Roundoff at an exact tangent can produce a tiny positive discriminant.
    // Ignore contacts with less than sub-nanometre inward penetration.
    if (discriminant <= EPS * a) continue;
    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    // Touching a corner while moving away or tangent must not pin the player.
    candidate(t, (qx + dx * t) * dx + (qy + dy * t) * dy < -EPS);
  }
  return first;
}

export function move(run, forward, turn = 0) {
  if (run.stage !== 'explore' || ![forward, turn].every(Number.isFinite)) return false;
  run.player.heading = heading(run.player.heading + turn);
  if (!forward) return true;
  const width = run.world.grid[0].length, height = run.world.grid.length;
  // Longer requests necessarily reach the boundary; cap arithmetic, not speed.
  const requested = Math.max(-2 * (width + height), Math.min(2 * (width + height), forward));
  const dx = Math.sin(run.player.heading) * requested, dy = Math.cos(run.player.heading) * requested;
  let first = Infinity;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (solid(run, x, y)) first = Math.min(first, sweepTile(run.player, dx, dy, x, y, PLAYER_RADIUS));
  }
  // Defensive world-boundary planes also protect malformed imported grids.
  if (dx > EPS) first = Math.min(first, (width - PLAYER_RADIUS - run.player.x) / dx);
  if (dx < -EPS) first = Math.min(first, (PLAYER_RADIUS - run.player.x) / dx);
  if (dy > EPS) first = Math.min(first, (height - PLAYER_RADIUS - run.player.y) / dy);
  if (dy < -EPS) first = Math.min(first, (PLAYER_RADIUS - run.player.y) / dy);
  const blocked = first < 1 - EPS || requested !== forward;
  const fraction = Math.max(0, Math.min(1, first - 1e-7 / Math.max(Math.abs(requested), EPS)));
  run.player.x += dx * fraction;
  run.player.y += dy * fraction;
  if (distance(run.player, run.route.at(-1)) >= 0.15) {
    run.route.push({ x: run.player.x, y: run.player.y });
    if (run.route.length > 4096) run.route.splice(1, 1);
  }
  return !blocked;
}

function segmentIntersectsTile(a, b, x, y) {
  let low = 0, high = 1;
  for (const [origin, delta, min, max] of [[a.x, b.x - a.x, x, x + 1], [a.y, b.y - a.y, y, y + 1]]) {
    if (Math.abs(delta) < EPS) {
      if (origin < min - EPS || origin > max + EPS) return false;
    } else {
      const t1 = (min - origin) / delta, t2 = (max - origin) / delta;
      low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
      if (low > high + EPS) return false;
    }
  }
  return true;
}

function lineClear(run, a, b, options = {}) {
  if (!finitePoint(a) || !finitePoint(b)) return false;
  const width = run.world.grid[0].length, height = run.world.grid.length;
  if ([a, b].some(p => p.x <= 0 || p.y <= 0 || p.x >= width || p.y >= height)) return false;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (solid(run, x, y, options) && segmentIntersectsTile(a, b, x, y)) return false;
  }
  return true;
}

export function hasLineOfSight(run, a, b) { return lineClear(run, a, b); }

export function nearbyDoor(run) {
  return run.world.doors.filter(door => distance(run.player, door) <= DOOR_RADIUS + EPS
    && lineClear(run, run.player, door, { ignoreDoorId: door.id }))
    .sort((a, b) => distance(run.player, a) - distance(run.player, b))[0] ?? null;
}

export function toggleDoor(run) {
  if (run.stage !== 'explore') return 'inactive';
  const door = nearbyDoor(run);
  if (!door) return 'far';
  if (run.doorStates[door.id] && pointRectDistanceSquared(run.player, Math.floor(door.x), Math.floor(door.y)) <= PLAYER_RADIUS ** 2 + EPS) {
    return 'occupied';
  }
  run.doorStates[door.id] = !run.doorStates[door.id];
  return run.doorStates[door.id] ? 'opened' : 'closed';
}

function inspectSource(run) {
  if (run.stage !== 'explore') return { result: 'far' };
  const nearExit = distance(run.player, run.world.exit) <= INTERACTION_RADIUS + EPS
    && hasLineOfSight(run, run.player, run.world.exit);
  if (nearExit && run.carrying) { run.stage = 'won'; return { result: 'won' }; }
  const source = run.world.sources.filter(item => distance(run.player, item) <= INTERACTION_RADIUS + EPS
    && hasLineOfSight(run, run.player, item)).sort((a, b) => distance(run.player, a) - distance(run.player, b))[0];
  if (!source) return { result: nearExit ? 'exit_locked' : 'far' };
  if (run.checked.includes(source.id)) return { result: 'already', source };
  run.checked.push(source.id);
  if (source.id !== run.world.targetSourceId) return { result: 'wrong', source };
  run.carrying = true;
  return { result: 'collected', source };
}

export function findPath(run, from, to, { allDoorsOpen = false } = {}) {
  if (!finitePoint(from) || !finitePoint(to)) return null;
  const start = { x: Math.floor(from.x), y: Math.floor(from.y) };
  const end = { x: Math.floor(to.x), y: Math.floor(to.y) };
  if (solid(run, start.x, start.y, { allDoorsOpen }) || solid(run, end.x, end.y, { allDoorsOpen })) return null;
  const queue = [start], parents = new Map([[key(start.x, start.y), null]]);
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    if (cell.x === end.x && cell.y === end.y) {
      const path = []; let cursor = cell;
      while (cursor) { path.push({ x: cursor.x + 0.5, y: cursor.y + 0.5 }); cursor = parents.get(key(cursor.x, cursor.y)); }
      return path.reverse();
    }
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const next = { x: cell.x + dx, y: cell.y + dy }, id = key(next.x, next.y);
      if (!parents.has(id) && !solid(run, next.x, next.y, { allDoorsOpen })) { parents.set(id, cell); queue.push(next); }
    }
  }
  return null;
}

export function getAcousticPath(run, source) {
  const listener = run.player;
  if (hasLineOfSight(run, listener, source)) return { gain: 1, cutoff: 18000, position: { x: source.x, y: source.y }, kind: 'direct' };
  const route = findPath(run, listener, source);
  // Closed rooms must remain discoverable by sound. Offline measurements of
  // the saved world showed the former 0.16 / 650 Hz path at -64.8 dBFS at entry;
  // this transmission raises it by 8.3 dB while preserving source direction,
  // distance attenuation, and the clearer signal after entering the room.
  if (!route) return { gain: 0.4, cutoff: 1800, position: { x: source.x, y: source.y }, kind: 'occluded' };
  const points = [{ x: listener.x, y: listener.y }, ...route, { x: source.x, y: source.y }];
  const path = [points[0]];
  let at = 0;
  while (at < points.length - 1) {
    let next = points.length - 1;
    while (next > at + 1 && !hasLineOfSight(run, points[at], points[next])) next--;
    if (distance(points[at], points[next]) > EPS) path.push(points[next]);
    at = next;
  }
  const first = path[1] ?? source;
  const length = path.slice(1).reduce((sum, point, i) => sum + distance(path[i], point), 0);
  const firstLength = distance(listener, first), scale = firstLength > EPS ? length / firstLength : 1;
  const bends = Math.max(1, path.length - 2);
  return { gain: Math.max(0.35, 0.84 ** bends), cutoff: Math.max(2400, 8500 * 0.8 ** (bends - 1)),
    position: { x: listener.x + (first.x - listener.x) * scale, y: listener.y + (first.y - listener.y) * scale },
    kind: route.some(cell => run.world.grid[Math.floor(cell.y)][Math.floor(cell.x)] === 'D') ? 'doorway' : 'reflected' };
}

// Movement updates the real collision/audio pose every frame. Long frame stalls
// consume at most 50 ms, so returning to the page never jumps the player ahead.
export class SmoothMovement {
  constructor({ getGame, onUpdate = () => {}, requestFrame = callback => requestAnimationFrame(callback),
    cancelFrame = id => cancelAnimationFrame(id), now = () => performance.now() }) {
    Object.assign(this, { getGame, onUpdate, requestFrame, cancelFrame, now });
    this.active = null; this.frame = null;
  }
  start({ forward = 0, turn = 0, action = '', onComplete = () => {} }) {
    if (![forward, turn].every(Number.isFinite) || (!forward && !turn) || (forward && turn)) return false;
    this.cancel();
    const game = this.getGame();
    if (game?.stage !== 'explore') return false;
    const duration = 1000 * (Math.abs(forward) / WALK_METRES_PER_SECOND + Math.abs(turn) / TURN_RADIANS_PER_SECOND);
    const operation = { game, forward, turn, action, onComplete, duration, elapsed: 0, last: this.now(), progress: 0, travelled: 0, turned: 0, frames: 0 };
    this.active = operation; this.frame = this.requestFrame(time => this.tick(operation, time));
    return true;
  }
  tick(operation, time) {
    if (this.active !== operation) return;
    this.frame = null;
    if (this.getGame() !== operation.game || operation.game.stage !== 'explore') return this.finish(operation, 'cancelled');
    const delta = Math.min(50, Math.max(0, time - operation.last)); operation.last = time;
    operation.elapsed = Math.min(operation.duration, operation.elapsed + delta);
    const progress = operation.elapsed / operation.duration, fraction = progress - operation.progress;
    const before = { ...operation.game.player }, forward = operation.forward * fraction, turn = operation.turn * fraction;
    const allowed = move(operation.game, forward, turn);
    const travelled = distance(before, operation.game.player);
    operation.travelled += travelled; operation.turned += turn; operation.frames++; operation.progress = progress;
    this.onUpdate({ elapsed: operation.elapsed, duration: operation.duration, pose: { ...operation.game.player } });
    if (this.active !== operation) return;
    if (!allowed || (forward && travelled + 1e-7 < Math.abs(forward))) return this.finish(operation, 'blocked');
    if (operation.elapsed >= operation.duration) return this.finish(operation, 'completed');
    this.frame = this.requestFrame(next => this.tick(operation, next));
  }
  finish(operation, status) {
    if (this.active !== operation) return;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null; this.active = null;
    operation.onComplete({ status, travelled: operation.travelled, turned: operation.turned, frames: operation.frames, elapsed: operation.elapsed });
  }
  cancel() { if (this.active) this.finish(this.active, 'cancelled'); }
}

// Every accepted E spends an attempt, including collection and the exit.
export function interact(run){
 if(run.stage!=='explore'||run.attempts>=5)return {result:'inactive'};
 run.attempts++;const outcome=inspectSource(run);
 if(run.attempts>=5&&run.stage!=='won'){run.stage='failed';return {result:'exhausted'};}
 return outcome;
}
