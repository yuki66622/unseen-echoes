import test from 'node:test';
import assert from 'node:assert/strict';
import { HotelAudio, seamlessLoopBuffer } from '../../public/hotel/audio.mjs';

class Param {
  constructor(value = 0) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}
class Node {
  constructor() { this.connections = []; }
  connect(other) { this.connections.push(other); }
  disconnect() { this.connections = []; }
}
class Buffer {
  constructor(channels, length, sampleRate) { this.numberOfChannels = channels; this.length = length; this.sampleRate = sampleRate; this.duration = length / sampleRate; this.data = Array.from({ length: channels }, () => new Float32Array(length)); }
  getChannelData(channel) { return this.data[channel]; }
}
class Context {
  constructor() {
    this.sampleRate = 1000; this.currentTime = 0; this.state = 'suspended'; this.destination = new Node(); this.nodes = []; this.listener = {};
    for (const name of ['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ']) this.listener[name] = new Param();
  }
  track(node) { this.nodes.push(node); return node; }
  createGain() { return this.track(Object.assign(new Node(), { gain: new Param(1) })); }
  createConvolver() { return this.track(new Node()); }
  createBiquadFilter() { return this.track(Object.assign(new Node(), { frequency: new Param(), Q: new Param() })); }
  createPanner() { return this.track(Object.assign(new Node(), { positionX: new Param(), positionY: new Param(), positionZ: new Param() })); }
  createBufferSource() { return this.track(Object.assign(new Node(), { start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } })); }
  createBuffer(channels, length, sampleRate) { return new Buffer(channels, length, sampleRate); }
  async decodeAudioData() { return this.createBuffer(1, 2000, 1000); }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
}
const scene = () => ({ player: { x: 5, y: 5, floor: 0, heading: 0 }, doors: { entrance: 1, lounge: 1, recording: 1, linen: 1 }, stairs: null, phase: 'testimony', paused: false, sources: {} });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function makeAudio() {
  globalThis.AudioContext = Context;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  const audio = new HotelAudio({ silent: true });
  await audio.init({ assets: {
    bed: { url: 'bed.wav', kind: 'ambience', gainDb: -12 }, speech: { url: 'speech.wav', kind: 'speech' },
    evidence: { url: 'evidence.wav', kind: 'evidence' }, 'step-wood': { url: 'wood.wav', kind: 'effect' },
    'testimony-music': { url: 'a.wav', kind: 'music', gainDb: -20 }, 'investigation-music': { url: 'b.wav', kind: 'music', gainDb: -20 },
  }, ambience: [{ assetId: 'bed', sourceId: 'hotel-bed', kind: 'diffuse' }] });
  await audio.start(scene()); await tick(); return audio;
}

test('silent gate remains zero through start, movement, volume, pause, resume and restart', async () => {
  const audio = await makeAudio();
  audio.setVolume(1); audio.update(scene());
  assert.equal(audio.output.gain.value, 0);
  await audio.pause(); assert.equal(audio.getStats().paused, true);
  await audio.resume(scene()); assert.equal(audio.output.gain.value, 0);
  audio.stop(); await audio.start(scene()); await tick();
  assert.equal(audio.output.gain.value, 0);
  assert.equal(audio.getStats().finalOutputGain, 0);
  assert.equal(audio.context.nodes.filter(node => node.connections.includes(audio.context.destination)).length, 1);
  audio.stop();
});

test('environment and both music loops keep identity and phase across room and phase changes', async () => {
  const audio = await makeAudio();
  const keys = audio.getStats().voices.map(v => v.key);
  audio.context.currentTime = 1.25;
  const changed = scene(); changed.player = { x: 3, y: 5, floor: 1, heading: Math.PI / 2 }; changed.phase = 'investigation';
  audio.update(changed);
  assert.deepEqual(audio.getStats().voices.map(v => v.key), keys);
  assert.equal(audio.getStats().loopStarts, 3);
  assert.ok(audio.getStats().voices.every(v => v.phaseSeconds > 0));
  const music = audio.getStats().voices.filter(v => v.kind === 'music');
  assert.equal(music.find(v => v.id === 'testimony-music').gain, 0);
  assert.ok(music.find(v => v.id === 'investigation-music').gain > 0);
  audio.stop();
});

test('speech and evidence duck beds; natural completion is true; cancellation is false', async () => {
  const audio = await makeAudio();
  const speech = audio.play('speech', { sourceId: 'martin', group: 'npc' }); await tick();
  assert.equal(audio.getStats().busGains.ambience, 0.3);
  const speechVoice = [...audio.voices.values()].find(v => v.id === 'speech'); speechVoice.source.onended();
  assert.equal(await speech, true); assert.equal(audio.getStats().busGains.ambience, 1);
  const evidence = audio.play('evidence', { sourceId: 'recorder', group: 'evidence' }); await tick();
  assert.equal(audio.getStats().busGains.ambience, 0.16);
  audio.stopGroup('evidence'); assert.equal(await evidence, false);
  assert.equal(audio.getStats().busGains.ambience, 1); audio.stop();
});

test('stop cancels pending decode/play without resurrecting nodes', async () => {
  const audio = await makeAudio();
  let release; audio.context.decodeAudioData = () => new Promise(resolve => { release = resolve; });
  const pending = audio.playBytes(new ArrayBuffer(4), { group: 'npc' });
  audio.stop(); release(new Buffer(1, 1000, 1000));
  assert.equal(await pending, false); assert.equal(audio.getStats().activeVoices, 0);
});

test('cancelling a group also cancels its pending dynamic speech', async () => {
  const audio = await makeAudio();
  let release; audio.context.decodeAudioData = () => new Promise(resolve => { release = resolve; });
  const pending = audio.playBytes(new Uint8Array([1, 2]), { group: 'npc' });
  audio.stopGroup('npc'); release(new Buffer(1, 1000, 1000));
  assert.equal(await pending, false);
  assert.ok(audio.getStats().voices.every(v => v.kind !== 'speech')); audio.stop();
});

test('microphone listening ducks smoothly without restarting loops or pausing world audio time', async () => {
  const audio = await makeAudio(), keys = audio.getStats().voices.map(v => v.key);
  audio.setListening(true);
  assert.equal(audio.getStats().busGains.ambience, 0.12);
  assert.equal(audio.getStats().busGains.music, 0.08);
  assert.equal(audio.context.state, 'running');
  audio.context.currentTime = 0.5; audio.update(scene());
  assert.deepEqual(audio.getStats().voices.map(v => v.key), keys);
  audio.setListening(false); assert.equal(audio.getStats().busGains.ambience, 1);
  assert.equal(audio.getStats().finalOutputGain, 0); audio.stop();
});

test('rapid footsteps have a bounded voice count and disconnect on stop', async () => {
  const audio = await makeAudio(), promises = [];
  for (let i = 0; i < 20; i++) promises.push(audio.play('step-wood', { group: 'steps', position: { x: 5, y: 4, floor: 0 } }));
  await tick();
  assert.equal(audio.getStats().voices.filter(v => v.id === 'step-wood').length, 2);
  assert.ok(audio.getStats().voices.filter(v => v.id === 'step-wood').every(v => v.acoustic === null));
  const nodes = [...audio.voices.values()].flatMap(v => [v.source, v.gain, v.filter, v.panner, v.direct, v.spatial, v.wet]);
  audio.stop(); assert.ok((await Promise.all(promises)).every(value => value === false));
  assert.ok(nodes.every(node => node.connections.length === 0)); assert.equal(audio.getStats().activeVoices, 0);
});

test('loop preparation produces an adjacent-sample wrap without modifying original PCM', () => {
  const context = new Context(), original = context.createBuffer(1, 1000, 1000), input = original.getChannelData(0);
  for (let i = 0; i < input.length; i++) input[i] = i / 1000;
  const result = seamlessLoopBuffer(context, original, 0.1), data = result.getChannelData(0);
  assert.equal(result.length, 900);
  assert.ok(Math.abs(data[0] - data.at(-1)) < 0.002);
  assert.equal(input[0], 0); assert.ok(input.at(-1) > 0.99);
});
