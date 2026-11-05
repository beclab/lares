/** Realtime model names a voice key may grant, and the preset each one opens. */
export const REALTIME_MODEL_PRESETS = Object.freeze({ "voice-dictation": "dictation", "voice-chat": "chat", "voice-assistant": "assistant", "voice-direct": "direct" });

/**
 * What a voice session may do, derived once from its preset and its grant.
 * `relay`: a voice dialogue model answers before (or instead of) the Agent.
 * `agent`: the session reaches the owner's personal Agent.
 * `clientTools`: the caller may declare tools that run on its own device.
 */
export function voiceCapabilities(preset, { clientTools = false } = {}) {
  const relay = preset === "chat" || preset === "assistant";
  const tools = relay && clientTools === true;
  return Object.freeze({
    type: preset === "dictation" ? "transcription" : "realtime",
    relay,
    agent: preset === "assistant" || preset === "direct",
    clientTools: tools,
    instructions: preset === "chat" || tools,
    instructionLimit: tools ? 8000 : 2000,
  });
}
