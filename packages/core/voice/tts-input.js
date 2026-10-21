const QWEN_12HZ = /qwen3-tts|audioqwen3tts/i;

/** 12Hz Qwen drops its last codec frames. This tail is not spoken, so those frames land on it. */
export const QWEN_SPEECH_TAIL = " ^.";

export function speechInput(model, text) {
  const body = String(text ?? "");
  if (!QWEN_12HZ.test(String(model ?? ""))) return body;
  return body.endsWith(QWEN_SPEECH_TAIL) ? body : `${body}${QWEN_SPEECH_TAIL}`;
}
