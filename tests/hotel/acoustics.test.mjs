import test from 'node:test';
import assert from 'node:assert/strict';
import { acousticScene, listenerPose, roomAt, webAudioListener } from '../../public/hotel/acoustics.mjs';

const state = (player = { x: 5, y: 4, floor: 0, heading: 0 }) => ({ player, doors: { entrance: 1, lounge: 1, recording: 1, linen: 1 }, stairs: null });
const claire = { x: 12.1, y: 5, floor: 0 };
const recorder = { x: 3, y: 3.6, floor: 1 };

test('all intended spaces have distinct acoustic regions', () => {
  assert.equal(roomAt({ x: 5, y: -1, floor: 0 }), 'exterior');
  assert.equal(roomAt({ x: 5, y: 3, floor: 0 }), 'lobby');
  assert.equal(roomAt(claire), 'lounge');
  assert.equal(roomAt({ x: 16, y: 9, floor: 0 }), 'stairs-lower');
  assert.equal(roomAt({ x: 16, y: 9, floor: 1 }), 'stairs-upper');
  assert.equal(roomAt({ x: 13, y: 10, floor: 1 }), 'corridor');
  assert.equal(roomAt(recorder), 'recording');
  assert.equal(roomAt({ x: 13, y: 7, floor: 1 }), 'linen');
});

test('point-source gain declines continuously with distance', () => {
  const close = acousticScene(state({ ...claire, x: 12.5 }), claire);
  const far = acousticScene(state({ ...claire, x: 17 }), claire);
  assert.ok(close.gain > far.gain);
  assert.equal(close.route.length, 0);
  assert.ok(Math.abs(acousticScene(state({ ...claire, x: 15 }), claire).gain - acousticScene(state({ ...claire, x: 15.001 }), claire).gain) < 0.001);
});

test('a wall routes sound to its doorway rather than through the wall', () => {
  const result = acousticScene(state({ x: 9, y: 9, floor: 0 }), claire);
  assert.deepEqual(result.route, ['lounge']);
  assert.equal(result.apparent.x, 10);
  assert.equal(result.apparent.z, -4.6);
  assert.ok(result.distance > Math.hypot(claire.x - 9, claire.y - 9));
});

test('door opening continuously increases loudness and high frequencies', () => {
  const scene = state(), gains = [], cutoffs = [];
  for (let i = 0; i <= 100; i++) {
    scene.doors.lounge = i / 100;
    const result = acousticScene(scene, claire); gains.push(result.gain); cutoffs.push(result.cutoff);
  }
  for (let i = 1; i < gains.length; i++) { assert.ok(gains[i] > gains[i - 1]); assert.ok(cutoffs[i] > cutoffs[i - 1]); }
  assert.ok(gains.at(-1) / gains[0] > 9.9);
  assert.equal(cutoffs[0], 650);
});

test('cross-floor routes traverse both stair openings and vertical flight', () => {
  const belowRoom = acousticScene(state({ x: 3, y: 3.6, floor: 0 }), recorder);
  assert.deepEqual(belowRoom.route, ['lounge', 'stairs-lower', 'stairs-flight', 'stairs-upper', 'recording']);
  assert.ok(belowRoom.distance > 30);
  assert.ok(belowRoom.cutoff <= 5200);
  const inRoom = acousticScene(state({ x: 3, y: 4.6, floor: 1 }), recorder);
  assert.ok(belowRoom.gain < inRoom.gain * 0.2);
});

test('stair acoustics interpolate endpoints without a midpoint switch', () => {
  const scene = state({ x: 16, y: 8, floor: 0, heading: 0 });
  scene.stairs = { from: 0, to: 1, progress: 0, start: { x: 16, y: 7.9, floor: 0 }, end: { x: 13.1, y: 10, floor: 1 } };
  const a = acousticScene(scene, recorder);
  scene.stairs.progress = 1; const b = acousticScene(scene, recorder);
  scene.stairs.progress = 0.5; const midpoint = acousticScene(scene, recorder);
  assert.ok(Math.abs(midpoint.gain - (a.gain + b.gain) / 2) < 1e-10);
  assert.equal(listenerPose(scene).floor, 0.5);
  assert.ok(Math.abs(webAudioListener(scene).y - 3.15) < 1e-10);
  scene.stairs.progress = 0.4999; const before = acousticScene(scene, recorder);
  scene.stairs.progress = 0.5001; const after = acousticScene(scene, recorder);
  assert.ok(Math.abs(before.gain - after.gain) < 0.001);
  assert.ok(Math.abs(before.cutoff - after.cutoff) < 4);
  assert.equal(scene.player.floor, 0);
});

test('diffuse ambience remains continuous crossing an open doorway', () => {
  const lobbyBed = { x: 5, y: 5, floor: 0 };
  const before = acousticScene(state({ x: 9.9999, y: 4.6, floor: 0 }), lobbyBed, { diffuse: true });
  const after = acousticScene(state({ x: 10.0001, y: 4.6, floor: 0 }), lobbyBed, { diffuse: true });
  assert.ok(Math.abs(before.gain - after.gain) < 0.001);
  assert.ok(Math.abs(before.directionality - after.directionality) < 0.001);
});

test('heading uses north at zero and east at positive pi/2', () => {
  const north = webAudioListener(state());
  assert.equal(north.forwardX, 0); assert.equal(north.forwardZ, -1);
  const east = webAudioListener(state({ x: 5, y: 4, floor: 0, heading: Math.PI / 2 }));
  assert.equal(east.forwardX, 1); assert.ok(Math.abs(east.forwardZ) < 1e-9);
});
