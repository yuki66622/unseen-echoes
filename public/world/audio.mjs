import {createVisualMeter,readVisualMeter} from '../audio-visual.mjs';
import { createAcousticStage, applyAcousticPath, createHrtfPanner,
  createCueBuffer, relativePosition, prepareLoopBuffer, MASTER_HEADROOM } from '../sound-engine.mjs';
import { SOUNDS } from '../sound-catalog.mjs';
import { getAcousticPath } from './runtime.mjs';

const clamp01 = value => Math.max(0, Math.min(1, value));
const SOUND_IDS = ['rain', 'forest', 'fire'];
const REFERENCE_URLS = Object.freeze(Object.fromEntries(SOUND_IDS.map(id => [id, new URL(SOUNDS[id].url,new URL('../',import.meta.url)).pathname])));
function audioPack(assets){if(assets!=null)throw new Error('只使用现有音库。');const urls={...REFERENCE_URLS};return {origin:'supplied',urls,key:JSON.stringify(urls)};}
function ramp(parameter, value, now, seconds = 0.06) {
  const current = parameter.value;
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
  else parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(current, now);
  parameter.linearRampToValueAtTime(value, now + seconds);
}

function beaconBuffer(context) {
  const buffer = context.createBuffer(1, Math.round(context.sampleRate * 2.4), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    const time = i / context.sampleRate;
    for (const start of [0.1, 0.48]) {
      const phase = (time - start) / 0.22;
      if (phase >= 0 && phase <= 1) samples[i] += 0.018 * Math.sin(Math.PI * phase) ** 2 * Math.sin(2 * Math.PI * 560 * (time - start));
    }
  }
  return buffer;
}

export class WorldAudio {
  constructor({ silent = false } = {}) {
    this.silent = Boolean(silent); this.volume = 0.35;
    this.context = null; this.master = null; this.initPromise = null;
    this.buffers = new Map(); this.details = new Map(); this.voices = new Set();
    this.cues = new Set(); this.cueBuffers = new Map(); this.exitBuffer = null;
    this.run = null; this.listener = null; this.running = false;
    this.operation = 0; this.lastError = null;
    this.checking = false;
    this.assetOrigin = null; this.assetUrls = {};
    this.packCache = new Map(); this.pendingPacks = new Map();
  }

  async init(pack = audioPack(null)) {
    if (!this.context) {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) throw new Error('当前浏览器不支持空间音频。');
      this.context = new Context(); this.master = this.context.createGain();
      this.master.gain.value = 0; this.master.connect(this.context.destination);this.visualMeter=createVisualMeter(this.context);
    }
    if (this.packCache.has(pack.key)) return this.packCache.get(pack.key);
    if (this.pendingPacks.has(pack.key)) return this.pendingPacks.get(pack.key);
    const loading = (async () => {
      try {
        let loaded;
        {
          const outcomes = await Promise.allSettled(SOUND_IDS.map(async id => {
            const response = await fetch(pack.urls[id], { redirect: 'error',signal:AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
            const bytes = await response.arrayBuffer();
            const sizeLimit = pack.origin === 'supplied' ? 20 * 1024 * 1024 : 2 * 1024 * 1024;
            if (!bytes.byteLength || bytes.byteLength > sizeLimit) throw new Error(`${id}: invalid recording size`);
            const decoded = await this.context.decodeAudioData(bytes);
            return { id, ...prepareLoopBuffer(this.context, decoded) };
          }));
          const failures = outcomes.filter(outcome => outcome.status === 'rejected');
          if (failures.length) throw new Error(failures.map(outcome => outcome.reason.message).join('; '));
          loaded = { buffers: new Map(), details: new Map() };
          for (const outcome of outcomes) {
            loaded.buffers.set(outcome.value.id, outcome.value.buffer);
            loaded.details.set(outcome.value.id, outcome.value.details);
          }
        }
        this.packCache.set(pack.key, loaded);
        // Keep the last few complete packs; partial or failed packs never cache.
        while (this.packCache.size > 3) this.packCache.delete(this.packCache.keys().next().value);
        return loaded;
      } catch (error) {
        const message = pack.origin === 'ElevenLabs' ? '生成音效加载失败，请重试；未替换为参考录音。'
          : '参考录音加载失败，请检查连接后重试。';
        throw new Error(message, { cause: error });
      }
    })();
    this.pendingPacks.set(pack.key, loading); this.initPromise = loading;
    try { return await loading; }
    finally {
      this.pendingPacks.delete(pack.key);
      if (this.initPromise === loading) this.initPromise = null;
    }
  }

  _masterLevel() {
    if (!this.master) return;
    const level = this.silent || !(this.running || this.checking) ? 0 : this.volume * MASTER_HEADROOM;
    // A silent diagnostic session never connects a nonzero signal to speakers.
    if (this.silent || this.volume === 0) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    } else ramp(this.master.gain, level, this.context.currentTime);
  }

  _stopAll() {
    this.running = false; this.checking = false; this.run = null;
    if (!this.context) return;
    this._masterLevel();
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      ramp(voice.gain.gain, 0, now, 0.02);
      try { voice.source.stop(now + 0.03); } catch { /* Already ended. */ }
    }
    this.voices.clear();
    for (const cue of this.cues) {
      ramp(cue.gain.gain, 0, now, 0.02);
      try { cue.source.stop(now + 0.03); } catch { /* Already ended. */ }
    }
    this.cues.clear();
  }

  _addVoice(descriptor, buffer, balanceLevel, when) {
    const source = this.context.createBufferSource(), gain = this.context.createGain(), balance = this.context.createGain();
    const acoustic = createAcousticStage(this.context, this.master);
    applyAcousticPath(acoustic, getAcousticPath(this.run, descriptor), this.listener, this.context.currentTime, true);
    balance.gain.value = balanceLevel;
    source.buffer = buffer; source.loop = true; source.loopStart = 0; source.loopEnd = buffer.duration;
    source.playbackRate.value = 1;
    gain.gain.value = 0; gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(1, when + 0.12);
    source.connect(gain); gain.connect(balance); balance.connect(acoustic.filter);if(this.visualMeter)acoustic.panner.connect(this.visualMeter.analyser);
    const voice = { descriptor: { ...descriptor }, source, gain, balance, acoustic, buffer, when };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice); source.disconnect(); gain.disconnect(); balance.disconnect();
      acoustic.filter.disconnect(); acoustic.acousticGain.disconnect(); acoustic.panner.disconnect();
    };
    source.start(when, 0);
  }

  _syncBeacon() {
    if (!this.running || !this.run?.carrying || [...this.voices].some(voice => voice.descriptor.soundId === 'exit')) return;
    this.exitBuffer ??= beaconBuffer(this.context);
    this._addVoice({ ...this.run.world.exit, id: 'exit-beacon', soundId: 'exit' }, this.exitBuffer, 1, this.context.currentTime + 0.02);
  }

  async start(run) {
    if (!run?.world || !Array.isArray(run.world.sources) || run.world.sources.length !== 3
      || new Set(run.world.sources.map(source => source.soundId)).size !== 3
      || run.world.sources.some(source => !SOUNDS[source.soundId])) throw new Error('这个世界缺少完整的环境音效。');
    const operation = ++this.operation;
    this._stopAll();
    this.buffers = new Map(); this.details = new Map();
    this.assetOrigin = null; this.assetUrls = {};
    try {
      const pack = audioPack(run.audioAssets);
      this.assetOrigin = pack.origin; this.assetUrls = { ...pack.urls };
      const loaded = await this.init(pack);
      if (operation !== this.operation) return false;
      await this.context.resume();
      if (operation !== this.operation) return false;
      if (this.context.state !== 'running') throw new Error('浏览器尚未允许播放声音，请再次点击开启声音。');
      this.buffers = loaded.buffers; this.details = loaded.details;
      this.run = run; this.listener = { ...run.player };
      const when = this.context.currentTime + 0.04;
      for (const descriptor of run.world.sources) this._addVoice(descriptor, this.buffers.get(descriptor.soundId), SOUNDS[descriptor.soundId].mixGain, when);
      this.running = true; this._syncBeacon(); this._masterLevel(); this.lastError = null;
      return true;
    } catch (error) {
      if (operation !== this.operation) return false;
      this._stopAll(); this.lastError = error.message;
      throw error;
    }
  }

  setPose(run, { continuous = false } = {}) {
    if (![run?.player?.x, run?.player?.y, run?.player?.heading].every(Number.isFinite)) return;
    // A stale UI callback from a different world cannot redirect active voices.
    if (this.running && this.run !== run) return;
    this.listener = { ...run.player };
    if (!this.running || !this.context) return;
    this.run = run; this._syncBeacon();
    const now = this.context.currentTime;
    for (const voice of this.voices) applyAcousticPath(voice.acoustic, getAcousticPath(run, voice.descriptor), this.listener, now, false, continuous);
    for (const cue of this.cues) {
      if (!cue.panner) continue;
      const relative = relativePosition(this.listener, cue.position);
      for (const axis of ['x', 'y', 'z']) ramp(cue.panner[`position${axis.toUpperCase()}`], relative[axis], now, 0.035);
    }
  }

  playCue(kind, position) {
    const tone = { door: 'door', wrong: 'wrong', collected: 'door', won: 'door' }[kind];
    if (!tone || !this.running || this.context?.state !== 'running' || this.cues.size >= 4) return false;
    if (position && ![position.x, position.y].every(Number.isFinite)) return false;
    if (!this.cueBuffers.has(tone)) this.cueBuffers.set(tone, createCueBuffer(this.context, tone));
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = this.cueBuffers.get(tone); source.loop = false; gain.gain.value = 0.65; source.connect(gain);
    const panner = position ? createHrtfPanner(this.context) : null;
    if (panner) {
      const relative = relativePosition(this.listener, position);
      for (const axis of ['x', 'y', 'z']) panner[`position${axis.toUpperCase()}`].value = relative[axis];
      gain.connect(panner); panner.connect(this.master);
    } else gain.connect(this.master);
    const cue = { kind, source, gain, panner, position: position ? { ...position } : null };
    this.cues.add(cue);
    source.onended = () => { this.cues.delete(cue); source.disconnect(); gain.disconnect(); panner?.disconnect(); };
    source.start(this.context.currentTime);
    return true;
  }

  setVolume(value) { if (Number.isFinite(value)) { this.volume = clamp01(value); this._masterLevel(); } }
  pause() { this.operation++; this._stopAll(); }

  async checkSound() {
    this.pause();
    const state = status => ({ status, contextState: this.context?.state ?? 'uninitialized', volume: this.volume });
    if (this.volume === 0) return state('muted');
    const operation = ++this.operation;
    try {
      if (!this.context) {
        const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Context) return state('blocked');
        this.context = new Context(); this.master = this.context.createGain();
        this.master.gain.value = 0; this.master.connect(this.context.destination);this.visualMeter=createVisualMeter(this.context);
      }
      // This invocation occurs directly inside the user's click, before fetching
      // or decoding any world recordings. It never changes their chosen volume.
      await this.context.resume();
      if (operation !== this.operation) return state('cancelled');
      if (this.volume === 0) return state('muted');
      if (this.context.state !== 'running') return state('blocked');
      const source = this.context.createBufferSource(), gain = this.context.createGain();
      const buffer = this.context.createBuffer(1, Math.round(this.context.sampleRate * 0.65), this.context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        const time = i / this.context.sampleRate, pulse = time < 0.3 ? time / 0.3 : (time - 0.35) / 0.3;
        if (pulse >= 0 && pulse <= 1) samples[i] = 0.14 * Math.sin(Math.PI * pulse) ** 2 * Math.sin(2 * Math.PI * (time < 0.3 ? 440 : 660) * time);
      }
      source.buffer = buffer; gain.gain.value = 1; source.connect(gain); gain.connect(this.master);
      const cue = { kind: 'sound-check', source, gain, panner: null, position: null };
      this.cues.add(cue); this.checking = true; this._masterLevel();
      source.onended = () => {
        this.cues.delete(cue); source.disconnect(); gain.disconnect();
        if (operation === this.operation) { this.checking = false; this._masterLevel(); }
      };
      source.start(this.context.currentTime + 0.03);
      return state('playing');
    } catch {
      if (operation !== this.operation) return state('cancelled');
      this._stopAll(); return state('blocked');
    }
  }

  getEnvironmentVisualState(){return readVisualMeter(this.visualMeter,this.running&&this.context?.state==='running');}
  getStats() {
    const now = this.context?.currentTime ?? 0;
    return { revision: 'generated-world-v3', running: this.running, checking: this.checking, silent: this.silent, volume: this.volume,
      assetOrigin: this.assetOrigin, assetUrls: { ...this.assetUrls },
      masterGain: this.master?.gain.value ?? 0, masterTarget: this.silent || !(this.running || this.checking) ? 0 : this.volume * MASTER_HEADROOM,
      activeVoices: this.voices.size, cueCount: this.cues.size, loadedSounds: this.buffers.size,
      contextState: this.context?.state ?? 'uninitialized', error: this.lastError,
      listener: this.listener ? { ...this.listener } : null,
      doorStates: this.run ? { ...this.run.doorStates } : {},
      voices: [...this.voices].map(voice => ({ id: voice.descriptor.id, soundId: voice.descriptor.soundId,
        startTime: voice.when, phaseSeconds: Math.max(0, now - voice.when) % voice.buffer.duration,
        loopDuration: voice.buffer.duration, gain: voice.gain.gain.value, mixGain: voice.balance.gain.value,
        acousticGain: voice.acoustic.acousticGain.gain.value, cutoff: voice.acoustic.filter.frequency.value,
        pannerPosition: { x: voice.acoustic.panner.positionX.value, y: voice.acoustic.panner.positionY.value, z: voice.acoustic.panner.positionZ.value },
        targets: { ...voice.acoustic.targets }, path: { ...voice.acoustic.path, position: { ...voice.acoustic.path.position } } })) };
  }
}
