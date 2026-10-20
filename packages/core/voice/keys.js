import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { readJsonFile, writeJsonFile } from "../tools/json-file.js";
import { dshPluginConfigPath } from "../workspace/home.js";

export const VOICE_KEY_MODELS = Object.freeze(["voice-dictation", "voice-chat", "voice-assistant", "voice-direct"]);
const KEY = /^lvk_([a-f0-9]{16})_[A-Za-z0-9_-]{43}$/;
const LIMIT = 32;

function invalid(message) {
  throw Object.assign(new Error(message), { code: "voice_key_invalid", status: 400 });
}
const digest = (key) => createHash("sha256").update(key).digest();
const view = ({ hash: _hash, ...record }) => record;
const optional = (value, name) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) invalid(`invalid ${name}`);
  return value;
};

/**
 * Owner-issued credentials for server-side Realtime callers such as Router.
 * Only hashes are stored; the file is re-read on every check so revocation needs no restart.
 */
export function createVoiceKeyStore({ path = join(dirname(dshPluginConfigPath("voice-input")), "keys.json"), now = Date.now } = {}) {
  const read = () => {
    const stored = readJsonFile(path);
    return Array.isArray(stored?.keys) ? stored.keys : [];
  };
  return {
    list: () => read().map(view),
    issue(body = {}) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) invalid("invalid key name");
      const models = Array.isArray(body.models) ? [...new Set(body.models)] : [];
      if (!models.length || models.some((model) => !VOICE_KEY_MODELS.includes(model))) invalid("invalid key models");
      const keys = read();
      if (keys.length >= LIMIT) throw Object.assign(new Error("too many voice keys"), { code: "voice_key_limit", status: 409 });
      const id = randomBytes(8).toString("hex");
      const key = `lvk_${id}_${randomBytes(32).toString("base64url")}`;
      const record = { id, name, models, sessionId: optional(body.sessionId, "sessionId"), workspaceId: optional(body.workspaceId, "workspaceId"), createdAt: new Date(now()).toISOString() };
      writeJsonFile(path, { keys: [...keys, { ...record, hash: digest(key).toString("hex") }] });
      return { ...record, key };
    },
    revoke(id) {
      const keys = read();
      const next = keys.filter((record) => record.id !== id);
      if (next.length === keys.length) return false;
      writeJsonFile(path, { keys: next });
      return true;
    },
    /** @returns {null | { id: string, name: string, models: string[], sessionId: string | null, workspaceId: string | null }} */
    verify(authorization) {
      const key = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
      const match = KEY.exec(key);
      if (!match) return null;
      const record = read().find((value) => value.id === match[1]);
      if (!record || typeof record.hash !== "string" || !/^[a-f0-9]{64}$/.test(record.hash)) return null;
      return timingSafeEqual(digest(key), Buffer.from(record.hash, "hex")) ? view(record) : null;
    },
  };
}
