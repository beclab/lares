import { mintRpcId } from "../larepass/rpc.js";
import { createSessionFollow } from "../larepass/mux.js";
import { createInboxTracker } from "../larepass/queue.js";
import { reduceUtterance } from "./speech.js";
import { ROUTER_PROVIDER_ID } from "../router/models.js";

export const SPOKEN_PROMPT = "This is a voice conversation. Keep user-facing answers concise and natural for speech. Do not read reasoning or tool payloads aloud. Preserve the task's factual results and use the user's language.";
// A device's dialogue model turns the Agent's answer into one spoken sentence. A weather lookup came
// back as a page of markdown with humidity, a coat tip, a week's forecast and unrelated news, which
// took 11-14 s to write and left the dialogue to guess what mattered.
export const DEVICE_SPOKEN_PROMPT = "The answer is spoken by a small voice device: give only what the user asked for, in at most two short sentences of plain text. No markdown, headings, lists, links, citations, emoji, advice or follow-up offers. Use the units of the user's language (°C for Chinese).";

/** dsh opens a turn before claiming input; rpcId associates input with that open turn. */
export function createVoiceAgentSession(api, { sessionId = null, preset, workspaceId, restoredRequests = [], onChange = () => {}, metric = () => {}, fallbackModel = async () => null } = {}) {
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
  const inbox = createInboxTracker();
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
    if (sessionId) inbox.apply(sessionId, [event]);
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
      if (!replay && task.utterance?.done && !task.utterance.silent && !task.speechReadyAt) {
        task.speechReadyAt = Date.now();
        metric({ stage: "agent_speech_ready", requestId: task.requestId, durationMs: task.speechReadyAt - task.at });
      }
      if (!replay && task.requestId === latestRequest) { utterance = task.utterance; error = task.error; }
    }
    if (event.type === "turn/end" && openTurn === event.data?.turn) { openTurn = null; observedRunning = false; }
    version++; onChange();
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
            if (decoded?.projections) inbox.seed(sessionId, decoded.projections);
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
          const send = () => api.prompt({ sessionId, requestId, mode: mode === "steer" ? "steer" : "queue", content: [{ type: "text", text }] }, following.signal);
          try {
            await send();
          } catch (cause) {
            // A Session keeps the model its last request used. Once Router stops serving it (an
            // engine stopped for a GPU-mode change), every hand-off fails until the Session moves to
            // what Router's default-chat answers with now; the refused prompt was never recorded.
            const model = cause?.code === "session/model-unavailable" ? await fallbackModel() : null;
            if (!model) throw cause;
            await api.selectModel({ sessionId, provider: ROUTER_PROVIDER_ID, model });
            metric({ stage: "agent_model_fallback", requestId, model });
            await send();
          }
          return snapshot();
        } catch (cause) {
          task.status = "unknown"; task.error = "submission_outcome_unknown"; version++;
          throw cause;
        }
      })();
      return task.operation;
    },
    async cancel() { if (sessionId) await api.cancel({ sessionId }); },
    /**
     * Withdraws one request: a queued prompt leaves the dsh inbox, the running turn is cancelled.
     * Anything else (unknown, finished, steered into the current step) is not cancellable.
     * @returns {Promise<"withdrawn" | "cancelled" | "not_cancellable">}
     */
    async withdraw(requestId) {
      const task = requests.get(requestId);
      if (!task || !unfinished(task) || task.status === "unknown") return "not_cancellable";
      if (task.status === "accepted") await task.operation?.catch(() => {});
      if (task.turn != null && task.turn === openTurn && ["running", "waiting"].includes(task.status)) {
        await api.cancel({ sessionId });
        return "cancelled";
      }
      const queued = sessionId && inbox.messages(sessionId).find((message) => message?.source?.rpcId === requestId);
      if (!queued) return "not_cancellable";
      try {
        await api.updateQueue({ sessionId, itemId: queued.id, action: { kind: "remove" } });
      } catch (cause) {
        if (cause?.code === "session/queue-item-not-found") return "not_cancellable";
        throw cause;
      }
      task.status = "cancelled"; task.error = "voice_cancelled"; version++; onChange();
      return "withdrawn";
    },
    async close() { closed = true; clearTimeout(readyTimer); following?.abort(); await followTask; },
  };
}
