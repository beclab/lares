import { isAuthFailure } from "./host.js";
import { consumeMux, MUX_PATH } from "./mux.js";
import { foldTranscript, mergeEvents } from "./transcript.js";
import { promptPayload, rpcPath, unwrapServerResponse, wrapClientRequest } from "./rpc.js";

function httpStatus(res) {
  return Number(res?.status) || 0;
}

function asError(code, message, extra = {}) {
  return { ok: false, error: { code, message }, ...extra };
}

export async function callRpc(request, method, payload = {}) {
  const envelope = wrapClientRequest(method, payload);
  let res;
  try {
    res = await request(rpcPath(method), { method: "POST", body: envelope });
  } catch (err) {
    return asError("unreachable", err instanceof Error ? err.message : String(err), { status: "unreachable" });
  }
  const http = httpStatus(res);
  if (isAuthFailure(http)) {
    return asError("unauthorized", `Host rejected this login (${http})`, { status: "unauthorized", http });
  }
  if (http < 200 || http >= 300) {
    return asError("http", `Host returned ${http}`, { status: "error", http });
  }
  const parsed = unwrapServerResponse(res.body);
  if (!parsed.ok) return { ...parsed, status: "rpc-error", http };
  return { ...parsed, status: "ok", http };
}

export async function ensureSession(rpc) {
  const listed = await rpc("session.list", {});
  if (!listed.ok) return listed;
  const items = Array.isArray(listed.value?.items) ? listed.value.items : [];
  const existing = items.find((row) => row?.sessionId && !row.parentSessionId && row.origin !== "subagent");
  if (existing) return { ok: true, status: "ok", value: { sessionId: existing.sessionId } };
  return rpc("session.create", {});
}

export async function loadTranscript(rpc, sessionId) {
  const history = await rpc("session.history", { sessionId });
  if (!history.ok) return history;
  return { ok: true, status: "ok", value: foldTranscript(history.value?.events) };
}

export function clientTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

export function sendPrompt(rpc, sessionId, text) {
  return rpc("session.prompt", promptPayload(sessionId, text, clientTimeZone()));
}

export { consumeMux, mergeEvents, MUX_PATH };
