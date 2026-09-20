// Chase-only recorded audio. The square arena has no internal-wall acoustics.
import {fetchWithTimeout} from './request.mjs';
export const CHASE_MASTER_HEADROOM = 0.32;
export const CHASE_PEAK_LIMIT = 0.6;
export const HEARTBEAT_FADE_SECONDS = 0.2;
export const FOOTSTEP_OFFSET_SECONDS = 0.75;
export const FOOTSTEP_DURATION_SECONDS = 0.35;
const STEP_DISTANCE = 0.45;
// A moving opponent disappears on the final server tick. Its 50 ms interpolated
// position can therefore expose under 0.45 m of a legitimate half-metre command.
const REMOTE_STEP_DISTANCE = 0.35;
const MAX_STEP_GAP_MS = 1000;
const MAX_STEP_JUMP = 0.8;
const ENTRY_STORAGE = 'unseen/chase-audio/entered-rounds';
const FINISH_STORAGE = 'unseen/chase-audio/finished-rounds';
const clamp = value => Math.max(0, Math.min(1, value));
const nowMs = () => globalThis.performance?.now() ?? Date.now();
const validPose = pose => Number.isFinite(pose?.x) && Number.isFinite(pose?.y)
  && Number.isFinite(pose.heading ?? 0);
const copyPose = pose => ({ x: pose.x, y: pose.y, heading: pose.heading ?? 0 });

export const CHASE_ASSETS = Object.freeze({
  entry: { label: '入场录音', path: './assets/chase/entry.mp3', targetRms: 0.085 },
  heartbeat: { label: '心跳录音', path: './assets/chase/heartbeat.mp3', targetRms: 0.09 },
  background: { label: '背景录音', path: './assets/chase/background.mp3', targetRms: 0.05 },
  door: { label: '开门录音', path: './assets/chase/door.mp3', targetRms: null },
  'hunter-win': { label: '监管者胜利录音', path: './assets/chase/hunter-win.mp3', targetRms: 0.08 },
  footsteps: { label: '脚步录音', path: './assets/chase/footsteps.mp3', targetRms: 0.07 },
  motor: { label: '老式电机', path: './assets/chase/motor.mp3', targetRms: 0.045 },
  rain: { label: '出口雨声', path: '../assets/edgechat/rain-light.m4a', targetRms: 0.045, maxSeconds: 12, maxGain: 16 },
});

function setGain(parameter, value, time, seconds = 0) {
  const previous = parameter.value;
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(time);
  else parameter.cancelScheduledValues(time);
  parameter.setValueAtTime(seconds ? previous : value, time);
  if (seconds) parameter.linearRampToValueAtTime(value, time + seconds);
}

// No automatic amplification of user-supplied clips, especially the sparse door
// recording. Only the older rain anchor may receive bounded gain.
export function prepareChaseBuffer(context, decoded, id) {
  const descriptor = CHASE_ASSETS[id];
  if (!descriptor || !decoded?.numberOfChannels || !Number.isFinite(decoded.duration)
    || decoded.duration < 0.08 || !Number.isFinite(decoded.sampleRate) || decoded.sampleRate <= 0) {
    throw new Error('录音格式无效或时长不足。');
  }
  const length = Math.min(decoded.length, Math.round((descriptor.maxSeconds ?? decoded.duration) * decoded.sampleRate));
  const buffer = context.createBuffer(1, length, decoded.sampleRate);
  const samples = buffer.getChannelData(0);
  let sourcePeak = 0;
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const input = decoded.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      if (!Number.isFinite(input[i])) throw new Error('录音包含无效采样。');
      sourcePeak = Math.max(sourcePeak, Math.abs(input[i]));
      samples[i] += input[i] / decoded.numberOfChannels;
    }
  }
  let peak = 0, energy = 0;
  for (const value of samples) { peak = Math.max(peak, Math.abs(value)); energy += value * value; }
  const rms = Math.sqrt(energy / samples.length);
  if (rms < 1e-7 || !Number.isFinite(rms)) throw new Error('录音没有有效声音。');
  const gain = Math.min(descriptor.maxGain ?? 1, CHASE_PEAK_LIMIT / peak,
    descriptor.targetRms === null ? 1 : descriptor.targetRms / rms);
  let finalPeak = 0, finalEnergy = 0;
  // Quiet edges avoid discontinuities at the loop wrap and one-shot boundaries.
  const edge = Math.min(Math.round(decoded.sampleRate * 0.008), Math.floor(length / 4));
  for (let i = 0; i < length; i++) {
    const envelope = edge ? Math.min(1, i / edge, (length - 1 - i) / edge) : 1;
    samples[i] *= gain * envelope;
    finalPeak = Math.max(finalPeak, Math.abs(samples[i]));
    finalEnergy += samples[i] * samples[i];
  }
  return { buffer, details: {
    label: descriptor.label, sourceDurationSeconds: decoded.duration, durationSeconds: buffer.duration,
    sourceChannels: decoded.numberOfChannels, channels: 1, sampleRate: decoded.sampleRate,
    sourcePeak, analyzedSourceSeconds: length / decoded.sampleRate, monoRms: rms,
    normalizationGain: gain, peak: finalPeak, rms: Math.sqrt(finalEnergy / length),
    pcmBytes: length * 4,
  } };
}

export function makeFootstepSegment(context, recording) {
  const offset = Math.min(FOOTSTEP_OFFSET_SECONDS, Math.max(0, recording.duration - FOOTSTEP_DURATION_SECONDS));
  const start = Math.round(offset * recording.sampleRate);
  const length = Math.min(recording.length - start, Math.round(FOOTSTEP_DURATION_SECONDS * recording.sampleRate));
  const buffer = context.createBuffer(1, length, recording.sampleRate);
  const input = recording.getChannelData(0), output = buffer.getChannelData(0);
  const attack = Math.max(1, Math.round(recording.sampleRate * 0.006));
  const release = Math.max(1, Math.round(recording.sampleRate * 0.035));
  for (let i = 0; i < length; i++) {
    const envelope = Math.max(0, Math.min(1, i / attack, (length - 1 - i) / release));
    output[i] = input[start + i] * envelope;
  }
  return { buffer, offsetSeconds: start / recording.sampleRate };
}

export class ChaseStepTracker {
  constructor() { this.players = new Map(); }
  clear() { this.players.clear(); }
  update(snapshot, time) {
    const players = validPose(snapshot?.self) ? [{ ...snapshot.self, id: 'self', own: true }] : [];
    const included = new Set(['self']);
    for (const other of snapshot?.audiblePlayers ?? []) {
      if (!validPose(other) || typeof other.id !== 'string' || !other.id || included.has(other.id)
        || other.moving !== true || !validPose(snapshot?.self)
        || Math.hypot(other.x - snapshot.self.x, other.y - snapshot.self.y) > 5) continue;
      included.add(other.id);
      players.push({ ...other, own: false });
    }
    const present = new Set(players.map(player => player.id));
    for (const id of this.players.keys()) if (!present.has(id)) this.players.delete(id);
    const steps = [];
    for (const player of players) {
      const before = this.players.get(player.id);
      const delta = before ? Math.hypot(player.x - before.x, player.y - before.y) : 0;
      const state = { x: player.x, y: player.y, distance: before?.distance ?? 0,
        observedAt: time, changedAt: before?.changedAt ?? time };
      if (!before || player.moving !== true || !Number.isFinite(time)
        || time < before.observedAt || time - before.observedAt > MAX_STEP_GAP_MS
        || delta > MAX_STEP_JUMP || (delta > 0 && time - before.changedAt > MAX_STEP_GAP_MS)) {
        state.distance = 0; state.changedAt = time;
      } else if (delta > 0) {
        state.changedAt = time; state.distance += delta;
        const stride = player.own ? STEP_DISTANCE : REMOTE_STEP_DISTANCE;
        if (state.distance + 1e-9 >= stride) {
          const consumed = Math.floor((state.distance + 1e-9) / stride) * stride;
          state.distance = Math.max(0, state.distance - consumed);
          steps.push({ id: player.id, own: player.own, position: copyPose(player) });
        }
      }
      this.players.set(player.id, state);
    }
    return steps;
  }
}

function rememberedRounds(key) {
  try {
    const value = JSON.parse(globalThis.sessionStorage?.getItem(key) || '[]');
    return new Set(Array.isArray(value) ? value.filter(id => typeof id === 'string').slice(-128) : []);
  } catch { return new Set(); }
}
function persistRounds(key, rounds) {
  try { globalThis.sessionStorage?.setItem(key, JSON.stringify([...rounds].slice(-128))); }
  catch { /* In-memory deduplication still applies when browser storage is blocked. */ }
}

export class ChaseAudio {
  constructor({ silent = false } = {}) {
    this.silent = Boolean(silent); this.volume = 0.35;
    this.context = null; this.master = null; this.initPromise = null;
    this.buffers = new Map(); this.assetDetails = {}; this.footstepBuffer = null;
    this.voices = new Set(); this.tracker = new ChaseStepTracker();
    this.enteredRounds = rememberedRounds(ENTRY_STORAGE); this.finishedRounds = rememberedRounds(FINISH_STORAGE);
    this.operation = 0; this.running = false; this.enabled = false; this.mode = 'idle';
    this.roundId = null; this.snapshot = null; this.listener = { x: 2, y: 1, heading: 0 };
    this.heartbeatTarget = 0; this.heartbeatVoice = null; this.lastDoorSeq = 0; this.lastError = null;
    this.counters = { entry: 0, door: 0, hunterWin: 0, footstepsSelf: 0, footstepsRemote: 0,
      background: 0, heartbeat: 0, anchors: 0 };
  }

  async _init() {
    if (this.buffers.size === Object.keys(CHASE_ASSETS).length) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (!this.context) {
        const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Context) throw new Error('当前浏览器不支持游戏声音，请使用较新版本的浏览器。');
        this.context = new Context();
      }
      if (!this.master) {
        this.master = this.context.createGain(); this.master.gain.value = 0;
        this.master.connect(this.context.destination);
      }
      const outcomes = await Promise.allSettled(Object.entries(CHASE_ASSETS).map(async ([id, descriptor]) => {
        try {
          const url = new URL(descriptor.path, import.meta.url).href;
          const data = await fetchWithTimeout(url, {}, 15000, response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.arrayBuffer();
          });
          const decoded = await this.context.decodeAudioData(data);
          return { id, ...prepareChaseBuffer(this.context, decoded, id) };
        } catch (error) { throw new Error(`${descriptor.label}加载失败：${error.message}`); }
      }));
      const failed = outcomes.filter(result => result.status === 'rejected');
      if (failed.length) throw new Error(failed.map(result => result.reason.message).join('；'));
      for (const { value } of outcomes) {
        this.buffers.set(value.id, value.buffer); this.assetDetails[value.id] = value.details;
      }
      const segment = makeFootstepSegment(this.context, this.buffers.get('footsteps'));
      this.footstepBuffer = segment.buffer;
      Object.assign(this.assetDetails.footsteps, { cueOffsetSeconds: segment.offsetSeconds,
        cueDurationSeconds: segment.buffer.duration });
      this.lastError = null;
    })();
    try { await this.initPromise; }
    catch (error) { this.initPromise = null; this.lastError = error.message; throw error; }
  }

  _masterLevel(immediate = false) {
    if (!this.master) return;
    const value = this.silent || !this.running ? 0 : this.volume * CHASE_MASTER_HEADROOM;
    setGain(this.master.gain, value, this.context.currentTime, immediate || value === 0 ? 0 : 0.04);
  }

  _position(voice, immediate = false) {
    if (!voice.panner) return;
    const heading = this.listener.heading, dx = voice.position.x - this.listener.x, dy = voice.position.y - this.listener.y;
    const position = { x: dx * Math.cos(heading) - dy * Math.sin(heading), y: 0,
      z: -(dx * Math.sin(heading) + dy * Math.cos(heading)) };
    for (const axis of ['x', 'y', 'z']) {
      if (voice.targets[axis] === position[axis]) continue;
      setGain(voice.panner[`position${axis.toUpperCase()}`], position[axis], this.context.currentTime,
        immediate ? 0 : 0.035);
      voice.targets[axis] = position[axis];
    }
  }

  _voice(id, { kind = id, level = 1, loop = false, position = null, actor = null, buffer = null } = {}) {
    const source = this.context.createBufferSource();
    source.buffer = buffer ?? this.buffers.get(id); source.loop = loop;
    const gain = this.context.createGain(); gain.gain.value = level;
    source.connect(gain);
    const panner = position ? this.context.createPanner() : null;
    if (panner) {
      panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
      panner.refDistance = 2; panner.rolloffFactor = 0.6;
      gain.connect(panner); panner.connect(this.master);
    } else gain.connect(this.master);
    const voice = { id, kind, source, gain, panner, position: position ? copyPose(position) : null,
      actor, targets: {}, loop, startedAt: this.context.currentTime };
    this._position(voice, true); this.voices.add(voice);
    source.onended = () => this._dispose(voice);
    source.start(this.context.currentTime);
    return voice;
  }

  _dispose(voice, stop = false) {
    if (!this.voices.delete(voice)) return;
    voice.source.onended = null;
    if (stop) { try { voice.source.stop(); } catch { /* Already naturally finished. */ } }
    voice.source.disconnect(); voice.gain.disconnect(); voice.panner?.disconnect();
    if (this.heartbeatVoice === voice) this.heartbeatVoice = null;
    if (this.mode === 'victory' && this.voices.size === 0) {
      this.running = false; this.enabled = false; this.mode = 'idle'; this._masterLevel(true);
    }
  }

  _stopVoices() {
    this.running = false; this.mode = 'idle'; this.heartbeatTarget = 0;
    this._masterLevel(true);
    for (const voice of [...this.voices]) this._dispose(voice, true);
    this.heartbeatVoice = null; this.tracker.clear();
  }

  async start(snapshot) {
    if (!snapshot || typeof snapshot.roundId !== 'string' || !snapshot.roundId || !validPose(snapshot.self)
      || !['hunter', 'survivor'].includes(snapshot.role)) throw new Error('追逐状态不完整，暂时无法启动声音。');
    if (snapshot.outcome || this.finishedRounds.has(snapshot.roundId)) return false;
    const anchors = (snapshot.sources ?? []).filter(source =>
      (source.id === 'a' && source.soundId === 'motor') || (source.id === 'b' && source.soundId === 'rain'));
    if (anchors.length !== 2 || new Set(anchors.map(source => source.id)).size !== 2 || !anchors.every(validPose)) {
      throw new Error('追逐声源位置不完整，请重新连接。');
    }
    const operation = ++this.operation;
    this._stopVoices(); this.enabled = true;
    this.roundId = snapshot.roundId; this.snapshot = snapshot; this.listener = copyPose(snapshot.self);
    this.lastDoorSeq = Number.isSafeInteger(snapshot.doorEvent?.seq) ? snapshot.doorEvent.seq : 0;
    const playEntry = !this.enteredRounds.has(snapshot.roundId);
    try {
      await this._init();
      if (operation !== this.operation) return false;
      await this.context.resume();
      if (operation !== this.operation) return false;
      const current = this.snapshot;
      if (current.paused || current.outcome) {
        if (current.paused) this.enabled = false;
        this._stopVoices(); return false;
      }
      this.listener = copyPose(current.self);
      this.running = true; this.mode = 'chase';
      this._voice('background', { level: 0.16, loop: true }); this.counters.background++;
      for (const source of anchors) {
        this._voice(source.soundId, { kind: 'anchor', level: source.id === 'a' ? 0.24 : 0.28,
          loop: true, position: source }); this.counters.anchors++;
      }
      if (current.role === 'survivor') {
        this.heartbeatVoice = this._voice('heartbeat', { level: 0, loop: true }); this.counters.heartbeat++;
      }
      if (playEntry) {
        this._voice('entry', { level: 0.7 }); this.counters.entry++;
        this.enteredRounds.add(snapshot.roundId); persistRounds(ENTRY_STORAGE, this.enteredRounds);
      }
      this._masterLevel(); this.update(current);
      return true;
    } catch (error) {
      if (operation !== this.operation) return false;
      this.enabled = false; this._stopVoices(); this.lastError = error.message; throw error;
    }
  }

  update(snapshot) {
    if (!snapshot || snapshot.roundId !== this.roundId || !validPose(snapshot.self)) return;
    this.snapshot = snapshot; this.listener = copyPose(snapshot.self);
    const event = snapshot.doorEvent;
    const eventSeq = Number.isSafeInteger(event?.seq) ? event.seq : this.lastDoorSeq;
    const opened = eventSeq > this.lastDoorSeq;
    this.lastDoorSeq = Math.max(this.lastDoorSeq, eventSeq);
    if (!this.running || this.mode !== 'chase') return;
    if (snapshot.paused) { this.pause(); return; }
    // Finishing a snapshot stops the scene but preserves the user's sound intent
    // so finish() can still play the result after an update-first caller.
    if (snapshot.outcome) { this._stopVoices(); return; }
    for (const voice of this.voices) this._position(voice);
    const target = snapshot.role === 'survivor' && Number.isFinite(snapshot.heartbeatIntensity)
      ? clamp(snapshot.heartbeatIntensity) : 0;
    if (target !== this.heartbeatTarget) {
      this.heartbeatTarget = target;
      if (this.heartbeatVoice) setGain(this.heartbeatVoice.gain.gain, target * 0.45,
        this.context.currentTime, HEARTBEAT_FADE_SECONDS);
    }
    if (opened && validPose(event)) {
      for (const voice of [...this.voices]) if (voice.kind === 'door') this._dispose(voice, true);
      this._voice('door', { level: 0.8, position: event }); this.counters.door++;
    }
    const steps = this.tracker.update(snapshot, nowMs());
    for (const voice of [...this.voices]) {
      if (voice.kind === 'footstep' && voice.actor !== 'self' && !this.tracker.players.has(voice.actor)) this._dispose(voice, true);
    }
    for (const step of steps) {
      if ([...this.voices].some(voice => voice.kind === 'footstep' && voice.actor === step.id)) continue;
      this._voice('footsteps', { kind: 'footstep', level: step.own ? 0.55 : 0.8,
        position: step.position, actor: step.id, buffer: this.footstepBuffer });
      this.counters[step.own ? 'footstepsSelf' : 'footstepsRemote']++;
    }
  }

  pause() { this.operation++; this.enabled = false; this._stopVoices(); }
  setVolume(value) { if (Number.isFinite(value)) { this.volume = clamp(value); this._masterLevel(); } }

  async finish(snapshot, { playVictory = true } = {}) {
    const round = snapshot?.roundId;
    if (!round || (this.roundId && round !== this.roundId) || this.finishedRounds.has(round)) return false;
    this.finishedRounds.add(round);
    persistRounds(FINISH_STORAGE, this.finishedRounds);
    const enabled = this.enabled;
    const operation = ++this.operation;
    this.enabled = false; this._stopVoices();
    if (!enabled || !playVictory || snapshot.winner !== 'hunter') return false;
    try {
      await this._init();
      if (operation !== this.operation) return false;
      await this.context.resume();
      if (operation !== this.operation) return false;
      this.enabled = true; this.running = true; this.mode = 'victory';
      this._voice('hunter-win', { level: 0.8 }); this.counters.hunterWin++;
      this._masterLevel();
      return true;
    } catch (error) {
      if (operation !== this.operation) return false;
      this.enabled = false; this._stopVoices(); this.lastError = error.message; throw error;
    }
  }

  getStats() {
    return { running: this.running, mode: this.mode, silent: this.silent, volume: this.volume,
      masterGain: this.master?.gain.value ?? 0, contextState: this.context?.state ?? 'uninitialized',
      loadedAssets: this.buffers.size, assetDetails: structuredClone(this.assetDetails),
      roundId: this.roundId, listener: { ...this.listener }, heartbeatTarget: this.heartbeatTarget,
      heartbeatGain: this.heartbeatVoice?.gain.gain.value ?? 0, lastDoorSeq: this.lastDoorSeq,
      activeVoices: this.voices.size, counters: { ...this.counters }, error: this.lastError,
      voices: [...this.voices].map(voice => ({ id: voice.id, kind: voice.kind, loop: voice.loop,
        actor: voice.actor, gain: voice.gain.gain.value, durationSeconds: voice.source.buffer.duration,
        position: voice.position ? { ...voice.position } : null,
        path: voice.panner ? 'direct' : 'central',
        pannerPosition: voice.panner ? { x: voice.panner.positionX.value,
          y: voice.panner.positionY.value, z: voice.panner.positionZ.value } : null })),
    };
  }
}
