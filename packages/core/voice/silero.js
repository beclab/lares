import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createPcmResampler, pcmSamples } from "./realtime-audio.js";

const require = createRequire(import.meta.url);

/** Silero v5 reads 512 samples at 16 kHz, with the last 64 of the previous frame as context. */
const RATE = 16000;
const FRAME = 512;
const CONTEXT = 64;
/** Silero's own hysteresis: speech starts at 0.5 and lasts until the probability drops below 0.35. */
export const SPEECH_ON = 0.5;
export const SPEECH_OFF = 0.35;

// One model for the process; each session keeps its own state. The browser composer already
// ships this runtime and these weights through @ricky0123/vad-web, so the server adds nothing.
let shared = null;
function load() {
  shared ??= (async () => {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(await readFile(require.resolve("@ricky0123/vad-web/dist/silero_vad_v5.onnx")));
    return { ort, session, sr: new ort.Tensor("int64", BigInt64Array.from([BigInt(RATE)]), []) };
  })();
  // A failed load is retried by the next session rather than remembered.
  shared.catch(() => { shared = null; });
  return shared;
}

/**
 * A speech gate for one realtime session, with the noise gate's `voiced(rms, speaking)` shape:
 * whether the room holds a voice comes from Silero rather than from loudness, so a fan, a motor
 * or a microphone's gain is not a voice however loud it is. `hear` takes the session's 24 kHz
 * PCM as it arrives; the verdict follows about one frame (32 ms) behind it.
 */
export async function createSileroGate() {
  const { ort, session, sr } = await load();
  const resample = createPcmResampler(24000, RATE);
  let state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  let context = new Float32Array(CONTEXT), pending = new Float32Array(0), probability = 0, chain = Promise.resolve();
  const run = async (frame) => {
    const input = new Float32Array(CONTEXT + FRAME);
    input.set(context);
    input.set(frame, CONTEXT);
    context = frame.slice(-CONTEXT);
    const out = await session.run({ input: new ort.Tensor("float32", input, [1, input.length]), state, sr });
    state = out.stateN;
    probability = out.output.data[0];
  };
  return {
    kind: "silero",
    hear(chunk) {
      const samples = pcmSamples(resample(pcmSamples(chunk)));
      const joined = new Float32Array(pending.length + samples.length);
      joined.set(pending);
      joined.set(samples, pending.length);
      let offset = 0;
      for (; offset + FRAME <= joined.length; offset += FRAME) {
        const frame = joined.slice(offset, offset + FRAME);
        chain = chain.then(() => run(frame)).catch(() => {});
      }
      pending = joined.slice(offset);
    },
    voiced(_rms, speaking) {
      return probability >= (speaking ? SPEECH_OFF : SPEECH_ON);
    },
    /** Resolves once every frame heard so far has been scored; for tests. */
    settled() { return chain.then(() => probability); },
  };
}
