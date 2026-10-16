import { createVoiceCapture } from "./browser-capture.js";
import { createSpeechEndpoint, frameRms } from "./endpoint.js";

export function createEnergyEndpoint(stream, end) {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) throw new Error("voice_unsupported");
  const context = new AudioCtx();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2048, 1, 1);
  const gain = context.createGain();
  gain.gain.value = 0;
  const endpoint = createSpeechEndpoint();
  let heard = false;
  const silenceTimer = setTimeout(() => { if (!heard) end(false); }, 10_000);
  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);
    const rms = frameRms(samples);
    if (rms >= 0.004) heard = true;
    if (endpoint.push(1, rms, samples.length * 1000 / context.sampleRate)) end(true);
  };
  source.connect(processor); processor.connect(gain); gain.connect(context.destination);
  void context.resume();
  return { stop() { clearTimeout(silenceTimer); processor.onaudioprocess = null; source.disconnect(); processor.disconnect(); gain.disconnect(); void context.close(); } };
}

export function createDeviceInput({ transcribe, onPhase = () => {}, endpoint = createEnergyEndpoint, media } = {}) {
  let recorder = null;
  let settle = null;
  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    recorder?.dispose(); recorder = null;
    settle?.(""); settle = null;
  };
  return {
    capabilities: { duplex: true, bargeIn: false, audio: "encoded" },
    capture({ signal, onTranscribing, continuous = false } = {}) {
      cancel();
      return new Promise((resolve, reject) => {
        settle = resolve;
        const done = (text) => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); settle = null; resolve(text); };
        recorder = createVoiceCapture({ media, transcribe, submit: done, onStream: (stream) => {
          for (const track of stream.getTracks()) track.addEventListener?.("ended", () => { settle = null; cancel(); reject(new Error("voice_device_lost")); }, { once: true });
          return endpoint(stream, (heard = true) => { if (heard) recorder?.stop(); else {
            if (continuous) { cancel(); done(""); }
            else { settle = null; cancel(); reject(new Error("voice_no_input")); }
          } });
        }, onPhase(phase, extra) {
          onPhase(phase, extra);
          if (phase === "transcribing") onTranscribing?.();
          if (phase === "error") {
            if (continuous && ["voice_no_input", "voice_too_short"].includes(extra.error)) { done(""); return; }
            clearTimeout(timer); signal?.removeEventListener("abort", cancel); settle = null; reject(new Error(extra.error)); }
        } });
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) { cancel(); return; }
        timer = setTimeout(() => recorder?.stop(), 60_000);
        void recorder.start();
      });
    },
    stop: () => recorder?.stop(),
    cancel,
  };
}
