/**
 * Which sessions moved on without being watched.
 *
 * The host has no read state to hand down: `session.list` carries `updatedAt`,
 * `running` and `blank` and nothing else. The mux, however, streams events for
 * every session at once, so a client knows about work landing in a session it
 * is not showing. "Seen" is therefore decided here, per device, against the
 * last moment each session was the open one.
 */

export const SEEN_STORAGE_KEY = "lares.session.seen";

/**
 * @param {unknown} value - whatever the store held, including nothing.
 * @param {number} [now]
 * @returns {{ since: number, sessions: Record<string, number> }}
 */
export function readSeen(value, now = Date.now()) {
  const rows = value && typeof value === "object" ? value.sessions : null;
  const sessions = {};
  if (rows && typeof rows === "object") {
    for (const [sessionId, at] of Object.entries(rows)) {
      const stamp = Number(at);
      if (sessionId && Number.isFinite(stamp) && stamp > 0) sessions[sessionId] = stamp;
    }
  }
  const since = Number(value && typeof value === "object" ? value.since : 0);
  return { since: Number.isFinite(since) && since > 0 ? since : now, sessions };
}

export function markSeen(seen, sessionId, at = Date.now()) {
  if (!sessionId) return seen;
  const previous = seen.sessions[sessionId] ?? 0;
  const stamp = Math.max(previous, Number(at) || 0);
  if (stamp === previous) return seen;
  return { since: seen.since, sessions: { ...seen.sessions, [sessionId]: stamp } };
}

/** Forget rows the host no longer lists, so the store cannot grow forever. */
export function pruneSeen(seen, sessions) {
  const live = new Set((Array.isArray(sessions) ? sessions : []).map((row) => row?.sessionId).filter(Boolean));
  const kept = Object.entries(seen.sessions).filter(([sessionId]) => live.has(sessionId));
  if (kept.length === Object.keys(seen.sessions).length) return seen;
  return { since: seen.since, sessions: Object.fromEntries(kept) };
}

/**
 * A session never opened on this device is only news when it moved after
 * tracking began — otherwise every history row would light up on first run.
 * The open session is never marked: it is being watched right now.
 *
 * @returns {Record<string, true>} keyed by session id, for template lookups.
 */
export function unseenSessions(sessions, seen, openSessionId = "") {
  const marks = {};
  for (const row of Array.isArray(sessions) ? sessions : []) {
    const sessionId = row?.sessionId;
    if (!sessionId || sessionId === openSessionId || row.blank) continue;
    const updatedAt = Number(row.updatedAt) || 0;
    if (!updatedAt) continue;
    if (updatedAt > (seen.sessions[sessionId] ?? seen.since)) marks[sessionId] = true;
  }
  return marks;
}
