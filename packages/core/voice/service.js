import { readConfig, validateConfigPatch, writeConfig } from "./config.js";
import { installVoiceChart } from "./install.js";
import {
  beginHostCapture,
  endHostCapture,
  openBluetoothPlayback,
  playBluetoothAudio,
  readHostCapture,
  resetHostCapture,
  stopBluetoothPlayback,
} from "./session.js";
import { createCaptureSession } from "./capture.js";
import { createDuplexCoordinator } from "./duplex.js";
import { normalizeSttPcm } from "./pcm.js";
import { speechSegments } from "./script.js";
import { pcmToWav, silencePcm, synthesizeStream } from "../router/tts.js";
import {
  STT_MAX_AUDIO_BYTES,
  VoiceError,
  listModels,
  pickSttModelId,
  pickTtsModelId,
  resolveSttModel,
  sttModelIds,
  transcribe,
  ttsModelIds,
} from "../router/stt.js";

export { STT_MAX_AUDIO_BYTES };

const duplex = createDuplexCoordinator(stopBluetoothPlayback);

export async function voiceStatusPayload(options) {
  const config = readConfig();
  let modelAvailable = false;
  let resolvedModel = config.model;
  try {
    const models = await listModels(options);
    resolvedModel = pickSttModelId(models, config.model) ?? "";
    modelAvailable = Boolean(resolvedModel);
  } catch {
    modelAvailable = false;
  }
  return {
    ok: modelAvailable,
    model: resolvedModel,
    modelAvailable,
    language: config.language,
  };
}

export async function voiceModelsPayload(options) {
  const models = await listModels(options);
  const config = readConfig();
  const ids = models.map((model) => model.id);
  const stt = sttModelIds(models);
  const tts = ttsModelIds(models);
  return {
    models: ids,
    stt,
    tts,
    selected: pickSttModelId(models, config.model),
    ttsSelected: pickTtsModelId(models, config.ttsModel),
  };
}

export async function saveVoiceConfig(body) {
  const patch = validateConfigPatch(body);
  if (patch.model || patch.ttsModel) {
    const models = await listModels();
    if (patch.model && !sttModelIds(models).includes(patch.model)) {
      throw new VoiceError("voice_model_unavailable", 400, "selected voice model is not available");
    }
    if (patch.ttsModel && !ttsModelIds(models).includes(patch.ttsModel)) {
      throw new VoiceError("voice_model_unavailable", 400, "selected speech model is not available");
    }
  }
  return writeConfig(patch);
}

export function installVoice(kind) {
  return installVoiceChart(kind);
}

function cancelledSpeech() {
  return new VoiceError("voice_cancelled", 499, "speech was superseded");
}

const readouts = new WeakMap();

/**
 * Every open page asks to read the same answer when it concludes. A request
 * for the readout already under way joins it instead of restarting the
 * headset and cancelling the page that asked first.
 */
export async function speakFromConfig(text, options = {}) {
  const config = options.config ?? readConfig();
  if (!config.speak) throw new VoiceError("voice_speak_disabled", 409, "speech playback is off");
  const segments = speechSegments(text);
  if (!segments.length) throw new VoiceError("voice_config_invalid", 400, "nothing to speak");
  const model = options.model ?? await pickTtsModelId(await listModels(), config.ttsModel);
  if (!model) throw new VoiceError("voice_model_unavailable", 503, "no speech model available");
  const coordinator = options.coordinator ?? duplex;
  const current = readouts.get(coordinator);
  if (current?.text === text && current.active()) return current.result;
  const lease = coordinator.beginSpeech(options.signal);
  const result = readAloud(segments, model, lease, options);
  readouts.set(coordinator, { text, active: lease.active, result });
  return result;
}

async function readAloud(segments, model, lease, options) {
  const openPlayback = options.openPlayback ?? openBluetoothPlayback;
  const synthesize = options.synthesize ?? synthesizeStream;
  const playFile = options.playFile ?? playBluetoothAudio;
  const toWav = options.pcmToWav ?? pcmToWav;
  const gap = options.silencePcm ?? silencePcm;
  let opening;
  let player;
  const abortPlayer = () => player?.abort?.();
  lease.signal.addEventListener("abort", abortPlayer);
  const pcm = [];
  let streamed = false;
  let fileAudio;
  const release = () => {
    lease.signal.removeEventListener("abort", abortPlayer);
    lease.finish();
  };
  // The speaker drains in real time; synthesis must not wait on it, or the
  // browser copy arrives only after the headset has finished.
  let feeding = Promise.resolve();
  const writeChunk = (chunk) => {
    if (!chunk?.length) return;
    pcm.push(chunk);
    if (!lease.active()) return;
    opening ??= openPlayback().catch(() => ({ skipped: true }));
    feeding = feeding.then(async () => {
      player ??= await opening;
      if (player.skipped || !lease.active()) return;
      try {
        await player.write(chunk);
      } catch {
        player.skipped = true;
        player.abort?.();
      }
    });
  };
  try {
    for (const segment of segments) {
      if (!lease.active()) break;
      const outcome = await synthesize({ text: segment.text, model, signal: lease.signal }, writeChunk);
      if (!outcome.streamed) {
        fileAudio = outcome.audio;
        break;
      }
      streamed = true;
      if (segment.gapMs > 0 && lease.active()) writeChunk(gap(segment.gapMs));
    }
  } catch (err) {
    void opening?.then((opened) => opened.abort?.());
    release();
    if (lease.signal.aborted) throw cancelledSpeech();
    throw err;
  }
  const audio = streamed ? toWav(Buffer.concat(pcm)) : fileAudio;
  const headset = opening ? await opening : null;
  if (!lease.active()) {
    headset?.abort?.();
    release();
    throw cancelledSpeech();
  }
  if (streamed && headset && !headset.skipped) {
    void feeding
      .then(() => (headset.skipped || !lease.active() ? headset.abort?.() : headset.close()))
      .catch(() => headset.abort?.())
      .finally(release);
    return { bluetooth: "played", audio };
  }
  headset?.abort?.();
  let bluetooth = "skipped";
  if (!streamed && fileAudio) {
    try {
      if ((await playFile(fileAudio)).played) bluetooth = "played";
    } catch {
      // Browser playback remains available.
    }
  }
  release();
  return { bluetooth, audio };
}

export function interruptSpeech() {
  return duplex.interrupt();
}

export function languageForTranscribe(requestedLanguage, configLanguage) {
  if (requestedLanguage === null) return configLanguage || undefined;
  return validateConfigPatch({ language: requestedLanguage }).language || undefined;
}

export async function transcribeFromHttp({ languageParam, contentType, bytes }) {
  const config = readConfig();
  const text = await transcribeAudio({
    bytes,
    contentType,
    language: languageForTranscribe(languageParam, config.language),
    preferred: config.model,
  });
  return { text };
}

const hostCapture = createCaptureSession({
  open: beginHostCapture,
  read: (from) => readHostCapture(from),
  close: endHostCapture,
  reset: resetHostCapture,
  transcribe(wav, signal) {
    const config = readConfig();
    return transcribeAudio({
      bytes: wav,
      contentType: "audio/wav",
      language: languageForTranscribe(null, config.language),
      preferred: config.model,
      signal,
    });
  },
});

export async function captureStart() {
  await interruptSpeech();
  return hostCapture.start();
}

export function captureStop(cancel) {
  hostCapture.stop(cancel);
  return hostCapture.status();
}

export function captureStatus() {
  return hostCapture.status();
}

export async function transcribeAudio({ bytes, contentType, language, preferred, signal }) {
  const model = await resolveSttModel(preferred);
  if (!model) {
    throw new VoiceError("voice_model_unavailable", 503, "no voice model available in the Router catalog");
  }
  if (bytes.length === 0) throw new VoiceError("voice_audio_unreadable", 400, "audio content is empty");
  const pcm = await normalizeSttPcm(bytes, contentType);
  return transcribe({
    bytes: pcm,
    filename: "voice.wav",
    contentType: "audio/wav",
    model,
    language,
    preferred,
    signal,
  });
}
