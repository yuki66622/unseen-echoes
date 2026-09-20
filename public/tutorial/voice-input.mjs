export const VOICE_INPUT_REVISION = 'gemini-chat-v1';
const MAX_SECONDS = 12;
const MAX_WAV_BYTES = 2_400_000;
const abortError = () => Object.assign(new Error('录音已取消。'), { name: 'AbortError' });
const stopTracks = stream => stream?.getTracks().forEach(track => track.stop());
const rmsLevel = samples => {
  if (!samples.length) return 0;
  let squares = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) return 0;
    squares += sample * sample;
  }
  return Math.min(1, Math.sqrt(squares / samples.length));
};

export function encodeWav(samples, sampleRate) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('不支持此录音采样率。');
  if (!samples?.length || samples.length > Math.floor(sampleRate * MAX_SECONDS)) throw new Error('录音必须在 12 秒以内且不能为空。');
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error('录音包含无效采样。');
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function requestJson(url, options, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 25_000);
  try {
    const response = await fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || '语音服务暂时不可用，请重试。');
    return data;
  } catch (error) {
    if (timedOut) throw new Error('语音请求超时，请重试。');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}

async function openBrowserCapture({ signal, maxSeconds, onLimit, onLevel = () => {} }) {
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw new Error('当前页面无法使用麦克风，请使用 localhost 或 HTTPS。');
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context || !globalThis.AudioWorkletNode) throw new Error('当前浏览器不支持所需的录音功能。');
  let context, stream, source, node, sink, timer, flushTimer;
  let closed = false, complete = false, finishing = false, captureError = null, finishPromise = null, finishResolve, finishReject;
  const chunks = []; let frames = 0;
  const close = () => {
    if (closed) return;
    closed = true; clearTimeout(timer); clearTimeout(flushTimer);
    signal.removeEventListener('abort', close);
    stopTracks(stream);
    source?.disconnect(); node?.disconnect(); sink?.disconnect();
    if (node) { node.port.onmessage = null; node.port.close(); }
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    finishReject?.(abortError());
  };
  signal.addEventListener('abort', close, { once: true });
  const join = () => {
    const samples = new Float32Array(frames); let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    return { samples, sampleRate: context.sampleRate };
  };
  const finish = () => {
    if (finishPromise) return finishPromise;
    finishing = true;
    // Release physical capture immediately, before waiting for the worklet's
    // final buffered samples. The processing graph has always emitted zeros.
    stopTracks(stream); source?.disconnect(); clearTimeout(timer);
    finishPromise = new Promise((resolve, reject) => {
      finishResolve = resolve; finishReject = reject;
      if (closed || signal.aborted) reject(abortError());
      else if (captureError) reject(captureError);
      else if (complete) resolve(join());
      else {
        flushTimer = setTimeout(() => reject(new Error('录音处理未及时完成，请重试。')), 500);
        node.port.postMessage({ type: 'stop' });
      }
    }).finally(close);
    return finishPromise;
  };
  try {
    if (signal.aborted) throw abortError();
    context = new Context({ latencyHint: 'interactive' });
    if (!context.audioWorklet || context.sampleRate < 8000 || context.sampleRate > 96000) throw new Error('浏览器录音格式不受支持。');
    // Resume is requested immediately, while start() is invoked from a gesture.
    // Capturing the rejection avoids an unhandled promise during permission UI.
    let resumeError;
    const resumed = context.resume().catch(error => { resumeError = error; });
    const permission = navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true
    }, video: false });
    // getUserMedia itself is not abortable. A late permission grant must never
    // leave a live track after cancel() has already returned.
    void permission.then(lateStream => { if (closed || signal.aborted) stopTracks(lateStream); }, () => {});
    stream = await abortable(permission, signal);
    let setupTimer;
    try {
      const setup = (async () => {
        await context.audioWorklet.addModule(new URL('./voice-capture-worklet.js?v=voice-v1', import.meta.url));
        await resumed;
      })();
      await abortable(Promise.race([setup, new Promise((_, reject) => {
        setupTimer = setTimeout(() => reject(new Error('录音未能启动，请松开后重试。')), 4000);
      })]), signal);
    } finally { clearTimeout(setupTimer); }
    if (resumeError) throw resumeError;
    if (closed || signal.aborted) throw abortError();
    const maxFrames = Math.floor(context.sampleRate * maxSeconds);
    node = new AudioWorkletNode(context, 'voice-capture', { numberOfInputs: 1, numberOfOutputs: 1,
      outputChannelCount: [1], processorOptions: { maxFrames } });
    node.port.onmessage = ({ data }) => {
      if (closed || signal.aborted || complete) return;
      if (data.type === 'chunk' && data.samples instanceof Float32Array) {
        const remaining = maxFrames - frames;
        if (remaining > 0) {
          const chunk = data.samples.subarray(0, remaining); chunks.push(chunk); frames += chunk.length;
          // Meter only the existing capture samples; buffered final chunks still
          // belong in the recording, but must not relight a released control.
          if (!finishing) onLevel(rmsLevel(chunk));
        }
      } else if (data.type === 'complete') {
        complete = true; clearTimeout(flushTimer);
        finishResolve?.(join());
        if (data.reason === 'limit') onLimit();
      }
    };
    node.onprocessorerror = () => { captureError = new Error('录音处理失败，请重试。'); finishReject?.(captureError); onLimit(); };
    source = context.createMediaStreamSource(stream); sink = context.createGain(); sink.gain.value = 0;
    source.connect(node); node.connect(sink); sink.connect(context.destination);
    timer = setTimeout(onLimit, maxSeconds * 1000);
    return { finish, close };
  } catch (error) { close(); throw error; }
}

const browserTransport = {
  getStatus: ({ signal }) => requestJson('/api/tutorial/status', { method: 'GET' }, signal),
  transcribe: (input, { signal, token, status, context }) => {
    if(status.understanding){
      let payload;
      if(input instanceof ArrayBuffer){
        const bytes=new Uint8Array(input),chunks=[];
        for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
        payload={audio:btoa(chunks.join(''))};
      }else payload={text:input.text};
      return requestJson('/api/tutorial/interpret',{method:'POST',headers:{'Content-Type':'application/json','X-Voice-Token':token},
        body:JSON.stringify({...payload,context:context.context??{},history:context.history??[]})},signal);
    }
    if(!(input instanceof ArrayBuffer))throw new Error('文字对话需要连接 Gemini。');
    return requestJson('/api/tutorial/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Voice-Token': token }, body: input
    }, signal);
  },
  openCapture: openBrowserCapture
};

export class VoiceInput {
  constructor({ onState = () => {}, onTranscript = () => {}, onLevel = () => {}, isAllowed = () => true, getContext = () => ({}), transport } = {}) {
    this.onState = onState; this.onTranscript = onTranscript; this.isAllowed = isAllowed;
    this.onLevel = onLevel;
    this.getContext = getContext;
    // Tests inject all boundaries explicitly. Production never substitutes a
    // simulated provider or browser SpeechRecognition on failure.
    this.transport = transport ?? browserTransport;
    this.state = 'idle'; this.message = '按住说话，松开识别。'; this.status = null;
    this.operation = 0; this.active = null; this.initPromise = null; this.statusController = null; this.destroyed = false;
    this._background = () => { if (this.active) this.cancel(); };
    this._visibility = () => { if (globalThis.document?.hidden) this._background(); };
    globalThis.addEventListener?.('blur', this._background);
    globalThis.addEventListener?.('pagehide', this._background);
    globalThis.document?.addEventListener('visibilitychange', this._visibility);
  }

  _state(state, message) {
    if (state !== 'recording') this._level(0);
    if (this.state === state && this.message === message) return;
    this.state = state; this.message = message; this.onState({ state, message });
  }
  _level(value) {
    const level = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    // A decorative subscriber must never interfere with capture or cleanup.
    try { this.onLevel(level); } catch {}
  }
  _allowed() { try { return !this.destroyed && Boolean(this.isAllowed()); } catch { return false; } }
  _current(operation) { return !this.destroyed && this.active === operation && !operation.controller.signal.aborted; }

  async init({ force = false } = {}) {
    if (this.destroyed) throw new Error('语音输入已关闭。');
    if (force) {
      this.statusController?.abort();
      this.statusController = null; this.initPromise = null; this.status = null;
    }
    if (this.status) return this.status;
    if (this.initPromise) return this.initPromise;
    const controller = new AbortController(); this.statusController = controller;
    const pending = (async () => {
      const status = await this.transport.getStatus({ signal: controller.signal });
      if (controller.signal.aborted || this.destroyed || this.statusController !== controller) throw abortError();
      if (typeof status?.configured !== 'boolean' || typeof status.csrfToken !== 'string'
        || (status.configured && !status.csrfToken)) throw new Error('语音服务状态无效。');
      const seconds = Number(status.maxSeconds);
      this.status = { ...status, maxSeconds: seconds > 0 ? Math.min(MAX_SECONDS, seconds) : MAX_SECONDS };
      if (!status.configured) this._state('unavailable', '语音服务尚未就绪，仍可使用键盘操作。');
      else if (!this.active) this._state('idle', '按住说话，松开识别。');
      return this.status;
    })();
    this.initPromise = pending;
    try { return await pending; }
    catch (error) { if (!controller.signal.aborted) this._state('error', this._errorMessage(error)); throw error; }
    finally {
      if (this.initPromise === pending) this.initPromise = null;
      if (this.statusController === controller) this.statusController = null;
    }
  }

  _begin(state, message) {
    if (this.active || !this._allowed()) return null;
    const operation = { id: ++this.operation, controller: new AbortController(), capture: null };
    this.active = operation; this._state(state, message); return operation;
  }

  async start() {
    const operation = this._begin('permission', '正在准备麦克风；松开可取消。');
    if (!operation || !this._current(operation)) return false;
    try {
      const status = await this.init();
      if (!this._current(operation)) return false;
      if (!status.configured) { this.active = null; return false; }
      const capture = await this.transport.openCapture({ signal: operation.controller.signal, maxSeconds: status.maxSeconds,
        onLimit: () => { if (this._current(operation)) void this.stop(); },
        onLevel: level => { if (this._current(operation) && this.state === 'recording') this._level(level); } });
      if (!this._current(operation) || !this._allowed()) { capture.close(); if (this._current(operation)) this.cancel(); return false; }
      operation.capture = capture;
      this._state('recording', status.local?`正在录音，松开后在本机识别（最长 ${status.maxSeconds} 秒）。`:`正在录音，松开后交给 ${status.provider||'语音服务'}（最长 ${status.maxSeconds} 秒）。`);
      return true;
    } catch (error) { return this._fail(operation, error); }
  }

  async stop() {
    const operation = this.active;
    if (!operation) return false;
    if (this.state === 'permission') { this.cancel(); return false; }
    if (this.state !== 'recording') return false;
    this._state('transcribing', '正在识别口令……');
    try {
      const { samples, sampleRate } = await operation.capture.finish();
      operation.capture = null;
      if (!this._current(operation)) return false;
      if (samples.length < sampleRate * 0.2) throw new Error('录音太短，请按住至少 0.2 秒后说出口令。');
      return await this._send(encodeWav(samples, sampleRate), operation);
    } catch (error) { return this._fail(operation, error); }
  }

  // Explicit fixture entry for the QA page, also using the real production
  // upload/cancellation/result path. The game never shows a file-upload control.
  async transcribeWav(wav) {
    const operation = this._begin('transcribing', '正在识别测试文件……');
    if (!operation) return false;
    try {
      let bytes = wav;
      if (typeof Blob !== 'undefined' && wav instanceof Blob) bytes = await wav.arrayBuffer();
      else if (ArrayBuffer.isView(wav)) bytes = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 44 || bytes.byteLength > MAX_WAV_BYTES) throw new Error('测试文件不是支持大小的 WAV。');
      return await this._send(bytes, operation);
    } catch (error) { return this._fail(operation, error); }
  }

  async _send(wav, operation) {
    if (!this._current(operation)) return false;
    const status = await this.init();
    if (!this._current(operation)) return false;
    if (!status.configured) { this.active = null; return false; }
    if (!this._allowed()) { this.cancel(); return false; }
    const began=performance.now();
    if(status.understanding)this._state('transcribing','Gemini 正在理解这句话…');
    const result = await this.transport.transcribe(wav, { signal: operation.controller.signal, token: status.csrfToken,
      status, context:this.getContext() });
    const recognitionMs=performance.now()-began;
    if (!this._current(operation)) return false;
    if (!this._allowed()) { this.cancel(); return false; }
    if (typeof result?.text !== 'string' || (!result.text.trim()&&!['reply','clarify'].includes(result.mode))) throw new Error('没有识别到清晰内容，请再试一次。');
    this.active = null; this._state('idle', '按住说话，松开识别。');
    this.onTranscript({...result,recognitionMs});
    return true;
  }

  async sendText(text){
    if(typeof text!=='string'||!text.trim()||text.length>600)return false;
    const operation=this._begin('transcribing','正在理解…');
    if(!operation)return false;
    try{return await this._send({text:text.trim()},operation);}
    catch(error){return this._fail(operation,error);}
  }

  _errorMessage(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return '麦克风权限未开启；可在浏览器设置中允许后重试。';
    if (error?.name === 'NotFoundError') return '未找到麦克风，仍可使用键盘操作。';
    if (error?.name === 'NotReadableError') return '麦克风暂时不可用，请检查是否被其他应用占用。';
    return error?.message || '语音输入失败，请重试。';
  }
  _fail(operation, error) {
    if (!this._current(operation)) return false;
    operation.controller.abort(); operation.capture?.close(); this.active = null;
    this._state('error', this._errorMessage(error)); return false;
  }

  cancel() {
    this.operation++;
    const operation = this.active; this.active = null;
    operation?.controller.abort(); operation?.capture?.close();
    this.statusController?.abort(); this.statusController = null; this.initPromise = null;
    if (!this.destroyed) this._state(this.status?.configured === false ? 'unavailable' : 'idle',
      this.status?.configured === false ? '语音服务尚未就绪，仍可使用键盘操作。' : '按住说话，松开识别。');
  }

  destroy() {
    this.cancel(); this.destroyed = true;
    globalThis.removeEventListener?.('blur', this._background);
    globalThis.removeEventListener?.('pagehide', this._background);
    globalThis.document?.removeEventListener('visibilitychange', this._visibility);
  }
}
