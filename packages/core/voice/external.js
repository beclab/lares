import { createHmac, timingSafeEqual } from "node:crypto";

/** A configured Router signs the resolved principal; caller-supplied identity headers are ignored. */
export function verifyVoicePrincipal(headers, secret, { now = Date.now } = {}) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("voice_external_disabled");
  const claim = headers["x-olares-voice-principal"];
  const signature = headers["x-olares-voice-signature"];
  if (typeof claim !== "string" || claim.length > 4096 || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) throw new Error("voice_external_unauthorized");
  const expected = createHmac("sha256", secret).update(claim).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new Error("voice_external_unauthorized");
  let principal;
  try { principal = JSON.parse(Buffer.from(claim, "base64url").toString("utf8")); } catch { throw new Error("voice_external_unauthorized"); }
  if (!Number.isInteger(principal.at) || Math.abs(now() / 1000 - principal.at) > 60 || typeof principal.nonce !== "string" || !/^[a-f0-9]{32}$/.test(principal.nonce) || typeof principal.model !== "string" || (!principal.user && !principal.app)) throw new Error("voice_external_unauthorized");
  return principal;
}

export function authorizeVoicePreset(principal, grants, model) {
  if (principal.model !== model) throw new Error("voice_external_model_mismatch");
  const preset = { "voice-dictation": "dictation", "voice-chat": "chat", "voice-assistant": "assistant", "voice-direct": "direct" }[model];
  if (!preset) throw new Error("voice_external_model_unknown");
  const owner = principal.user || `app:${principal.app}`;
  const grant = grants[owner];
  if (!grant?.presets?.includes(preset)) throw new Error("voice_external_forbidden");
  if (["assistant", "direct"].includes(preset) && (!principal.user || !grant.lares)) throw new Error("voice_external_forbidden");
  return { owner, preset, sessionId: grant.sessionId || null, workspaceId: grant.workspaceId || null, agentPreset: grant.agentPreset || null };
}
