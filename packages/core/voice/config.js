import { readJsonFile, writeJsonFile } from "../tools/json-file.js";
import { dshPluginConfigPath } from "../workspace/home.js";
import { STT_LANGUAGE_CHOICES } from "./languages.js";

export { STT_LANGUAGE_CHOICES, VOICE_AUTO, voiceMenuValue, voiceValueFromMenu } from "./languages.js";

const DEFAULTS = {
  mode: "single",
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

const WRITABLE = new Set(Object.keys(DEFAULTS));
const SUPPORTED_LANGUAGES = new Set(["", ...STT_LANGUAGE_CHOICES.map((item) => item.id)]);
const SAFE_MODEL = /^[^\u0000-\u001f\u007f]{0,512}$/;

function invalid(message) {
  throw Object.assign(new Error(message), { code: "voice_config_invalid", status: 400 });
}

/** @param {unknown} raw @returns {Partial<typeof DEFAULTS>} */
export function validateConfigPatch(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("config patch must be an object");
  const patch = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!WRITABLE.has(key)) invalid(`unknown voice setting: ${key}`);
    if (key === "speak" || key === "streaming") {
      if (typeof value !== "boolean") invalid(`${key} must be a boolean`);
      patch[key] = value;
      continue;
    }
    if (["mode", "device", "backend"].includes(key)) {
      const choices = { mode: ["single", "continuous"], device: ["auto", "device", "headset"], backend: ["pipeline", "realtime"] };
      if (!choices[key].includes(value)) invalid(`invalid ${key}`);
      patch[key] = value;
      continue;
    }
    if (typeof value !== "string") invalid(`${key} must be a string`);
    const normalized = value.trim();
    if ((key === "model" || key === "ttsModel" || key === "realtimeModel") && !SAFE_MODEL.test(normalized)) invalid("invalid voice model");
    if (key === "language" && !SUPPORTED_LANGUAGES.has(normalized)) invalid("unsupported recognition language");
    patch[key] = normalized;
  }
  return patch;
}

function configPath() {
  return dshPluginConfigPath("voice-input");
}

/** @returns {typeof DEFAULTS} */
export function readConfig() {
  const stored = readJsonFile(configPath());
  const merged = { ...DEFAULTS };
  const model = typeof stored?.model === "string" ? stored.model.trim() : "";
  const ttsModel = typeof stored?.ttsModel === "string" ? stored.ttsModel.trim() : "";
  const language = typeof stored?.language === "string" ? stored.language.trim() : "";
  if (SAFE_MODEL.test(model)) merged.model = model;
  if (SAFE_MODEL.test(ttsModel)) merged.ttsModel = ttsModel;
  if (SUPPORTED_LANGUAGES.has(language)) merged.language = language;
  for (const key of ["mode", "device", "backend", "realtimeModel"]) {
    if (stored?.[key] !== undefined) {
      try { Object.assign(merged, validateConfigPatch({ [key]: stored[key] })); } catch {}
    }
  }
  if (stored?.speak === true) merged.speak = true;
  if (stored?.streaming === true) merged.streaming = true;
  return merged;
}

/** @param {Record<string, unknown>} patch @returns {typeof DEFAULTS} */
export function writeConfig(patch) {
  const next = readConfig();
  for (const [key, value] of Object.entries(validateConfigPatch(patch))) {
    next[key] = value;
  }
  const path = configPath();
  writeJsonFile(path, next);
  return next;
}
