import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChaseAudio, ChaseStepTracker, CHASE_ASSETS, CHASE_MASTER_HEADROOM, CHASE_MIX, heartbeatLevel,
  CHASE_PEAK_LIMIT, HEARTBEAT_FADE_SECONDS, prepareChaseBuffer, makeFootstepSegment,
} from '../public/multiplayer/chase-audio.mjs';

const durations = { breathing:6, ending: 6.68, heartbeat: 10, background: 30, door: 4,
  'hunter-win': 4.16, footsteps: 3.88, motor: 30, rain: 20 };
const sources = [{ id: 'a', soundId: 'motor', x: 1.5, y: 4.8 },
  { id: 'b', soundId: 'rain', x: 7.6, y: 5.5 }, { id: 'c', soundId: 'fire', x: 2, y: 7 }];
const snapshot = (extra = {}) => ({ roundId: 'round-one', role: 'survivor',
  self: { x: 2, y: 1, heading: 0, moving: false }, sources, audiblePlayers: [],
  heartbeatIntensity: 0, doorOpen: false, doorEvent: { seq: 0, openedAtMs: 0, x: 7.6, y: 5.5 },
  outcome: null, winner: null, ...extra });

class Parameter {
  constructor(value = 0) { this.value = value; this.events = []; }
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
  setValueAtTime(value, when) { this.value = value; this.events.push({ type: 'set', value, when }); }
  linearRampToValueAtTime(value, when) { this.value = value; this.events.push({ type: 'ramp', value, when }); }
}
class Node {
  constructor() { this.connections = []; this.disconnected = false; }
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.connections = []; this.disconnected = true; }
}
class Context {
  constructor() { this.currentTime = 0; this.sampleRate = 1000; this.state = 'suspended'; this.destination = new Node(); this.sources = []; this.resumeCount = 0; }
  createGain() { return Object.assign(new Node(), { gain: new Parameter(1) }); }
  createWaveShaper() { return new Node(); }
  createPanner() { return Object.assign(new Node(), { positionX: new Parameter(), positionY: new Parameter(), positionZ: new Parameter() }); }
  createBuffer(channels, length, sampleRate) {
    const samples = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
      getChannelData: channel => samples[channel] };
  }
  createBufferSource() {
    const node = new Node(); node.start = time => { node.startedAt = time; };
    node.stop = () => { node.stopped = true; }; node.finish = () => node.onended?.();
    this.sources.push(node); return node;
  }
  async decodeAudioData(data) {
    const id = Object.keys(CHASE_ASSETS)[new Uint8Array(data)[0]];
    const buffer = this.createBuffer(2, Math.round(durations[id] * this.sampleRate), this.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] = (id === 'door' ? 0.04 : 0.8) * Math.sin(i * 0.17);
    }
    return buffer;
  }
  async resume() { this.resumeCount++; this.state = 'running'; }
}
function setup(t, { failedAsset = null, blocked = false } = {}) {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const storage = new Map(), requests = [], releases = [];
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true,
    value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  globalThis.fetch = async url => {
    const id = Object.keys(CHASE_ASSETS).find(id => String(url).endsWith(CHASE_ASSETS[id].path.split('/').at(-1)));
    assert.ok(id, `Unknown test asset: ${url}`); requests.push(id);
    if (blocked) await new Promise(resolve => releases.push(resolve));
    return { ok: id !== failedAsset, status: id === failedAsset ? 404 : 200,
      arrayBuffer: async () => new Uint8Array([Object.keys(CHASE_ASSETS).indexOf(id)]).buffer };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else delete globalThis.sessionStorage;
  });
  const make = (silent = true) => { const audio = new ChaseAudio({ silent }); audio.context = new Context(); return audio; };
  return { make, requests, releases, storage };
}

test('entry starts Epic background continuously below foreground cues, without the witch clip', async t=>{
  const {make}=setup(t);const audio=make();await audio.start(snapshot());const stats=audio.getStats();
  const bg=stats.voices.filter(v=>v.id==='background');assert.equal(bg.length,1);assert.equal(bg[0].loop,true);
  assert.equal(bg[0].durationSeconds,30);assert.equal(bg[0].gain,CHASE_MIX.background);
  assert.ok(CHASE_MIX.background<CHASE_MIX.ownStep&&CHASE_MIX.background<CHASE_MIX.heartbeat);
  assert.ok(!stats.voices.some(v=>['entry','ending','hunter-win'].includes(v.id)));assert.equal(stats.masterGain,0);
  audio.update(snapshot());assert.equal(audio.getStats().counters.background,1);audio.pause();
  assert.equal(audio.getStats().activeVoices,0);await audio.start(snapshot());
  assert.equal(audio.getStats().voices.filter(v=>v.id==='background').length,1);audio.pause();
});

test('all game outcomes play the witch recording once and stop the game background', async t=>{
  const {make}=setup(t);
  for(const outcome of ['captured','escaped','attempts_exhausted','disconnected']){
    for(const role of ['hunter','survivor']){
      const audio=make(),live=snapshot({roundId:outcome+'-'+role,role});await audio.start(live);
      const result={...live,outcome,winner:'hunter'};audio.update(result);assert.equal(await audio.finish(result),true);
      const s=audio.getStats();assert.equal(s.activeVoices,1);assert.equal(s.voices[0].id,'ending');assert.equal(s.voices[0].loop,false);
      assert.equal(s.voices[0].durationSeconds,6.68);assert.equal(s.counters.ending,1);assert.equal(await audio.finish(result),false);
      [...audio.voices][0].source.finish();assert.equal(audio.getStats().running,false);assert.equal(audio.getStats().masterGain,0);
      assert.equal(await make().finish(result),false);
    }
  }
});

test('heart distance contrast is expanded while silence, fade and role restrictions remain', async t=>{
  assert.equal(heartbeatLevel(1),1.2);assert.equal(heartbeatLevel(.5),.3);
  assert.ok(heartbeatLevel(1)/heartbeatLevel(.074)>150);
  assert.equal(heartbeatLevel(0),0);assert.equal(heartbeatLevel(NaN),0);
  const {make}=setup(t),audio=make();await audio.start(snapshot({role:'hunter',heartbeatIntensity:.5,heartbeatSource:{x:3,y:2}}));
  assert.equal(audio.getStats().heartbeatGain,.3);assert.equal(audio.heartbeatVoice.panner.rolloffFactor,0);
  audio.update(snapshot({role:'hunter',heartbeatIntensity:1}));assert.equal(audio.getStats().heartbeatGain,1.2);
  assert.equal(audio.heartbeatVoice.gain.gain.events.at(-1).when,HEARTBEAT_FADE_SECONDS);
  audio.update(snapshot({role:'hunter',heartbeatIntensity:0}));assert.equal(audio.getStats().heartbeatGain,0);audio.pause();
  const survivor=make();await survivor.start(snapshot({heartbeatIntensity:1}));assert.ok(!survivor.getStats().voices.some(v=>v.id==='heartbeat'));survivor.pause();
});

test('pause and suppressed results cannot restart music or ending sounds', async t=>{
  const {make,releases}=setup(t,{blocked:true}),audio=make();const loading=audio.start(snapshot());
  audio.pause();releases.forEach(release=>release());assert.equal(await loading,false);assert.equal(audio.getStats().activeVoices,0);
  await audio.start(snapshot());audio.pause();assert.equal(await audio.finish(snapshot({outcome:'captured'})),false);
  const other=audio;await other.start(snapshot({roundId:'suppressed'}));assert.equal(await other.finish(snapshot({roundId:'suppressed',outcome:'escaped'}),{playVictory:false}),false);
  assert.equal(other.getStats().activeVoices,0);
});


test('breathing plays once per twenty active round seconds and stops outside play',async t=>{
 const {make}=setup(t),audio=make();await audio.start(snapshot({remainingSeconds:180}));
 audio.update(snapshot({remainingSeconds:160.1}));assert.equal(audio.getStats().counters.breathing,0);
 audio.update(snapshot({remainingSeconds:160}));audio.update(snapshot({remainingSeconds:159}));assert.equal(audio.getStats().counters.breathing,1);
 audio.update(snapshot({remainingSeconds:140}));assert.equal(audio.getStats().counters.breathing,2);
 assert.equal(audio.getStats().voices.filter(v=>v.id==='breathing').length,1);
 audio.pause();audio.update(snapshot({remainingSeconds:120}));assert.equal(audio.getStats().counters.breathing,2);assert.equal(audio.getStats().activeVoices,0);
 await audio.start(snapshot({remainingSeconds:120}));assert.equal(audio.getStats().counters.breathing,2);
 audio.update(snapshot({remainingSeconds:100}));assert.equal(audio.getStats().counters.breathing,3);
 await audio.finish(snapshot({remainingSeconds:80,outcome:'captured',winner:'hunter'}));assert.ok(!audio.getStats().voices.some(v=>v.id==='breathing'));assert.equal(audio.getStats().masterGain,0);
});
