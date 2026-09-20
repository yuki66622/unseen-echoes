import {
  SoundHuntAudio, createAcousticStage, applyAcousticPath,
} from '../sound-engine.mjs';
import { getAcousticPath } from '../room-layout.mjs';

export const STEP_DISTANCE = 0.45;
export const MAX_STEP_GAP_MS = 1000;
export const MAX_STEP_JUMP = 0.8;
const MAX_ACTIVE_FOOTSTEPS = 4;
const SELF_ID = 'self';
const clock = () => globalThis.performance?.now() ?? Date.now();
const validPose = pose => Number.isFinite(pose?.x) && Number.isFinite(pose?.y)
  && Number.isFinite(pose.heading ?? 0);
const copyPose = pose => ({ x: pose.x, y: pose.y, heading: pose.heading ?? 0 });

/** Distance is consumed once, even when the same network sample is rendered repeatedly. */
export class FootstepTracker {
  constructor() { this.players = new Map(); this.roundId = undefined; }

  clear() { this.players.clear(); this.roundId = undefined; }

  update(snapshot, nowMs) {
    if (!Number.isFinite(nowMs)) return [];
    if (snapshot?.roundId !== this.roundId) {
      this.players.clear();
      this.roundId = snapshot?.roundId;
    }
    const players = [];
    if (validPose(snapshot?.self)) players.push({ ...snapshot.self, id: SELF_ID, kind: 'self' });
    const seen = new Set([SELF_ID]);
    for (const player of snapshot?.audiblePlayers ?? []) {
      if (!validPose(player) || typeof player.id !== 'string' || !player.id || seen.has(player.id)) continue;
      seen.add(player.id);
      // The server is the visibility authority; this guard also keeps stale input quiet.
      if (player.moving !== true || !validPose(snapshot?.self)
        || Math.hypot(player.x - snapshot.self.x, player.y - snapshot.self.y) > 5) continue;
      players.push({ ...player, kind: 'remote' });
    }
    const present = new Set(players.map(player => player.id));
    for (const id of this.players.keys()) if (!present.has(id)) this.players.delete(id);

    const steps = [];
    for (const player of players) {
      const previous = this.players.get(player.id);
      const delta = previous ? Math.hypot(player.x - previous.x, player.y - previous.y) : 0;
      const elapsed = previous ? nowMs - previous.changedAt : 0;
      const state = { x: player.x, y: player.y, distance: previous?.distance ?? 0,
        changedAt: previous?.changedAt ?? nowMs, observedAt: nowMs };
      const frameGap = previous ? nowMs - previous.observedAt : 0;
      if (!previous || player.moving !== true || frameGap < 0 || frameGap > MAX_STEP_GAP_MS
        || delta > MAX_STEP_JUMP || (delta > 0 && (elapsed < 0 || elapsed > MAX_STEP_GAP_MS))) {
        state.distance = 0;
        state.changedAt = nowMs;
      } else if (delta > 0) {
        state.changedAt = nowMs;
        state.distance += delta;
        if (state.distance + 1e-9 >= STEP_DISTANCE) {
          // A delayed packet can cause at most one finite cue, never a queued burst.
          const consumed = Math.floor((state.distance + 1e-9) / STEP_DISTANCE) * STEP_DISTANCE;
          state.distance = Math.max(0, state.distance - consumed);
          steps.push({ id: player.id, kind: player.kind, position: copyPose(player) });
        }
      }
      this.players.set(player.id, state);
    }
    return steps;
  }
}

/** Quiet, deterministic synthesized impacts; these are not new recorded assets. */
export function createFootstepBuffer(context, kind) {
  if (kind !== 'self' && kind !== 'remote') throw new Error('Unknown footstep kind.');
  const duration = kind === 'self' ? 0.13 : 0.16;
  const buffer = context.createBuffer(1, Math.round(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  const frequency = kind === 'self' ? 110 : 155;
  let seed = 18327, smoothNoise = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / context.sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    smoothNoise += 0.13 * ((seed / 4294967296) * 2 - 1 - smoothNoise);
    const attack = Math.min(1, t / 0.008);
    const envelope = attack * attack * Math.exp(-t * 32) * Math.sin(Math.PI * i / (samples.length - 1));
    samples[i] = 0.11 * envelope * (0.8 * Math.sin(2 * Math.PI * frequency * t) + 0.2 * smoothNoise);
  }
  samples[0] = 0;
  samples[samples.length - 1] = 0;
  return buffer;
}

export class MultiplayerAudio {
  constructor({ silent = false } = {}) {
    this.base = new SoundHuntAudio({ silent });
    this.tracker = new FootstepTracker();
    this.footstepBuffers = new Map();
    this.footsteps = new Set();
    this.steps = { self: 0, remote: 0 };
    this.snapshot = null;
    this.operation = 0;
    this.running = false;
  }

  async start(snapshot) {
    const operation = ++this.operation;
    this.running = false;
    this._clearFootsteps();
    this.tracker.clear();
    this.base.pause();
    this.snapshot = snapshot;
    this.base.setDoorOpen(Boolean(snapshot?.doorOpen));
    const started = await this.base.startScene(snapshot?.sources, snapshot?.self);
    if (operation !== this.operation || !started) return false;
    this.running = true;
    // update() may have received newer predicted poses while the recordings decoded.
    this.update(this.snapshot);
    return true;
  }

  update(snapshot) {
    if (this.snapshot?.roundId !== snapshot?.roundId) this._clearFootsteps();
    this.snapshot = snapshot;
    if (!snapshot || !validPose(snapshot.self)) {
      this.tracker.clear();
      this._clearFootsteps();
      return;
    }
    this.base.setDoorOpen(Boolean(snapshot.doorOpen));
    this.base.setPose(snapshot.self, { continuous: true });
    if (!this.running || !this.base.running) return;
    const steps = this.tracker.update(snapshot, clock());
    const context = this.base.context;
    for (const cue of [...this.footsteps]) {
      if (cue.kind === 'remote' && !this.tracker.players.has(cue.id)) {
        this._disposeFootstep(cue, true);
      } else {
        applyAcousticPath(cue.acoustic,
          getAcousticPath(snapshot.self, cue.position, Boolean(snapshot.doorOpen)),
          snapshot.self, context.currentTime, false, true);
      }
    }
    for (const step of steps) this._playFootstep(step);
  }

  _playFootstep(step) {
    const context = this.base.context;
    if (!this.running || !this.base.running || context?.state !== 'running'
      || this.footsteps.size >= MAX_ACTIVE_FOOTSTEPS) return false;
    if (!this.footstepBuffers.has(step.kind)) {
      this.footstepBuffers.set(step.kind, createFootstepBuffer(context, step.kind));
    }
    const source = context.createBufferSource();
    source.buffer = this.footstepBuffers.get(step.kind);
    source.loop = false;
    const gain = context.createGain();
    gain.gain.value = step.kind === 'self' ? 0.7 : 1;
    const acoustic = createAcousticStage(context, this.base.master);
    applyAcousticPath(acoustic,
      getAcousticPath(this.snapshot.self, step.position, Boolean(this.snapshot.doorOpen)),
      this.snapshot.self, context.currentTime, true);
    source.connect(gain);
    gain.connect(acoustic.filter);
    const cue = { ...step, position: { ...step.position }, source, gain, acoustic };
    this.footsteps.add(cue);
    source.onended = () => this._disposeFootstep(cue);
    source.start(context.currentTime);
    this.steps[step.kind]++;
    return true;
  }

  _disposeFootstep(cue, stop = false) {
    if (!this.footsteps.delete(cue)) return;
    cue.source.onended = null;
    if (stop) {
      try { cue.source.stop(); } catch { /* A naturally ended cue is already silent. */ }
    }
    cue.source.disconnect();
    cue.gain.disconnect();
    cue.acoustic.filter.disconnect();
    cue.acoustic.acousticGain.disconnect();
    cue.acoustic.panner.disconnect();
  }

  _clearFootsteps() {
    for (const cue of [...this.footsteps]) this._disposeFootstep(cue, true);
  }

  playCue(kind, position) { return this.base.playCue(kind, position); }
  setVolume(value) { this.base.setVolume(value); }

  pause() {
    this.operation++;
    this.running = false;
    this.tracker.clear();
    this._clearFootsteps();
    this.base.pause();
  }

  getStats() {
    const base = this.base.getStats();
    return {
      ...base, base, running: this.running && base.running,
      masterGain: this.base.master?.gain.value ?? 0,
      stepCount: this.steps.self + this.steps.remote,
      steps: { ...this.steps }, activeFootsteps: this.footsteps.size,
      activeCues: this.footsteps.size + (base.cueCount ?? 0),
      trackedPlayers: this.tracker.players.size,
      footsteps: [...this.footsteps].map(cue => ({
        kind: cue.kind, path: cue.acoustic.path.kind,
        acousticGain: cue.acoustic.acousticGain.gain.value,
        cutoff: cue.acoustic.filter.frequency.value,
      })),
    };
  }
}
