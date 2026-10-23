/**
 * Silero VAD is shared by every Lares client. The model, the one-per-page
 * session and the host asset routes all live in core; this module keeps the
 * historical web entry points as thin aliases.
 */
export {
  createVadSession,
  createVoiceVadEndpoint as createVadEndpoint,
  preloadVoiceVad as preloadVad,
  voiceVadReady,
} from "@olares/lares-core/voice/vad";
