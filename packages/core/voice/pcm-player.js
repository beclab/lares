import { PCM_PLAYER_WORKLET } from "./pcm-worklet.js";
import { pcmSamples } from "./realtime-audio.js";

let primed = null;
const worklets = new WeakMap();

function ensureWorklet(ctx) {
  const pending = worklets.get(ctx);
  if (pending) return pending;
  const url = URL.createObjectURL(new Blob([PCM_PLAYER_WORKLET], { type: "text/javascript" }));
  let tracked;
  tracked = Promise.resolve(ctx.audioWorklet.addModule(url)).finally(() => URL.revokeObjectURL(url)).catch((error) => {
    if (worklets.get(ctx) === tracked) worklets.delete(ctx);
    throw error;
  });
  worklets.set(ctx, tracked);
  return tracked;
}

/** Create and resume the playback context inside the gesture that asked for sound. */
export function primePlaybackContext(Context = globalThis.AudioContext || globalThis.webkitAudioContext) {
  if (!Context) return null;
  if (!primed || primed.state === "closed") primed = new Context();
  const resume = primed.resume?.();
  if (resume && typeof resume.catch === "function") resume.catch(() => {});
  ensureWorklet(primed).catch(() => {});
  return primed;
}

export function createPcmStreamPlayer({ onProgress = () => {}, onMetric = () => {}, context: Context = globalThis.AudioContext || globalThis.webkitAudioContext } = {}) {
  let context, node, resolve, reject, played = 0, generation = 0, pendingByte = null, failed = null, paused = false, owned = false;
  const stop = () => {
    generation++; paused = false; node?.disconnect(); if (node) node.port.onmessage = null; node = null;
    const closing = owned ? context : null;
    owned = false;
    if (closing && closing.state !== "closed") void closing.close().catch(() => {});
    context = null; resolve?.(); resolve = reject = null; pendingByte = null;
  };
  return {
    async start({ sampleRate, channels, encoding }) {
      stop(); failed = null; played = 0;
      if (!Context || channels !== 1 || encoding !== "pcm_s16le" || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("voice_audio_format");
      const epoch = generation;
      const shared = primed && primed.state !== "closed" ? primed : null;
      owned = !shared;
      context = shared || new Context(); const opened = context;
      try {
        await ensureWorklet(opened);
        await opened.resume?.();
        if (epoch !== generation) throw new Error("voice_cancelled");
        if (opened.state && opened.state !== "running") throw new Error("voice_playback_failed");
        onMetric({ stage: "playback_context", state: opened.state || "unknown", shared: Boolean(shared) });
      } catch (error) {
        onMetric({ stage: "playback_context", state: opened.state || "missing", shared: Boolean(shared), code: error?.message || "voice_playback_failed" });
        if (owned && opened.state !== "closed") void opened.close?.().catch(() => {});
        owned = false; context = null;
        throw error;
      }
      node = new AudioWorkletNode(opened, "lares-pcm-player", {
        processorOptions: { inputRate: sampleRate, outputRate: opened.sampleRate || sampleRate, preroll: Math.round(sampleRate * 0.2) },
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      });
      node.port.onmessage = ({ data }) => {
        if (epoch !== generation) return;
        if (data.type === "progress") { played = data.frames; onProgress(played); }
        if (data.type === "started" || data.type === "underrun") onMetric({ stage: `playback_${data.type}` });
        if (data.type === "done") { resolve?.(); resolve = reject = null; }
        if (data.type === "error") { failed = new Error("voice_audio_backpressure"); reject?.(failed); }
      };
      node.connect(opened.destination);
    },
    write(bytes) {
      if (!node) throw new Error("voice_cancelled");
      let chunk = bytes;
      if (pendingByte !== null) { chunk = new Uint8Array(bytes.length + 1); chunk[0] = pendingByte; chunk.set(bytes, 1); pendingByte = null; }
      if (chunk.length % 2) { pendingByte = chunk[chunk.length - 1]; chunk = chunk.subarray(0, -1); }
      if (!chunk.length) return;
      const samples = pcmSamples(chunk);
      node.port.postMessage({ type: "audio", samples }, [samples.buffer]);
    },
    finish() {
      if (failed) return Promise.reject(failed);
      if (!node) return Promise.resolve();
      if (pendingByte !== null) return Promise.reject(new Error("voice_audio_format"));
      return new Promise((done, fail) => { resolve = done; reject = fail; node.port.postMessage({ type: "finish" }); });
    },
    canPause: true,
    pause() { paused = true; node?.port.postMessage({ type: "pause" }); },
    resume() { paused = false; node?.port.postMessage({ type: "resume" }); },
    get paused() { return paused; },
    playedFrames: () => played,
    stop,
  };
}
