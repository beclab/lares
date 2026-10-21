/**
 * dsh sends its own session id as `x-session-id` on Agent model calls. While a
 * keyed Realtime session drives that dsh session, the shim forwards Router's
 * realtime session id instead, so Router groups the Agent's calls under the
 * voice session (Router ADR-83).
 */
const aliases = new Map();

export function bindRouterSession(dshSessionId, routerSessionId) {
  if (!dshSessionId || !routerSessionId) return () => {};
  aliases.set(dshSessionId, routerSessionId);
  return () => { if (aliases.get(dshSessionId) === routerSessionId) aliases.delete(dshSessionId); };
}

export function routerSessionFor(dshSessionId) {
  return aliases.get(dshSessionId) || dshSessionId;
}
