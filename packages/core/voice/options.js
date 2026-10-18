import { defaultDictationProfiles } from "./dictation.js";

export const VOICE_DEFAULTS = {
  preset: "assistant",
  dictationPreset: "raw",
  dictationProfiles: defaultDictationProfiles(),
  dictationShortcuts: { default: "", raw: "", clean: "", outline: "", summary: "" },
  chatModel: "default-chat",
  instructions: "",
  voice: "",
  ttsVoiceByModel: {},
  mode: "single",
  mobileMode: "continuous",
  endpointSilenceMs: 500,
  idleTimeoutMs: 300_000,
  recoveryTimeoutMs: 120_000,
  device: "auto",
  backend: "pipeline",
  realtimeModel: "",
  model: "",
  ttsModel: "",
  language: "",
  speak: false,
  // Read answers while they are written. Needs the GPU in MemorySlice, see gpu-mode.js.
  streaming: false,
};

export const VOICE_PRESETS = Object.freeze(["dictation", "chat", "assistant", "direct"]);
