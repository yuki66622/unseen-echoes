import test from 'node:test';
import assert from 'node:assert/strict';
import { SoloConnection } from '../local/solo-session.mjs';

function session() {
  let time = 1000, timerId = 0;
  const timers = new Map(), snapshots = [];
  const connection = new SoloConnection(room => snapshots.push(room), {
    now: () => time,
    setInterval: callback => { const id = timerId++; timers.set(id, callback); return id; },
    clearInterval: id => timers.delete(id),
  });
  const tick = (ms = 50) => { time += ms; for (const callback of [...timers.values()]) callback(); };
  return {
    connection, timers, snapshots, tick,
    view: () => snapshots.at(-1),
    advance(ms) { for (let remaining = ms; remaining > 0; remaining -= 50) tick(Math.min(50, remaining)); },
    input(seq, kind, value = '') {
      return connection.call('input', { roundId: snapshots.at(-1).game.roundId, seq, kind, value });
    },
  };
}

for (const [role, y, heading, otherRole] of [
  ['survivor', 1, 0, 'hunter'], ['hunter', 7, Math.PI, 'survivor'],
]) {
  test(`solo ${role} enters immediately with the real initial pose and a stationary opponent`, () => {
    const run = session();
    run.connection.start(role);
    const room = run.view();
    assert.equal(run.connection.local, true);
    assert.equal(run.connection.ready, true);
    assert.equal(room.code, 'LOCAL');
    assert.equal(room.phase, 'running');
    assert.equal(room.game.role, role);
    assert.deepEqual(room.game.self, { x: 2, y, heading, moving: false });
    assert.equal(room.game.attemptsRemaining, 5);
    assert.equal(room.game.restartVotes, 0);
    assert.equal(room.game.paused, false);
    assert.equal(room.members.length, 2);
    assert.equal(room.members.find(member => member.identity === run.connection.identity).role, role);
    const opponent = room.members.find(member => member.identity !== run.connection.identity);
    assert.equal(opponent.role, otherRole);
    assert.equal(opponent.online, true);
    assert.match(opponent.name, /静止|stationary/i);
    run.advance(4000);
    assert.deepEqual(run.view().game.audiblePlayers, []);
    if (role === 'hunter') assert.deepEqual(run.view().game.heartbeatSource, { x: 2, y: 1 });
    run.connection.disconnect();
  });
}

test('solo movement advances with time and stop prevents later movement', async () => {
  const run = session();
  run.connection.start('survivor');
  const initial = run.view();
  await run.input(1, 'move', 'forward');
  run.advance(200);
  assert.ok(Math.abs(run.view().game.self.y - 1.2) < 1e-7);
  assert.equal(run.view().game.self.moving, true);
  await run.input(2, 'stop');
  run.advance(500);
  assert.ok(Math.abs(run.view().game.self.y - 1.2) < 1e-7);
  assert.equal(run.view().game.motion, null);
  assert.equal(run.view().game.lastProcessedInputSeq, 2);
  assert.equal(initial.game.self.y, 1);
  run.connection.disconnect();
});

test('solo hunter retains the real head start and can move when it ends', async () => {
  const run = session();
  run.connection.start('hunter');
  await assert.rejects(run.input(1, 'move', 'forward'), /head start/);
  run.advance(3000);
  await run.input(1, 'move', 'forward');
  run.advance(500);
  assert.ok(Math.abs(run.view().game.self.y - 6.5) < 1e-7);
  assert.deepEqual(run.view().game.heartbeatSource, { x: 2, y: 1 });
  run.connection.disconnect();
});

test('five missed interactions finish the solo round and stop its timer', async () => {
  const run = session();
  run.connection.start('survivor');
  for (let seq = 1; seq <= 5; seq++) {
    await run.input(seq, 'interact', 'inspect');
    assert.equal(run.view().game.attemptsRemaining, 5 - seq);
  }
  assert.equal(run.view().phase, 'finished');
  assert.equal(run.view().game.outcome, 'attempts_exhausted');
  assert.equal(run.view().game.winner, 'hunter');
  assert.equal(run.timers.size, 0);
  await assert.rejects(run.input(6, 'interact', 'inspect'), /ended/);
});

test('restart returns one player to role selection and rejects stale round input', async () => {
  const run = session();
  run.connection.start('survivor');
  const previousRound = run.view().game.roundId;
  await run.input(1, 'interact', 'inspect');
  await run.connection.call('restartRound');
  assert.equal(run.view().phase, 'lobby');
  assert.equal(run.view().game, null);
  assert.equal(run.timers.size, 0);
  const count = run.snapshots.length;
  run.tick(1000);
  assert.equal(run.snapshots.length, count);
  run.connection.start('hunter');
  assert.notEqual(run.view().game.roundId, previousRound);
  assert.equal(run.view().game.role, 'hunter');
  assert.equal(run.view().game.attemptsRemaining, 5);
  await assert.rejects(run.connection.call('input', {
    roundId: previousRound, seq: 2, kind: 'stop', value: '',
  }), /different round/);
  run.connection.disconnect();
});

test('starting again and resetting leave no timer from the previous round', () => {
  const run = session();
  run.connection.start('survivor');
  run.connection.start('hunter');
  assert.equal(run.timers.size, 1);
  const count = run.snapshots.length;
  run.tick();
  assert.equal(run.snapshots.length, count + 1);
  run.connection.reset();
  assert.equal(run.view().phase, 'lobby');
  assert.equal(run.view().game, null);
  assert.equal(run.timers.size, 0);
  run.connection.resume();
  assert.equal(run.timers.size, 0);
});

test('disconnect stops updates and resume or reconnect restarts only one timer', async () => {
  const run = session();
  run.connection.start('survivor');
  run.connection.disconnect();
  assert.equal(run.connection.ready, false);
  assert.equal(run.timers.size, 0);
  const count = run.snapshots.length;
  run.tick(1000);
  assert.equal(run.snapshots.length, count);
  await assert.rejects(run.input(1, 'move', 'forward'));
  run.connection.resume();
  run.connection.resume();
  run.connection.reconnect();
  assert.equal(run.connection.ready, true);
  assert.equal(run.timers.size, 1);
  await run.input(1, 'move', 'forward');
  run.advance(500);
  assert.ok(Math.abs(run.view().game.self.y - 1.5) < 1e-7);
  run.connection.disconnect();
  run.connection.reconnect();
  assert.equal(run.timers.size, 1);
  run.connection.disconnect();
});

test('going offline does not stop the local round or its controls', async () => {
  const run = session();
  run.connection.start('survivor');
  run.connection.goOffline();
  assert.equal(run.connection.ready, true);
  await run.input(1, 'move', 'forward');
  run.advance(500);
  assert.ok(Math.abs(run.view().game.self.y - 1.5) < 1e-7);
  assert.equal(run.view().game.paused, false);
  run.connection.disconnect();
});

test('invalid roles or commands reject without replacing the current round', async () => {
  const run = session();
  await assert.rejects(run.connection.call('input', { seq: 1, kind: 'stop', value: '' }));
  run.connection.start('survivor');
  const roundId = run.view().game.roundId;
  for (const role of ['', 'spectator', null, undefined]) assert.throws(() => run.connection.start(role), /role/i);
  assert.equal(run.view().game.roundId, roundId);
  assert.equal(run.timers.size, 1);
  await assert.rejects(run.input(1, 'move', 'teleport'), /Unknown input/);
  await assert.rejects(run.connection.call('unknown'));
  assert.equal(run.view().game.lastProcessedInputSeq, 0);
  run.connection.disconnect();
});

test('the real deadline ends a local round and resume cannot restart a finished timer', () => {
  const run = session();
  run.connection.start('survivor');
  run.tick(180000);
  assert.equal(run.view().phase, 'finished');
  assert.equal(run.view().game.outcome, 'timeout');
  assert.equal(run.timers.size, 0);
  run.connection.resume();
  assert.equal(run.timers.size, 0);
});
