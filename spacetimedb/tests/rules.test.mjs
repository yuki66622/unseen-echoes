import test from 'node:test';
import assert from 'node:assert/strict';
import { createChase, advanceChase, applyInput, setPlayerOnline, abandonChase, snapshotFor,
  canInteract, RuleError, ROUND_MS, RECONNECT_MS } from '../src/rules.ts';

const newGame = () => createChase('round-one', [
  { id: 'survivor-id', role: 'survivor', online: true },
  { id: 'hunter-id', role: 'hunter', online: true },
], 0);
const survivor = state => state.players[0];
const hunter = state => state.players[1];
const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
function act(state, player, seq, kind, value, at = state.serverTimeMs, roundId = state.roundId) {
  return applyInput(state, player.id, { roundId, seq, kind, value }, at);
}
function ticks(state, end) {
  while (state.serverTimeMs < end && !state.outcome) advanceChase(state, Math.min(end, state.serverTimeMs + 50));
}

test('creation requires two distinct online roles and gives exact initial poses', () => {
  const state = newGame();
  assert.deepEqual(survivor(state).pose, { x: 2, y: 1, heading: 0 });
  assert.deepEqual(hunter(state).pose, { x: 2, y: 7, heading: Math.PI });
  assert.equal(snapshotFor(state, 'survivor-id', 0).remainingSeconds, 180);
  assert.equal(snapshotFor(state,'survivor-id',0).objective,'Find the old motor and interact to inspect it.');
  assert.equal(survivor(state).notice,'Find the old motor, then reach the rain at the exit.');
  assert.equal(snapshotFor(state, 'hunter-id', 0).headstartSeconds, 3);
  assert.throws(() => createChase('r', [{ id: 's', role: 'survivor', online: true }], 0), RuleError);
  assert.throws(() => createChase('r', [{ id: 's', role: 'survivor', online: true }, { id: 's', role: 'hunter', online: true }], 0), RuleError);
});

test('the hunter cannot move, turn, interact or operate a door during the three-second head start', () => {
  const state = newGame();
  for (const [kind, value] of [['move', 'forward'], ['turn', 'right'], ['interact', 'inspect'], ['door', 'open']]) {
    assert.throws(() => act(state, hunter(state), 1, kind, value, 2999), /head start/);
  }
  act(state, survivor(state), 1, 'move', 'forward', 2999);
  act(state, hunter(state), 1, 'move', 'forward', 3000);
  ticks(state, 3500);
  near(hunter(state).pose.y, 6.5);
});

test('movement starts at acceptance and advances with real time, not number of messages', () => {
  const state = newGame();
  act(state, survivor(state), 1, 'move', 'forward', 0);
  for (let seq = 2; seq <= 100; seq++) act(state, survivor(state), seq, 'move', 'forward', 0);
  near(survivor(state).pose.y, 1);
  ticks(state, 200);
  near(survivor(state).pose.y, 1.2);
  act(state, survivor(state), 101, 'move', 'back', 200);
  near(survivor(state).motion.origin.y, 1.2);
  ticks(state, 450);
  near(survivor(state).pose.y, 0.95);
  act(state, survivor(state), 102, 'stop', '', 450);
  ticks(state, 900);
  near(survivor(state).pose.y, 0.95);
});

test('server snapshots acknowledge input separately from motion progress and hide internal clocks', () => {
  const state = newGame();
  act(state, survivor(state), 7, 'move', 'forward', 0);
  ticks(state, 150);
  const view = snapshotFor(state, 'survivor-id', 0);
  assert.equal(view.lastProcessedInputSeq, 7);
  assert.equal(view.motion.seq, 7);
  assert.equal(view.motion.elapsedMs, 150);
  assert.equal(view.motion.durationMs, 500);
  assert.equal('expiresAtMs' in view.motion, false);
  assert.equal(view.self.moving, true);
  ticks(state, 500);
  assert.equal(snapshotFor(state, 'survivor-id', 0).motion, null);
});

test('old round, replayed input, foreign identity and malformed command cannot apply', () => {
  const state = newGame();
  act(state, survivor(state), 2, 'move', 'forward', 0);
  const before = JSON.stringify(state);
  for (const command of [
    { roundId: 'old', seq: 3, kind: 'move', value: 'forward' },
    { roundId: state.roundId, seq: 2, kind: 'move', value: 'forward' },
    { roundId: state.roundId, seq: 1, kind: 'move', value: 'forward' },
    { roundId: state.roundId, seq: 3, kind: '__proto__', value: 'forward' },
    { roundId: state.roundId, seq: 3, kind: 'move', value: 'teleport' },
    { roundId: state.roundId, seq: 0x100000000, kind: 'stop', value: '' },
  ]) assert.throws(() => applyInput(state, 'survivor-id', command, 50), RuleError);
  assert.throws(() => applyInput(state, 'outsider', { roundId: state.roundId, seq: 1, kind: 'stop', value: '' }, 50), RuleError);
  assert.equal(JSON.stringify(state), before);
});

test('a stalled callback catches up at most 100 ms and expires an overdue motion', () => {
  const state = newGame();
  act(state, survivor(state), 1, 'move', 'forward', 0);
  advanceChase(state, 400);
  near(survivor(state).pose.y, 1.1);
  advanceChase(state, 1000);
  near(survivor(state).pose.y, 1.2);
  assert.equal(survivor(state).motion, null);
  advanceChase(state, 1100);
  near(survivor(state).pose.y, 1.2);
});

test('walks cannot cross the outside wall during a late tick', () => {
  const state = newGame();
  survivor(state).pose = { x: 7.55, y: 5.5, heading: Math.PI / 2 };
  act(state, survivor(state), 1, 'move', 'forward', 0);
  advanceChase(state, 300);
  near(survivor(state).pose.x, 7.6);
  assert.equal(survivor(state).motion, null);
});

test('capture requires explicit interaction and range after head start', () => {
  const state = newGame();
  advanceChase(state, 8000);
  hunter(state).pose = { x: 3.2, y: 5.5, heading: Math.PI / 2 };
  survivor(state).pose = { x: 4.6, y: 5.5, heading: 0 };
  assert.equal(canInteract(state, 'hunter-id'), false);
  act(state, hunter(state), 1, 'interact', 'inspect');
  assert.equal(state.outcome, null);
  hunter(state).pose.x=3.7;
  assert.equal(canInteract(state, 'hunter-id'), true);
  ticks(state, 8100);
  assert.equal(state.outcome, null);
  act(state, hunter(state), 2, 'interact', 'inspect');
  assert.equal(state.outcome, 'captured');
  assert.equal(state.winner, 'hunter');
  assert.equal(snapshotFor(state, 'survivor-id', 0).outcome, 'captured');
  assert.throws(() => act(state, survivor(state), 1, 'move', 'forward'), /ended/);
  advanceChase(state, ROUND_MS + 1);
  assert.equal(state.outcome, 'captured');
});

test('a removed interior wall no longer prevents a capture within reach', () => {
  const state = newGame();
  advanceChase(state, 8000);
  hunter(state).pose = { x: 3.7, y: 4, heading: 0 };
  survivor(state).pose = { x: 4.3, y: 4, heading: 0 };
  state.doorOpen = true;
  act(state, hunter(state), 1, 'interact', 'inspect');
  assert.equal(state.outcome, 'captured');
});

test('escape requires the motor, exit range and explicit interaction, with no door step', () => {
  const state=newGame();const p=survivor(state);
  p.pose={x:7.6,y:5.5,heading:0};act(state,p,1,'interact','inspect');
  assert.equal(state.outcome,null);assert.equal(state.hasKey,false);
  p.pose={x:1.5,y:4.8,heading:0};act(state,p,2,'interact','inspect');
  assert.equal(state.hasKey,true);assert.equal(state.outcome,null);
  p.pose={x:5,y:5.5,heading:0};act(state,p,3,'interact','inspect');
  assert.equal(state.outcome,null);assert.equal(canInteract(state,p.id),false);
  p.pose={x:7.6,y:5.5,heading:0};assert.equal(state.doorOpen,false);
  assert.equal(canInteract(state,p.id),true);act(state,p,4,'interact','inspect');
  assert.equal(state.outcome,'escaped');assert.equal(state.winner,'survivor');
});

test('only the survivor can confirm the motor and an open exit cannot confirm it remotely',()=>{
  const state=newGame();advanceChase(state,8000);
  hunter(state).pose={x:1.5,y:4.8,heading:0};
  act(state,hunter(state),1,'interact','inspect');assert.equal(state.hasKey,false);
  survivor(state).pose={x:7.6,y:5.5,heading:0};state.doorOpen=true;
  act(state, survivor(state), 1, 'interact', 'inspect');
  assert.equal(state.outcome, null);
  assert.equal(state.hasKey, false);
  assert.equal(survivor(state).notice,'The old motor is not within reach.');
});

test('timeout has a stable hunter result, including an input exactly at the deadline', () => {
  const state = newGame();
  act(state, survivor(state), 1, 'move', 'forward', ROUND_MS);
  assert.equal(state.outcome, 'timeout');
  assert.equal(state.winner, 'hunter');
  assert.equal(survivor(state).motion, null);
  assert.equal(survivor(state).lastProcessedInputSeq, 0);
  assert.equal(snapshotFor(state, 'survivor-id', 0).remainingSeconds, 0);
});

test('both roles can open or close the east exit within reach', () => {
  const state = newGame();
  advanceChase(state,8000);
  assert.throws(() => act(state, survivor(state), 1, 'door', 'open'), /closer/);
  survivor(state).pose = { x: 6.5, y: 5.5, heading: Math.PI / 2 };
  hunter(state).pose = { x: 6.7, y: 5.7, heading: 0 };
  act(state, survivor(state), 1, 'door', 'open');
  assert.equal(state.doorOpen,true);
  act(state,hunter(state),1,'door','close');assert.equal(state.doorOpen,false);
  act(state,hunter(state),2,'door','open');assert.equal(state.doorOpen,true);
  act(state,survivor(state),2,'door','close');assert.equal(state.doorOpen,false);
});

test('changing exit state during a movement never pulls the player back', () => {
  const state = newGame();
  advanceChase(state, 8000);
  state.doorOpen = true;
  survivor(state).pose = { x: 6.2, y: 5.5, heading: Math.PI / 2 };
  hunter(state).pose = { x: 6.4, y: 5.3, heading: 0 };
  act(state, survivor(state), 1, 'move', 'forward');
  ticks(state, 8475);
  near(survivor(state).pose.x, 6.675);
  act(state, hunter(state), 1, 'door', 'close');
  near(survivor(state).motion.origin.x, 6.675);
  ticks(state, 8500);
  near(survivor(state).pose.x, 6.7);
  assert.equal(survivor(state).motion, null);
});

test('stationary, turning and distant players never expose positions in the sender snapshot', () => {
  const state = newGame();
  advanceChase(state, 8000);
  const view = () => snapshotFor(state, 'survivor-id', 0);
  assert.deepEqual(view().audiblePlayers, []);
  act(state, hunter(state), 1, 'move', 'forward');
  assert.deepEqual(view().audiblePlayers, []); // six metres away
  hunter(state).pose = { x: 2, y: 5, heading: Math.PI };
  act(state, hunter(state), 2, 'move', 'forward');
  assert.equal(view().audiblePlayers.length, 1);
  assert.equal(view().audiblePlayers[0].id, 'hunter-id');
  act(state, hunter(state), 3, 'turn', 'right');
  assert.deepEqual(view().audiblePlayers, []);
  assert.equal('players' in view(), false);
  assert.equal('startedAtMs' in view(), false);
});

test('square snapshots expose the agreed static landmarks and map id, not private player state',()=>{
  const state=newGame();
  for(const id of ['survivor-id','hunter-id']){
    const view=snapshotFor(state,id,0);
    assert.equal(view.mapId,'square-open-v2');
    assert.deepEqual(view.sources,[
      {id:'a',x:1.5,y:4.8,soundId:'motor'},
      {id:'b',x:7.6,y:5.5,soundId:'rain'},
      {id:'c',x:2,y:7,soundId:'fire'},
    ]);
    assert.equal('players' in view,false);assert.equal('hunter' in view,false);
    assert.deepEqual(view.audiblePlayers,[]);
    assert.deepEqual(view.doorEvent,{seq:0,openedAtMs:0,x:7.6,y:5.5});
  }
});

test('hunter heartbeat is a bounded smooth distance signal even when the survivor is stationary',()=>{
  const state=newGame();hunter(state).pose={x:0.4,y:0.4,heading:0};
  let previous=1;
  for(const d of [0,1,2,2.01,3,5,7,7.99,8,9]){
    survivor(state).pose={x:0.4+0.6*d,y:0.4+0.8*d,heading:0};
    const view=snapshotFor(state,'hunter-id',0);
    const value=view.heartbeatIntensity;
    assert.equal(typeof value,'number');assert.ok(Number.isFinite(value)&&value>=0&&value<=1);
    const t=Math.max(0,Math.min(1,(8-d)/6));near(value,t*t*(3-2*t));
    assert.ok(value<=previous);previous=value;
    if(d<=2)near(value,1);
    if(d>=8)near(value,0);
    assert.deepEqual(view.audiblePlayers,[]);
    assert.equal(view.heartbeatSource===null,d>=8);
    if(d<8)assert.deepEqual(view.heartbeatSource,{x:survivor(state).pose.x,y:survivor(state).pose.y});
    assert.equal('heartbeatIntensity' in snapshotFor(state,'survivor-id',0),false);
  }
});

test('heartbeat is silent during pause, offline state, and every final outcome',()=>{
  const state=newGame();survivor(state).pose={x:2,y:6,heading:0};
  assert.equal(snapshotFor(state,'hunter-id',0).heartbeatIntensity,1);
  setPlayerOnline(state,'survivor-id',false,100);
  assert.equal(snapshotFor(state,'hunter-id',0).heartbeatIntensity,0);
  setPlayerOnline(state,'survivor-id',true,1000);
  assert.equal(snapshotFor(state,'hunter-id',0).heartbeatIntensity,1);
  hunter(state).online=false;
  assert.equal(snapshotFor(state,'hunter-id',0).heartbeatIntensity,0);
  hunter(state).online=true;
  for(const outcome of ['captured','escaped','timeout','abandoned','interrupted']){
    state.outcome=outcome;
    assert.equal(snapshotFor(state,'hunter-id',0).heartbeatIntensity,0);
  }
});

test('door events increment only on actual openings and both players see the same immutable snapshot event',()=>{
  const state=newGame();advanceChase(state,8000);
  survivor(state).pose={x:7,y:5.5,heading:0};hunter(state).pose={x:6.8,y:5.5,heading:0};
  act(state,survivor(state),1,'door','open',8050);
  const first={seq:1,openedAtMs:8050,x:7.6,y:5.5};
  assert.deepEqual(state.doorEvent,first);
  assert.deepEqual(snapshotFor(state,'survivor-id',0).doorEvent,first);
  assert.deepEqual(snapshotFor(state,'hunter-id',0).doorEvent,first);
  act(state,hunter(state),1,'door','open',8100);
  assert.deepEqual(state.doorEvent,first);
  act(state,hunter(state),2,'door','close',8150);
  assert.deepEqual(state.doorEvent,first);
  act(state,hunter(state),3,'door','close',8200);
  assert.deepEqual(state.doorEvent,first);
  act(state,hunter(state),4,'door','toggle',8250);
  assert.deepEqual(state.doorEvent,{...first,seq:2,openedAtMs:8250});
  const snapshot=snapshotFor(state,'survivor-id',0);snapshot.doorEvent.seq=99;
  assert.equal(state.doorEvent.seq,2);
  assert.throws(()=>act(state,hunter(state),4,'door','toggle',8300),/already/);
  assert.equal(state.doorEvent.seq,2);
  setPlayerOnline(state,'hunter-id',false,8300);
  assert.throws(()=>act(state,survivor(state),2,'door','close',8350),/paused/);
  assert.equal(state.doorEvent.seq,2);
});

test('legacy states without valid door events do not manufacture an opening sound',()=>{
  for(const previous of [undefined,null,{seq:-1,openedAtMs:50},{seq:2,openedAtMs:NaN}]){
    const state=newGame();state.doorEvent=previous;state.doorOpen=true;
    survivor(state).pose={x:7,y:5.5,heading:0};
    assert.deepEqual(snapshotFor(state,'survivor-id',0).doorEvent,{seq:0,openedAtMs:0,x:7.6,y:5.5});
    act(state,survivor(state),1,'door','open',50);
    assert.equal(snapshotFor(state,'survivor-id',0).doorEvent.seq,0);
    act(state,survivor(state),2,'door','close',100);
    act(state,survivor(state),3,'door','open',150);
    assert.deepEqual(state.doorEvent,{seq:1,openedAtMs:150,x:7.6,y:5.5});
  }
});

test('disconnect pauses both players, blocks capture and preserves round/head-start time until reconnection', () => {
  const state = newGame();
  act(state, survivor(state), 1, 'move', 'forward');
  ticks(state, 100);
  setPlayerOnline(state, 'hunter-id', false, 100);
  assert.equal(survivor(state).motion, null);
  const paused = snapshotFor(state, 'survivor-id', 0);
  assert.equal(paused.paused, true);
  assert.equal(paused.self.moving, false);
  advanceChase(state, 10_100);
  const later = snapshotFor(state, 'survivor-id', 0);
  assert.equal(later.remainingSeconds, paused.remainingSeconds);
  assert.equal(later.headstartSeconds, paused.headstartSeconds);
  assert.equal(canInteract(state, 'hunter-id'), false);
  assert.throws(() => act(state, survivor(state), 2, 'move', 'forward'), /paused/);
  setPlayerOnline(state, 'hunter-id', true, 10_100);
  const resumed = snapshotFor(state, 'survivor-id', 0);
  assert.equal(resumed.paused, false);
  assert.equal(resumed.remainingSeconds, paused.remainingSeconds);
  assert.equal(resumed.headstartSeconds, paused.headstartSeconds);
  assert.equal(survivor(state).motion, null);
  near(survivor(state).pose.y, 1.1);
});

test('reconnection needs both players; thirty-second expiration gives no winner and is irreversible', () => {
  const state = newGame();
  setPlayerOnline(state, 'hunter-id', false, 50);
  setPlayerOnline(state, 'survivor-id', false, 100);
  setPlayerOnline(state, 'hunter-id', true, 200);
  assert.equal(snapshotFor(state, 'hunter-id', 0).paused, true);
  setPlayerOnline(state, 'survivor-id', true, 50 + RECONNECT_MS);
  assert.equal(state.outcome, 'interrupted');
  assert.equal(state.winner, null);
  assert.equal(snapshotFor(state, 'hunter-id', 0).paused, false);
  assert.equal(snapshotFor(state, 'hunter-id', 0).remainingSeconds, 180);
  advanceChase(state, ROUND_MS * 2);
  assert.equal(state.outcome, 'interrupted');
});

test('leaving a running chase awards the other role; leaving a finished chase preserves the result', () => {
  const state = newGame();
  abandonChase(state, 'hunter-id', 500);
  assert.equal(state.outcome, 'abandoned');
  assert.equal(state.winner, 'survivor');
  abandonChase(state, 'survivor-id', 1000);
  assert.equal(state.outcome, 'abandoned');
  assert.equal(state.winner, 'survivor');
});

test('a fresh round resets prior commands, evidence and results', () => {
  const old = newGame();
  act(old, survivor(old), 45, 'move', 'forward');
  abandonChase(old, 'hunter-id', 100);
  const state = createChase('round-two', old.players.map(player => ({ ...player, online: true })), 1000);
  assert.equal(state.hasKey, false);
  assert.deepEqual(state.doorEvent,{seq:0,openedAtMs:0,x:7.6,y:5.5});
  assert.equal(state.outcome, null);
  assert.equal(survivor(state).lastProcessedInputSeq, 0);
  assert.throws(() => act(state, survivor(state), 46, 'move', 'forward', 1000, old.roundId), /different round/);
  act(state, survivor(state), 1, 'move', 'forward', 1000);
});

test('only survivor receives moving hunter footsteps; hunter receives nearby heartbeat instead',()=>{
  const state=newGame();advanceChase(state,8000);
  hunter(state).pose={x:2,y:2,heading:0};survivor(state).pose={x:2,y:3,heading:0};
  act(state,survivor(state),1,'move','forward');act(state,hunter(state),1,'move','forward');
  assert.equal(snapshotFor(state,'survivor-id',0).audiblePlayers.length,1);
  assert.deepEqual(snapshotFor(state,'hunter-id',0).audiblePlayers,[]);
  assert.ok(snapshotFor(state,'hunter-id',0).heartbeatIntensity>0);
  assert.equal('heartbeatSource' in snapshotFor(state,'survivor-id',0),false);
});

test('five unsuccessful interactions exhaust only that player and cannot be replayed', () => {
  const state=newGame();ticks(state,8000);
  for(let seq=1;seq<=4;seq++)act(state,hunter(state),seq,'interact','inspect');
  assert.equal(snapshotFor(state,'hunter-id',0).attemptsRemaining,1);
  assert.equal(snapshotFor(state,'survivor-id',0).attemptsRemaining,5);
  act(state,hunter(state),5,'interact','inspect');
  assert.equal(state.outcome,'attempts_exhausted');assert.equal(state.winner,'survivor');
  assert.equal(hunter(state).lastProcessedInputSeq,5);
  for(const seq of [5,6])assert.throws(()=>act(state,hunter(state),seq,'interact','inspect'),RuleError);
  assert.equal(hunter(state).interactionAttempts,5);
});

test('a fifth capture or escape succeeds before the exhaustion decision', () => {
  const capture=newGame();ticks(capture,8000);
  for(let seq=1;seq<=4;seq++)act(capture,hunter(capture),seq,'interact','inspect');
  hunter(capture).pose={...survivor(capture).pose};
  act(capture,hunter(capture),5,'interact','inspect');
  assert.equal(capture.outcome,'captured');assert.equal(capture.winner,'hunter');
  const escape=newGame();
  for(let seq=1;seq<=3;seq++)act(escape,survivor(escape),seq,'interact','inspect');
  survivor(escape).pose={x:1.5,y:4.8,heading:0};act(escape,survivor(escape),4,'interact','inspect');
  assert.equal(escape.hasKey,true);assert.equal(escape.outcome,null);
  assert.equal(snapshotFor(escape,'survivor-id',0).attemptsRemaining,1);
  survivor(escape).pose={x:7.6,y:5.5,heading:0};act(escape,survivor(escape),5,'interact','inspect');
  assert.equal(escape.outcome,'escaped');assert.equal(escape.winner,'survivor');
});

test('a fifth motor inspection spends the attempt but cannot grant a sixth escape', () => {
  const state=newGame();for(let seq=1;seq<=4;seq++)act(state,survivor(state),seq,'interact','inspect');
  survivor(state).pose={x:1.5,y:4.8,heading:0};act(state,survivor(state),5,'interact','inspect');
  assert.equal(state.hasKey,true);assert.equal(state.outcome,'attempts_exhausted');assert.equal(state.winner,'hunter');
});

test('rejected inputs do not spend attempts, reconnect preserves them, and a new round resets them', () => {
  const state=newGame();
  assert.throws(()=>act(state,hunter(state),1,'interact','inspect'),/head start/);
  assert.equal(hunter(state).interactionAttempts,0);
  act(state,survivor(state),1,'interact','inspect');
  for(const command of [{roundId:'old',seq:2,kind:'interact',value:'inspect'},{roundId:state.roundId,seq:1,kind:'interact',value:'inspect'},{roundId:state.roundId,seq:2,kind:'invalid',value:''}])assert.throws(()=>applyInput(state,'survivor-id',command,0),RuleError);
  assert.equal(survivor(state).interactionAttempts,1);
  setPlayerOnline(state,'hunter-id',false,10);
  assert.throws(()=>act(state,survivor(state),2,'interact','inspect',20),/paused/);
  setPlayerOnline(state,'hunter-id',true,30);
  assert.equal(snapshotFor(state,'survivor-id',0).attemptsRemaining,4);
  assert.equal(snapshotFor(newGame(),'survivor-id',0).attemptsRemaining,5);
});

test('persisted rounds without a budget field start at zero and count the next accepted attempt', () => {
  const state=newGame();delete survivor(state).interactionAttempts;
  assert.equal(snapshotFor(state,'survivor-id',0).attemptsRemaining,5);
  act(state,survivor(state),1,'interact','inspect');
  assert.equal(survivor(state).interactionAttempts,1);
  assert.equal(snapshotFor(state,'survivor-id',0).attemptsRemaining,4);
});
