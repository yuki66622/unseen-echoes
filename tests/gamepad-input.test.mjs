import test from 'node:test';
import assert from 'node:assert/strict';
import { attachGamepad } from '../public/gamepad-input.mjs';

function target() {
  const listeners = new Map();
  return {
    addEventListener(name, fn, capture) {
      const entries = listeners.get(name) || [];
      entries.push({ fn, capture }); listeners.set(name, entries);
    },
    removeEventListener(name, fn, capture) {
      listeners.set(name, (listeners.get(name) || []).filter(entry => entry.fn !== fn || entry.capture !== capture));
    },
    emit(name, event = {}) { for (const entry of [...(listeners.get(name) || [])]) entry.fn(event); },
    get listenerCount() { return [...listeners.values()].reduce((count, entries) => count + entries.length, 0); },
    captures(name) { return (listeners.get(name) || []).map(entry => entry.capture); },
  };
}
function gamepad({ id = 'Xbox Wireless Controller', index = 0, mapping = 'standard' } = {}) {
  return { id, index, mapping, connected: true, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
}
function harness(extra = {}) {
  const window = target(), document = Object.assign(target(), { hidden: false, hasFocus: () => true });
  const pad = gamepad(), frames = new Map(), actions = [], statuses = [];
  let pads = [pad], time = 0, nextId = 0, stops = 0, pauses = 0, enabled = true, repeatAllowed = true, pauseAllowed = true;
  const input = attachGamepad({ window, document, navigator: { getGamepads: () => pads },
    requestFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; },
    cancelFrame(id) { frames.delete(id); },
    isEnabled: () => enabled, canPause: () => pauseAllowed, canRepeat: () => repeatAllowed,
    onAction: action => actions.push({ action, time }), onStop: () => stops++,
    onPause: () => { pauses++; enabled = !enabled; }, onStatus: status => statuses.push(status), ...extra,
  });
  return {
    input, pad, window, document, actions, statuses,
    get stops() { return stops; }, get pauses() { return pauses; }, get pending() { return frames.size; },
    get status() { return statuses.at(-1); },
    set enabled(value) { enabled = value; }, set repeatAllowed(value) { repeatAllowed = value; },
    set pauseAllowed(value) { pauseAllowed = value; }, set pads(value) { pads = value; },
    tick(delta = 16) {
      time += delta; const callbacks = [...frames.values()]; frames.clear();
      for (const fn of callbacks) fn(time);
    },
    press(index, value = true) { pad.buttons[index] = { pressed: value, value: value ? 1 : 0 }; },
    center() { pad.axes.fill(0); for (const button of pad.buttons) { button.pressed = false; button.value = 0; } },
  };
}

test('module can attach without DOM or Gamepad API and dispose repeatedly', () => {
  const statuses = [];
  const input = attachGamepad({ window: null, document: null, navigator: null, onStatus: state => statuses.push(state) });
  assert.equal(statuses.at(-1).state, 'unsupported');
  input.reset(); input.destroy(); input.destroy();
});

test('a held stick on first connection must return to center before taking control', () => {
  const h = harness(); h.pad.axes[1] = -1; h.tick();
  assert.equal(h.status.state, 'neutral'); assert.equal(h.actions.length, 0);
  h.tick(500); assert.equal(h.actions.length, 0);
  h.center(); h.tick(); assert.equal(h.status.state, 'ready');
  h.pad.axes[1] = -1; h.tick(); assert.equal(h.actions[0].action, 'forward');
});

test('holds repeat bounded steps at 500ms, turns at 250ms, and never catch up with a burst', () => {
  const h = harness(); h.tick(); h.pad.axes[1] = -1; h.tick();
  h.tick(499); assert.equal(h.actions.length, 1);
  h.tick(1); assert.equal(h.actions.length, 2);
  h.tick(900); assert.equal(h.actions.length, 3);
  h.pad.axes[2] = 1; h.tick(); assert.equal(h.actions.at(-1).action, 'right');
  const count = h.actions.length; h.tick(249); assert.equal(h.actions.length, count);
  h.tick(1); assert.equal(h.actions.length, count + 1);
  assert.equal(h.stops, 1);
});

test('turning takes priority over walking and D-pad works without analog sticks', () => {
  const h = harness(); h.tick(); h.pad.axes[1] = -1; h.pad.axes[2] = -1; h.tick();
  assert.equal(h.actions.at(-1).action, 'left');
  h.center(); h.tick(); h.press(13); h.tick(); assert.equal(h.actions.at(-1).action, 'back');
  h.press(15); h.tick(); assert.equal(h.actions.at(-1).action, 'right');
  h.press(14); h.tick(); assert.equal(h.actions.at(-1).action, 'back', 'opposite D-pad turns cancel');
});

test('dead zone and hysteresis reject drift without repeatedly stopping a held intent', () => {
  const h = harness(); h.tick(); h.pad.axes[1] = -0.24; h.tick(); assert.equal(h.actions.length, 0);
  h.pad.axes[1] = -0.3; h.tick(); assert.equal(h.actions.length, 1);
  h.pad.axes[1] = -0.2; h.tick(500); assert.equal(h.actions.length, 2); assert.equal(h.stops, 0);
  h.pad.axes[1] = -0.17; h.tick(); assert.equal(h.stops, 1);
  h.tick(500); assert.equal(h.stops, 1);
  h.pad.axes[1] = -0.2; h.tick(); assert.equal(h.actions.length, 2, 'drift cannot restart motion');
});

test('busy guards prevent queue buildup; chapters can choose their actual repeat interval', () => {
  const h = harness({ repeatMs: () => 320 }); h.tick();
  h.repeatAllowed = false; h.pad.axes[1] = -1; h.tick(); assert.equal(h.actions.length, 0);
  h.repeatAllowed = true; h.tick(); assert.equal(h.actions.length, 1);
  h.tick(319); assert.equal(h.actions.length, 1); h.tick(1); assert.equal(h.actions.length, 2);
  h.repeatAllowed = false; h.tick(500); h.tick(500); assert.equal(h.actions.length, 2);
  h.repeatAllowed = true; h.tick(); assert.equal(h.actions.length, 3);
});

test('held A consumes only one of five interaction attempts; X also fires once per press', () => {
  let attempts = 5;
  const h = harness({ onAction: action => { if (action === 'interact') attempts--; } }); h.tick();
  h.press(0); for (let i = 0; i < 100; i++) h.tick(50);
  assert.equal(attempts, 4);
  h.press(0, false); h.tick(); h.press(0); h.tick(); assert.equal(attempts, 3);
  const doors = harness(); doors.tick(); doors.press(2); doors.tick(); doors.tick(500); doors.tick(500);
  assert.deepEqual(doors.actions.map(item => item.action), ['door']);
});

test('buttons held during connection cannot interact until released and pressed again', () => {
  const h = harness(); h.press(0); h.tick(); h.tick(500); assert.equal(h.actions.length, 0);
  h.press(0, false); h.tick(); h.press(0); h.tick(); assert.equal(h.actions[0].action, 'interact');
});

test('B stops immediately and blocks held sticks until every control is neutral', () => {
  const h = harness(); h.tick(); h.pad.axes[1] = -1; h.tick(); h.press(1); h.tick();
  assert.equal(h.stops, 1); assert.equal(h.status.state, 'neutral');
  h.press(1, false); h.tick(500); assert.equal(h.actions.length, 1);
  h.center(); h.tick(); h.pad.axes[1] = -1; h.tick(); assert.equal(h.actions.length, 2);
});

test('a command button stops owned walking and never resumes a stick underneath the held button', () => {
  const h = harness(); h.tick(); h.pad.axes[1] = -1; h.tick(); h.press(0); h.tick();
  assert.equal(h.stops, 1); assert.equal(h.actions.at(-1).action, 'interact');
  h.tick(500); h.tick(500); assert.equal(h.actions.length, 2);
});

test('Menu can pause and resume while gameplay is disabled, but cannot repeat or bypass text gates', () => {
  const h = harness(); h.tick(); h.pad.axes[1] = -1; h.tick(); h.press(9); h.tick();
  assert.equal(h.pauses, 1); assert.equal(h.stops, 1);
  h.tick(500); assert.equal(h.pauses, 1);
  h.center(); h.tick(); assert.equal(h.status.state, 'paused');
  h.press(9); h.tick(); assert.equal(h.pauses, 2);
  h.center(); h.tick(); h.pauseAllowed = false; h.enabled = false; h.tick();
  h.press(9); h.tick(); assert.equal(h.pauses, 2);
  h.pad.axes[1] = -1; h.tick(); assert.equal(h.actions.length, 1);
});

test('disabling gameplay stops owned movement and restoring it requires neutral controls', () => {
  const h = harness(); h.tick(); h.pad.axes[1] = -1; h.tick(); h.enabled = false; h.tick();
  assert.equal(h.stops, 1); assert.equal(h.status.state, 'paused');
  h.enabled = true; h.tick(); assert.equal(h.status.state, 'neutral'); assert.equal(h.actions.length, 1);
  h.center(); h.tick(); h.pad.axes[1] = -1; h.tick(); assert.equal(h.actions.length, 2);
});

test('blur, visibility changes, and stalled frames stop and require neutral on return', () => {
  for (const failure of ['blur', 'hidden', 'gap']) {
    const h = harness(); h.tick(); h.pad.axes[1] = -1; h.tick();
    if (failure === 'blur') { h.window.emit('blur'); h.tick(); h.window.emit('focus'); }
    else if (failure === 'hidden') {
      h.document.hidden = true; h.document.emit('visibilitychange'); h.tick();
      h.document.hidden = false; h.document.emit('visibilitychange');
    } else h.tick(1500);
    h.tick(); assert.equal(h.stops, 1, failure); assert.equal(h.actions.length, 1, failure);
    h.center(); h.tick(); h.pad.axes[1] = -1; h.tick(); assert.equal(h.actions.length, 2, failure);
  }
});

test('keyboard capture gives control back once without stopping subsequent keyboard motion', () => {
  const h = harness(); h.tick(); h.pad.axes[1] = -1; h.tick();
  assert.deepEqual(h.document.captures('keydown'), [true]);
  h.document.emit('keydown'); assert.equal(h.stops, 1);
  h.tick(500); h.document.emit('keydown'); h.tick(); assert.equal(h.stops, 1);
  assert.equal(h.actions.length, 1); h.center(); h.tick();
  h.document.emit('keydown'); h.tick(); assert.equal(h.stops, 1);
});

test('disconnect and device replacement stop immediately and never inherit held input', () => {
  const h = harness(); h.tick(); h.pad.axes[1] = -1; h.tick();
  h.window.emit('gamepaddisconnected', { gamepad: h.pad }); h.pads = [];
  assert.equal(h.stops, 1); h.tick(); assert.equal(h.status.state, 'waiting');
  const replacement = gamepad({ id: 'Second Xbox' }); replacement.axes[2] = 1; h.pads = [replacement]; h.tick();
  assert.equal(h.status.state, 'neutral'); assert.equal(h.actions.length, 1);
  replacement.axes[2] = 0; h.tick(); replacement.axes[2] = 1; h.tick();
  assert.equal(h.actions.at(-1).action, 'right');
  const third = gamepad({ id: 'Third Xbox' }); third.axes[1] = -1; h.pads = [third]; h.tick();
  assert.equal(h.stops, 2); assert.equal(h.status.state, 'neutral');
});

test('nonstandard mapping is reported but never guessed; a standard controller is preferred', () => {
  const h = harness(); const unknown = gamepad({ mapping: '', id: 'Unknown' });
  unknown.axes[1] = -1; h.pads = [unknown]; h.tick(); h.tick(500);
  assert.equal(h.status.state, 'unsupported'); assert.equal(h.actions.length, 0);
  h.pads = [unknown, h.pad]; h.tick(); assert.equal(h.status.state, 'ready');
  assert.equal(h.status.id, h.pad.id);
});

test('missing axes and buttons are neutral, and status snapshots are independent values', () => {
  const h = harness(); h.pad.axes = []; h.pad.buttons = []; h.tick();
  assert.equal(h.status.state, 'ready'); assert.equal(h.actions.length, 0);
  const status = h.status; h.pad.axes.push(-1); assert.deepEqual(status.axes, []);
  h.tick(); assert.deepEqual(h.status.axes, [-1]); assert.equal(h.actions.length, 0);
});

test('Gamepad API failures are contained and clearing them requires a safe reacquisition', () => {
  let fail = false; const pad = gamepad();
  const h = harness({ navigator: { getGamepads() { if (fail) throw Error('blocked'); return [pad]; } } });
  h.tick(); pad.axes[1] = -1; h.tick(); fail = true; h.tick();
  assert.equal(h.stops, 1); assert.equal(h.status.state, 'unsupported');
  fail = false; h.tick(); assert.equal(h.status.state, 'neutral'); assert.equal(h.actions.length, 1);
});

test('destroy cancels owned motion, RAF and every event listener exactly once', () => {
  const h = harness(); h.tick(); h.pad.axes[1] = -1; h.tick(); assert.equal(h.pending, 1);
  assert.ok(h.window.listenerCount > 0); assert.ok(h.document.listenerCount > 0);
  h.input.destroy(); h.input.destroy();
  assert.equal(h.stops, 1); assert.equal(h.pending, 0);
  assert.equal(h.window.listenerCount, 0); assert.equal(h.document.listenerCount, 0);
  h.tick(1000); assert.equal(h.actions.length, 1);
});
