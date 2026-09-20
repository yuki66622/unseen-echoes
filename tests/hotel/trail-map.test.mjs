import test from 'node:test';
import assert from 'node:assert/strict';
import { TrailMap } from '../../public/hotel/trail-map.mjs';
import { createState } from '../../public/hotel/world.mjs';

// An explicit canvas boundary records the actual clipped line raster. Tests
// verify absence of unseen output as well as trail memory and floor changes.
function canvasBoundary() {
  const canvas = { width: 360, height: 300 };
  let path = [], cursor = null, mask = null, stack = [];
  const pixels = new Set(), strokes = [], fills = [];
  const inside = (x, y) => !mask || mask.some(circle => Math.hypot(x - circle.x, y - circle.y) <= circle.radius);
  const paint = (a, b) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y), count = Math.max(1, Math.ceil(length * 2));
    for (let i = 0; i <= count; i++) {
      const x = a.x + (b.x - a.x) * i / count, y = a.y + (b.y - a.y) * i / count;
      if (inside(x, y)) pixels.add(`${Math.round(x)},${Math.round(y)}`);
    }
  };
  const context = {
    globalAlpha: 1,
    save() { stack.push({ mask, globalAlpha: this.globalAlpha }); },
    restore() { const prior = stack.pop(); mask = prior.mask; this.globalAlpha = prior.globalAlpha; },
    setTransform() {},
    fillRect() { pixels.clear(); strokes.length = 0; fills.length = 0; },
    beginPath() { path = []; cursor = null; },
    moveTo(x, y) { cursor = { x, y }; },
    lineTo(x, y) { if (cursor) path.push({ type: 'line', a: cursor, b: { x, y } }); cursor = { x, y }; },
    arc(x, y, radius) { path.push({ type: 'circle', x, y, radius }); },
    closePath() {},
    clip() { mask = path.filter(item => item.type === 'circle'); },
    stroke() {
      if (!this.globalAlpha) return;
      strokes.push({ mask: mask && [...mask], alpha: this.globalAlpha });
      for (const item of path) if (item.type === 'line') paint(item.a, item.b);
    },
    fill() {
      if (!this.globalAlpha) return;
      fills.push({ mask: mask && [...mask], alpha: this.globalAlpha });
      for (const item of path) if (item.type === 'line') paint(item.a, item.b);
    },
  };
  canvas.getContext = () => context;
  const worldPoint = (x, y) => {
    const padding = Math.min(canvas.width, canvas.height) * 0.04;
    const scale = Math.min((canvas.width - padding * 2) / 18, (canvas.height - padding * 2) / 15);
    return { x: (canvas.width - 18 * scale) / 2 + x * scale, y: (canvas.height - 15 * scale) / 2 + (12 - y) * scale };
  };
  return {
    canvas, pixels, strokes, fills, worldPoint,
    litNear(x, y, radius = 2) {
      const p = worldPoint(x, y);
      return [...pixels].some(key => { const [a, b] = key.split(',').map(Number); return Math.hypot(p.x - a, p.y - b) <= radius; });
    },
  };
}

function move(map, state, x, y, elapsed = 0.5) {
  state.player.x = x; state.player.y = y; state.elapsed += elapsed; map.update(state);
}

function revealEntrance(map, state) {
  map.update(state);
  move(map, state, 5, -1.1);
  move(map, state, 5, -0.6);
  state.elapsed += 1; map.update(state);
}

test('new map is fully black until actual walking, including stationary turns and elapsed time', () => {
  const c = canvasBoundary(), map = new TrailMap(c.canvas), state = createState();
  assert.equal(c.pixels.size, 0);
  for (let n = 0; n < 50; n++) { state.elapsed += 5; state.player.heading += 0.3; map.update(state); }
  assert.equal(c.pixels.size, 0);
  assert.equal(c.strokes.length, 0);
  assert.equal(c.fills.length, 0, 'Even the player marker stays hidden before exploration begins');
  assert.equal(map.getStats().floors[0].distance, 0);
  assert.equal(map.getStats().floors[0].revealed, false);
  assert.equal(map.getStats().markerVisible, false);
});

test('roughly one metre unlocks a gradual trail and walls remain inside the explored mask', () => {
  const c = canvasBoundary(), map = new TrailMap(c.canvas), state = createState();
  map.update(state);
  move(map, state, 5, -1.1);
  assert.equal(c.pixels.size, 0);
  move(map, state, 5, -0.6);
  assert.equal(c.pixels.size, 0, 'Crossing the threshold begins a fade rather than flashing the map');
  state.elapsed += 0.25; map.update(state);
  assert.ok(c.pixels.size > 0);
  const earlyOpacity = c.strokes[0].alpha;
  state.elapsed += 1; map.update(state);
  assert.ok(c.strokes[0].alpha > earlyOpacity);
  assert.ok(c.strokes.every(stroke => stroke.mask?.length));
  assert.ok(c.fills.every(fill => fill.mask?.length));
  const metre = Math.abs(c.worldPoint(1, 0).x - c.worldPoint(0, 0).x);
  assert.ok(c.strokes.every(stroke => stroke.mask.every(circle => circle.radius <= metre + 1e-6)));
  assert.ok(c.litNear(5, -1), 'The actual walked path is visible');
  assert.ok(c.litNear(4.3, 0) || c.litNear(5.7, 0), 'Only a nearby doorway wall portion is revealed');
  for (const [x, y] of [[0, 0], [18, 0], [18, 12], [10, 10], [14, 10]]) assert.equal(c.litNear(x, y), false, `Unexplored wall (${x}, ${y}) stays dark`);
});

test('NPC and recorder locations cannot affect the rendered map', () => {
  const c = canvasBoundary(), map = new TrailMap(c.canvas), state = createState();
  revealEntrance(map, state);
  const original = [...c.pixels].sort();
  state.sources = { secretRecorder: { x: 5, y: -1, floor: 0 }, unknownWitness: { x: 18, y: 12, floor: 0 } };
  map.update(state);
  assert.deepEqual([...c.pixels].sort(), original);
});

test('stairs never create a cross-floor diagonal, both floors remember separate explored paths', () => {
  const c = canvasBoundary(), map = new TrailMap(c.canvas), state = createState();
  revealEntrance(map, state);
  const original = map.getStats().floors[0];
  state.stairs = { from: 0, to: 1, progress: 0.5 };
  move(map, state, 10, 5, 1);
  assert.deepEqual(map.getStats().floors[0], original);
  assert.equal(map.getStats().markerVisible, false);
  assert.equal(c.litNear(10, 5), false);
  assert.equal(map.getStats().floors[1], undefined, 'Upcoming floor is not explored early');
  state.stairs = null; state.player.floor = 1;
  move(map, state, 13.1, 10, 1);
  assert.equal(map.getStats().floors[1].distance, 0);
  assert.equal(map.getStats().floors[1].points, 1, 'Landing is a new path start');
  assert.equal(c.pixels.size, 0, 'New upper floor also starts black');
  move(map, state, 12.6, 10);
  move(map, state, 12.1, 10);
  state.elapsed += 1; map.update(state);
  assert.ok(c.litNear(12.5, 10));
  const upstairs = map.getStats().floors[1];
  state.stairs = { from: 1, to: 0, progress: 0.5 };
  move(map, state, 15, 8, 1);
  state.stairs = null; state.player.floor = 0;
  move(map, state, 16, 7.1, 1);
  assert.equal(map.getStats().floors[0].distance, original.distance);
  assert.equal(map.getStats().floors[0].segments, 2);
  assert.deepEqual(map.getStats().floors[1], upstairs);
  assert.ok(c.litNear(5, -1), 'Returning restores the already explored entrance');
  assert.equal(c.litNear(10, 3), false, 'No line joins the old trail to the stair landing');
});

test('pause freezes recording and reveal, reset removes all floor memories', () => {
  const c = canvasBoundary(), map = new TrailMap(c.canvas), state = createState();
  revealEntrance(map, state);
  state.paused = true;
  const stats = map.getStats(), pixels = [...c.pixels].sort();
  move(map, state, 15, 11, 100);
  assert.deepEqual(map.getStats(), stats);
  assert.deepEqual([...c.pixels].sort(), pixels);
  map.reset();
  assert.deepEqual(map.getStats().floors, {});
  assert.equal(c.pixels.size, 0);
  const fresh = createState(); map.update(fresh);
  assert.equal(c.pixels.size, 0);
  assert.equal(map.getStats().floors[0].distance, 0);
});

test('unexpected discontinuities start a separate segment instead of revealing a shortcut', () => {
  const c = canvasBoundary(), map = new TrailMap(c.canvas), state = createState();
  revealEntrance(map, state);
  const walked = map.getStats().floors[0].distance;
  move(map, state, 16, 7, 1);
  assert.equal(map.getStats().floors[0].distance, walked);
  assert.equal(map.getStats().floors[0].segments, 2);
  assert.equal(c.litNear(10, 3), false);
});

test('resizing redraws the same exploration at the new scale without revealing more', () => {
  const c = canvasBoundary(), map = new TrailMap(c.canvas), state = createState();
  revealEntrance(map, state);
  const stats = map.getStats();
  c.canvas.width = 720; c.canvas.height = 600;
  map.update(state);
  assert.deepEqual(map.getStats(), stats);
  assert.ok(c.litNear(5, -1));
  assert.equal(c.litNear(18, 12), false);
});
