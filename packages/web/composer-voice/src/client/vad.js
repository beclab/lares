import { createSpeechEndpoint, frameRms } from "@olares/lares-core/voice/endpoint";

const ASSET_ROOT = "/api/lares/voice/vad/";
/** Silero v5 frames are 512 samples at 16 kHz. */
const FRAME_MS = 32;

let runtimePromise;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-lares-vad="${src}"]`);
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = existing ?? document.createElement("script");
    script.dataset.laresVad = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`failed to load ${src}`)), { once: true });
    if (!existing) {
      script.src = src;
      document.head.append(script);
    }
  });
}

async function loadVadRuntime() {
  runtimePromise ??= (async () => {
    await loadScript(`${ASSET_ROOT}ort.js`);
    await loadScript(`${ASSET_ROOT}vad.js`);
    if (!globalThis.vad?.MicVAD) throw new Error("Silero VAD did not load");
    return globalThis.vad;
  })();
  return runtimePromise;
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
  let tail = Promise.resolve();

  function load() {
    loading ??= Promise.resolve()
      .then(() => factory({
        getStream: async () => stream,
        resumeStream: async () => stream,
        onFrame: (prob, frame) => {
          if (active && endpoint.push(prob, frameRms(frame), FRAME_MS)) ended();
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
    open(nextStream, onSpeechEnd) {
      const run = tail.then(async () => {
        const created = await load();
        stream = nextStream;
        ended = onSpeechEnd;
        endpoint = createSpeechEndpoint();
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

const session = createVadSession(async (hooks) => {
  const vad = await loadVadRuntime();
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

/** Load Silero once, before the first recording, and keep that session. */
export function preloadVad() {
  return session.preload();
}

/** End a recording after two seconds without the near speaker's voice. */
export function createVadEndpoint(stream, onSpeechEnd) {
  return session.open(stream, onSpeechEnd);
}
