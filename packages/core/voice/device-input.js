import { createVoiceCapture } from "./browser-capture.js";
import { createEnergyEndpoint, createInputMeter } from "./endpoint.js";
import { createVoiceVadEndpoint, preloadVoiceVad } from "./vad.js";

export { createEnergyEndpoint };

/** Silero once it is loaded; the energy endpoint otherwise or on any VAD failure. */
export function defaultEndpoint(stream, end, onSpeech, onLevel, options) {
  return createVoiceVadEndpoint(stream, end, onSpeech, onLevel, options)
    ?? createEnergyEndpoint(stream, end, onSpeech, onLevel, options);
}

export function createDeviceInput({ transcribe, onPhase = () => {}, endpoint = defaultEndpoint, endpointSilenceMs = 500, media, preparation, streamInput, echoTested = false } = {}) {
  let recorder = null;
  let settle = null;
  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    recorder?.dispose(); recorder = null;
    settle?.(""); settle = null;
  };
  return {
    capabilities: { duplex: true, bargeIn: echoTested === true, echoTested: echoTested === true, listenWhileWorking: true, audio: "encoded" },
    capture({ signal, onTranscribing, onReady, onSpeech, onLevel = () => {}, continuous = false, manual = false } = {}) {
      cancel();
      // Hands-free calls end themselves. A manual hold is still one take of the same call.
      const automatic = continuous && !manual;
      // Only automatic turns need a speech model. The first take may use energy
      // endpointing; the model is warmed for the next one instead of delaying it.
      if (automatic) void preloadVoiceVad();
      return new Promise((resolve, reject) => {
        let ready = false;
        settle = resolve;
        const done = (text) => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); settle = null; resolve(text); };
        const retainStream = continuous && typeof preparation?.borrow === "function";
        recorder = createVoiceCapture({ media, streamInput, preparation, retainStream, transcribe, submit: done, onStream: (stream) => {
          for (const track of stream.getTracks()) track.addEventListener?.("ended", () => {
            // The device dropped mid-take. End this utterance empty; the next hold opens another microphone.
            if (settle) cancel();
          }, { once: true });
          if (!automatic) return createInputMeter(stream, onLevel);
          return endpoint(stream, (heard = true) => { if (heard) recorder?.stop(); else { cancel(); done(""); } }, onSpeech, onLevel, { silenceMs: endpointSilenceMs, interruptionMs: echoTested ? 500 : 0 });
        }, onPhase(phase, extra) {
          onPhase(phase, extra);
          if (phase === "recording" && !ready) {
            ready = true; onReady?.();
            timer = setTimeout(() => { if (continuous) recorder?.stop(); else { settle = null; cancel(); reject(new Error("voice_capture_limit")); } }, 60_000);
          }
          if (phase === "transcribing") onTranscribing?.();
          if (phase === "error") {
            if (continuous && (extra.recognizedEmpty || ["voice_no_input", "voice_too_short"].includes(extra.error))) { done(""); return; }
            clearTimeout(timer); signal?.removeEventListener("abort", cancel); settle = null; reject(new Error(extra.error)); }
        } });
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) { cancel(); return; }
        void recorder.start();
      });
    },
    stop: () => recorder?.stop(),
    cancel,
  };
}
