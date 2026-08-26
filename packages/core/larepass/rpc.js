export function mintRpcId() {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function rpcPath(method) {
  return `/api/${method}`;
}

export function wrapClientRequest(method, payload = {}) {
  return {
    type: "client-request",
    rpcId: mintRpcId(),
    method,
    payload,
  };
}

export function unwrapServerResponse(body) {
  if (body === null || typeof body !== "object" || body.type !== "server-response") {
    return { ok: false, error: { code: "invalid-envelope", message: "invalid rpc envelope" } };
  }
  const result = body.result;
  if (result?.ok === true) return { ok: true, rpcId: body.rpcId, value: result.value };
  if (result?.ok === false) {
    return {
      ok: false,
      rpcId: body.rpcId,
      error: result.error ?? { code: "rpc-error", message: "rpc failed" },
    };
  }
  return { ok: false, rpcId: body.rpcId, error: { code: "invalid-envelope", message: "invalid rpc envelope" } };
}

export function promptPayload(sessionId, text, timeZone) {
  return {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: String(text ?? "") }],
    ...(timeZone ? { clientTimeZone: timeZone } : {}),
  };
}
