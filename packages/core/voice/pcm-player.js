import { PCM_PLAYER_WORKLET } from "./pcm-worklet.js";
import { pcmSamples } from "./realtime-audio.js";
import { browserAudioErrorCode, requireAudioWorklet } from "./browser-audio.js";

/** Unread audio the speaker may be holding. A longer reply waits here; it is not a failed call. */
export const PLAYBACK_QUEUE_SECONDS = 4;

let primed = null;
const worklets = new WeakMap();
let watchingVisibility = false;

/** iOS/macOS suspend the page's context on a call, the lock screen or a device switch. */
function resumeIfInterrupted(context) {
  if (!context || context.state === "closed" || context.state === "running") return;
  void context.resume?.().catch(() => {});
}

function watchVisibility() {
  if (watchingVisibility || typeof document === "undefined" || !document.addEventListener) return;
  watchingVisibility = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeIfInterrupted(primed);
  });
}

function ensureWorklet(ctx) {
  const pending = worklets.get(ctx);
  if (pending) return pending;
  const load = async () => {
    requireAudioWorklet(ctx);
    const url = URL.createObjectURL(new Blob([PCM_PLAYER_WORKLET], { type: "text/javascript" }));
    try { await ctx.audioWorklet.addModule(url); }
    finally { URL.revokeObjectURL(url); }
  };
  let tracked;
  tracked = load().catch((error) => {
    if (worklets.get(ctx) === tracked) worklets.delete(ctx);
    throw error;
  });
  worklets.set(ctx, tracked);
  return tracked;
}

/** One silent frame runs the audio unit at this context's rate before another clip can retune iOS. */
function commitPlaybackClock(context) {
  try {
    if (typeof context?.createBuffer !== "function" || typeof context.createBufferSource !== "function" || !context.destination || !context.sampleRate) return;
    const buffer = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
  } catch { /* Resuming the context is the unlock. */ }
}

/** Optional gesture prewarming must never block a text submission. Playback reports failures at start. */
export function primePlaybackContext(Context = globalThis.AudioContext || globalThis.webkitAudioContext) {
  if (!Context || globalThis.isSecureContext === false) return null;
  try {
    if (!primed || primed.state === "closed") primed = new Context();
    requireAudioWorklet(primed);
    const resume = primed.resume?.();
    if (resume && typeof resume.catch === "function") resume.catch(() => {});
    ensureWorklet(primed).catch(() => {});
    commitPlaybackClock(primed);
    return primed;
  } catch {
    const failed = primed;
    primed = null;
    worklets.delete(failed);
    try { Promise.resolve(failed?.close?.()).catch(() => {}); } catch { /* Prewarming is optional. */ }
    return null;
  }
}

export function createPcmStreamPlayer({ onProgress = () => {}, onMetric = () => {}, context: Context = globalThis.AudioContext || globalThis.webkitAudioContext } = {}) {
  let context, node, resolve, reject, played = 0, accepted = 0, rate = 0, generation = 0, pendingByte = null, paused = false, owned = false, settled = false;
  let tail = Promise.resolve();
  const waiters = new Set();
  const wake = () => { for (const listen of [...waiters]) listen(); };
  /**
   * The page shares one primed context. iOS interrupts it (a call, the lock
   * screen) and it never resumes on its own, so a reply that starts after that
   * gets a fresh context instead of a silent failure.
   */
  const openContext = async (shared) => {
    watchVisibility();
    if (shared) {
      shared.addEventListener?.("statechange", () => resumeIfInterrupted(shared));
      try {
        await ensureWorklet(shared);
        await shared.resume?.();
        if (!shared.state || shared.state === "running") {
          owned = false; context = shared;
          return { opened: shared, shared: true };
        }
      } catch { /* replaced below */ }
      worklets.delete(shared);
      if (primed === shared) primed = null;
    }
    const fresh = new Context();
    owned = true;
    fresh.addEventListener?.("statechange", () => resumeIfInterrupted(fresh));
    try {
      await ensureWorklet(fresh);
      await fresh.resume?.();
      if (fresh.state && fresh.state !== "running") throw new Error("voice_playback_failed");
    } catch (error) {
      owned = false;
      if (fresh.state !== "closed") void fresh.close?.().catch(() => {});
      throw error;
    }
    context = fresh;
    return { opened: fresh, shared: false };
  };
  const stop = () => {
    generation++; paused = false; node?.disconnect(); if (node) node.port.onmessage = null; node = null;
    const closing = owned ? context : null;
    owned = false;
    if (closing && closing.state !== "closed") void closing.close().catch(() => {});
    context = null; resolve?.(); resolve = reject = null; pendingByte = null;
    wake();
    tail = Promise.resolve();
  };
  return {
    async start({ sampleRate, channels, encoding }) {
      stop(); played = 0; accepted = 0; settled = false;
      if (!Context || globalThis.isSecureContext === false) throw new Error(browserAudioErrorCode());
      if (channels !== 1 || encoding !== "pcm_s16le" || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("voice_audio_format");
      rate = sampleRate;
      const epoch = generation;
      const shared = primed && primed.state !== "closed" ? primed : null;
      let opened;
      try {
        ({ opened } = await openContext(shared));
        if (epoch !== generation) throw new Error("voice_cancelled");
        onMetric({ stage: "playback_context", state: opened.state || "unknown", shared: Boolean(shared && opened === shared) });
      } catch (error) {
        onMetric({ stage: "playback_context", state: context?.state || "missing", shared: Boolean(shared), code: error?.message || "voice_playback_failed" });
        if (owned && context && context.state !== "closed") void context.close?.().catch(() => {});
        owned = false; context = null;
        throw error;
      }
      node = new AudioWorkletNode(opened, "lares-pcm-player", {
        processorOptions: { inputRate: sampleRate, outputRate: opened.sampleRate || sampleRate, preroll: Math.round(sampleRate * 0.2) },
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      node.port.onmessage = ({ data }) => {
        if (epoch !== generation) return;
        if (data.type === "progress") { played = data.frames; onProgress(played); wake(); }
        if (data.type === "started" || data.type === "underrun") onMetric({ stage: `playback_${data.type}` });
        if (data.type === "done") { settled = true; resolve?.(); resolve = reject = null; }
      };
      node.connect(opened.destination);
    },
    write(bytes) {
      const epoch = generation;
      const run = () => {
        if (epoch !== generation || !node) throw new Error("voice_cancelled");
        let chunk = bytes;
        if (pendingByte !== null) { chunk = new Uint8Array(bytes.length + 1); chunk[0] = pendingByte; chunk.set(bytes, 1); pendingByte = null; }
        if (chunk.length % 2) { pendingByte = chunk[chunk.length - 1]; chunk = chunk.subarray(0, -1); }
        if (!chunk.length) return;
        const source = pcmSamples(chunk);
        const budget = rate * PLAYBACK_QUEUE_SECONDS;
        let offset = 0;
        const post = (from, count) => {
          const samples = count === source.length && from === 0 ? source : source.slice(from, from + count);
          accepted += samples.length;
          node.port.postMessage({ type: "audio", samples }, [samples.buffer]);
        };
        const pump = () => {
          while (offset < source.length) {
            const room = budget - (accepted - played);
            if (room <= 0) return false;
            const count = Math.min(source.length - offset, room);
            post(offset, count);
            offset += count;
          }
          return true;
        };
        if (pump()) return;
        // The rest of a long reply plays as the speaker catches up.
        return new Promise((done, fail) => {
          const listen = () => {
            if (epoch !== generation || !node) { waiters.delete(listen); fail(new Error("voice_cancelled")); return; }
            if (!pump()) return;
            waiters.delete(listen);
            done();
          };
          waiters.add(listen);
        });
      };
      const pending = tail.then(run, run);
      tail = pending.catch(() => {});
      return pending;
    },
    finish() {
      const epoch = generation;
      return tail.catch(() => {}).then(() => {
        if (epoch !== generation || !node || settled) return;
        if (pendingByte !== null) throw new Error("voice_audio_format");
        return new Promise((done, fail) => { resolve = done; reject = fail; node.port.postMessage({ type: "finish" }); });
      });
    },
    canPause: true,
    pause() { paused = true; node?.port.postMessage({ type: "pause" }); },
    resume() { paused = false; node?.port.postMessage({ type: "resume" }); },
    get paused() { return paused; },
    /** The browser's own view; a phone can report "running" while the OS has muted it. */
    contextState: () => context?.state || "missing",
    sampleRate: () => context?.sampleRate || 0,
    playedFrames: () => played,
    stop,
  };
}
