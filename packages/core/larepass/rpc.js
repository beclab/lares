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

/**
 * Call sites use `namespace.method`. The Host gateway claims `namespace/method`
 * and 404s a single path segment such as `session.list`.
 */
export function hostEndpoint(method) {
  const name = String(method ?? "");
  if (name.includes("/")) return name;
  const dot = name.indexOf(".");
  if (dot <= 0 || dot === name.length - 1) return name;
  return `${name.slice(0, dot)}/${name.slice(dot + 1)}`;
}

/**
 * Wire body for one call. `session.history` is `session/page`. `session/list`
 * names its argument `_request`; settings uses direct named parameters.
 * Prompt requires a `requestId` the call site does not carry.
 */
export function hostCall(method, payload = {}) {
  let endpoint = hostEndpoint(method);
  const body = payload && typeof payload === "object" ? payload : {};
  if (endpoint === "session/history") {
    endpoint = "session/page";
    const throughSeq = Number.isInteger(body.throughSeq) ? body.throughSeq : -1;
    return {
      endpoint,
      args: {
        request: {
          address: { kind: "session", sessionId: body.sessionId },
          throughSeq,
        },
      },
    };
  }
  if (endpoint === "session/list") return { endpoint, args: { _request: body } };
  // Parameterless endpoints reject even an empty `request` object.
  if (endpoint === "session/modelCatalog" || endpoint === "settings/describe") return { endpoint, args: {} };
  if (endpoint === "settings/update") return { endpoint, args: body };
  if (endpoint === "$events/result") return { endpoint, args: body };
  if (endpoint === "session/prompt") {
    return {
      endpoint,
      args: { request: { requestId: body.requestId || mintRpcId(), ...body } },
    };
  }
  return { endpoint, args: { request: body } };
}

export function rpcPath(method) {
  return `/api/${hostCall(method).endpoint}`;
}

export const RESPOND_PATH = "/api/respond";

export function wrapClientResponse(rpcId, result) {
  return {
    type: "client-response",
    rpcId,
    result,
  };
}

export function wrapClientRequest(method, payload = {}) {
  const call = hostCall(method, payload);
  return {
    type: "client-request",
    rpcId: mintRpcId(),
    method: call.endpoint,
    payload: { args: call.args },
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

export function promptPayload(sessionId, textOrContent, timeZone, mode = "queue") {
  const content = Array.isArray(textOrContent)
    ? textOrContent
    : [{ type: "text", text: String(textOrContent ?? "") }];
  return {
    sessionId,
    mode: mode === "steer" ? "steer" : "queue",
    content,
    ...(timeZone ? { clientTimeZone: timeZone } : {}),
  };
}
