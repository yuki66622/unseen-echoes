import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, queueMove, queueTurn, cancelMotion, updateWorld,
  nearestDoor, setDoor, nearestInteraction, regionAt, doorPosition, WALLS,
} from '../../public/hotel/world.mjs';

const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const angleDelta = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

function face(state, heading) {
  for (let i = 0; i < 5; i++) {
    const delta = angleDelta(state.player.heading, heading);
    if (Math.abs(delta) < 1e-7) return;
    assert.equal(queueTurn(state, delta * 180 / Math.PI), true);
    updateWorld(state, 0.7);
  }
  throw new Error('Could not finish turn');
}

function walk(state, x, y) {
  const allEvents = [];
  for (let i = 0; i < 60; i++) {
    const dx = x - state.player.x;
    const dy = y - state.player.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6 || state.stairs) return allEvents;
    face(state, Math.atan2(dx, dy));
    assert.equal(queueMove(state, Math.min(d, 0.5)), true);
    const events = updateWorld(state, 0.35);
    allEvents.push(...events);
    if (events.some(event => event.type === 'collision')) throw new Error(`Route collided while going to (${x}, ${y}) from (${state.player.x}, ${state.player.y})`);
  }
  throw new Error('Could not finish walk');
}

function open(state, id) {
  assert.equal(nearestDoor(state)?.id, id);
  assert.equal(setDoor(state, id, true), true);
  const events = updateWorld(state, 0.72);
  assert.ok(events.some(event => event.type === 'door' && event.id === id && event.open));
  close(state.doors[id], 1);
}

function enterHotel(state) {
  walk(state, 5, -1.1);
  open(state, 'entrance');
  walk(state, 5, 2);
}

test('bounded movement and turning update continuously, with stop and isolated reset', () => {
  const state = createState();
  assert.deepEqual(state.player, { x: 5, y: -1.6, floor: 0, heading: 0 });
  assert.equal(queueMove(state, 25), true);
  updateWorld(state, 0.08);
  assert.ok(state.player.y > -1.6 && state.player.y < -0.6);
  updateWorld(state, 1);
  close(state.player.y, -0.6);
  assert.equal(queueTurn(state, 30), true);
  updateWorld(state, 0.05);
  assert.ok(state.player.heading > 0 && state.player.heading < Math.PI / 6);
  updateWorld(state, 0.5);
  close(state.player.heading, Math.PI / 6);
  queueMove(state, -0.5);
  updateWorld(state, 0.08);
  cancelMotion(state);
  const stopped = { ...state.player };
  updateWorld(state, 2);
  assert.deepEqual(state.player, stopped);
  assert.equal(queueMove(state, NaN), false);
  assert.equal(queueTurn(state, Infinity), false);
  state.sources.claire.x = 17;
  state.phase = 'ending';
  const reset = createState();
  assert.equal(reset.sources.claire.x, 12.1);
  assert.equal(reset.phase, 'testimony');
  assert.deepEqual(reset.doors, { entrance: 0, lounge: 0, recording: 0, linen: 1 });
});

test('closed doors and walls stop the full player body, including slow-frame movement', () => {
  const state = createState();
  queueMove(state, 1);
  updateWorld(state, 1);
  queueMove(state, 1);
  const events = updateWorld(state, 10);
  assert.ok(events.some(event => event.type === 'collision'));
  assert.ok(state.player.y <= -0.18 + 1e-7);
  assert.equal(regionAt(state.player), 'exterior');
  assert.equal(setDoor(state, 'lounge', true), false, 'remote doors cannot be opened');
  assert.equal(setDoor(state, 'missing', true), false);
  open(state, 'entrance');
  walk(state, 5, 2);
  walk(state, 8.8, 2);
  face(state, Math.PI / 2);
  queueMove(state, 1);
  updateWorld(state, 1);
  queueMove(state, 1);
  assert.ok(updateWorld(state, 10).some(event => event.type === 'collision'));
  assert.ok(state.player.x <= 9.82 + 1e-7);
  assert.equal(regionAt(state.player), 'lobby');
});

test('door opening is gradual, pause freezes it, and body occupancy prevents closing', () => {
  const state = createState();
  walk(state, 5, -1.1);
  assert.equal(setDoor(state, 'entrance', true), true);
  const before = state.doors.entrance;
  updateWorld(state, 0.2);
  assert.ok(state.doors.entrance > before && state.doors.entrance < 1);
  state.paused = true;
  const snapshot = structuredClone(state);
  assert.deepEqual(updateWorld(state, 20), []);
  assert.deepEqual(state, snapshot);
  assert.equal(queueMove(state, 0.5), false);
  assert.equal(setDoor(state, 'entrance', false), false);
  state.paused = false;
  updateWorld(state, 1);
  walk(state, 5, 0);
  assert.equal(setDoor(state, 'entrance', false), false);
  walk(state, 5, 1);
  assert.equal(setDoor(state, 'entrance', false), true);
  updateWorld(state, 1);
  close(state.doors.entrance, 0);
});

test('door cues have hysteresis and NPC interactions track their current unobstructed room', () => {
  const state = createState();
  queueMove(state, 0.4);
  let events = updateWorld(state, 0.5);
  assert.equal(events.filter(event => event.type === 'door-near' && event.id === 'entrance').length, 1);
  queueMove(state, -0.3);
  updateWorld(state, 0.5);
  queueMove(state, 0.3);
  events = updateWorld(state, 0.5);
  assert.equal(events.filter(event => event.type === 'door-near').length, 0);
  queueMove(state, -0.8);
  updateWorld(state, 1);
  queueMove(state, 0.8);
  events = updateWorld(state, 1);
  assert.equal(events.filter(event => event.type === 'door-near' && event.id === 'entrance').length, 1);
  open(state, 'entrance');
  walk(state, 5, 2);
  walk(state, 8.9, 4.6);
  state.sources.claire = { x: 10.2, y: 4.6, floor: 0 };
  assert.equal(nearestInteraction(state), null, 'closed dividing door prevents interaction');
  open(state, 'lounge');
  walk(state, 10.5, 4.6);
  assert.equal(nearestInteraction(state)?.id, 'claire');
  state.sources.claire = { x: 17, y: 5, floor: 0 };
  assert.equal(nearestInteraction(state), null, 'interaction uses moving source, not original spawn');
});

test('complete playable route: all witnesses, stairs, cleaner, recorder, closed room and return', () => {
  const state = createState();
  const allEvents = [];
  enterHotel(state);
  allEvents.push(...walk(state, 4, 8));
  assert.equal(nearestInteraction(state)?.id, 'martin');
  walk(state, 4, 4.6);
  walk(state, 8.8, 4.6);
  open(state, 'lounge');
  walk(state, 11, 4.6);
  walk(state, 12.1, 5);
  assert.equal(nearestInteraction(state)?.id, 'claire');
  walk(state, 14.2, 5);
  assert.equal(nearestInteraction(state)?.id, 'elena');
  walk(state, 16, 5);
  walk(state, 16, 7.5);
  allEvents.push(...walk(state, 16, 8.4));
  assert.ok(state.stairs);
  assert.equal(state.stairs.to, 1);
  assert.equal(state.player.floor, 0);
  assert.ok(Number.isFinite(state.stairs.start.heading));
  assert.ok(Number.isFinite(state.stairs.end.heading));
  const progress = state.stairs.progress;
  const y = state.player.y;
  updateWorld(state, 0.2);
  assert.ok(state.stairs.progress > progress);
  assert.ok(state.player.y > y && state.player.y < 10);
  close(state.player.x, state.stairs.start.x + (state.stairs.end.x - state.stairs.start.x) * state.stairs.progress);
  close(state.player.y, state.stairs.start.y + (state.stairs.end.y - state.stairs.start.y) * state.stairs.progress);
  assert.equal(state.player.floor, 0, 'floor only commits on arrival');
  state.paused = true;
  const frozen = structuredClone(state);
  assert.deepEqual(updateWorld(state, 12), []);
  assert.deepEqual(state, frozen, 'stairs and all world state freeze while paused');
  state.paused = false;
  allEvents.push(...updateWorld(state, 3));
  assert.equal(state.stairs, null);
  assert.equal(state.player.floor, 1);
  close(state.player.x, 13.1);
  close(state.player.y, 10);
  close(state.player.heading, Math.PI * 1.5);
  const landed = { ...state.player };
  updateWorld(state, 3);
  assert.deepEqual(state.player, landed, 'arrival does not immediately return downstairs');
  walk(state, 12.4, 9.2);
  assert.equal(nearestInteraction(state)?.id, 'cleaner');
  walk(state, 3, 9.2);
  open(state, 'recording');
  walk(state, 3, 7.1);
  assert.equal(setDoor(state, 'recording', false), true);
  updateWorld(state, 1);
  allEvents.push(...walk(state, 3, 3.6));
  assert.equal(regionAt(state.player), 'recording');
  assert.deepEqual(nearestInteraction(state), { id: 'recorder', type: 'recorder', distance: 0 });
  close(state.doors.recording, 0);
  state.phase = 'investigation';
  walk(state, 3, 6.9);
  open(state, 'recording');
  walk(state, 3, 9.1);
  assert.equal(setDoor(state, 'recording', false), true);
  updateWorld(state, 1);
  walk(state, 3, 10);
  walk(state, 13.1, 10);
  allEvents.push(...walk(state, 14.4, 10));
  assert.ok(state.stairs);
  assert.equal(state.stairs.to, 0);
  assert.equal(state.player.floor, 1);
  allEvents.push(...updateWorld(state, 3));
  assert.equal(state.player.floor, 0);
  assert.equal(state.stairs, null);
  close(state.player.x, 16);
  close(state.player.y, 7.1);
  close(state.player.heading, Math.PI);
  assert.equal(state.phase, 'investigation');
  close(state.doors.recording, 0);
  close(state.doors.lounge, 1);
  walk(state, 16, 5);
  walk(state, 14.2, 5);
  assert.equal(nearestInteraction(state)?.id, 'elena');
  assert.ok(allEvents.some(event => event.type === 'stairs-start' && event.to === 1));
  assert.ok(allEvents.some(event => event.type === 'stairs-end' && event.floor === 0));
  assert.ok(allEvents.some(event => event.type === 'footstep' && event.material === 'carpet'));
  assert.ok(allEvents.some(event => event.type === 'footstep' && event.material === 'wood'));
});

test('pause in an ordinary step preserves progress and rejects input until resume', () => {
  const state = createState();
  queueMove(state, 0.5);
  updateWorld(state, 0.1);
  assert.ok(state.motion);
  state.paused = true;
  const snapshot = structuredClone(state);
  updateWorld(state, 10);
  assert.deepEqual(state, snapshot);
  assert.equal(queueTurn(state, 30), false);
  state.paused = false;
  updateWorld(state, 1);
  close(state.player.y, -1.1);
});

test('map data exposes only approved floors, doors and regions', () => {
  assert.ok(WALLS.every(wall => [0, 1].includes(wall.floor)));
  assert.deepEqual(doorPosition('recording'), { x: 3, y: 8, floor: 1 });
  assert.equal(doorPosition('unknown'), null);
  assert.equal(regionAt({ x: 3, y: 3, floor: 1 }), 'recording');
  assert.equal(regionAt({ x: 15, y: 3, floor: 1 }), 'linen');
  assert.equal(regionAt({ x: 16, y: 10, floor: 1 }), 'stairs');
});
