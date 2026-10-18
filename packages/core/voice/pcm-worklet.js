/** Separate from the UI thread so rendering cannot interrupt PCM playback. */
export const PCM_PLAYER_WORKLET = `
class LaresPcmPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.queue = []; this.offset = 0; this.frames = 0; this.reported = 0;
    this.rate = options.processorOptions.inputRate; this.step = this.rate / sampleRate;
    this.paused = false; this.queued = 0; this.finished = false; this.started = false; this.starved = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'audio') {
        if (this.queued + data.samples.length > this.rate * 4) { this.port.postMessage({ type: 'error' }); return; }
        this.queue.push(data.samples); this.queued += data.samples.length;
      } else if (data.type === 'finish') this.finished = true;
      else if (data.type === 'pause') this.paused = true;
      else if (data.type === 'resume') this.paused = false;
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    out.fill(0);
    if (this.paused) return true;
    for (let i = 0; i < out.length; i++) {
      while (this.queue.length && this.offset >= this.queue[0].length) {
        const head = this.queue.shift(); this.offset -= head.length; this.queued -= head.length;
        this.frames += head.length;
      }
      const head = this.queue[0];
      if (!head) {
        if (this.finished) { this.port.postMessage({ type: 'progress', frames: this.frames }); this.port.postMessage({ type: 'done' }); return false; }
        if (this.started && !this.starved) this.port.postMessage({ type: 'underrun' });
        this.starved = true; continue;
      }
      const at = Math.floor(this.offset), fraction = this.offset - at;
      // Interpolate across transport blocks; never clamp an unfinished block's edge.
      let next = head[at + 1];
      if (next === undefined) next = this.queue[1]?.[0];
      if (fraction > 0 && next === undefined && !this.finished) {
        if (this.started && !this.starved) this.port.postMessage({ type: 'underrun' });
        this.starved = true; break;
      }
      if (!this.started) { this.started = true; this.port.postMessage({ type: 'started' }); }
      this.starved = false;
      out[i] = head[at] * (1 - fraction) + (next ?? head[at]) * fraction;
      this.offset += this.step;
    }
    const played = this.frames + Math.min(this.queue[0]?.length || 0, Math.floor(this.offset));
    if (played - this.reported >= this.rate * 0.05) { this.reported = played; this.port.postMessage({ type: 'progress', frames: played }); }
    return true;
  }
}
registerProcessor('lares-pcm-player', LaresPcmPlayer);
`;

export const PCM_CAPTURE_WORKLET = `
class LaresPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.pending = new Float32Array(1024); this.length = 0;
    this.port.onmessage = ({ data }) => { if (data.type === 'flush') { this.flush(); this.port.postMessage({ type: 'flushed' }); } };
  }
  flush() {
    if (!this.length) return;
    const samples = this.pending.slice(0, this.length); this.length = 0;
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) for (const value of input) { this.pending[this.length++] = value; if (this.length === this.pending.length) this.flush(); }
    return true;
  }
}
registerProcessor('lares-pcm-capture', LaresPcmCapture);
`;
