import { schema, table, t, SenderError, type ReducerCtx, type InferSchema, type Infer } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { createChase, advanceChase, applyInput, setPlayerOnline, abandonChase, snapshotFor,
  RuleError, type ChaseState } from './rules.ts';

// Raw membership, poses and schedules remain private. The only public surface
// is a sender-scoped view that omits every inaudible opponent position.
const room = table({ name: 'room' }, {
  code: t.string().primaryKey(), mode: t.string(), phase: t.string(),
  host: t.identity(), stateJson: t.string(),
});
const member = table({ name: 'member' }, {
  identity: t.identity().primaryKey(), roomCode: t.string().index('btree'),
  name: t.string(), role: t.string(), ready: t.bool(), online: t.bool(), restartVote: t.bool(),
});
const connection = table({ name: 'connection' }, {
  id: t.connectionId().primaryKey(), identity: t.identity().index('btree'),
});
const tick = table({ name: 'tick' }, {
  scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(),
  roomCode: t.string().index('btree'), roundId: t.string(),
});
const spacetimedb = schema({ room, member, connection, tick });
export default spacetimedb;
type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type Room = Infer<typeof room.rowType>;
type Member = Infer<typeof member.rowType>;
const now = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
const readState = (current: Room): ChaseState => JSON.parse(current.stateJson);
const sameIdentity = (left: Member['identity'], right: Member['identity']) => left.toHexString() === right.toHexString();

function codeCheck(code: string): void {
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new SenderError('Room code must contain six uppercase letters or digits.');
}
function nameCheck(raw: string): string {
  const name = raw.trim();
  if (raw.length > 128 || [...name].length < 1 || [...name].length > 32 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
    throw new SenderError('Player name must contain 1 to 32 characters without control characters.');
  }
  return name;
}
function activeConnection(ctx: Ctx): void {
  const active = ctx.connectionId === null ? null : ctx.db.connection.id.find(ctx.connectionId);
  if (!active || !sameIdentity(active.identity, ctx.sender)) throw new SenderError('An active game connection is required.');
}
function requireRoom(ctx: Ctx): { me: Member; current: Room } {
  activeConnection(ctx);
  const me = ctx.db.member.identity.find(ctx.sender);
  const current = me && ctx.db.room.code.find(me.roomCode);
  if (!me || !current) throw new SenderError('Join a room first.');
  return { me, current };
}
function removeTicks(ctx: Ctx, code: string): void {
  for (const row of [...ctx.db.tick.roomCode.filter(code)]) ctx.db.tick.scheduledId.delete(row.scheduledId);
}
function saveState(ctx: Ctx, current: Room, state: ChaseState): void {
  ctx.db.room.code.update({ ...current, phase: state.outcome ? 'finished' : 'running', stateJson: JSON.stringify(state) });
  if (state.outcome) removeTicks(ctx, current.code);
}
function startRound(ctx: Ctx, current: Room, members: Member[]): void {
  const roundId = ctx.newUuidV4().toString();
  const state = createChase(roundId, members.map(player => ({
    id: player.identity.toHexString(), role: player.role, online: player.online,
  })), now(ctx));
  removeTicks(ctx, current.code);
  for (const player of members) ctx.db.member.identity.update({ ...player, ready: false, restartVote: false });
  saveState(ctx, current, state);
  ctx.db.tick.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(50_000n), roomCode: current.code, roundId });
}
const rolesValid = (members: Member[]) => members.length === 2
  && members.some(player => player.role === 'hunter') && members.some(player => player.role === 'survivor');

export const create_room = spacetimedb.reducer(
  { code: t.string(), mode: t.string(), name: t.string() },
  (ctx, { code, mode, name }) => {
    activeConnection(ctx);
    codeCheck(code);
    const playerName = nameCheck(name);
    if (mode !== 'chase') throw new SenderError('Only the chase uses a multiplayer room.');
    if (ctx.db.member.identity.find(ctx.sender)) throw new SenderError('Leave your current room first.');
    if (ctx.db.room.code.find(code)) throw new SenderError('Room code is already in use.');
    ctx.db.room.insert({ code, mode, phase: 'lobby', host: ctx.sender, stateJson: 'null' });
    ctx.db.member.insert({ identity: ctx.sender, roomCode: code, name: playerName,
      role: '', ready: false, online: true, restartVote: false });
  },
);
export const join_room = spacetimedb.reducer(
  { code: t.string(), name: t.string() },
  (ctx, { code, name }) => {
    activeConnection(ctx);
    codeCheck(code);
    const playerName = nameCheck(name);
    if (ctx.db.member.identity.find(ctx.sender)) throw new SenderError('Leave your current room first.');
    const current = ctx.db.room.code.find(code);
    if (!current || current.phase !== 'lobby') throw new SenderError('Room is unavailable.');
    if ([...ctx.db.member.roomCode.filter(code)].length >= 2) throw new SenderError('Room is full.');
    ctx.db.member.insert({ identity: ctx.sender, roomCode: code, name: playerName,
      role: '', ready: false, online: true, restartVote: false });
  },
);
export const select_role = spacetimedb.reducer({ role: t.string() }, (ctx, { role }) => {
  const { me, current } = requireRoom(ctx);
  if (current.phase !== 'lobby') throw new SenderError('Roles can only change in the lobby.');
  if (!['', 'hunter', 'survivor'].includes(role)) throw new SenderError('Choose hunter or survivor.');
  const members = [...ctx.db.member.roomCode.filter(current.code)];
  if (role && members.some(player => !sameIdentity(player.identity, ctx.sender) && player.role === role)) {
    throw new SenderError('The other player has selected that role.');
  }
  if (me.role !== role) for (const player of members) {
    ctx.db.member.identity.update({ ...player, role: sameIdentity(player.identity, ctx.sender) ? role : player.role, ready: false });
  }
});
export const set_ready = spacetimedb.reducer({ ready: t.bool() }, (ctx, { ready }) => {
  const { me, current } = requireRoom(ctx);
  if (current.phase !== 'lobby') throw new SenderError('Readiness can only change in the lobby.');
  if (!me.online || (ready && !['hunter', 'survivor'].includes(me.role))) throw new SenderError('Select a role before becoming ready.');
  ctx.db.member.identity.update({ ...me, ready });
  const members = [...ctx.db.member.roomCode.filter(current.code)];
  if (rolesValid(members) && members.every(player => player.ready && player.online)) startRound(ctx, current, members);
});
export const restart_round = spacetimedb.reducer({}, ctx => {
  const { me, current } = requireRoom(ctx);
  if (current.phase !== 'finished') throw new SenderError('A restart vote is only available after the round.');
  const existing = [...ctx.db.member.roomCode.filter(current.code)];
  if (!rolesValid(existing) || !existing.every(player => player.online)) throw new SenderError('Both players must be present to restart.');
  if (me.restartVote) return;
  ctx.db.member.identity.update({ ...me, restartVote: true });
  const members = [...ctx.db.member.roomCode.filter(current.code)];
  if (members.every(player => player.restartVote)) {
    removeTicks(ctx, current.code);
    for (const player of members) ctx.db.member.identity.update({ ...player, role: '', ready: false, restartVote: false });
    ctx.db.room.code.update({ ...current, phase: 'lobby', stateJson: 'null' });
  }
});
export const input = spacetimedb.reducer(
  { roundId: t.string(), seq: t.u32(), kind: t.string(), value: t.string() },
  (ctx, command) => {
    const { me, current } = requireRoom(ctx);
    if (current.phase !== 'running') throw new SenderError('The chase is not running.');
    const state = readState(current);
    try { applyInput(state, me.identity.toHexString(), command, now(ctx)); }
    catch (error) {
      if (error instanceof RuleError) throw new SenderError(error.message);
      throw error;
    }
    saveState(ctx, current, state);
  },
);
export const leave_room = spacetimedb.reducer({}, ctx => {
  activeConnection(ctx);
  const me = ctx.db.member.identity.find(ctx.sender);
  if (!me) return;
  const current = ctx.db.room.code.find(me.roomCode);
  ctx.db.member.identity.delete(ctx.sender);
  const remaining = [...ctx.db.member.roomCode.filter(me.roomCode)];
  if (!current) return;
  if (!remaining.length) {
    removeTicks(ctx, current.code);
    ctx.db.room.code.delete(current.code);
    return;
  }
  const transferred = { ...current, host: sameIdentity(current.host, ctx.sender) ? remaining[0].identity : current.host };
  if (current.phase === 'running' || current.phase === 'finished') {
    const state = readState(current);
    abandonChase(state, me.identity.toHexString(), now(ctx));
    // A personal Continue must not erase the other player's shared result.
    saveState(ctx, transferred, state);
  } else ctx.db.room.code.update(transferred);
  for (const player of remaining) ctx.db.member.identity.update({ ...player, ready: false, restartVote: false });
});

export const on_connect = spacetimedb.clientConnected(ctx => {
  if (ctx.connectionId === null) return;
  if (!ctx.db.connection.id.find(ctx.connectionId)) ctx.db.connection.insert({ id: ctx.connectionId, identity: ctx.sender });
  const me = ctx.db.member.identity.find(ctx.sender);
  if (!me || me.online) return;
  ctx.db.member.identity.update({ ...me, online: true });
  const current = ctx.db.room.code.find(me.roomCode);
  if (current && current.phase !== 'lobby') {
    const state = readState(current);
    setPlayerOnline(state, me.identity.toHexString(), true, now(ctx));
    saveState(ctx, current, state);
  }
});
export const on_disconnect = spacetimedb.clientDisconnected(ctx => {
  if (ctx.connectionId === null) return;
  ctx.db.connection.id.delete(ctx.connectionId);
  const me = ctx.db.member.identity.find(ctx.sender);
  if (!me || [...ctx.db.connection.identity.filter(ctx.sender)].length) return;
  ctx.db.member.identity.update({ ...me, online: false, ready: false, restartVote: false });
  const current = ctx.db.room.code.find(me.roomCode);
  if (current && current.phase !== 'lobby') {
    const state = readState(current);
    setPlayerOnline(state, me.identity.toHexString(), false, now(ctx));
    saveState(ctx, current, state);
  }
});

export const advance_round = spacetimedb.reducer(
  { onSchedule: tick }, { timer: tick.rowType },
  (ctx, { timer }) => {
    if (!sameIdentity(ctx.sender, ctx.databaseIdentity)) throw new SenderError('Only the server may advance a round.');
    const scheduled = ctx.db.tick.scheduledId.find(timer.scheduledId);
    if (!scheduled || scheduled.roomCode !== timer.roomCode || scheduled.roundId !== timer.roundId) return;
    const current = ctx.db.room.code.find(timer.roomCode);
    if (!current || current.phase !== 'running') {
      ctx.db.tick.scheduledId.delete(timer.scheduledId);
      return;
    }
    const state = readState(current);
    if (state.roundId !== timer.roundId) {
      ctx.db.tick.scheduledId.delete(timer.scheduledId);
      return;
    }
    advanceChase(state, now(ctx));
    saveState(ctx, current, state);
  },
);

const roomSnapshot = t.row('RoomSnapshot', {
  code: t.string(), mode: t.string(), phase: t.string(), host: t.identity(),
  membersJson: t.string(), gameJson: t.string(),
});
export const my_room = spacetimedb.view({ name: 'my_room', public: true }, t.option(roomSnapshot), ctx => {
  const me = ctx.db.member.identity.find(ctx.sender);
  if (!me) return undefined;
  const current = ctx.db.room.code.find(me.roomCode);
  if (!current) return undefined;
  const members = [...ctx.db.member.roomCode.filter(current.code)]
    .map(player => ({ identity: player.identity.toHexString(), name: player.name, role: player.role,
      ready: player.ready, online: player.online, restartVote: player.restartVote }))
    .sort((left, right) => left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0);
  const gameJson = current.phase === 'lobby' ? 'null'
    : JSON.stringify(snapshotFor(readState(current), me.identity.toHexString(), members.filter(player => player.restartVote).length));
  return { code: current.code, mode: current.mode, phase: current.phase, host: current.host,
    membersJson: JSON.stringify(members), gameJson };
});
