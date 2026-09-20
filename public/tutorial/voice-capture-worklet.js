/* Microphone processing only. Outputs are always zero: never a sidetone. */
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.maxFrames = Math.max(1, Math.min(Math.floor(sampleRate * 6), Math.floor(options.processorOptions?.maxFrames ?? sampleRate * 6)));
    this.chunk = new Float32Array(2048); this.filled = 0; this.frames = 0; this.done = false;
    this.port.onmessage = ({ data }) => { if (data.type === 'stop') this.finish('stop'); };
  }
  flush() {
    if (!this.filled) return;
    const samples = this.chunk.slice(0, this.filled);
    this.port.postMessage({ type: 'chunk', samples }, [samples.buffer]);
    this.filled = 0;
  }
  finish(reason) {
    if (this.done) return;
    this.done = true; this.flush(); this.port.postMessage({ type: 'complete', reason });
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.done) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length && this.frames < this.maxFrames; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      this.chunk[this.filled++] = value; this.frames++;
      if (this.filled === this.chunk.length) this.flush();
    }
    if (this.frames >= this.maxFrames) this.finish('limit');
    return !this.done;
  }
}
registerProcessor('voice-capture', VoiceCaptureProcessor);
