import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePose, motionDuration, sampleMotion } from '../src/physics.mjs';
import * as geometry from '../src/geometry.mjs';

const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const motion = (pose, forward, turn = 0) => ({ seq: 1, origin: pose, forward, turn,
  durationMs: motionDuration(forward, turn), elapsedMs: 0 });

test('square-v1 has no interior walls and every sampled interior point connects directly', () => {
  assert.equal(geometry.ROOM_SIZE,8);assert.deepEqual(geometry.WALLS,[]);
  assert.deepEqual(geometry.DOOR.center,{x:7.6,y:5.5});
  assert.deepEqual(geometry.LOCATIONS,[{id:'a',x:1.5,y:4.8},{id:'b',x:7.6,y:5.5},{id:'c',x:2,y:7}]);
  const points=[...geometry.LOCATIONS,{x:2,y:1},{x:2,y:7}];
  for(const x of [0.4,2,4,6,7.6])for(const y of [0.4,2,4,6,7.6])points.push({x,y});
  for(const a of points)for(const b of points)for(const open of [false,true]){
    assert.equal(geometry.canTravel(a,b,open),true,JSON.stringify({a,b,open}));
    assert.equal(geometry.hasLineOfSight(a,b,open),true);
  }
});

test('outer boundaries reject outside paths even with the exit open',()=>{
  for(const outside of [{x:-1,y:4},{x:9,y:4},{x:4,y:-1},{x:4,y:9}])for(const open of [false,true]){
    assert.equal(geometry.canTravel({x:4,y:4},outside,open),false);
    assert.equal(geometry.hasLineOfSight({x:4,y:4},outside,open),false);
  }
  assert.equal(geometry.canTravel({x:4,y:4},{x:0.1,y:4}),false);
  assert.equal(geometry.canTravel({x:NaN,y:4},{x:4,y:4}),false);
  assert.deepEqual(geometry.blockingSegments(),[]);
});

test('walk sampling is linear at one metre per second, including reverse', () => {
  const walk = motion({ x: 2, y: 1, heading: 0 }, 0.5);
  near(walk.durationMs, 500);
  for (const elapsed of [0, 50, 125, 250, 499, 500, 800]) {
    const sampled = sampleMotion(walk, elapsed);
    near(sampled.pose.y, 1 + Math.min(elapsed, 500) / 1000);
    near(sampled.pose.x, 2);
    assert.equal(sampled.done, elapsed >= 500);
  }
  near(sampleMotion(motion({ x: 2, y: 1, heading: 0 }, -0.5), 250).pose.y, 0.75);
});

test('turns rotate at 120 degrees per second; heading zero faces positive y', () => {
  const right = motion({ x: 2, y: 1, heading: 0 }, 0, Math.PI / 6);
  near(right.durationMs, 250);
  near(sampleMotion(right, 125).pose.heading, Math.PI / 12);
  near(sampleMotion(motion({ x: 2, y: 1, heading: 0 }, 0, -Math.PI / 6), 250).pose.heading, 11 * Math.PI / 6);
  const walk = advancePose({ x: 2, y: 1, heading: Math.PI / 2 }, 0.5, 0);
  near(walk.pose.x, 2.5);
  near(walk.pose.y, 1);
});

test('the removed interior walls and old doorway never block a chase step', () => {
  const wall = advancePose({ x: 2, y: 4, heading: Math.PI / 2 }, 4, 0, true);
  assert.equal(wall.blocked, false);
  near(wall.pose.x, 6);
  const closed = sampleMotion(motion({ x: 3, y: 5.5, heading: Math.PI / 2 }, 3), 3000, false);
  assert.equal(closed.blocked, false);
  assert.equal(closed.done, true);
  near(closed.pose.x, 6);
  const open = sampleMotion(motion({ x: 3, y: 5.5, heading: Math.PI / 2 }, 3), 3000, true);
  assert.equal(open.blocked, false);
  near(open.pose.x, 6);
});

test('collision preserves the last safe point and permits moving away again', () => {
  const hit = advancePose({ x: 7.5, y: 4, heading: Math.PI / 2 }, 0.5, 0, true);
  near(hit.pose.x, 7.6);
  const retreat = advancePose(hit.pose, -0.5, 0, true);
  assert.equal(retreat.blocked, false);
  near(retreat.pose.x, 7.1);
});

test('long steps stop at every external wall whether the exit is open or closed',()=>{
  for(const open of [false,true])for(const [heading,expected] of [
    [0,{x:4,y:7.6}],[Math.PI/2,{x:7.6,y:4}],
    [Math.PI,{x:4,y:0.4}],[3*Math.PI/2,{x:0.4,y:4}],
  ]){
    const result=advancePose({x:4,y:4,heading},20,0,open);
    near(result.pose.x,expected.x);near(result.pose.y,expected.y);assert.equal(result.blocked,true);
  }
});

test('room bounds stop motion and invalid inputs are rejected', () => {
  const edge = advancePose({ x: 2, y: 0.5, heading: 0 }, -1, 0);
  near(edge.pose.y, 0.4);
  assert.equal(edge.blocked, true);
  assert.throws(() => advancePose({ x: NaN, y: 1, heading: 0 }, 1, 0), TypeError);
  assert.throws(() => motionDuration(1, 1), TypeError);
  assert.throws(() => motionDuration(Infinity, 0), TypeError);
  assert.throws(() => sampleMotion(motion({ x: 2, y: 1, heading: 0 }, 0.5), NaN), TypeError);
});
