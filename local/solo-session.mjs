import { createChase, advanceChase, applyInput, snapshotFor, STEP_MS } from '../spacetimedb/src/rules.ts';

export class SoloConnection {
  constructor(onRoom, dependencies = {}) {
    this.onRoom = onRoom;
    this.now = dependencies.now ?? (() => performance.now());
    this.setInterval = dependencies.setInterval ?? ((callback, ms) => globalThis.setInterval(callback, ms));
    this.clearInterval = dependencies.clearInterval ?? (timer => globalThis.clearInterval(timer));
    this.identity = 'local-player';
    this.local = true;
    this.ready = true;
    this.state = null;
    this.timer = null;
    this.round = 0;
  }

  start(role) {
    if (role !== 'hunter' && role !== 'survivor') throw new Error('Choose a hunter or survivor role.');
    const state = createChase(`local-${++this.round}`, [
      { id: this.identity, role, online: true },
      { id: 'local-target', role: role === 'hunter' ? 'survivor' : 'hunter', online: true },
    ], this.now());
    this.disconnect();
    this.state = state;
    this.resume();
  }

  async call(name, args = {}) {
    if (!this.ready) throw new Error('Local session is disconnected.');
    if (name === 'restartRound') return this.reset();
    if (name !== 'input') throw new Error('Unknown local session command.');
    if (!this.state) throw new Error('Choose a role before playing.');
    applyInput(this.state, this.identity, args, this.now());
    this.publish();
  }

  publish() {
    if (this.state?.outcome) this.stopTimer();
    const players = this.state?.players ?? [{ id: this.identity, role: '', online: true }];
    this.onRoom({
      code: 'LOCAL', mode: 'chase', host: this.identity,
      phase: !this.state ? 'lobby' : this.state.outcome ? 'finished' : 'running',
      game: this.state ? snapshotFor(this.state, this.identity, 0) : null,
      members: players.map(player => ({
        identity: player.id, role: player.role, online: player.online,
        name: player.id === this.identity ? '本机玩家' : '静止测试目标',
        ready: Boolean(this.state), restartVote: false,
      })),
    });
  }

  tick() {
    advanceChase(this.state, this.now());
    this.publish();
  }

  stopTimer() {
    if (this.timer !== null) this.clearInterval(this.timer);
    this.timer = null;
  }

  reset() {
    this.disconnect();
    this.state = null;
    this.ready = true;
    this.publish();
  }

  disconnect() {
    this.stopTimer();
    this.ready = false;
  }

  resume() {
    this.ready = true;
    if (!this.state || this.state.outcome || this.timer !== null) return false;
    this.tick();
    if (!this.state.outcome) this.timer = this.setInterval(() => this.tick(), STEP_MS);
    return true;
  }

  reconnect() { return this.resume(); }
  goOffline() {}
}
