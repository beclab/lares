import { VOICE_KEY_MODELS } from "./key-models.js";

export { VOICE_KEY_MODELS };
/** Agent-driving models act as the Lares owner; a new key leaves them out unless chosen. */
export const VOICE_KEY_AGENT_MODELS = Object.freeze(["voice-assistant", "voice-direct"]);
export const VOICE_KEY_DEFAULT_MODELS = Object.freeze(VOICE_KEY_MODELS.filter((model) => !VOICE_KEY_AGENT_MODELS.includes(model)));
/** Models whose voice dialogue can call tools a device declares (`clientTools`). */
export const VOICE_KEY_TOOL_MODELS = Object.freeze(["voice-chat", "voice-assistant"]);
const PATH = "/api/lares/voice/keys";

/** Browser request port with the `{ ok, status, body }` shape the mobile host request uses. */
export async function fetchVoiceRequest(path, { method = "GET", body } = {}) {
  const res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  return { ok: res.ok, status: res.status, body: payload };
}

const value = (res) => {
  if (res?.ok) return res.body;
  throw new Error(res?.body?.error?.code || "voice_key_failed");
};

/** Owner voice keys for server-side Realtime callers (docs/realtime-protocol.md). */
export function createVoiceKeysClient(request = fetchVoiceRequest) {
  return {
    async list() { return value(await request(PATH)).keys || []; },
    /** The returned `key` is shown once; the Host stores only its hash. */
    async issue({ name, models, clientTools = false }) { return value(await request(PATH, { method: "POST", body: { name: String(name || "").trim(), models, clientTools } })); },
    async revoke(id) { return value(await request(PATH, { method: "DELETE", body: { id } })).revoked === true; },
  };
}
