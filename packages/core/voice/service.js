import { readConfig, validateConfigPatch, writeConfig } from "./config.js";
import {
  STT_MAX_AUDIO_BYTES,
  VoiceError,
  audioFilenameForContentType,
  listModels,
  pickSttModelId,
  resolveSttModel,
  sttModelIds,
  transcribe,
} from "../router/stt.js";

export { STT_MAX_AUDIO_BYTES };

export async function voiceStatusPayload() {
  const config = readConfig();
  let modelAvailable = false;
  let resolvedModel = config.model;
  try {
    const models = await listModels();
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

export async function voiceModelsPayload() {
  const models = await listModels();
  const ids = models.map((model) => model.id);
  const stt = sttModelIds(models);
  const selected = pickSttModelId(models, readConfig().model);
  return { models: ids, stt, selected };
}

export async function saveVoiceConfig(body) {
  const patch = validateConfigPatch(body);
  if (patch.model) {
    const available = sttModelIds(await listModels());
    if (!available.includes(patch.model)) {
      throw new VoiceError("voice_model_unavailable", 400, "selected voice model is not available");
    }
  }
  return writeConfig(patch);
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

export async function transcribeAudio({ bytes, contentType, language, preferred }) {
  const model = await resolveSttModel(preferred);
  if (!model) {
    throw new VoiceError("voice_model_unavailable", 503, "no voice model available in the Router catalog");
  }
  if (bytes.length === 0) throw new VoiceError("voice_audio_unreadable", 400, "audio content is empty");
  return transcribe({
    bytes,
    filename: audioFilenameForContentType(contentType),
    contentType,
    model,
    language,
    preferred,
  });
}
