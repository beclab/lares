import { createVoiceCapture } from "./browser-capture.js";
import { createSpeechEndpoint, frameRms } from "./endpoint.js";

export function createEnergyEndpoint(stream, end, onSpeech = () => {}, onLevel = () => {}, options = {}) {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) throw new Error("voice_unsupported");
  const context = new AudioCtx();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2048, 1, 1);
  const gain = context.createGain();
  gain.gain.value = 0;
  const endpoint = createSpeechEndpoint(options);
  let heard = false;
  const silenceTimer = setTimeout(() => { if (!heard) end(false); }, 10_000);
  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);
    const rms = frameRms(samples);
    onLevel(rms);
    if (rms >= 0.004 && !heard) { heard = true; onSpeech(); }
    if (endpoint.push(1, rms, samples.length * 1000 / context.sampleRate)) end(true);
  };
  source.connect(processor); processor.connect(gain); gain.connect(context.destination);
  void context.resume();
  return { stop() { clearTimeout(silenceTimer); processor.onaudioprocess = null; source.disconnect(); processor.disconnect(); gain.disconnect(); void context.close(); } };
}

function createInputMeter(stream, onLevel) {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) return { stop() {} };
  const context = new AudioCtx();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser(); analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => { analyser.getFloatTimeDomainData(samples); onLevel(frameRms(samples)); }, 80);
  void context.resume();
  return { stop() { clearInterval(timer); source.disconnect(); analyser.disconnect(); void context.close(); } };
}

export function createDeviceInput({ transcribe, onPhase = () => {}, endpoint = createEnergyEndpoint, endpointSilenceMs = 500, media } = {}) {
  let recorder = null;
  let settle = null;
  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    recorder?.dispose(); recorder = null;
    settle?.(""); settle = null;
  };
  return {
    capabilities: { duplex: true, bargeIn: false, listenWhileWorking: true, audio: "encoded" },
    capture({ signal, onTranscribing, onReady, onSpeech, onLevel = () => {}, continuous = false } = {}) {
      cancel();
      return new Promise((resolve, reject) => {
        settle = resolve;
        const done = (text) => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); settle = null; resolve(text); };
        recorder = createVoiceCapture({ media, transcribe, submit: done, onStream: (stream) => {
          for (const track of stream.getTracks()) track.addEventListener?.("ended", () => { settle = null; cancel(); reject(new Error("voice_device_lost")); }, { once: true });
          if (!continuous) return createInputMeter(stream, onLevel);
          return endpoint(stream, (heard = true) => { if (heard) recorder?.stop(); else {
            if (continuous) { cancel(); done(""); }
            else { settle = null; cancel(); reject(new Error("voice_no_input")); }
          } }, onSpeech, onLevel, { silenceMs: endpointSilenceMs });
        }, onPhase(phase, extra) {
          onPhase(phase, extra);
          if (phase === "recording") onReady?.();
          if (phase === "transcribing") onTranscribing?.();
          if (phase === "error") {
            if (continuous && ["voice_no_input", "voice_too_short"].includes(extra.error)) { done(""); return; }
            clearTimeout(timer); signal?.removeEventListener("abort", cancel); settle = null; reject(new Error(extra.error)); }
        } });
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) { cancel(); return; }
        timer = setTimeout(() => { if (continuous) recorder?.stop(); else { settle = null; cancel(); reject(new Error("voice_capture_limit")); } }, 60_000);
        void recorder.start();
      });
    },
    stop: () => recorder?.stop(),
    cancel,
  };
}
