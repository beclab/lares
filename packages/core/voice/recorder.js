const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** Below this the blob is container header only. */
export const MIN_RECORDING_MS = 700;
export const MIN_RECORDING_BYTES = 1024;

export const RECORDING_AUDIO = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
};

export function isComposerVoiceReady(phase, setDraft) {
  return phase === "plain" && typeof setDraft === "function";
}

export function isRecordingTooShort(durationMs, byteSize) {
  return durationMs < MIN_RECORDING_MS || byteSize < MIN_RECORDING_BYTES;
}

export function pickRecordingMime(recorder = globalThis.MediaRecorder) {
  if (typeof recorder === "undefined" || recorder === undefined) return "";
  for (const type of MIME_CANDIDATES) {
    try {
      if (recorder.isTypeSupported(type)) return type;
    } catch {
      return "";
    }
  }
  return "";
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = String(total % 60).padStart(2, "0");
  return `${Math.floor(total / 60)}:${s}`;
}
