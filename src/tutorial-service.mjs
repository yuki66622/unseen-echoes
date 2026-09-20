import { DEFAULT_MODEL, KINDS, SCHEMA, SYSTEM } from './tutorial-contract.mjs';

export const MAX_PROVIDER_BYTES = 128 * 1024;
export const PROVIDER_TIMEOUT_MS = 20_000;
export const MAX_AUDIO_BYTES = 2_400_000;
const kinds = new Set(KINDS);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const length = value => [...value].length;
const number = value => typeof value === 'number' && Number.isFinite(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => own(value, key));

export class TutorialError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'TutorialError';
    this.status = status;
    this.code = code;
  }
}

const invalidInput = () => new TutorialError(400, 'invalid_input', '这次输入不完整或格式无效，请重试。');
const invalidAudio = () => new TutorialError(400, 'invalid_audio', '录音格式无效，请重新按住说话。');
const invalidResponse = () => new TutorialError(502, 'gemini_response', 'Gemini 没有返回可执行的完整结果，本次未执行，请再说一次。');
const timeoutError = () => new TutorialError(504, 'gemini_timeout', 'Gemini 回复超时，这句话未执行。可以重新发送。');
const networkError = () => new TutorialError(502, 'gemini_network', '暂时无法连接 Gemini，这句话未执行。可以重新发送。');

export function validatePlan(plan) {
  if (!exactKeys(plan, ['text', 'mode', 'message', 'actions'])) throw invalidResponse();
  if (typeof plan.text !== 'string' || length(plan.text) > 1000) throw invalidResponse();
  if (typeof plan.message !== 'string' || length(plan.message.trim()) < 1 || length(plan.message.trim()) > 400) throw invalidResponse();
  if (!['act', 'reply', 'clarify'].includes(plan.mode) || !Array.isArray(plan.actions)) throw invalidResponse();
  if (plan.actions.length > 4 || (plan.mode === 'act') !== (plan.actions.length > 0)) throw invalidResponse();
  let total = 0;
  for (const [index, action] of plan.actions.entries()) {
    if (!exactKeys(action, ['type', 'amount', 'state'])) throw invalidResponse();
    const { type, amount, state } = action;
    if (!kinds.has(type) || !number(amount)) throw invalidResponse();
    if (type === 'door') {
      if (amount !== 0 || !['open', 'close'].includes(state)) throw invalidResponse();
    } else if (state !== 'none') throw invalidResponse();
    if (type === 'move' || type === 'approachDoor') {
      if (Math.abs(amount) < 0.1 || Math.abs(amount) > 1 || (type === 'approachDoor' && amount < 0)) throw invalidResponse();
      total += Math.abs(amount);
    } else if (type === 'turn') {
      if (Math.abs(amount) < 1 || Math.abs(amount) > 180) throw invalidResponse();
    } else if (amount !== 0) throw invalidResponse();
    if ((type === 'pause' || type === 'stop') && index !== plan.actions.length - 1) throw invalidResponse();
  }
  if (total > 1.5 || (plan.actions.length > 0 && !plan.text.trim())) throw invalidResponse();
  return plan;
}

export function cleanContext(value) {
  if (!isObject(value)) throw invalidInput();
  const result = {};
  for (const key of ['inRoom', 'nearSound']) if (typeof value[key] === 'boolean') result[key] = value[key];
  if (Number.isInteger(value.checkedCount) && value.checkedCount >= 0 && value.checkedCount <= 3) result.checkedCount = value.checkedCount;
  for (const [section, fields] of Object.entries({ position: { x: [0, 8], y: [0, 8], heading: [0, 360] }, door: { distance: [0, 12], relativeBearing: [-180, 180] } })) {
    const source = own(value, section) ? value[section] : {};
    if (!isObject(source)) throw invalidInput();
    result[section] = {};
    for (const [key, [low, high]] of Object.entries(fields)) {
      if (number(source[key]) && source[key] >= low && source[key] <= high) result[section][key] = Math.round(source[key] * 1000) / 1000;
    }
  }
  for (const key of ['open', 'nearby']) if (typeof value.door?.[key] === 'boolean') result.door[key] = value.door[key];
  return result;
}

export function cleanHistory(value) {
  if (!Array.isArray(value) || value.length > 8) throw invalidInput();
  return value.map(item => {
    if (!isObject(item) || !['user', 'assistant'].includes(item.role) || typeof item.text !== 'string' || length(item.text) > 600) throw invalidInput();
    return { role: item.role, text: item.text };
  });
}

/** Validate decoded audio before any provider request. Metadata chunks are supported. */
export function validateWav(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength <= 44 || bytes.byteLength > MAX_AUDIO_BYTES) throw invalidAudio();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) !== bytes.byteLength - 8) throw invalidAudio();
  let offset = 12, format = null, dataLength = null;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw invalidAudio();
    const id = tag(offset), size = view.getUint32(offset + 4, true), start = offset + 8, end = start + size;
    if (end > bytes.byteLength) throw invalidAudio();
    if (id === 'fmt ') {
      if (format || size < 16) throw invalidAudio();
      const encoding = view.getUint16(start, true), channels = view.getUint16(start + 2, true);
      const rate = view.getUint32(start + 4, true), byteRate = view.getUint32(start + 8, true);
      const alignment = view.getUint16(start + 12, true), bits = view.getUint16(start + 14, true);
      if (encoding !== 1 || channels !== 1 || bits !== 16 || rate < 8000 || rate > 96000 || alignment !== 2 || byteRate !== rate * 2) throw invalidAudio();
      format = { rate };
    } else if (id === 'data') {
      if (!format || dataLength !== null || size % 2 !== 0) throw invalidAudio();
      dataLength = size;
    }
    offset = end + (size % 2);
    if (offset > bytes.byteLength) throw invalidAudio();
  }
  if (!format || dataLength === null) throw invalidAudio();
  const duration = dataLength / 2 / format.rate;
  if (duration < 0.2 || duration > 12.25) throw new TutorialError(400, 'duration', '请说一句不超过 12 秒的指令。');
  return duration;
}

export function decodeAudio(value) {
  // Strict padding/alphabet also rejects data URLs and whitespace before atob's
  // intentionally permissive decoding. Check length before allocating bytes.
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) throw invalidInput();
  const padding = value.indexOf('=');
  if (padding !== -1 && (padding < value.length - 2 || !/^={1,2}$/.test(value.slice(padding)))) throw invalidInput();
  let binary;
  try { binary = atob(value); } catch { throw invalidInput(); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  validateWav(bytes);
  return bytes;
}

async function boundedResponse(response, signal) {
  const claimed = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(claimed) && claimed > MAX_PROVIDER_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw invalidResponse();
  }
  if (!response.body?.getReader) throw invalidResponse();
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw timeoutError();
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PROVIDER_BYTES) { cancel(); throw invalidResponse(); }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  if (signal.aborted) throw timeoutError();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalidResponse(); }
}

function responsePlan(data) {
  if (!isObject(data) || !Array.isArray(data.candidates) || !data.candidates.length) throw invalidResponse();
  const candidate = data.candidates[0];
  if (!isObject(candidate) || candidate.finishReason !== 'STOP' || !Array.isArray(candidate.content?.parts)) throw invalidResponse();
  let output = '';
  for (const part of candidate.content.parts) {
    if (!isObject(part)) throw invalidResponse();
    if (part.thought) continue;
    if (own(part, 'text') && typeof part.text !== 'string') throw invalidResponse();
    output += part.text ?? '';
  }
  let plan;
  try { plan = JSON.parse(output); } catch { throw invalidResponse(); }
  return validatePlan(plan);
}

export async function tutorialReply(payload, env = {}, fetchImpl = fetch) {
  const key = typeof env.GEMINI_API_KEY === 'string' && env.GEMINI_API_KEY.trim() || typeof env.GOOGLE_API_KEY === 'string' && env.GOOGLE_API_KEY.trim();
  if (!key) throw new TutorialError(503, 'gemini_key_missing', '语音理解服务尚未配置，请稍后重新连接。');
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  if (typeof model !== 'string' || !/^gemini-[a-zA-Z0-9.-]{1,90}$/.test(model)) throw new TutorialError(503, 'gemini_model_invalid', '语音理解模型配置无效，请联系维护者。');
  if (!isObject(payload) || Object.keys(payload).some(name => !['audio', 'text', 'context', 'history'].includes(name)) || own(payload, 'audio') === own(payload, 'text')) throw invalidInput();
  const audio = own(payload, 'audio');
  if (audio) decodeAudio(payload.audio);
  else if (typeof payload.text !== 'string' || length(payload.text.trim()) < 1 || length(payload.text.trim()) > 600) throw invalidInput();
  const parts = [{ text: JSON.stringify({ context: cleanContext(payload.context ?? {}), history: cleanHistory(payload.history ?? []) }) }];
  if (audio) parts.push({ text: '请听这段玩家录音，理解意图并回应。' }, { inlineData: { mimeType: 'audio/wav', data: payload.audio } });
  else parts.push({ text: '玩家本轮输入：' + payload.text });
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1600, responseMimeType: 'application/json', responseJsonSchema: SCHEMA },
  };
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(timeoutError()); controller.abort(); }, PROVIDER_TIMEOUT_MS);
  });
  const request = (async () => {
    let response, data;
    try {
      response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body), signal: controller.signal, redirect: 'manual',
      });
      if (!response.ok || response.redirected) {
        void response.body?.cancel().catch(() => {});
        if ([401, 403].includes(response.status)) throw new TutorialError(502, 'gemini_auth', 'Gemini 密钥或访问权限不可用，请检查 AI Studio 配置。');
        if (response.status === 429) throw new TutorialError(429, 'gemini_limit', 'Gemini 额度或频率受限，本次未执行；请稍后重试。');
        throw new TutorialError(502, 'gemini_provider', 'Gemini 请求未完成，请检查模型和服务配置；本次未执行。');
      }
      data = await boundedResponse(response, controller.signal);
    } catch (error) {
      if (error instanceof TutorialError) throw error;
      throw controller.signal.aborted ? timeoutError() : networkError();
    }
    const plan = responsePlan(data);
    // Match GeminiGame: typed words are authoritative even if the model paraphrases.
    if (!audio) plan.text = payload.text;
    return { ...plan, provider: 'Gemini', model, requestId: crypto.randomUUID() };
  })();
  try { return await Promise.race([request, timeout]); }
  finally { clearTimeout(timer); }
}
