const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** Below this the blob is container header only. */
export const MIN_RECORDING_MS = 700;

export function pickRecordingMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
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
