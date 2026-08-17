/**
 * Settings for voice-input under $DSH_HOME/voice-input/config.json.
 * Empty model → auto-pick first STT row from Router catalog.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULTS = {
  model: "", // Router STT model id; empty = auto
  language: "", // ISO-639-1; empty = detect
};

const WRITABLE = new Set(Object.keys(DEFAULTS));

function configPath() {
  const home = process.env.DSH_HOME?.trim() || "/data/dina/dsh-home";
  return join(home, "voice-input", "config.json");
}

/** @returns {typeof DEFAULTS} */
export function readConfig() {
  const path = configPath();
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    const stored = JSON.parse(readFileSync(path, "utf8"));
    const merged = { ...DEFAULTS };
    for (const key of WRITABLE) {
      if (typeof stored?.[key] === "string") merged[key] = stored[key];
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

/** @param {Record<string, unknown>} patch @returns {typeof DEFAULTS} */
export function writeConfig(patch) {
  const next = readConfig();
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!WRITABLE.has(key)) continue;
    if (typeof value !== "string") continue;
    next[key] = value.trim();
  }
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  return next;
}
