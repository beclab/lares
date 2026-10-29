/**
 * A take can lose a race with the turn that is still being submitted or with a
 * reply that is still playing. That is contention on one shared audio link, not
 * a broken voice session: the take is dropped and the call keeps listening.
 *
 * A continuous call also drops one bad utterance (see RECOVERABLE_TAKE_FAULTS)
 * and keeps listening. Anything else that fails a take still fails the call.
 */
export const TRANSIENT_VOICE_ERRORS = Object.freeze([
  // The previous turn is still being transcribed/submitted (or the Host queued it).
  "turn_busy",
  // Half duplex: the reply owns the link, or its audio is still in flight.
  "waiting_for_playback",
  // One take exceeded the bounded transport buffers.
  "voice_audio_backpressure",
  "voice_stream_state",
  // The take hit the transport's own size/limit for a single utterance.
  "audio_limit_exceeded",
  // The Host never returned a transcript for a committed take.
  "voice_asr_timeout",
]);

/**
 * One utterance of a continuous call failed. The call stays open and the next
 * hold records again, so the composer must not announce these.
 * A one-shot dictation still surfaces them.
 */
export const RECOVERABLE_TAKE_FAULTS = Object.freeze([
  "voice_failed",
  "voice_timeout",
  "voice_stream_failed",
  "voice_audio_unreadable",
  "voice_device_lost",
  "voice_no_input",
  "voice_too_short",
]);

const TRANSIENT = new Set(TRANSIENT_VOICE_ERRORS);

/**
 * The call already ended itself. Hold-to-speak and send open another one,
 * so these codes are lifecycle, not a failure the composer should announce.
 */
export const QUIET_VOICE_ENDINGS = Object.freeze([
  "voice_recovery_expired",
  "voice_idle_timeout",
]);

const QUIET = new Set(QUIET_VOICE_ENDINGS);
const RECOVERABLE = new Set(RECOVERABLE_TAKE_FAULTS);

export function voiceErrorCode(value) {
  if (typeof value === "string") return value;
  return value?.code || value?.message || "";
}

/** @returns {boolean} true when only this take failed, not the connection. */
export function isTransientVoiceError(value) {
  return TRANSIENT.has(voiceErrorCode(value));
}

/** @returns {boolean} true when a continuous call drops the take and keeps listening. */
export function isRecoverableTakeFault(value) {
  return RECOVERABLE.has(voiceErrorCode(value));
}

/** @returns {boolean} true when the call ended itself and needs no banner. */
export function isQuietVoiceEnding(value) {
  return QUIET.has(voiceErrorCode(value));
}

/** Marks a rejection so the controller drops one take instead of the call. */
export function transientVoiceError(code) {
  const error = new Error(code);
  error.code = code;
  error.transient = true;
  return error;
}
