/**
 * Settings for voice-input under $DSH_HOME/voice-input/config.json.
 * Empty model → auto-pick first STT row from Router catalog.
 */
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "../../shared/host/json-file.js";

const DEFAULTS = {
  model: "", // Router STT model id; empty = auto
  language: "", // ISO-639-1; empty = detect
};

const WRITABLE = new Set(Object.keys(DEFAULTS));
const SUPPORTED_LANGUAGES = new Set(["", "zh", "en", "ja", "ko"]);
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
    if (typeof value !== "string") invalid(`${key} must be a string`);
    const normalized = value.trim();
    if (key === "model" && !SAFE_MODEL.test(normalized)) invalid("invalid voice model");
    if (key === "language" && !SUPPORTED_LANGUAGES.has(normalized)) invalid("unsupported recognition language");
    patch[key] = normalized;
  }
  return patch;
}

function configPath() {
  const home = process.env.DSH_HOME?.trim() || "/data/dina/dsh-home";
  return join(home, "voice-input", "config.json");
}

/** @returns {typeof DEFAULTS} */
export function readConfig() {
  const stored = readJsonFile(configPath());
  const merged = { ...DEFAULTS };
  const model = typeof stored?.model === "string" ? stored.model.trim() : "";
  const language = typeof stored?.language === "string" ? stored.language.trim() : "";
  if (SAFE_MODEL.test(model)) merged.model = model;
  if (SUPPORTED_LANGUAGES.has(language)) merged.language = language;
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
