/**
 * Decide when a take is over from Silero's per-frame speech probability and the
 * frame's loudness. A conference mic hears the whole room, so a frame only
 * counts as the speaker when it is human speech and within `relative` of the
 * loudest speech already heard in this take. Farther voices then do not hold
 * the recording open.
 */
export const ENDPOINT = {
  speechProb: 0.5,
  // Phrase endpointing, the same default speech platforms use for a request
  // (Azure end-of-silence is 500ms). Dictation waits 1.5–2s; a chat turn should not.
  silenceMs: 500,
  minSpeechMs: 250,
  relative: 0.3,
  floor: 0.004,
  smoothFrames: 5,
};

export function frameRms(frame) {
  if (!frame?.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

export function createSpeechEndpoint(options = {}) {
  const o = { ...ENDPOINT, ...options };
  const recent = [];
  let reference = 0;
  let speechMs = 0;
  let quietMs = 0;
  let ended = false;

  return {
    /** @returns {boolean} true once, on the frame that ends the take */
    push(prob, rms, frameMs) {
      if (ended) return false;
      recent.push(rms);
      if (recent.length > o.smoothFrames) recent.shift();
      const level = recent.reduce((sum, value) => sum + value, 0) / recent.length;
      const human = prob >= o.speechProb;
      if (human && level > reference) reference = level;
      const near = human && level >= Math.max(o.floor, reference * o.relative);
      if (near) {
        speechMs += frameMs;
        quietMs = 0;
      } else {
        quietMs += frameMs;
      }
      if (speechMs >= o.minSpeechMs && quietMs >= o.silenceMs) {
        ended = true;
        return true;
      }
      return false;
    },
  };
}
