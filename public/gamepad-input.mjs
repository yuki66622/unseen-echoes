const ENTER_DEAD_ZONE = 0.25;
const RELEASE_DEAD_ZONE = 0.18;
const MAX_FRAME_GAP_MS = 1000;
const CONTROL_BUTTONS = [0, 1, 2, 9, 12, 13, 14, 15];
const noop = () => {};
const finiteAxis = value => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
const pressed = button => Boolean(button?.pressed || Number(button?.value) > 0.5);

/** Map a standard gamepad to existing, bounded game actions; owns no game or audio state. */
export function attachGamepad(options = {}) {
  const {
    isEnabled = () => false, canPause = isEnabled, canRepeat = () => true,
    onAction = noop, onStop = noop, onPause = noop, onStatus = noop,
    repeatMs = action => ['left', 'right'].includes(action) ? 250 : 500,
    window: hostWindow = globalThis.window, document: hostDocument = globalThis.document,
    navigator: hostNavigator = globalThis.navigator,
    requestFrame = hostWindow?.requestAnimationFrame?.bind(hostWindow),
    cancelFrame = hostWindow?.cancelAnimationFrame?.bind(hostWindow),
  } = options;
  let destroyed = false, frame = null, device = null, armed = false, owned = false;
  let activeAction = null, repeatAt = 0, lastTime = null, lastEnabled = null;
  let previousButtons = [], vertical = 0, horizontal = 0, lastStatus = '';
  let focused = hostDocument?.hasFocus ? hostDocument.hasFocus() : true;
  const listeners = [];

  function stopOwned(force = false) {
    const shouldStop = owned || force;
    owned = false; activeAction = null; repeatAt = 0;
    if (shouldStop) onStop();
  }
  function reset() {
    if (destroyed) return;
    stopOwned(); armed = false; vertical = 0; horizontal = 0;
  }
  function report(state, pad = null) {
    const status = {
      state, id: pad?.id || '', mapping: pad?.mapping || '',
      axes: Array.from(pad?.axes || [], finiteAxis),
      buttons: Array.from(pad?.buttons || [], button => {
        const value = Number(button?.value);
        return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : Number(pressed(button));
      }),
    };
    const key = JSON.stringify(status);
    if (key !== lastStatus) { lastStatus = key; onStatus(status); }
  }
  function listen(target, name, callback, capture = false) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, callback, capture);
    listeners.push(() => target.removeEventListener(name, callback, capture));
  }
  function axisIntent(value, previous) {
    const threshold = previous && Math.sign(value) === previous ? RELEASE_DEAD_ZONE : ENTER_DEAD_ZONE;
    return Math.abs(value) >= threshold ? Math.sign(value) : 0;
  }
  function centered(pad, buttons) {
    return Array.from(pad.axes || []).slice(0, 4).every(axis => Math.abs(finiteAxis(axis)) < RELEASE_DEAD_ZONE)
      && CONTROL_BUTTONS.every(index => !buttons[index]);
  }
  function choosePad(pads) {
    const available = Array.from(pads || []).filter(pad => pad && pad.connected !== false);
    const current = available.find(pad => device && pad.index === device.index && pad.id === device.id && pad.mapping === device.mapping);
    return current?.mapping === 'standard' ? current : available.find(pad => pad.mapping === 'standard') || current || available[0] || null;
  }
  function poll(time) {
    if (destroyed) return;
    frame = requestFrame(poll);
    let pad;
    try { pad = choosePad(hostNavigator.getGamepads()); }
    catch { reset(); device = null; lastTime = null; report('unsupported'); return; }
    if (!pad) {
      reset(); device = null; previousButtons = []; lastTime = null; lastEnabled = null;
      report('waiting'); return;
    }
    const changed = !device || pad.index !== device.index || pad.id !== device.id || pad.mapping !== device.mapping;
    if (changed) {
      reset(); device = { index: pad.index, id: pad.id, mapping: pad.mapping };
      previousButtons = []; lastTime = null; lastEnabled = null;
    }
    if (pad.mapping !== 'standard') { reset(); report('unsupported', pad); return; }
    const buttons = Array.from({ length: 17 }, (_, index) => pressed(pad.buttons?.[index]));
    const rising = index => buttons[index] && !previousButtons[index];
    const visible = focused && !hostDocument?.hidden;
    const enabled = visible && Boolean(isEnabled());
    if (lastEnabled !== null && lastEnabled !== enabled) reset();
    lastEnabled = enabled;
    if (!Number.isFinite(time) || (lastTime !== null && (time < lastTime || time - lastTime > MAX_FRAME_GAP_MS))) reset();
    const tick = Number.isFinite(time) ? time : 0;
    lastTime = tick;

    if (!visible) {
      reset(); previousButtons = buttons; report('paused', pad); return;
    }
    if (!armed && centered(pad, buttons)) armed = true;
    if (!armed) {
      previousButtons = buttons; report(enabled ? 'neutral' : 'paused', pad); return;
    }
    if (rising(9) && canPause()) {
      reset(); onPause(); previousButtons = buttons; report('neutral', pad); return;
    }
    if (!enabled) {
      stopOwned(); previousButtons = buttons; report('paused', pad); return;
    }
    if (rising(1)) {
      stopOwned(true); armed = false; vertical = 0; horizontal = 0;
      previousButtons = buttons; report('neutral', pad); return;
    }
    if (rising(0) || rising(2)) {
      stopOwned(); onAction(rising(0) ? 'interact' : 'door');
    }
    // Holding a command button must not consume another interaction attempt or
    // resume a held walking stick underneath the action it just performed.
    if (CONTROL_BUTTONS.slice(0, 4).some(index => buttons[index])) {
      stopOwned(); previousButtons = buttons; report('ready', pad); return;
    }
    vertical = axisIntent(finiteAxis(pad.axes?.[1]), vertical);
    horizontal = axisIntent(finiteAxis(pad.axes?.[2]), horizontal);
    const turn = buttons[14] !== buttons[15] ? (buttons[15] ? 1 : -1) : horizontal;
    const walk = buttons[12] !== buttons[13] ? (buttons[13] ? 1 : -1) : vertical;
    const action = turn ? (turn > 0 ? 'right' : 'left') : walk ? (walk > 0 ? 'back' : 'forward') : null;
    if (!action) stopOwned();
    else {
      if (activeAction && action !== activeAction) stopOwned();
      if ((!activeAction || tick >= repeatAt) && canRepeat(action)) {
        onAction(action); owned = true; activeAction = action;
        const interval = Number(repeatMs(action));
        repeatAt = tick + (Number.isFinite(interval) && interval > 0 ? interval : ['left', 'right'].includes(action) ? 250 : 500);
      }
    }
    previousButtons = buttons; report('ready', pad);
  }

  listen(hostWindow, 'blur', () => { focused = false; reset(); });
  listen(hostWindow, 'focus', () => { focused = true; reset(); });
  listen(hostDocument, 'visibilitychange', reset);
  listen(hostDocument, 'keydown', reset, true);
  listen(hostWindow, 'gamepadconnected', event => {
    if (!device || event.gamepad?.index === device.index) reset();
  });
  listen(hostWindow, 'gamepaddisconnected', event => {
    if (device && event.gamepad?.index === device.index) {
      reset(); device = null; previousButtons = []; report('waiting');
    }
  });
  listen(hostWindow, 'pagehide', reset);
  if (typeof hostNavigator?.getGamepads !== 'function' || typeof requestFrame !== 'function') report('unsupported');
  else { report('waiting'); frame = requestFrame(poll); }
  return {
    reset,
    destroy() {
      if (destroyed) return;
      reset(); destroyed = true;
      if (frame !== null && typeof cancelFrame === 'function') cancelFrame(frame);
      frame = null;
      for (const remove of listeners) remove();
    },
  };
}
