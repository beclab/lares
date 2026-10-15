/**
 * What to tell the user when answer playback cannot happen.
 * Recognized codes stay in the product language. A generic failure keeps the
 * server's own detail so the notice says what actually broke.
 */

const REPLACED = {
  voice_model_unavailable: "voice_tts_unavailable",
  voice_timeout: "voice_speak_timeout",
  voice_failed: "voice_speak_failed",
};

const WITH_DETAIL = new Set(["voice_speak_failed", "voice_speak_timeout"]);
const STOCK = new Set([
  "speech timed out",
  "no speech model available",
  "speech playback is off",
  "nothing to speak",
]);

export function speakToggleNotice(ttsModels) {
  return Array.isArray(ttsModels) && ttsModels.length === 0 ? "voice_tts_unavailable" : "";
}

function translated(translate, code) {
  if (!code) return "";
  const key = `error.${code}`;
  const text = translate(key);
  return text === key ? "" : text;
}

export function speakProblemText(translate, err) {
  const code = err && typeof err === "object" && typeof err.code === "string" ? err.code : "";
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const message = raw && raw !== code && !STOCK.has(raw) ? raw : "";
  const mapped = REPLACED[code] || (code.startsWith("voice_") ? code : "");
  const text = translated(translate, mapped);
  if (text && message && WITH_DETAIL.has(mapped)) return `${text}: ${message}`;
  if (text) return text;
  if (!code && message.startsWith("voice_")) {
    const fromMessage = translated(translate, REPLACED[message] || message);
    if (fromMessage) return fromMessage;
  }
  if (message) return message;
  return translated(translate, "voice_speak_failed") || "voice_speak_failed";
}
