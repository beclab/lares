export function browserAudioErrorCode() {
  return globalThis.isSecureContext === false ? "voice_secure_context_required" : "voice_audio_unsupported";
}

export function requireAudioWorklet(context) {
  if (globalThis.isSecureContext === false || typeof context?.audioWorklet?.addModule !== "function" || typeof globalThis.AudioWorkletNode !== "function") {
    throw new Error(browserAudioErrorCode());
  }
}
