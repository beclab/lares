import { mintRpcId } from "../larepass/rpc.js";
import { createSessionFollow } from "../larepass/mux.js";
import { reduceUtterance } from "./speech.js";

export const SPOKEN_PROMPT = "This is a voice conversation. Keep user-facing answers concise and natural for speech. Do not read reasoning or tool payloads aloud. Preserve the task's factual results and use the user's language.";

/** dsh opens a turn before claiming input; rpcId associates input with that open turn. */
export function createVoiceAgentSession(api, { sessionId = null, preset, workspaceId, restoredRequests = [], metric = () => {} } = {}) {
  let creating;
  let following;
  let closed = false;
  let utterance = null;
  let error = null;
  let version = 0;
  let cursor = -1;
  let openTurn = null;
  let latestRequest = null;
  let followTask = null;
  let ready = null;
  let readyTimer;
  let observedRunning = false;
  const requests = new Map();
  for (const restored of restoredRequests.slice(-256)) {
    requests.set(restored.requestId, { requestId: restored.requestId, turn: null, status: "unknown", utterance: null, error: null, at: Date.now(), firstTextAt: null });
  }
  const decoder = createSessionFollow();
  const unfinished = (task) => ["accepted", "running", "waiting", "unknown"].includes(task.status);
  const snapshot = () => ({ sessionId, running: observedRunning || [...requests.values()].some(unfinished), utterance, error, version,
    requestId: latestRequest, cursor,
    tasks: [...requests.values()].map(({ requestId, turn, status, utterance: reply, error: taskError }) => ({ requestId, turn, status, text: reply?.silent ? "" : reply?.text || "", error: taskError })),
  });
  const ensure = async () => {
    if (sessionId) return sessionId;
    creating ??= Promise.resolve(api.create({ agentPreset: preset, workspaceId })).then((value) => {
      if (!value?.sessionId) throw new Error("voice_session_failed");
      sessionId = value.sessionId;
      return sessionId;
    });
    return creating;
  };
  const publish = (event, replay = false) => {
    if (!event || typeof event !== "object") return;
    if (typeof event.seq === "number") {
      if (event.seq <= cursor) return;
      cursor = event.seq;
    }
    if (event.type === "turn/start") { openTurn = event.data.turn; observedRunning = true; }
    if (event.type === "user/message") {
      const id = event.data?.requestId ?? event.data?.source?.rpcId;
      const task = requests.get(id);
      if (task && openTurn !== null) { task.turn = openTurn; task.status = "running"; }
    }
    const turn = event.data?.turn ?? openTurn;
    const owned = [...requests.values()].filter((task) => task.turn != null && task.turn === turn && unfinished(task));
    for (const task of owned) {
      task.utterance = reduceUtterance(task.utterance, event);
      if (event.type === "approval/asked") task.status = "waiting";
      if (event.type === "approval/decided") task.status = "running";
      if (event.type === "turn/end") {
        const reason = event.data?.reason?.kind;
        task.status = reason === "error" ? "failed" : reason === "cancelled" ? "cancelled" : "completed";
        task.error = reason === "error" ? "voice_agent_failed" : reason === "cancelled" ? "voice_cancelled" : null;
      }
      if (!replay && task.utterance?.text && !task.firstTextAt) {
        task.firstTextAt = Date.now();
        metric({ stage: "agent_first_text", requestId: task.requestId, durationMs: task.firstTextAt - task.at });
      }
      if (!replay && task.requestId === latestRequest) { utterance = task.utterance; error = task.error; }
    }
    if (event.type === "turn/end" && openTurn === event.data?.turn) { openTurn = null; observedRunning = false; }
    version++;
  };
  const follow = () => {
    if (following && !following.signal.aborted) return ready;
    const abort = new AbortController();
    following = abort;
    let resolveReady;
    let rejectReady;
    ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    readyTimer = setTimeout(() => { rejectReady(new Error("voice_agent_timeout")); abort.abort(); }, 15_000);
    ready.catch(() => {});
    abort.signal.addEventListener("abort", () => rejectReady(new Error("voice_session_closed")), { once: true });
    followTask = (async () => {
      try {
        for await (const frame of api.follow({ address: { kind: "session", sessionId }, assistantStream: true }, abort.signal)) {
          const decoded = decoder.push(frame);
          if (frame.type === "snapshot") {
            for (const event of decoded?.events ?? []) publish(event, true);
            clearTimeout(readyTimer); resolveReady();
          } else for (const event of decoded?.events ?? []) publish(event);
        }
        if (!abort.signal.aborted) throw new Error("voice_agent_disconnected");
      } catch (cause) {
        clearTimeout(readyTimer); rejectReady(cause);
        if (!abort.signal.aborted) { error = "voice_agent_disconnected"; version++; abort.abort(); }
      }
    })();
    followTask.catch(() => {});
    return ready;
  };
  return {
    snapshot,
    async ensureSession() { await ensure(); await follow(); return snapshot(); },
    async open() { if (sessionId) await follow(); },
    async resume() {
      following?.abort(); await followTask;
      closed = false; error = null; utterance = null; cursor = -1; openTurn = null; observedRunning = false; decoder.reset();
      if (sessionId) await follow();
    },
    async submit(text, requestId = mintRpcId(), mode = "queue") {
      if (closed) throw new Error("voice_session_closed");
      if (!String(text).trim()) return snapshot();
      if (requests.has(requestId)) return requests.get(requestId).operation || snapshot();
      if (requests.size >= 256) throw new Error("voice_session_limit");
      const task = { requestId, turn: null, status: "accepted", utterance: null, error: null, at: Date.now(), firstTextAt: null };
      requests.set(requestId, task);
      latestRequest = requestId; utterance = null; error = null; version++;
      task.operation = (async () => {
        try {
          await ensure();
          await follow();
          await api.prompt({ sessionId, requestId, mode: mode === "steer" ? "steer" : "queue", content: [{ type: "text", text }] }, following.signal);
          return snapshot();
        } catch (cause) {
          task.status = "unknown"; task.error = "submission_outcome_unknown"; version++;
          throw cause;
        }
      })();
      return task.operation;
    },
    async cancel() { if (sessionId) await api.cancel({ sessionId }); },
    async close() { closed = true; clearTimeout(readyTimer); following?.abort(); await followTask; },
  };
}
