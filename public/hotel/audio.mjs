import {createVisualMeter,readVisualMeter} from '../audio-visual.mjs';
import { acousticScene, webAudioListener, dbToGain, clamp } from './acoustics.mjs';

const BUS_NAMES = ['ambience', 'music', 'foreground', 'effect'];
const DEFAULT_SOURCE = {
  'hotel-bed': { x: 5, y: 5, floor: 0 }, 'exterior-bed': { x: 5, y: -2, floor: 0 },
  'upper-bed': { x: 9, y: 10, floor: 1 }, martin: { x: 4, y: 8, floor: 0 },
  claire: { x: 12.1, y: 5, floor: 0 }, elena: { x: 14.2, y: 5, floor: 0 },
  cleaner: { x: 12.4, y: 9.2, floor: 1 }, cart: { x: 13, y: 8.7, floor: 1 },
  recorder: { x: 3, y: 3.6, floor: 1 },
};

function setParam(param, value, time, smoothing = 0.075) {
  if (!param) return;
  if (smoothing && param.setTargetAtTime) param.setTargetAtTime(value, time, smoothing);
  else if (param.setValueAtTime) param.setValueAtTime(value, time);
  else param.value = value;
}

/** Overlap the recording tail and head once, then keep one loop node alive. */
export function seamlessLoopBuffer(context, input, overlapSeconds = 0.35) {
  const overlap = Math.min(Math.round(overlapSeconds * input.sampleRate), Math.floor(input.length / 5));
  if (overlap < 2) return input;
  const size = input.length - overlap;
  const output = context.createBuffer(input.numberOfChannels, size, input.sampleRate);
  for (let channel = 0; channel < input.numberOfChannels; channel++) {
    const source = input.getChannelData(channel), target = output.getChannelData(channel);
    const cleanLength = input.length - 2 * overlap;
    target.set(source.subarray(overlap, input.length - overlap));
    for (let i = 0; i < overlap; i++) {
      const t = i / (overlap - 1);
      const eased = t * t * (3 - 2 * t);
      target[cleanLength + i] = source[input.length - overlap + i] * (1 - eased) + source[i] * eased;
    }
  }
  return output;
}

function roomImpulse(context) {
  const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * 0.43), context.sampleRate);
  // Sparse early reflections: reproducible, quiet, and short enough to preserve words.
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (const [seconds, amplitude] of [[0.019, 0.42], [0.039, 0.28], [0.064, 0.17], [0.102, 0.11], [0.163, 0.06], [0.269, 0.027]]) {
      const i = Math.round((seconds + channel * 0.0017) * context.sampleRate);
      if (i < data.length) data[i] = amplitude;
    }
  }
  return impulse;
}

export class HotelAudio {
  constructor({ silent = false, onError = () => {} } = {}) {
    const querySilent = typeof location !== 'undefined' && new URLSearchParams(location.search).get('silent') === '1';
    this.silent = !!silent || querySilent;
    this.onError = onError;
    this.context = null;
    this.catalog = { assets: {}, ambience: [] };
    this.buffers = new Map(); this.loading = new Map(); this.loopBuffers = new Map();
    this.voices = new Map(); this.groupEpoch = new Map();
    this.nextVoice = 0; this.epoch = 0; this.running = false; this.paused = false;
    this.volume = 0.8; this.state = null; this.errors = []; this.buses = {};
    this.busTargets = { ambience: 1, music: 0, foreground: 1, effect: 1 };
    this.loopStarts = 0; this.listening = false;
  }

  async init(catalog) {
    this.catalog = catalog || { assets: {}, ambience: [] };
    if (!this.context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('Web Audio is not available in this browser.');
      this.context = new Context();
      this.master = this.context.createGain(); this.master.gain.value = this.volume;
      // The final gate is the only connection to destination, including generated cues.
      this.output = this.context.createGain(); this.output.gain.value = 0;
      this.master.connect(this.output); this.output.connect(this.context.destination);
      this.visualMeter=createVisualMeter(this.context);
      const impulse = roomImpulse(this.context);
      for (const name of BUS_NAMES) {
        const gain = this.context.createGain(); gain.gain.value = 1; gain.connect(this.master); if(this.visualMeter)gain.connect(this.visualMeter.analyser);
        const reverb = this.context.createConvolver(); reverb.normalize = false; reverb.buffer = impulse; reverb.connect(gain);
        this.buses[name] = { gain, reverb };
      }
    }
    // Decode failures remain visible; the usable part of the level can still start.
    const ids = Object.keys(this.catalog.assets || {});
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        try { await this._load(id); } catch (error) { this._error(id, error); }
      }
    }));
    return this;
  }

  _error(id, error) {
    const message = `${id}: ${error?.message || error}`;
    if (!this.errors.includes(message)) { this.errors.push(message); this.onError(message); }
  }

  async _load(id) {
    if (this.buffers.has(id)) return this.buffers.get(id);
    if (this.loading.has(id)) return this.loading.get(id);
    const asset = this.catalog.assets?.[id];
    if (!asset?.url) throw new Error(`Missing audio asset ${id}`);
    const loading = (async () => {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      this.buffers.set(id, buffer); return buffer;
    })();
    this.loading.set(id, loading);
    try { return await loading; } finally { this.loading.delete(id); }
  }

  async start(state) {
    if (!this.context) throw new Error('Initialize audio before starting.');
    if (this.running) { this.update(state); if (!state.paused) await this.resume(state); return; }
    this.running = true; this.paused = false; this.state = state;
    const epoch = ++this.epoch;
    this._gate();
    await this.context.resume();
    if (epoch !== this.epoch || !this.running) return;
    for (const ambience of this.catalog.ambience || []) {
      this._launchLoop(ambience.assetId, { sourceId: ambience.sourceId, diffuse: ambience.kind === 'diffuse', kind: 'ambience', group: 'ambience' }, epoch);
    }
    for (const id of ['testimony-music', 'investigation-music']) {
      if (this.catalog.assets?.[id]) this._launchLoop(id, { kind: 'music', group: 'music' }, epoch);
    }
    this.update(state);
  }

  async _launchLoop(id, options, epoch) {
    try {
      const input = await this._load(id);
      if (epoch !== this.epoch || !this.running) return;
      if (!this.loopBuffers.has(id)) this.loopBuffers.set(id, seamlessLoopBuffer(this.context, input, options.kind === 'music' ? 0.65 : 0.35));
      this._makeVoice(id, this.loopBuffers.get(id), { ...options, loop: true });
      this.loopStarts++;
    } catch (error) { this._error(id, error); }
  }

  async play(id, options = {}) {
    if (!this.running || !this.context) return false;
    const epoch = this.epoch, group = options.group || 'foreground', groupEpoch = this.groupEpoch.get(group) || 0;
    try {
      const buffer = id === 'door-cue' && !this.catalog.assets?.[id] ? this._doorCue() : await this._load(id);
      if (!this.running || epoch !== this.epoch || groupEpoch !== (this.groupEpoch.get(group) || 0)) return false;
      const asset = this.catalog.assets?.[id] || {};
      const voice = this._makeVoice(id, buffer, { kind: asset.kind || 'speech', ...options, group, loop: false });
      return await voice.completion;
    } catch (error) { this._error(id, error); return false; }
  }

  async playBytes(bytes, options = {}) {
    if (!this.running || !this.context) return false;
    const epoch = this.epoch, group = options.group || 'foreground', groupEpoch = this.groupEpoch.get(group) || 0;
    try {
      const data = bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const buffer = await this.context.decodeAudioData(data);
      if (!this.running || epoch !== this.epoch || groupEpoch !== (this.groupEpoch.get(group) || 0)) return false;
      return await this._makeVoice('dynamic-speech', buffer, { kind: 'speech', ...options, group, loop: false }).completion;
    } catch (error) { this._error('dynamic-speech', error); return false; }
  }

  _doorCue() {
    if (this.buffers.has('door-cue')) return this.buffers.get('door-cue');
    const length = Math.ceil(this.context.sampleRate * 0.18), buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / this.context.sampleRate;
      data[i] = Math.sin(2 * Math.PI * 540 * t) * Math.sin(Math.PI * i / length) ** 2 * 0.055;
    }
    this.buffers.set('door-cue', buffer); return buffer;
  }

  _makeVoice(id, buffer, options) {
    const context = this.context, now = context.currentTime, asset = this.catalog.assets?.[id] || {};
    const footstep = id.startsWith('step-');
    const peers = [...this.voices.values()].filter(v => footstep ? v.id.startsWith('step-') : options.kind === 'effect' ? v.kind === 'effect' : ['speech', 'evidence'].includes(options.kind) && ['speech', 'evidence'].includes(v.kind));
    const limit = footstep ? 2 : options.kind === 'effect' ? 8 : 3;
    while (peers.length >= limit) this._cancelVoice(peers.shift());
    const voice = {
      key: ++this.nextVoice, id, ...options, local: footstep || !!options.local, startedAt: now, duration: buffer.duration,
      originalDuration: this.buffers.get(id)?.duration || buffer.duration,
      baseGain: dbToGain(Number.isFinite(options.gainDb) ? options.gainDb : Number.isFinite(asset.gainDb) ? asset.gainDb : 0),
      acoustic: null, cleaned: false,
    };
    voice.bus = voice.kind === 'music' ? 'music' : voice.kind === 'ambience' ? 'ambience' : ['speech', 'evidence'].includes(voice.kind) ? 'foreground' : 'effect';
    voice.completion = new Promise(resolve => { voice.resolve = resolve; });
    voice.source = context.createBufferSource(); voice.source.buffer = buffer; voice.source.loop = !!options.loop;
    voice.filter = context.createBiquadFilter(); voice.filter.type = 'lowpass'; voice.filter.frequency.value = 18000; voice.filter.Q.value = 0.5;
    voice.gain = context.createGain(); voice.gain.gain.value = 0;
    voice.panner = context.createPanner(); voice.panner.panningModel = 'HRTF'; voice.panner.distanceModel = 'inverse'; voice.panner.rolloffFactor = 0;
    voice.panner.coneInnerAngle = 360; voice.panner.coneOuterAngle = 360;
    voice.direct = context.createGain(); voice.spatial = context.createGain(); voice.wet = context.createGain(); voice.wet.gain.value = 0;
    voice.source.connect(voice.filter); voice.filter.connect(voice.gain);
    voice.gain.connect(voice.direct); voice.direct.connect(this.buses[voice.bus].gain);
    voice.gain.connect(voice.panner); voice.panner.connect(voice.spatial); voice.spatial.connect(this.buses[voice.bus].gain);
    voice.spatial.connect(voice.wet); voice.wet.connect(this.buses[voice.bus].reverb);
    voice.source.onended = () => this._cleanVoice(voice, true);
    this.voices.set(voice.key, voice);
    this._updateVoice(voice);
    voice.source.start(now);
    this._updateBuses();
    return voice;
  }

  _position(voice) {
    if (voice.local) return null;
    if (voice.position) return voice.position;
    if (voice.sourceId) return this.state?.sources?.[voice.sourceId] || DEFAULT_SOURCE[voice.sourceId] || null;
    return null;
  }

  _updateVoice(voice) {
    if (!this.state || voice.cleaned) return;
    const time = this.context.currentTime, position = this._position(voice);
    const acoustic = position ? acousticScene(this.state, position, { diffuse: voice.diffuse }) : null;
    voice.acoustic = acoustic;
    let phaseGain = 1;
    if (voice.kind === 'music') {
      phaseGain = voice.id === 'testimony-music' ? (this.state.phase === 'testimony' ? 1 : 0) : (['investigation', 'ending'].includes(this.state.phase) ? 1 : 0);
    }
    voice.targetGain = voice.baseGain * (acoustic?.gain ?? 1) * phaseGain;
    setParam(voice.gain.gain, voice.targetGain, time, voice.kind === 'music' ? 0.55 : 0.085);
    setParam(voice.filter.frequency, acoustic?.cutoff ?? 18000, time, 0.11);
    const directional = acoustic?.directionality ?? 0;
    setParam(voice.direct.gain, Math.sqrt(1 - directional), time);
    setParam(voice.spatial.gain, Math.sqrt(directional), time);
    setParam(voice.wet.gain, acoustic?.reflection ?? 0, time);
    if (acoustic) {
      setParam(voice.panner.positionX, acoustic.apparent.x, time, 0.045);
      setParam(voice.panner.positionY, acoustic.apparent.y, time, 0.045);
      setParam(voice.panner.positionZ, acoustic.apparent.z, time, 0.045);
    }
  }

  _updateBuses() {
    if (!this.context) return;
    const foreground = [...this.voices.values()].filter(v => !v.cleaned && ['speech', 'evidence'].includes(v.kind));
    const evidence = foreground.some(v => v.kind === 'evidence');
    this.busTargets = { ambience: evidence ? 0.16 : foreground.length ? 0.3 : 1, music: evidence ? 0.12 : foreground.length ? 0.24 : 0.65, foreground: 1, effect: foreground.length ? 0.6 : 1 };
    if (this.listening) {
      this.busTargets.ambience = Math.min(this.busTargets.ambience, 0.12);
      this.busTargets.music = Math.min(this.busTargets.music, 0.08);
      this.busTargets.effect = Math.min(this.busTargets.effect, 0.35);
    }
    for (const name of BUS_NAMES) setParam(this.buses[name].gain.gain, this.busTargets[name], this.context.currentTime, foreground.length ? 0.055 : 0.32);
  }

  update(state) {
    this.state = state;
    if (!this.context) return;
    const listener = webAudioListener(state), time = this.context.currentTime, node = this.context.listener;
    for (const [param, value] of Object.entries({ positionX: listener.x, positionY: listener.y, positionZ: listener.z, forwardX: listener.forwardX, forwardY: 0, forwardZ: listener.forwardZ, upX: 0, upY: 1, upZ: 0 })) setParam(node[param], value, time, 0.045);
    this.listenerStats = listener;
    for (const voice of this.voices.values()) this._updateVoice(voice);
    this._updateBuses();
    if (state.paused && !this.paused) this.pause();
    this._gate();
  }

  _gate() {
    if (!this.output) return;
    const value = this.silent || this.paused || !this.running ? 0 : 1;
    this.finalOutputGain = value;
    // Silent is a hard, immediate final zero, independent of all upstream ramping.
    this.output.gain.cancelScheduledValues(this.context.currentTime);
    setParam(this.output.gain, value, this.context.currentTime, value ? 0.035 : 0);
  }

  _cleanVoice(voice, natural) {
    if (voice.cleaned) return;
    voice.cleaned = true;
    voice.source.onended = null;
    for (const key of ['source', 'filter', 'gain', 'panner', 'direct', 'spatial', 'wet']) {
      try { voice[key].disconnect(); } catch { /* A previously stopped node is harmless. */ }
    }
    this.voices.delete(voice.key); voice.resolve(!!natural); this._updateBuses();
  }

  stopGroup(group) {
    this.groupEpoch.set(group, (this.groupEpoch.get(group) || 0) + 1);
    for (const voice of [...this.voices.values()]) if (voice.group === group) {
      this._cancelVoice(voice);
    }
  }

  _cancelVoice(voice) {
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* Source may already have naturally ended. */ }
    this._cleanVoice(voice, false);
  }

  async pause() {
    this.paused = true; this._gate();
    if (this.context?.state === 'running') await this.context.suspend();
  }

  async resume(state = this.state) {
    if (!this.running || !this.context) return;
    this.paused = false;
    if (state) this.update({ ...state, paused: false });
    await this.context.resume();
    this._gate();
  }

  stop() {
    this.running = false; this.paused = false; this.listening = false; ++this.epoch; this._gate();
    for (const voice of [...this.voices.values()]) {
      this._cancelVoice(voice);
    }
    // Clear the previous run's short reflection tails before a restart.
    for (const bus of Object.values(this.buses)) { const impulse = bus.reverb.buffer; bus.reverb.buffer = null; bus.reverb.buffer = impulse; }
  }

  setVolume(value) {
    this.volume = clamp(value);
    if (this.master) setParam(this.master.gain, this.volume, this.context.currentTime);
    this._gate();
  }

  setListening(value) {
    this.listening = !!value;
    this._updateBuses();
  }

  getEnvironmentVisualState(){return readVisualMeter(this.visualMeter,this.running&&!this.paused&&this.context?.state==='running');}

  getStats() {
    const now = this.context?.currentTime || 0;
    return {
      silent: this.silent, finalOutputGain: this.finalOutputGain || 0,
      running: this.running, paused: this.paused, listening: this.listening, contextState: this.context?.state || 'uninitialized',
      volume: this.volume, busGains: { ...this.busTargets }, listener: this.listenerStats || null,
      transitionProgress: this.state?.stairs?.progress ?? null, loadedAssets: this.buffers.size,
      activeVoices: this.voices.size, loopStarts: this.loopStarts, pendingLoads: this.loading.size,
      errors: [...this.errors],
      voices: [...this.voices.values()].map(v => ({
        id: v.id, key: v.key, sourceId: v.sourceId || null, kind: v.kind, group: v.group,
        loop: !!v.loop, duration: v.duration, originalDuration: v.originalDuration,
        phaseSeconds: v.loop ? (now - v.startedAt) % v.duration : Math.min(v.duration, now - v.startedAt),
        gain: v.targetGain, actualGain: v.gain.gain.value, cutoff: v.filter.frequency.value,
        pannerModel: 'HRTF', panner: v.acoustic?.apparent || null,
        acoustic: v.acoustic ? { ...v.acoustic } : null,
      })),
    };
  }
}

export default HotelAudio;
