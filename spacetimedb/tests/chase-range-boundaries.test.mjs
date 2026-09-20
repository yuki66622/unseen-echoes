import test from 'node:test';
import assert from 'node:assert/strict';
import {createChase, advanceChase, canInteract, snapshotFor, applyInput, setPlayerOnline} from '../src/rules.ts';

const makeGame = (ready = true) => {
  const state = createChase('range-boundary', [
    {id: 'hunter', role: 'hunter', online: true},
    {id: 'survivor', role: 'survivor', online: true},
  ], 0);
  if (ready) advanceChase(state, 8000);
  return state;
};
const hunter = state => state.players[0];
const survivor = state => state.players[1];
const inspect = (state, id, seq = 1, now = state.serverTimeMs) => applyInput(state, id,
  {roundId: state.roundId, seq, kind: 'interact', value: 'inspect'}, now);
const placeCapture = (state, distance, heading = 0) => {
  hunter(state).pose = {x: 2, y: 2, heading};
  survivor(state).pose = {x: 2 + distance, y: 2, heading: Math.PI};
};
const placeAnchor = (state, hasMotor, distance, heading = 0) => {
  state.hasKey = hasMotor;
  const anchor = hasMotor ? {x: 7.6, y: 5.5} : {x: 1.5, y: 4.8};
  survivor(state).pose = {...anchor, y: anchor.y - distance, heading};
};

test('capture includes 1.25 m and excludes 1.251 m; snapshot and command agree', () => {
  for (const [distance, expected] of [[1.0, true], [1.25, true], [1.251, false]]) {
    const state = makeGame(); placeCapture(state, distance);
    assert.equal(canInteract(state, 'hunter'), expected, `capture at ${distance} m`);
    assert.equal(snapshotFor(state, 'hunter', 0).canInteract, expected);
    inspect(state, 'hunter');
    assert.equal(state.outcome, expected ? 'captured' : null);
    assert.equal(hunter(state).interactionAttempts, 1);
  }
});

test('motor and exit include 1.5 m and exclude 1.501 m without an angle requirement', () => {
  for (const hasMotor of [false, true]) for (const heading of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    for (const [distance, expected] of [[1.25, true], [1.5, true], [1.501, false]]) {
      const state = makeGame(); placeAnchor(state, hasMotor, distance, heading);
      assert.equal(canInteract(state, 'survivor'), expected, `${hasMotor ? 'exit' : 'motor'} ${distance} m / ${heading}`);
      assert.equal(snapshotFor(state, 'survivor', 0).canInteract, expected);
      inspect(state, 'survivor');
      assert.equal(state.outcome, hasMotor && expected ? 'escaped' : null);
      assert.equal(state.hasKey, hasMotor || expected);
      assert.equal(survivor(state).interactionAttempts, 1);
    }
  }
});

test('capture remains omnidirectional at its new boundary', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    const state = makeGame(); placeCapture(state, 1.25, heading);
    assert.equal(canInteract(state, 'hunter'), true);
    inspect(state, 'hunter'); assert.equal(state.outcome, 'captured');
  }
});

test('wider range keeps head start, online and pause gates and does not consume rejected E', () => {
  const headStart = makeGame(false); placeCapture(headStart, 1.0);
  assert.equal(canInteract(headStart, 'hunter'), false);
  assert.throws(() => inspect(headStart, 'hunter'), /head start/);
  assert.equal(hunter(headStart).interactionAttempts, 0);
  const paused = makeGame(); placeCapture(paused, 1.0);
  setPlayerOnline(paused, 'survivor', false, 8000);
  assert.equal(canInteract(paused, 'hunter'), false);
  assert.throws(() => inspect(paused, 'hunter'), /paused/);
  assert.equal(hunter(paused).interactionAttempts, 0);
});

test('fifth capture and escape win at the wider boundary before exhaustion', () => {
  for (const kind of ['capture', 'escape']) {
    const state = makeGame();
    const player = kind === 'capture' ? hunter(state) : survivor(state);
    player.interactionAttempts = 4;
    if (kind === 'capture') placeCapture(state, 1.25); else placeAnchor(state, true, 1.5);
    inspect(state, player.id);
    assert.equal(state.outcome, kind === 'capture' ? 'captured' : 'escaped');
    assert.equal(player.interactionAttempts, 5);
    assert.equal(snapshotFor(state, player.id, 0).attemptsRemaining, 0);
    assert.throws(() => inspect(state, player.id, 2), /ended/);
  }
});

test('wider motor range still requires the motor before exit and cannot grant a sixth attempt', () => {
  const earlyExit = makeGame(); placeAnchor(earlyExit, true, 1.5); earlyExit.hasKey = false;
  assert.equal(canInteract(earlyExit, 'survivor'), false);
  inspect(earlyExit, 'survivor'); assert.equal(earlyExit.outcome, null); assert.equal(earlyExit.hasKey, false);
  const lastMotor = makeGame(); placeAnchor(lastMotor, false, 1.5);
  survivor(lastMotor).interactionAttempts = 4; inspect(lastMotor, 'survivor');
  assert.equal(lastMotor.hasKey, true); assert.equal(lastMotor.outcome, 'attempts_exhausted');
  assert.equal(lastMotor.winner, 'hunter');
});
