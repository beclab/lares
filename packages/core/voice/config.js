import { readJsonFile, writeJsonFile } from "../tools/json-file.js";
import { dshPluginConfigPath } from "../workspace/home.js";
import { STT_LANGUAGE_CHOICES } from "./languages.js";

export { STT_LANGUAGE_CHOICES, VOICE_AUTO, voiceMenuValue, voiceValueFromMenu } from "./languages.js";

import { VOICE_DEFAULTS as DEFAULTS, VOICE_PRESETS } from "./options.js";

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
    if (key === "preset") {
      if (!VOICE_PRESETS.includes(value)) invalid("invalid voice preset");
      patch[key] = value; continue;
    }
    if (key === "endpointSilenceMs") {
      if (!Number.isInteger(value) || value < 200 || value > 3000) invalid("invalid endpoint delay");
      patch[key] = value; continue;
    }
    if (key === "idleTimeoutMs" || key === "recoveryTimeoutMs") {
      if (!Number.isInteger(value) || value < 10_000 || value > 3_600_000) invalid(`invalid ${key}`);
      patch[key] = value;
      continue;
    }
    if (key === "speak" || key === "streaming" || key === "dictationCleanup") {
      if (typeof value !== "boolean") invalid(`${key} must be a boolean`);
      patch[key] = value;
      continue;
    }
    if (["mode", "mobileMode", "device", "backend"].includes(key)) {
      const choices = { mobileMode: ["single", "continuous"], mode: ["single", "continuous"], device: ["auto", "device", "headset"], backend: ["pipeline", "realtime"] };
      if (!choices[key].includes(value)) invalid(`invalid ${key}`);
      patch[key] = value;
      continue;
    }
    if (typeof value !== "string") invalid(`${key} must be a string`);
    const normalized = value.trim();
    if ((key === "model" || key === "ttsModel" || key === "realtimeModel" || key === "chatModel" || key === "voice") && !SAFE_MODEL.test(normalized)) invalid("invalid voice model");
    if (key === "instructions" && normalized.length > 8000) invalid("voice instructions too long");
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
  for (const key of Object.keys(DEFAULTS)) {
    if (stored?.[key] !== undefined) {
      try { Object.assign(merged, validateConfigPatch({ [key]: stored[key] })); } catch {}
    }
  }
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
