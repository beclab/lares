import { mintRpcId } from "../larepass/rpc.js";
import { createSessionFollow } from "../larepass/mux.js";
import { reduceUtterance } from "./speech.js";

export const SPOKEN_PROMPT = "This is a voice conversation. Keep user-facing answers concise and natural for speech. Do not read reasoning or tool payloads aloud. Preserve the task's factual results and use the user's language.";

/** The Host owns the binding; model tools cannot pick a workspace or session. */
export function createVoiceAgentSession(api, { sessionId = null, preset, workspaceId, metric = () => {} } = {}) {
  let creating;
  let following;
  let closed = false;
  let running = false;
  let utterance = null;
  let error = null;
  let version = 0;
  let cursor = -1;
  let pending = null;
  let firstTextAt = null;
  let followTask = null;
  let ready = null;
  let readyTimer;
  let recovering = false;
  const requests = new Map();
  const decoder = createSessionFollow();
  const snapshot = () => ({ sessionId, running, utterance, error, version });
  const ensure = async () => {
    if (sessionId) return sessionId;
    creating ??= Promise.resolve(api.create({ agentPreset: preset, workspaceId })).then((value) => {
      sessionId = value.sessionId;
      return sessionId;
    });
    return creating;
  };
  const publish = (event) => {
    if (!event || typeof event !== "object") return;
    if (typeof event.seq === "number") {
      if (event.seq <= cursor) return;
      cursor = event.seq;
    }
    if (!event || typeof event !== "object") return;
    if (event.type === "user/message" && (event.data?.requestId ?? event.data?.source?.rpcId) === pending?.id) pending.seen = true;
    if (!pending?.seen) return;
    if (event.type === "turn/start") running = true;
    if (event.type === "turn/end") {
      running = false;
      error = event.data?.reason?.kind === "error" ? "voice_agent_failed" : null;
      if (event.data?.reason?.kind === "cancelled") error = "voice_cancelled";
    }
    utterance = reduceUtterance(utterance, event);
    if (!firstTextAt && utterance?.text) {
      firstTextAt = Date.now();
      metric({ stage: "agent_first_text", durationMs: firstTextAt - pending.at });
    }
    version++;
  };
  const follow = async () => {
    following = new AbortController();
    let resolveReady;
    let rejectReady;
    ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    readyTimer = setTimeout(() => { rejectReady(new Error("voice_agent_timeout")); following.abort(); }, 15_000);
    ready.catch(() => {});
    followTask = (async () => {
      try {
        for await (const frame of api.follow({ address: { kind: "session", sessionId }, assistantStream: true }, following.signal)) {
          const decoded = decoder.push(frame);
          if (frame.type === "snapshot") {
            for (const event of decoded?.events ?? []) cursor = Math.max(cursor, event.seq ?? -1);
            if (recovering) {
              running = false;
              for (const event of decoded?.events ?? []) {
                if (event.type === "turn/start") running = true;
                if (event.type === "turn/end") running = false;
              }
              pending = running ? { id: "@resume", seen: true, at: Date.now() } : null;
              recovering = false;
              version++;
            }
            clearTimeout(readyTimer);
            resolveReady();
          } else for (const event of decoded?.events ?? []) publish(event);
        }
        if (!following.signal.aborted) throw new Error("voice_agent_disconnected");
      } catch (cause) {
        clearTimeout(readyTimer);
        rejectReady(cause);
        if (!following.signal.aborted) { error = "voice_agent_disconnected"; version++; }
      }
    })();
    followTask.catch(() => {});
    return ready;
  };
  return {
    snapshot,
    async open() { if (sessionId) { recovering = true; await follow(); } },
    async submit(text, requestId = mintRpcId(), mode = "queue") {
      if (closed) throw new Error("voice_session_closed");
      if (!String(text).trim()) return snapshot();
      if (requests.has(requestId)) return requests.get(requestId);
      if (requests.size >= 256) throw new Error("voice_session_limit");
      const operation = (async () => {
        await ensure();
        if (!following || following.signal.aborted || error === "voice_agent_disconnected") await follow();
        else await ready;
        pending = { id: requestId, seen: false, at: Date.now() };
        running = true; utterance = null; error = null; firstTextAt = null; version++;
        await api.prompt({ sessionId, requestId, mode: mode === "steer" ? "steer" : "queue", content: [{ type: "text", text }] });
        return snapshot();
      })();
      // Keep failed/unknown submissions too: a retry must never execute the task twice.
      requests.set(requestId, operation);
      return operation;
    },
    async cancel() { if (sessionId) await api.cancel({ sessionId }); },
    async close() {
      closed = true;
      clearTimeout(readyTimer);
      following?.abort();
      await followTask;
    },
  };
}
