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

export async function listRootSessions(rpc) {
  const listed = await rpc("session.list", {});
  if (!listed.ok) return listed;
  return {
    ok: true,
    status: listed.status || "ok",
    value: { items: rootSessions(listed.value?.items).map(summarizeSession) },
  };
}

export async function ensureSession(rpc) {
  const listed = await listRootSessions(rpc);
  if (!listed.ok) return listed;
  const existing = listed.value.items[0];
  if (existing) {
    return { ok: true, status: "ok", value: { sessionId: existing.sessionId, sessions: listed.value.items } };
  }
  const created = await rpc("session.create", {});
  if (!created.ok) return created;
  const row = summarizeSession({ ...created.value, sessionId: created.value.sessionId });
  return { ok: true, status: "ok", value: { sessionId: row.sessionId, sessions: [row] } };
}

export function rootSessions(items) {
  return (Array.isArray(items) ? items : []).filter(
    (row) => row?.sessionId && !row.parentSessionId && row.origin !== "subagent",
  );
}

function basenameCwd(cwd) {
  if (!cwd) return "";
  const base = String(cwd).replace(/[/\\]+$/, "").split(/[/\\]/).pop();
  return base && base !== "." ? base : "";
}

export function sessionTitleOf(row) {
  const projected = row?.projections?.values?.title;
  if (typeof projected === "string" && projected.trim()) return projected.trim();
  if (typeof row?.title === "string" && row.title.trim()) return row.title.trim();
  if (typeof row?.name === "string" && row.name.trim()) return row.name.trim();
  return basenameCwd(row?.cwd);
}

export function summarizeSession(row) {
  return {
    sessionId: row.sessionId,
    title: sessionTitleOf(row),
    updatedAt: Number(row.updatedAt || row.mtime || row.createdAt || 0) || 0,
    blank: Boolean(row.blank),
  };
}

export function visibleHistorySessions(sessions, currentId) {
  return (Array.isArray(sessions) ? sessions : []).filter(
    (row) => row?.sessionId && (!row.blank || row.sessionId === currentId),
  );
}

function startOfLocalDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function groupSessionsByRecency(sessions, now = Date.now()) {
  const today = startOfLocalDay(now);
  const week = today - 7 * 24 * 60 * 60 * 1000;
  const buckets = { today: [], week: [], older: [] };
  const sorted = [...sessions].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  for (const row of sorted) {
    const at = Number(row.updatedAt) || 0;
    if (at >= today) buckets.today.push(row);
    else if (at >= week) buckets.week.push(row);
    else buckets.older.push(row);
  }
  return [
    { id: "today", key: "history.today", rows: buckets.today },
    { id: "week", key: "history.week", rows: buckets.week },
    { id: "older", key: "history.older", rows: buckets.older },
  ].filter((section) => section.rows.length > 0);
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
