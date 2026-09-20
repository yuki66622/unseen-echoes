import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as world from '../../public/hotel/world.mjs';
import {NavigationHint,navigationGoal,relativeDirection} from '../../public/hotel/navigation-hint.mjs';
import {planAssistance} from '../../public/hotel/navigation-assist.mjs';

// Run the actual application and world against explicit DOM, audio and provider
// boundaries. This checks orchestration without opening a browser or microphone,
// producing sound, or making any paid/external request.
const source = readFileSync(new URL('../../public/hotel/app.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const fixture = JSON.parse(readFileSync(new URL('../../public/hotel/data.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../../public/hotel/index.html', import.meta.url), 'utf8');
const initiallyHidden = new Set([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)].filter(match => /\bhidden\b/.test(match[0])).map(match => match[1]));
const textOf = element => [element?.textContent || element?.text || '', ...(element?.children || []).map(textOf)].filter(Boolean).join(' ');

function harness({ speechSeconds = 0 } = {}) {
  const elements = new Map(), frames = [], listeners = new Map(), played = [], pendingAudio = new Set(), requests = [];
  const canvasContext = new Proxy({}, { get: () => () => {} });
  const makeElement = (id = Symbol()) => {
    if (elements.has(id)) return elements.get(id);
    const element = {
      id, hidden: initiallyHidden.has(id), disabled: false, checked: false, value: id === 'volume' ? '0.35' : '', dataset: {},
      children: [], attributes: {}, textContent: '', style: {}, parentElement: null,
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener() {}, dispatchEvent() {}, blur() {}, closest() { return null; }, setPointerCapture() {},
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); },
      get firstElementChild() { return this.children[0]; },
      getContext() { return canvasContext; },
    };
    elements.set(id, element);
    return element;
  };
  const document = {
    hidden: false, getElementById: makeElement, createElement: () => makeElement(), createTextNode: text => ({ text }),
    querySelectorAll: () => [],
    addEventListener(name, callback) { const callbacks = listeners.get(name) || []; callbacks.push(callback); listeners.set(name, callbacks); },
  };
  let running = false, audioPaused = false, stops = 0;
  function endAudio(item, natural) { pendingAudio.delete(item); item.resolve(natural); }
  class AudioBoundary {
    async init() {}
    async start() { running = true; audioPaused = false; }
    setVolume() {} getStats() { return { running, silent: true, finalOutputGain: 0 }; }
    update() {} setListening() {}
    stopGroup(group) { for (const item of [...pendingAudio]) if (item.group === group) endAudio(item, false); }
    stop() { running = false; stops++; for (const item of [...pendingAudio]) endAudio(item, false); }
    pause() { audioPaused = true; }
    resume() { audioPaused = false; }
    async play(id, options = {}) {
      assert.ok(id === 'door-cue' || fixture.catalog.assets[id], `Unknown runtime audio asset: ${id}`);
      played.push({ id, ...options });
      const duration = ['speech', 'evidence'].includes(options.kind) ? speechSeconds : 0;
      if (!duration) return true;
      return new Promise(resolve => pendingAudio.add({ group: options.group, remaining: duration, resolve }));
    }
    async playBytes(bytes, options = {}) {
      played.push({ id: 'dynamic-speech', ...options });
      return new Promise(resolve => pendingAudio.add({ group: options.group, remaining: 2, resolve }));
    }
  }
  class VoiceBoundary {
    constructor() { this.state = 'idle'; this.status = { csrfToken: 'explicit-test-token' }; }
    async init() { return { configured: true }; }
    cancel() {} destroy() {} async sendText() { return true; } async start() {} async stop() {}
  }
  const fetchBoundary = async (url, options = {}) => {
    if (url === '/hotel/data.json') return { ok: true, json: async () => fixture };
    assert.equal(url, '/api/hotel/speak', 'No unexpected external requests are permitted');
    return new Promise((resolve, reject) => {
      const request = {
        signal: options.signal,
        resolve() { resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }); },
      };
      requests.push(request);
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })), { once: true });
    });
  };
  const context = vm.createContext({
    ...world, NavigationHint,navigationGoal,relativeDirection,planAssistance,TrailMap:class{update(){}reset(){}}, HotelAudio: AudioBoundary, VoiceInput: VoiceBoundary, URLSearchParams, location: { search: '?silent=1&debug=1' },
    document, window: { addEventListener() {} }, requestAnimationFrame: fn => frames.push(fn),
    fetch: fetchBoundary, CustomEvent: class {}, AbortController, setTimeout, clearTimeout, console,
  });
  vm.runInContext(source + `
    globalThis.testApi = {
      begin, restart, pause, playPassing, receiveReply, stopSpeech, navigate,
      interactionTarget, renderWorldHud,updateNavigationHint, startAssistance, stopAssistance, renderContext, talkTo, followup, replayMemory, selectRole,
      route: returning => qaWalk(returning),
      get state() { return state; },
      get status() { return {started, role, foreground, passingComplete, routeBusy, recordingHeard, collected:[...collected],searchAttempts,assistance}; }
    };`, context, { filename: 'hotel/app.mjs' });
  let now = 0;
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const api = context.testApi;
  return {
    api, played, requests, elements, document, get stops() { return stops; },
    place(pose) { world.cancelMotion(api.state); Object.assign(api.state.player, pose); api.renderContext(); api.renderWorldHud(); },
    async begin() { await api.begin(); await flush(); },
    async tick(count = 1) {
      for (let n = 0; n < count; n++) {
        now += 50;
        if (running && !audioPaused) for (const item of [...pendingAudio]) {
          item.remaining -= 0.05;
          if (item.remaining <= 0) endAudio(item, true);
        }
        for (const callback of frames.splice(0)) callback(now);
        await flush();
      }
    },
    async complete(promise, maximumFrames = 15000) {
      let settled = false, failure;
      promise.then(() => { settled = true; }, error => { settled = true; failure = error; });
      for (let n = 0; n < maximumFrames && !settled; n++) await this.tick();
      assert.ok(settled, 'Asynchronous application task must settle');
      if (failure) throw failure;
    },
    key(key, { typing = false, repeat = false } = {}) {
      const target = typing ? { closest: () => makeElement('message') } : makeElement('keyboard-target');
      for (const callback of listeners.get('keydown') || []) callback({ key, repeat, target, preventDefault() {} });
    },
    background() { document.hidden = true; for (const callback of listeners.get('visibilitychange') || []) callback(); },
    flush,
  };
}

const reply = (actions = [], extra = {}) => ({ text: 'A test request', reply: 'Understood.', speechText: '', role: 'guide', clipId: '', verdict: 'none', actions, ...extra });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('upstairs plays the dedicated clip once, without layered wood steps, and pause freezes ascent', async () => {
  const h=harness();await h.begin();h.place({x:16,y:8.05,floor:0,heading:0});
  h.key('ArrowUp');await h.tick(10);assert.equal(h.api.state.stairs?.to,1);
  const playedAt=h.played.length,progress=h.api.state.stairs.progress;
  h.api.pause();await h.tick(80);assert.equal(h.api.state.stairs.progress,progress);
  h.api.pause();await h.tick(70);assert.equal(h.api.state.player.floor,1);
  assert.equal(h.api.state.stairs,null);
  const clips=h.played.filter(p=>p.id==='stairs-up');assert.equal(clips.length,1);
  assert.equal(clips[0].local,true);assert.equal(clips[0].group,'stairs');
  assert.ok(h.played.slice(playedAt).every(p=>p.id!=='step-wood'));
});

test('real app route collects all witnesses with long dialogue, recorder, and returns downstairs', async () => {
  const h = harness({ speechSeconds: 8 });
  assert.equal(h.played.length, 0, 'No audio starts before entry');
  await h.begin();
  await h.complete(h.api.route(false));
  assert.equal(h.api.state.player.floor, 1);
  assert.equal(h.api.status.recordingHeard, true);
  for (const id of ['MARTIN-INITIAL', 'CLAIRE-INITIAL', 'ELENA-INITIAL', 'DLG-06', 'DLG-03-EN-R4']) assert.ok(h.api.status.collected.includes(id), `${id} was collected`);
  assert.equal(h.api.state.phase, 'investigation');
  assert.equal(h.elements.get('floor-label').textContent, 'Upper floor');
  await h.complete(h.api.route(true));
  assert.equal(h.api.state.player.floor, 0);
  close(h.api.state.player.x, 16);
  close(h.api.state.player.y, 7.1);
  close(h.api.state.player.heading, Math.PI);
  assert.equal(h.elements.get('facing').textContent, 'Facing South · 180°');
  assert.equal(h.elements.get('floor-label').textContent, 'Ground floor');
});

test('replaying a passing conversation preserves both sources without a position jump', async () => {
  const h = harness();
  await h.begin();
  await h.complete(h.api.playPassing());
  await h.tick(400);
  const before = Object.fromEntries(['claire', 'elena'].map(id => [id, { ...h.api.state.sources[id] }]));
  await h.complete(h.api.playPassing(true));
  await h.tick();
  for (const id of ['claire', 'elena']) {
    close(h.api.state.sources[id].x, before[id].x);
    close(h.api.state.sources[id].y, before[id].y);
  }
  assert.ok(Math.abs(before.claire.x - before.elena.x) > 2, 'Both final witness positions remain separately reachable');
});

test('a permitted 180-degree speech action completes the full continuous turn', async () => {
  const h = harness();
  await h.begin();
  const result = h.api.receiveReply(reply([{ type: 'turn', amount: 180 }]));
  await h.tick(2);
  assert.ok(h.api.state.player.heading > 0 && h.api.state.player.heading < Math.PI);
  await h.complete(result);
  close(h.api.state.player.heading, Math.PI);
});

test('restart cancels a route during an awaited turn and cannot move the new player', async () => {
  const h = harness();
  await h.begin();
  const route = h.api.route(false);
  for (let n = 0; n < 3000 && h.api.state.motion?.type !== 'turn'; n++) await h.tick();
  assert.equal(h.api.state.motion?.type, 'turn', 'Regression covers cancellation inside a pending turn');
  await h.api.restart();
  await h.complete(route);
  await h.tick(100);
  close(h.api.state.player.x, 5);
  close(h.api.state.player.y, -1.6);
  assert.equal(h.api.state.motion, null);
  assert.equal(h.api.status.routeBusy, false);
  assert.equal(h.api.status.collected.length, 0);
});

test('background pauses physical state and cancels automatic routing', async () => {
  const h = harness();
  await h.begin();
  const route = h.api.route(false);
  await h.tick(12);
  h.background();
  const player = JSON.stringify(h.api.state.player);
  const doors = JSON.stringify(h.api.state.doors);
  await h.complete(route);
  await h.tick(100);
  assert.equal(h.api.state.paused, true);
  assert.equal(JSON.stringify(h.api.state.player), player);
  assert.equal(JSON.stringify(h.api.state.doors), doors);
  assert.equal(h.api.status.routeBusy, false);
});

test('ending hides chat, rejects exploration inputs, stops sound, and supports restart', async () => {
  const h = harness();
  await h.begin();
  await h.complete(h.api.route(false));
  await h.complete(h.api.route(true));
  assert.equal(world.nearestInteraction(h.api.state)?.id, 'elena');
  await h.complete(h.api.receiveReply(reply([], { verdict: 'correct', reply: 'The witnesses honestly mistook an animal sound for language.' })));
  const player = JSON.stringify(h.api.state.player), count = h.played.length;
  assert.equal(h.api.state.phase, 'ending');
  h.api.renderWorldHud();
  assert.equal(h.elements.get('chat').hidden, true);
  assert.equal(h.elements.get('ending').hidden, false);
  assert.equal(h.elements.get('interaction-prompt').hidden, true);
  assert.equal(h.elements.get('orientation').hidden, true);
  assert.equal(h.api.interactionTarget(), null);
  h.key('e'); h.key('ArrowUp'); h.key('ArrowRight');
  await h.tick(30);
  assert.equal(JSON.stringify(h.api.state.player), player);
  assert.equal(h.played.length, count, 'The nearby witness cannot restart speech after ending');
  assert.equal(h.elements.get('send').disabled, true);
  assert.ok(h.stops >= 1, 'End stinger completion stops remaining ambience');
  await h.api.restart();
  assert.equal(h.api.state.phase, 'testimony');
  assert.equal(h.elements.get('chat').hidden, false);
  assert.equal(h.elements.get('ending').hidden, true);
  assert.equal(h.api.status.recordingHeard, false);
});

test('ending also prevents operating a reachable door', async () => {
  const h = harness();
  await h.begin();
  await h.complete(h.api.route(false));
  await h.complete(h.api.navigate([[3, 6.8]]));
  assert.equal(world.nearestDoor(h.api.state)?.id, 'recording');
  await h.complete(h.api.receiveReply(reply([], { verdict: 'correct' })));
  h.key('e');
  await h.tick(30);
  assert.equal(h.api.state.doorTargets.recording, 0);
  assert.equal(h.api.state.doors.recording, 0);
});

test('cancelling pending TTS releases foreground and permits another reply', async () => {
  const h = harness();
  await h.begin();
  h.elements.get('spoken-replies').checked = true;
  await h.api.receiveReply(reply([], { speechText: 'A pending spoken answer.' }));
  assert.equal(h.requests.length, 1);
  assert.equal(h.api.status.foreground, true);
  h.key('ArrowUp');
  await h.flush();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.api.status.foreground, false);
  await h.api.receiveReply(reply([], { speechText: 'A second answer.' }));
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve();
  await h.flush();
  assert.equal(h.api.status.foreground, true);
  h.elements.get('spoken-replies').checked = false;
  h.elements.get('spoken-replies').onchange();
  await h.flush();
  assert.equal(h.api.status.foreground, false, 'Stopping active TTS also releases foreground');
});

test('central E prompt opens the indicated door, without a chat door button or typing side effects', async () => {
  const h = harness();
  await h.begin();
  h.key('ArrowUp');
  await h.tick(12);
  assert.equal(h.api.interactionTarget()?.id, 'entrance');
  assert.equal(h.elements.get('interaction-prompt').hidden, false);
  assert.equal(h.elements.get('interaction-label').textContent, 'Open entrance');
  assert.equal(h.elements.get('interaction-bearing').textContent, 'Ahead');
  assert.equal(h.elements.get('chat').dataset.worldPrompt, 'true');
  assert.equal(h.elements.get('context-actions').children.length, 0, 'Door controls moved out of chat');
  h.key('e', { typing: true });
  h.key('ArrowUp', { typing: true });
  assert.equal(h.api.state.doorTargets.entrance, 0);
  assert.equal(h.api.state.motionQueue.length, 0);
  h.key('e');
  h.api.renderWorldHud();
  assert.equal(h.api.state.doorTargets.entrance, 1);
  assert.equal(h.elements.get('interaction-label').textContent, 'Close entrance', 'Prompt reflects the requested door state during its ramp');
  h.key('e', { repeat: true });
  assert.equal(h.api.state.doorTargets.entrance, 1, 'Held E does not repeatedly toggle a door');
  await h.tick(20);
  assert.equal(h.api.state.doors.entrance, 1);
  h.key('e');
  await h.tick(20);
  assert.equal(h.api.state.doors.entrance, 0);
  assert.equal(h.elements.get('interaction-label').textContent, 'Open entrance');
});

test('facing chooses between the overlapping linen door and cleaner, and the prompt matches E', async () => {
  const h = harness();
  await h.begin();
  h.place({ x: 12.9, y: 8.8, floor: 1, heading: Math.PI });
  assert.equal(world.nearestDoor(h.api.state)?.id, 'linen');
  assert.equal(world.nearestInteraction(h.api.state)?.id, 'cleaner');
  assert.equal(h.api.interactionTarget()?.id, 'linen');
  assert.equal(h.elements.get('interaction-label').textContent, 'Close linen room door');
  assert.equal(h.elements.get('interaction-bearing').textContent, 'Ahead');
  assert.ok(!h.elements.get('context-actions').children.some(item => /^(Open|Close) /.test(textOf(item))));
  h.key('e');
  assert.equal(h.api.state.doorTargets.linen, 0);
  await h.tick(20);
  h.place({ heading: Math.PI * 1.75 });
  assert.equal(h.api.interactionTarget()?.id, 'cleaner');
  assert.equal(h.elements.get('interaction-label').textContent, 'Talk to Hotel cleaner');
  h.key('e');
  await h.flush();
  assert.ok(h.played.some(item => item.id === 'DLG-06'));
  assert.equal(h.api.status.role, 'cleaner');
  assert.equal(h.elements.get('speaker-title').textContent, 'Hotel cleaner');
  assert.equal(h.api.state.doorTargets.linen, 0, 'Selecting the cleaner does not toggle the nearby door');
});

test('pausing hides E and rejects interaction; notes and controls hide the world prompt', async () => {
  const h = harness();
  await h.begin();
  h.place({ x: 5, y: -1.1, floor: 0, heading: 0 });
  assert.equal(h.elements.get('interaction-prompt').hidden, false);
  h.api.pause();
  h.api.renderWorldHud();
  assert.equal(h.elements.get('interaction-prompt').hidden, true);
  assert.equal(h.api.interactionTarget(), null);
  h.key('e');
  await h.tick(10);
  assert.equal(h.api.state.doorTargets.entrance, 0);
  h.api.pause();
  h.api.renderWorldHud();
  assert.equal(h.elements.get('interaction-prompt').hidden, false);
  for (const [toggle, panel] of [['notes-toggle', 'notes'], ['settings-toggle', 'settings']]) {
    h.elements.get(toggle).onclick();
    h.api.renderWorldHud();
    assert.equal(h.elements.get(panel).hidden, false);
    assert.equal(h.elements.get('interaction-prompt').hidden, true);
    assert.equal(h.elements.get('chat').dataset.worldPrompt, 'false');
    h.elements.get(toggle).onclick();
    h.api.renderWorldHud();
    assert.equal(h.elements.get('interaction-prompt').hidden, false);
  }
});

test('compass follows smooth turns, uses North at angular wrap, and does not change while typing', async () => {
  const h = harness();
  await h.begin();
  h.api.renderWorldHud();
  assert.equal(h.elements.get('facing').textContent, 'Facing North · 000°');
  for (let n = 0; n < 3; n++) { h.key('ArrowRight'); await h.tick(10); }
  assert.equal(h.elements.get('facing').textContent, 'Facing East · 090°');
  assert.equal(h.elements.get('compass-arrow').style.transform, 'rotate(90deg)');
  h.key('ArrowLeft', { typing: true });
  await h.tick(10);
  assert.equal(h.elements.get('facing').textContent, 'Facing East · 090°');
  h.place({ heading: 359 * Math.PI / 180 });
  assert.equal(h.elements.get('facing').textContent, 'Facing North · 359°');
  assert.equal(world.queueTurn(h.api.state, 2), true);
  const degrees = [359];
  for (let n = 0; n < 8; n++) {
    await h.tick();
    degrees.push(Number(h.elements.get('compass-arrow').style.transform.match(/rotate\((.*?)deg\)/)[1]));
  }
  assert.equal(h.elements.get('facing').textContent, 'Facing North · 001°');
  assert.ok(degrees.some(value => value < 2));
  for (let n = 1; n < degrees.length; n++) {
    const delta = ((degrees[n] - degrees[n - 1] + 540) % 360) - 180;
    assert.ok(delta >= -1e-6 && delta <= 2, `Compass must track the shortest physical turn (${delta})`);
  }
});

test('stairs hide and disable interaction while compass continuously reaches the correct landing headings', async () => {
  const h = harness();
  await h.begin();
  h.place({ x: 16, y: 7.9, floor: 0, heading: 0 });
  world.queueMove(h.api.state, 0.5);
  for (let n = 0; n < 20 && !h.api.state.stairs; n++) await h.tick();
  assert.ok(h.api.state.stairs);
  assert.equal(h.api.state.player.floor, 0);
  assert.equal(h.elements.get('floor-label').textContent, 'Going upstairs');
  assert.equal(h.elements.get('interaction-prompt').hidden, true);
  assert.equal(h.api.interactionTarget(), null);
  const targets = JSON.stringify(h.api.state.doorTargets), heard = h.played.length;
  h.key('e');
  await h.flush();
  assert.equal(JSON.stringify(h.api.state.doorTargets), targets);
  assert.equal(h.played.length, heard);
  await h.tick(70);
  assert.equal(h.api.state.player.floor, 1);
  assert.equal(h.api.state.stairs, null);
  assert.equal(h.elements.get('facing').textContent, 'Facing West · 270°');
  assert.equal(h.elements.get('floor-label').textContent, 'Upper floor');
  world.queueTurn(h.api.state, 90);
  world.queueTurn(h.api.state, 90);
  await h.tick(20);
  world.queueMove(h.api.state, 1);
  world.queueMove(h.api.state, 0.5);
  for (let n = 0; n < 40 && !h.api.state.stairs; n++) await h.tick();
  assert.ok(h.api.state.stairs);
  assert.equal(h.elements.get('floor-label').textContent, 'Going downstairs');
  assert.equal(h.elements.get('interaction-prompt').hidden, true);
  await h.tick(70);
  assert.equal(h.api.state.player.floor, 0);
  assert.equal(h.elements.get('facing').textContent, 'Facing South · 180°');
  assert.equal(h.elements.get('floor-label').textContent, 'Ground floor');
});

test('character identities remain in conversation, nearby labels and notes without duplicate interaction buttons', async () => {
  const h = harness();
  await h.begin();
  await h.complete(h.api.route(false));
  const labels = h.elements.get('chat-log').children.map(item => item.children[0]?.textContent);
  for (const identity of ['Martin · Receptionist', 'Claire · Witness', 'Elena · Witness', 'Hotel cleaner']) assert.ok(labels.includes(identity), `${identity} identifies recorded speech`);
  assert.ok(!labels.some(value => ['Martin', 'Claire', 'Elena', 'cleaner'].includes(value)), 'Character speaker labels include their identity');
  const notes = textOf(h.elements.get('note-list'));
  for (const identity of ['Martin · Receptionist:', 'Claire · Witness:', 'Elena · Witness:', 'Hotel cleaner:']) assert.ok(notes.includes(identity), `${identity} identifies a collected note`);
  await h.complete(h.api.route(true));
  h.api.renderContext();
  assert.ok(!textOf(h.elements.get('context-actions')).includes('Talk to Elena'));
  h.api.renderWorldHud();
  assert.ok(h.elements.get('interaction-label').textContent.includes('Elena · Witness'));
  await h.complete(h.api.talkTo('elena'));
  assert.equal(h.elements.get('speaker-title').textContent, 'Elena · Witness');
  await h.api.receiveReply(reply([], { role: 'elena', reply: 'I remember the sound.' }));
  assert.equal(h.elements.get('chat-log').children.at(-1).children[0].textContent, 'Elena · Witness');
  await h.complete(h.api.followup('ELENA-FRENCH-R2'));
  assert.ok(textOf(h.elements.get('note-list')).includes('Elena · Witness: A little.'));
  await h.complete(h.api.replayMemory('MARTIN-INITIAL'));
  assert.equal(h.elements.get('chat-log').children.at(-1).children[0].textContent, 'Recalled · Martin · Receptionist');
});


test('all accepted E searches spend the five-attempt allowance and restart restores it',async()=>{
 const h=harness();await h.begin();
 h.key('e');await h.tick();assert.equal(h.api.status.searchAttempts,1);
 h.place({x:5,y:-1.1,floor:0,heading:0});h.key('e');await h.tick(20);
 assert.equal(h.api.status.searchAttempts,2);assert.equal(h.api.state.doors.entrance,1);
 h.place({x:4,y:7.5,floor:0,heading:0});h.key('e');await h.tick();
 assert.equal(h.api.status.searchAttempts,3);assert.ok(h.api.status.collected.includes('MARTIN-INITIAL'));
 h.place({x:8,y:1,floor:0,heading:0});for(let i=0;i<2;i++){h.key('e');await h.tick();}
 assert.equal(h.api.status.searchAttempts,5);assert.equal(h.api.state.phase,'ending');
 assert.equal(h.elements.get('ending-status').textContent,'SEARCH ENDED');
 assert.ok(!h.elements.get('ending-text').textContent.includes('ape'));
 h.key('e');assert.equal(h.api.status.searchAttempts,5);
 await h.api.restart();assert.equal(h.api.status.searchAttempts,0);
});


test('a live relative cue changes from ahead to left and behind as the player turns', async () => {
  const h = harness(); await h.begin(); await h.tick(202);
  assert.equal(h.elements.get('direction-hint').hidden, false);
  assert.equal(h.elements.get('hint-text').textContent, 'Sound: ahead');
  h.place({heading:Math.PI/2}); h.api.updateNavigationHint(0);
  assert.equal(h.elements.get('hint-text').textContent, 'Sound: to your left');
  h.place({heading:Math.PI}); h.api.updateNavigationHint(0);
  assert.equal(h.elements.get('hint-text').textContent, 'Sound: behind you');
});

test('thirty lost seconds trigger a smooth short assist that stops before a closed door', async () => {
  const h = harness(); await h.begin(); await h.tick(600);
  assert.equal(h.api.status.assistance, null);
  await h.tick(2); assert.ok(h.api.status.assistance);
  assert.equal(h.elements.get('assist-status').hidden, false);
  const start={...h.api.state.player}; await h.tick(20);
  assert.ok(h.api.state.player.y>=start.y && h.api.state.player.y<-.99);
  await h.tick(100);
  assert.equal(h.api.status.assistance, null);
  assert.ok(h.api.state.player.y>start.y && h.api.state.player.y<0);
  assert.equal(h.api.state.doors.entrance,0,'Assistance does not operate the door');
  assert.equal(h.api.status.searchAttempts,0);
  assert.equal(h.api.status.collected.length,0);
  assert.equal(h.requests.length,0,'Movement never requires a provider request');
});

test('assistance moves at most two metres and hands control back, without collecting evidence', async () => {
  const h = harness(); await h.begin(); h.place({x:5,y:3,floor:0,heading:Math.PI}); await h.tick(2);
  const start={...h.api.state.player};
  h.api.startAssistance(navigationGoal(h.api.state,new Set(),false));
  await h.tick(20); assert.ok(h.api.status.assistance,'Warm-up is followed by continuous rotation');
  let walked=0,last={...h.api.state.player};
  for(let i=0;i<200 && h.api.status.assistance;i++){
    await h.tick(); const p=h.api.state.player; walked+=Math.hypot(p.x-last.x,p.y-last.y);last={...p};
  }
  assert.equal(h.api.status.assistance,null);
  const moved=Math.hypot(last.x-start.x,last.y-start.y);
  assert.ok(moved>1.9 && moved<=2.00001);
  assert.ok(walked<=2.00001);
  assert.equal(h.api.status.collected.length,0);
});

test('manual movement, Escape, typing, notes, pause and restart immediately cancel assistance', async () => {
  for(const kind of ['move','escape','typing','notes','pause','restart']){
    const h=harness(); await h.begin(); h.place({x:5,y:3,floor:0,heading:0}); await h.tick(2);
    h.api.startAssistance(navigationGoal(h.api.state,new Set(),false)); await h.tick(23);
    assert.ok(h.api.status.assistance,kind);
    if(kind==='move')h.key('ArrowDown');
    if(kind==='escape')h.key('Escape');
    if(kind==='typing'){h.document.activeElement={tagName:'TEXTAREA'};await h.tick();}
    if(kind==='notes')h.elements.get('notes-toggle').onclick();
    if(kind==='pause')h.api.pause();
    if(kind==='restart')await h.api.restart();
    assert.equal(h.api.status.assistance,null,kind);
    const p={...h.api.state.player}; await h.tick(25);
    if(kind==='move')assert.ok(Math.hypot(h.api.state.player.x-p.x,h.api.state.player.y-p.y)>.1);
    else{close(h.api.state.player.x,p.x);close(h.api.state.player.y,p.y);}
  }
});

test('reading and ongoing testimony do not accumulate lost time or start assistance', async () => {
  const h=harness({speechSeconds:40}); await h.begin();
  h.elements.get('notes-toggle').onclick(); await h.tick(800); assert.equal(h.api.status.assistance,null);
  h.elements.get('notes-toggle').onclick(); h.place({x:4,y:7,floor:0,heading:0});
  const talk=h.api.talkTo('martin'); await h.tick(650);
  assert.equal(h.api.status.foreground,true); assert.equal(h.api.status.assistance,null);
  await h.complete(talk); assert.equal(h.api.status.assistance,null);
});

test('the fifth successful recording finishes and a sixth E cannot interrupt it or add an attempt',async()=>{
 const h=harness({speechSeconds:4});await h.begin();
 h.key('e');await h.tick();
 for(const id of ['martin','claire','elena']){
   h.place({...h.api.state.sources[id],heading:0});h.key('e');await h.tick(100);
 }
 for(const id of ['MARTIN-INITIAL','CLAIRE-INITIAL','ELENA-INITIAL'])assert.ok(h.api.status.collected.includes(id));
 h.place({x:3,y:3.6,floor:1,heading:0});h.key('e');await h.tick();
 assert.equal(h.api.status.searchAttempts,5);assert.notEqual(h.api.state.phase,'ending');
 assert.equal(h.api.status.foreground,true);
 const stops=h.stops;h.key('e');await h.tick();
 assert.equal(h.api.status.searchAttempts,5);assert.equal(h.stops,stops);
 await h.tick(200);assert.equal(h.api.status.recordingHeard,true);
 assert.notEqual(h.api.state.phase,'ending');
 await h.api.receiveReply(reply([], {verdict:'correct'}));assert.equal(h.api.state.phase,'ending');
});

test('typing, held keys, pause and F do not consume the hotel E allowance',async()=>{
 const h=harness();await h.begin();
 h.key('e',{typing:true});h.key('e',{repeat:true});h.api.pause();h.key('e');h.api.pause();
 h.place({x:5,y:-1.1,floor:0,heading:0});h.key('f');await h.tick(20);
 assert.equal(h.api.status.searchAttempts,0);assert.equal(h.api.state.doors.entrance,1);
});
