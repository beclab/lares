/**
 * Decide when a take is over from Silero's per-frame speech probability and the
 * frame's loudness. A conference mic hears the whole room, so a frame only
 * counts as the speaker when it is human speech and within `relative` of the
 * loudest speech heard recently in this take. Farther voices then do not hold
 * the recording open, and a single loud cough does not raise the bar forever.
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
  // The reference is a leaky maximum: it halves roughly every five seconds of
  // speech-level audio, so a door slam cannot close the take for the rest of it.
  referenceDecay: 0.995,
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
      reference *= o.referenceDecay;
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
    /** A take that went quiet before its voice added up to a phrase: a cough, a knock, a click. */
    abandoned() {
      return !ended && speechMs < o.minSpeechMs && quietMs >= o.silenceMs;
    },
  };
}

/** Widest room-noise floor a quiet speaker is still expected to clear. */
const MAX_NOISE_FLOOR = 0.02;

/** How far above the loud moments of a room Router's VAD heard as empty a voice has to be. */
const LEARNED_MARGIN = 1.2;
/** A learned floor halves over this long unless another empty take holds it up. */
const LEARNED_HALF_LIFE_MS = 30_000;

/**
 * Speech without a speech model is whatever clears the room by 2.5x. The floor
 * follows the frames heard while nobody is speaking, so a fan or a motor does
 * not count as a voice that never stops, and a quiet speaker still does.
 */
export function createNoiseGate() {
  let noise = null, learned = 0;
  return {
    /** @returns {boolean} whether this frame is louder than the room */
    voiced(rms, speaking, frameMs = 0) {
      if (!speaking) noise = noise == null ? rms : noise * 0.9 + rms * 0.1;
      if (learned && frameMs) learned *= 0.5 ** (frameMs / LEARNED_HALF_LIFE_MS);
      const floor = Math.max(ENDPOINT.floor, Math.min(MAX_NOISE_FLOOR, (noise ?? ENDPOINT.floor / 2.5) * 2.5), learned);
      return rms >= floor;
    },
    /**
     * The frame levels of a take a speech model heard as nobody speaking. A room that never
     * falls quiet enough between voices (a fan, a motor, a microphone's gain) can only be
     * learned this way, since the floor otherwise listens only between voices. Its loud
     * moments set the floor, not its average: a take ends only after half a second without a
     * voiced frame, so bursts above an average-based floor keep it open. The learned floor
     * fades unless further empty takes keep it up, so a room that quietens hears quiet
     * speakers again.
     */
    /** The floors this gate is applying now, for diagnostics. */
    levels() { return { noise, learned }; },
    learn(levels) {
      const sorted = [...levels].sort((a, b) => a - b);
      if (!sorted.length) return;
      const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      learned = Math.max(learned, loud * LEARNED_MARGIN);
    },
  };
}

/**
 * Endpointing without a speech model. The room's floor is estimated from the
 * frames before the speaker starts and only needs to be cleared by that much,
 * so a loud room does not keep every take open and a quiet speaker still ends
 * it. Used by webviews that cannot load Silero, and as its fallback.
 */
export function createEnergyEndpoint(stream, end, onSpeech = () => {}, onLevel = () => {}, options = {}) {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) throw new Error("voice_unsupported");
  const context = new AudioCtx();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2048, 1, 1);
  const gain = context.createGain();
  gain.gain.value = 0;
  const endpoint = createSpeechEndpoint(options);
  const gate = createNoiseGate();
  let heard = false, consecutiveMs = 0, spoke = false;
  const silenceTimer = setTimeout(() => { if (!heard) end(false); }, 10_000);
  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);
    const rms = frameRms(samples);
    const frameMs = samples.length * 1000 / context.sampleRate;
    onLevel(rms);
    const human = gate.voiced(rms, spoke);
    if (human) spoke = true;
    consecutiveMs = human ? consecutiveMs + frameMs : 0;
    if (consecutiveMs >= (options.interruptionMs || 0) && human && !heard) { heard = true; onSpeech(); }
    if (endpoint.push(human ? 1 : 0, rms, frameMs)) end(true);
  };
  source.connect(processor); processor.connect(gain); gain.connect(context.destination);
  void context.resume();
  return { stop() { clearTimeout(silenceTimer); processor.onaudioprocess = null; source.disconnect(); processor.disconnect(); gain.disconnect(); void context.close(); } };
}

/** Visible microphone level for a take that ends by the user's finger. */
export function createInputMeter(stream, onLevel) {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) return { stop() {} };
  const context = new AudioCtx();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser(); analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => { analyser.getFloatTimeDomainData(samples); onLevel(frameRms(samples)); }, 80);
  void context.resume();
  return { stop() { clearInterval(timer); source.disconnect(); analyser.disconnect(); void context.close(); } };
}
