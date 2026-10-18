import { voiceAvailability } from "./presentation.js";

/** Product entry policy is scoped to this connection, never written to API defaults. */
export function laresVoiceConfig(config, mode = "continuous") {
  return { ...structuredClone(config), preset: mode === "single" ? "dictation" : "direct", backend: "pipeline" };
}

export function laresVoiceAvailability(settings, agentAvailable = false) {
  const available = voiceAvailability(settings ? { ...settings, config: laresVoiceConfig(settings.config || {}) } : null);
  return { ...available, conversation: available.conversation && agentAvailable === true,
    reason: available.conversation && agentAvailable !== true ? "agent" : available.reason };
}
