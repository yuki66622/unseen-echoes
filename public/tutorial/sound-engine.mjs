import { SOUNDS } from './sound-catalog.mjs?v=rooms-v3';
import { getAcousticPath, INITIAL_PLAYER } from './room-layout.mjs?v=rooms-v3';

export const AUDIO_ENGINE_REVISION = 'walk-v1';
export const MASTER_HEADROOM = 0.45;
export const SOURCE_PEAK_LIMIT = 0.45;
export const SOURCE_RMS_TARGET = 0.04;
export const SOFT_LIMIT_KNEE = 0.3;
export const REFERENCE_DISTANCE = 2;
export const DISTANCE_ROLLOFF = 0.6;
export const ACOUSTIC_TRANSITION_SECONDS = 0.3;
export const MOVING_POSITION_SECONDS = 0.035;
const VISUAL_NEAR_DISTANCE = 1;
const VISUAL_FAR_DISTANCE = 9;
const SOUND_IDS = Object.keys(SOUNDS);
const clamp01 = value => Math.max(0, Math.min(1, value));

function softLimit(value) {
  const magnitude = Math.abs(value);
  if (magnitude <= SOFT_LIMIT_KNEE) return value;
  const width = SOURCE_PEAK_LIMIT - SOFT_LIMIT_KNEE;
  return Math.sign(value) * (SOFT_LIMIT_KNEE + width * (1 - Math.exp(-(magnitude - SOFT_LIMIT_KNEE) / width)));
}

function balancedGain(samples, rawRms) {
  // Stratified, deterministic observations cover the whole recording without
  // repeatedly scanning a long buffer. Final statistics below use EVERY sample.
  const count = Math.min(65536, samples.length);
  const observations = new Float32Array(count);
  let seed = 19373;
  for (let i = 0; i < count; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const position = Math.floor((i + seed / 4294967296) * samples.length / count);
    observations[i] = samples[position];
  }
  const measure = gain => {
    let sum = 0;
    for (let i = 0; i < observations.length; i++) { const sample = softLimit(observations[i] * gain); sum += sample * sample; }
    return Math.sqrt(sum / observations.length);
  };
  let low = 0, high = SOURCE_RMS_TARGET / rawRms;
  let expanded = 0;
  while (measure(high) < SOURCE_RMS_TARGET && expanded < 20) { high *= 2; expanded++; }
  if (measure(high) < SOURCE_RMS_TARGET) throw new Error('录音有效底声过于稀疏，无法形成平衡的环境声。');
  for (let i = 0; i < 17; i++) {
    const middle = (low + high) / 2;
    if (measure(middle) < SOURCE_RMS_TARGET) low = middle; else high = middle;
  }
  return (low + high) / 2;
}

export function prepareLoopBuffer(context, decoded) {
  if (decoded.duration < 2 || decoded.numberOfChannels < 1) throw new Error('环境录音至少需要 2 秒。');
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const samples = decoded.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) {
      if (!Number.isFinite(samples[i])) throw new Error('录音包含无效采样。');
      mono[i] += samples[i] / decoded.numberOfChannels;
    }
  }
  let mean = 0;
  for (const value of mono) mean += value;
  mean /= mono.length;
  for (let i = 0; i < mono.length; i++) mono[i] -= mean;
  const overlap = Math.min(Math.round(decoded.sampleRate), Math.floor(mono.length / 8));
  const length = mono.length - overlap;
  const buffer = context.createBuffer(1, length, decoded.sampleRate);
  const output = buffer.getChannelData(0);
  output.set(mono.subarray(overlap, mono.length - overlap), 0);
  for (let i = 0; i < overlap; i++) {
    const angle = i / (overlap - 1) * Math.PI / 2;
    output[length - overlap + i] = mono[mono.length - overlap + i] * Math.cos(angle) + mono[i] * Math.sin(angle);
  }
  let peak = 0;
  let energy = 0;
  for (const value of output) { peak = Math.max(peak, Math.abs(value)); energy += value * value; }
  if (!Number.isFinite(peak) || Math.sqrt(energy / length) < 1e-6) throw new Error('录音为空或转为单声道后没有有效声音。');
  const rawRms = Math.sqrt(energy / length);
  const gain = balancedGain(output, rawRms);
  let finalEnergy = 0, finalPeak = 0, limitedSamples = 0;
  for (let i = 0; i < output.length; i++) {
    const amplified = output[i] * gain;
    if (Math.abs(amplified) > SOFT_LIMIT_KNEE) limitedSamples++;
    output[i] = softLimit(amplified);
    finalEnergy += output[i] * output[i];
    finalPeak = Math.max(finalPeak, Math.abs(output[i]));
  }
  return {
    buffer,
    details: {
      sourceDuration: decoded.duration,
      sourceChannels: decoded.numberOfChannels,
      loopDuration: buffer.duration,
      crossfadeSeconds: overlap / decoded.sampleRate,
      normalizationGain: gain,
      peak: finalPeak,
      rms: Math.sqrt(finalEnergy / length),
      rmsTarget: SOURCE_RMS_TARGET,
      softLimitKnee: SOFT_LIMIT_KNEE,
      softLimitedFraction: limitedSamples / length,
      seamDelta: Math.abs(output[0] - output[output.length - 1]),
      originalAdjacentDelta: Math.abs(softLimit(mono[overlap] * gain) - softLimit(mono[overlap - 1] * gain))
    }
  };
}

export async function loadRecordingLoops(context) {
  const outcomes = await Promise.allSettled(SOUND_IDS.map(async id => {
    const sound = SOUNDS[id];
    try {
      const response = await fetch(sound.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const decoded = await context.decodeAudioData(await response.arrayBuffer());
      return { id, ...prepareLoopBuffer(context, decoded) };
    } catch (error) {
      throw new Error(`${sound.label}加载失败：${error.message}（${sound.url}）`);
    }
  }));
  const errors = outcomes.filter(result => result.status === 'rejected').map(result => result.reason.message);
  if (errors.length) throw new Error(errors.join('；'));
  const buffers = new Map(); const details = new Map();
  for (const result of outcomes) { buffers.set(result.value.id, result.value.buffer); details.set(result.value.id, result.value.details); }
  return { buffers, details };
}

export function relativePosition(listener, source) {
  const angle = listener.heading ?? 0;
  const dx = source.x - listener.x, dy = source.y - listener.y;
  return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: 0, z: -(dx * Math.sin(angle) + dy * Math.cos(angle)) };
}

export function createHrtfPanner(context) {
  const panner = context.createPanner();
  panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
  panner.refDistance = REFERENCE_DISTANCE; panner.rolloffFactor = DISTANCE_ROLLOFF;
  panner.positionZ.value = -1;
  return panner;
}

function ramp(param, value, now, seconds = 0.06) {
  // Calls are made at context.currentTime. Explicitly anchor the current value:
  // cancelAndHold alone can leave the old event as the next ramp's start, causing
  // an immediate jump when that old event is far in the past. Capture before
  // cancellation so an interrupted ramp resumes from its current value.
  const current = param.value;
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
  else param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

// Occlusion and distance have separate responsibilities: this gain/filter models
// the wall; the panner still attenuates distance, including a doorway route's
// virtual position. This is an authored approximation, not wave simulation.
export function createAcousticStage(context, destination) {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass'; filter.Q.value = Math.SQRT1_2;
  const acousticGain = context.createGain();
  const panner = createHrtfPanner(context);
  filter.connect(acousticGain); acousticGain.connect(panner); panner.connect(destination);
  return { filter, acousticGain, panner, targets: {}, path: null };
}

export function applyAcousticPath(stage, path, listener, now, immediate = false, continuous = false) {
  const relative = relativePosition(listener, path.position);
  const samePath=stage.path?.kind===path.kind;
  const controls = [
    ['gain', stage.acousticGain.gain, path.gain],
    ['cutoff', stage.filter.frequency, path.cutoff],
    ...['x', 'y', 'z'].map(axis => [axis, stage.panner[`position${axis.toUpperCase()}`], relative[axis]])
  ];
  for (const [key, parameter, value] of controls) {
    if (!immediate && stage.targets[key] === value) continue;
    if (immediate) { parameter.cancelScheduledValues(now); parameter.setValueAtTime(value, now); }
    else ramp(parameter, value, now, continuous&&samePath&&['x','y','z'].includes(key)?MOVING_POSITION_SECONDS:ACOUSTIC_TRANSITION_SECONDS);
    stage.targets[key] = value;
  }
  stage.path = { ...path, position: { ...path.position } };
}

export function createCueBuffer(context, kind) {
  if (kind !== 'door' && kind !== 'wrong') throw new Error('未知提示音。');
  const duration = kind === 'door' ? 0.24 : 0.28;
  const buffer = context.createBuffer(1, Math.round(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  // Finite, softly enveloped interface tones. They are synthesized cues, not
  // a claim to reproduce an actual door or another environmental recording.
  for (let i = 0; i < samples.length; i++) {
    const fraction = i / (samples.length - 1), t = i / context.sampleRate;
    const startHz = kind === 'door' ? 420 : 290;
    const endHz = kind === 'door' ? 520 : 220;
    const phase = 2 * Math.PI * (startHz * t + (endHz - startHz) * t * t / (2 * duration));
    const envelope = Math.sin(Math.PI * fraction) ** 2;
    samples[i] = 0.1 * envelope * (0.85 * Math.sin(phase) + 0.15 * Math.sin(phase * 2));
  }
  return buffer;
}

export class SoundHuntAudio {
  constructor({ silent = false } = {}) {
    this.silent = Boolean(silent); this.volume = 0.35;
    this.context = null; this.master = null; this.initPromise = null;
    this.environmentAnalyser = null; this.environmentSamples = null;
    this.buffers = new Map(); this.details = new Map(); this.voices = new Set();
    this.cues = new Set(); this.cueBuffers = new Map(); this.doorOpen = false;
    this.enabled = new Set(SOUND_IDS);
    this.listener = { ...INITIAL_PLAYER };
    this.running = false; this.mode = 'idle'; this.operation = 0; this.lastError = null;
  }

  async init() {
    if (this.buffers.size === SOUND_IDS.length) return this.getStats();
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (!this.context) {
        const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Context) throw new Error('当前浏览器不支持 Web Audio。');
        this.context = new Context(); this.master = this.context.createGain();
        this.master.gain.value = 0; this.master.connect(this.context.destination);
        // Observe only environment voices before the output mute. This branch
        // has no output and leaves every audible panner -> master edge intact.
        this.environmentAnalyser = this.context.createAnalyser();
        this.environmentAnalyser.fftSize = 1024;
        this.environmentSamples = new Float32Array(this.environmentAnalyser.fftSize);
      }
      const loaded = await loadRecordingLoops(this.context);
      this.buffers = loaded.buffers; this.details = loaded.details; this.lastError = null;
      return this.getStats();
    })();
    try { return await this.initPromise; }
    catch (error) { this.lastError = error.message; this.initPromise = null; throw error; }
  }

  _masterLevel() {
    if (!this.context) return;
    ramp(this.master.gain, this.silent || !this.running ? 0 : this.volume * MASTER_HEADROOM, this.context.currentTime);
  }

  _stopAll() {
    this.running = false; this.mode = 'idle';
    if (!this.context) return;
    this._masterLevel();
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      voice.stopped = true;
      ramp(voice.gain.gain, 0, now, 0.03);
      voice.source.stop(now + 0.04);
    }
    this.voices.clear();
    for (const cue of this.cues) {
      ramp(cue.gain.gain, 0, now, 0.02);
      cue.source.stop(now + 0.03);
    }
    this.cues.clear();
  }

  async startScene(sources, listener = this.listener) {
    if (!Array.isArray(sources) || sources.length !== SOUND_IDS.length
      || new Set(sources.map(source => source.soundId)).size !== SOUND_IDS.length
      || sources.some(source => !SOUNDS[source.soundId] || !Number.isFinite(source.x) || !Number.isFinite(source.y))) {
      throw new Error(`场景必须包含${SOUND_IDS.map(id=>SOUNDS[id].label).join('、')}各一个，且位置有效。`);
    }
    const operation = ++this.operation;
    this._stopAll();
    try {
      await this.init();
      if (operation !== this.operation) return false;
      await this.context.resume();
      if (operation !== this.operation) return false;
    } catch (error) { if (operation !== this.operation) return false; throw error; }
    this.setPose(listener);
    const when = this.context.currentTime + 0.06;
    for (const descriptor of sources) {
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      // Perceptual balance follows normalization; the enable/fade gate stays independent.
      const balance = this.context.createGain();
      balance.gain.value = SOUNDS[descriptor.soundId].mixGain;
      const acoustic = createAcousticStage(this.context, this.master);
      acoustic.panner.connect(this.environmentAnalyser);
      applyAcousticPath(acoustic, getAcousticPath(this.listener, descriptor, this.doorOpen), this.listener, this.context.currentTime, true);
      const buffer = this.buffers.get(descriptor.soundId);
      source.buffer = buffer; source.loop = true;
      source.loopStart = 0; source.loopEnd = buffer.duration; source.playbackRate.value = 1;
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(this.enabled.has(descriptor.soundId) ? 1 : 0, when + 0.12);
      source.connect(gain); gain.connect(balance); balance.connect(acoustic.filter);
      const voice = { descriptor: { ...descriptor }, soundId: descriptor.soundId, source, gain, balance,
        acoustic, panner: acoustic.panner, buffer, when, stopped: false };
      this.voices.add(voice);
      source.onended = () => {
        this.voices.delete(voice);
        source.disconnect(); gain.disconnect(); balance.disconnect();
        acoustic.filter.disconnect(); acoustic.acousticGain.disconnect(); acoustic.panner.disconnect();
      };
      source.start(when, 0);
    }
    this.running = true; this.mode = 'scene'; this._masterLevel();
    return true;
  }

  setMix(enabledSoundIds) {
    const enabled = new Set(enabledSoundIds);
    if ([...enabled].some(id => !SOUNDS[id])) throw new Error('静音设置包含未知声音。');
    this.enabled = enabled;
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      const value = this.enabled.has(voice.soundId) ? 1 : 0;
      if (now < voice.when) {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(0, now);
        voice.gain.gain.setValueAtTime(0, voice.when);
        voice.gain.gain.linearRampToValueAtTime(value, voice.when + 0.12);
      } else ramp(voice.gain.gain, value, now);
    }
  }

  setSourceEnabled(soundId, enabled) {
    if (!SOUNDS[soundId]) throw new Error('未知声音。');
    const next = new Set(this.enabled);
    if (enabled) next.add(soundId); else next.delete(soundId);
    this.setMix(next);
  }

  setPose(listener, {continuous=false}={}) {
    if (![listener?.x, listener?.y, listener?.heading ?? 0].every(Number.isFinite)) return;
    this.listener = { ...listener };
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      applyAcousticPath(voice.acoustic, getAcousticPath(this.listener, voice.descriptor, this.doorOpen), this.listener, now, false, continuous);
    }
    for (const cue of this.cues) {
      if (!cue.panner) continue;
      const relative = relativePosition(this.listener, cue.position);
      for (const axis of ['x', 'y', 'z']) ramp(cue.panner[`position${axis.toUpperCase()}`], relative[axis], now, 0.035);
    }
  }

  setDoorOpen(open) {
    const next = Boolean(open);
    if (this.doorOpen === next) return;
    this.doorOpen = next;
    this.setPose(this.listener);
  }

  playCue(kind, position) {
    if (kind !== 'door' && kind !== 'wrong') throw new Error('未知提示音。');
    if (!this.running || this.context?.state !== 'running' || this.cues.size >= 4) return false;
    if (position && ![position.x, position.y].every(Number.isFinite)) return false;
    if (!this.cueBuffers.has(kind)) this.cueBuffers.set(kind, createCueBuffer(this.context, kind));
    const source = this.context.createBufferSource();
    source.buffer = this.cueBuffers.get(kind); source.loop = false;
    const gain = this.context.createGain(); gain.gain.value = 1;
    source.connect(gain);
    const panner = position ? createHrtfPanner(this.context) : null;
    if (panner) {
      const relative = relativePosition(this.listener, position);
      for (const axis of ['x', 'y', 'z']) panner[`position${axis.toUpperCase()}`].value = relative[axis];
      gain.connect(panner); panner.connect(this.master);
    } else gain.connect(this.master);
    const cue = { kind, source, gain, panner, position: position ? { ...position } : null };
    this.cues.add(cue);
    source.onended = () => {
      this.cues.delete(cue); source.disconnect(); gain.disconnect(); panner?.disconnect();
    };
    source.start(this.context.currentTime);
    return true;
  }

  setVolume(value) { if (Number.isFinite(value)) { this.volume = clamp01(value); this._masterLevel(); } }
  pause() { this.operation++; this._stopAll(); }

  getEnvironmentVisualState() {
    const inactive = () => ({ active: false, rms: 0, proximity: 0 });
    if (!this.running || this.mode !== 'scene' || this.context?.state !== 'running'
      || !this.environmentAnalyser || !this.environmentSamples?.length) return inactive();
    let energy = 0, weightedDistance = 0;
    for (const voice of this.voices) {
      if (voice.stopped || !this.enabled.has(voice.soundId) || voice.when > this.context.currentTime) continue;
      const panner = voice.acoustic.panner;
      const position = [panner.positionX.value, panner.positionY.value, panner.positionZ.value];
      const levels = [this.details.get(voice.soundId)?.rms, voice.gain.gain.value,
        voice.balance.gain.value, voice.acoustic.acousticGain.gain.value];
      if (!position.every(Number.isFinite) || !levels.every(value => Number.isFinite(value) && value >= 0)) continue;
      const distance = Math.hypot(...position);
      const attenuation = REFERENCE_DISTANCE / (REFERENCE_DISTANCE
        + DISTANCE_ROLLOFF * (Math.max(REFERENCE_DISTANCE, distance) - REFERENCE_DISTANCE));
      // Estimated energy, not a loudness measurement: spectral loss from the
      // low-pass filter is not inferred. All enabled sounds use the same rule.
      const weight = (levels.reduce((product, level) => product * level, 1) * attenuation) ** 2;
      if (!Number.isFinite(weight) || !Number.isFinite(distance) || weight <= 0) continue;
      energy += weight; weightedDistance += weight * distance;
    }
    if (!(energy > 0) || !Number.isFinite(energy) || !Number.isFinite(weightedDistance)) return inactive();
    try { this.environmentAnalyser.getFloatTimeDomainData(this.environmentSamples); }
    catch { return inactive(); }
    let squares = 0;
    for (const sample of this.environmentSamples) {
      if (!Number.isFinite(sample)) return inactive();
      squares += sample * sample;
    }
    const rms = Math.sqrt(squares / this.environmentSamples.length);
    if (!Number.isFinite(rms)) return inactive();
    // 1 m or closer is 1; 9 m or farther is 0. The virtual panner distance
    // already includes the doorway path. Master volume and silent QA do not.
    const proximity = clamp01((VISUAL_FAR_DISTANCE - weightedDistance / energy)
      / (VISUAL_FAR_DISTANCE - VISUAL_NEAR_DISTANCE));
    return { active: true, rms, proximity };
  }

  getStats() {
    const now = this.context?.currentTime ?? 0;
    return {
      running: this.running, mode: this.mode, activeVoices: this.voices.size, silent: this.silent,
      doorOpen: this.doorOpen, cueCount: this.cues.size,
      enabledSoundIds: SOUND_IDS.filter(id => this.enabled.has(id)),
      loadedSounds: this.buffers.size, contextState: this.context?.state ?? 'uninitialized',
      revision: AUDIO_ENGINE_REVISION, error: this.lastError,
      listener:{...this.listener},
      voices: [...this.voices].map(voice => ({ soundId: voice.soundId, startTime: voice.when,
        phaseSeconds: Math.max(0, now - voice.when) % voice.buffer.duration,
        loopDuration: voice.buffer.duration, gain: voice.gain.gain.value, mixGain: voice.balance.gain.value,
        acousticGain: voice.acoustic.acousticGain.gain.value, cutoff: voice.acoustic.filter.frequency.value,
        pannerPosition:{x:voice.acoustic.panner.positionX.value,y:voice.acoustic.panner.positionY.value,z:voice.acoustic.panner.positionZ.value},
        path: { ...voice.acoustic.path, position: { ...voice.acoustic.path.position } } }))
    };
  }
}
