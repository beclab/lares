import { ENDPOINT, createEnergyEndpoint, createSpeechEndpoint, frameRms } from "./endpoint.js";

/** Silero v5 frames are 512 samples at 16 kHz. */
const FRAME_MS = 32;
const ASSET_ROOT = "/api/lares/voice/vad/";

let runtime = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-lares-vad="${src}"]`);
    if (existing?.dataset.loaded === "true") { resolve(); return; }
    const script = existing ?? document.createElement("script");
    script.dataset.laresVad = src;
    script.addEventListener("load", () => { script.dataset.loaded = "true"; resolve(); }, { once: true });
    // Remove a failed tag so the next attempt creates a fresh one instead of
    // attaching listeners to a script that will never fire again.
    script.addEventListener("error", () => { script.remove(); reject(new Error(`failed to load ${src}`)); }, { once: true });
    if (!existing) { script.src = src; document.head.append(script); }
  });
}

async function loadRuntime() {
  if (typeof document === "undefined") throw new Error("voice_unsupported");
  await loadScript(`${ASSET_ROOT}ort.js`);
  await loadScript(`${ASSET_ROOT}vad.js`);
  if (!globalThis.vad?.MicVAD) throw new Error("voice_vad_unavailable");
  return globalThis.vad;
}

/**
 * One Silero session for the page. `MicVAD.new` builds the ONNX session, and
 * `destroy` releases it, so a recording only pauses that session and the next
 * one starts it again on a new stream.
 */
export function createVadSession(factory) {
  let loading;
  let detector;
  let stream = null;
  let ended = () => {};
  let endpoint = createSpeechEndpoint();
  let active = false;
  let spoke = false;
  let options = {};
  let tail = Promise.resolve();

  function load() {
    loading ??= Promise.resolve()
      .then(() => factory({
        getStream: async () => stream,
        resumeStream: async () => stream,
        onFrame: (prob, frame) => {
          if (!active) return;
          const rms = frameRms(frame);
          options.onLevel?.(rms);
          if (!spoke && prob >= ENDPOINT.speechProb && rms >= ENDPOINT.floor) { spoke = true; options.onSpeech?.(); }
          if (endpoint.push(prob, rms, FRAME_MS)) ended();
        },
      }))
      .then((created) => {
        detector = created;
        return created;
      })
      .catch((err) => {
        loading = undefined;
        throw err;
      });
    return loading;
  }

  return {
    preload() {
      return load();
    },
    open(nextStream, onSpeechEnd, nextOptions = {}) {
      const run = tail.then(async () => {
        const created = await load();
        stream = nextStream;
        ended = onSpeechEnd;
        spoke = false;
        // Options belong to this recording, not to whichever open() came last.
        options = nextOptions;
        endpoint = createSpeechEndpoint({ silenceMs: options.silenceMs });
        await created.start();
        active = true;
      });
      tail = run.then(() => {}, () => {});
      return run.then(() => ({
        stop() {
          if (!active) return;
          active = false;
          stream = null;
          tail = tail.then(() => detector.pause()).then(() => {}, () => {});
        },
      }));
    },
  };
}

let session = null;
let ready = false;
let preloading = null;
let retryAt = 0;

function sileroSession() {
  session ??= createVadSession(async (hooks) => {
    const vad = await loadRuntime();
    return vad.MicVAD.new({
      model: "v5",
      startOnLoad: false,
      baseAssetPath: ASSET_ROOT,
      onnxWASMBasePath: ASSET_ROOT,
      getStream: hooks.getStream,
      pauseStream: async () => {},
      resumeStream: hooks.resumeStream,
      // Olares Desktop's CEF rejects dynamically loaded AudioWorklet modules.
      // ScriptProcessor feeds the same 16 kHz frames into the same Silero model.
      processorType: "ScriptProcessor",
      onFrameProcessed: (probs, frame) => hooks.onFrame(probs.isSpeech, frame),
      onSpeechEnd: () => {},
      onVADMisfire: () => {},
      onSpeechStart: () => {},
      onSpeechRealStart: () => {},
    });
  });
  return session;
}

/**
 * Warm the model once. Returns whether Silero is usable here; a webview without
 * the runtime keeps the energy endpoint instead of failing the take.
 */
export function preloadVoiceVad() {
  if (typeof document === "undefined") return Promise.resolve(false);
  if (ready) return Promise.resolve(true);
  // An unavailable runtime is retried eventually, not on every single take.
  if (Date.now() < retryAt) return Promise.resolve(false);
  preloading ??= sileroSession().preload().then(() => { ready = true; return true; }, () => {
    retryAt = Date.now() + 60_000;
    preloading = null;
    return false;
  });
  return preloading;
}

export function voiceVadReady() { return ready; }

/**
 * Endpoint backed by Silero when the model is already loaded. `null` tells the
 * caller to use the energy endpoint for this take, so the first recording is
 * never delayed by model download.
 */
export function createVoiceVadEndpoint(stream, onSpeechEnd, onSpeech = () => {}, onLevel = () => {}, options = {}) {
  if (!ready) { void preloadVoiceVad(); return null; }
  let handle = null, fallback = null, stopped = false;
  sileroSession().open(stream, onSpeechEnd, { ...options, onSpeech, onLevel }).then((value) => {
    if (stopped) value?.stop(); else handle = value;
  }, () => {
    // The model failed after preload; keep this take usable with energy endpointing.
    if (!stopped) fallback = createEnergyEndpoint(stream, onSpeechEnd, onSpeech, onLevel, options);
  }).catch(() => {});
  return {
    stop() {
      stopped = true;
      handle?.stop();
      fallback?.stop();
    },
  };
}
