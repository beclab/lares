import { mintRpcId } from "../larepass/rpc.js";

export const REALTIME_INSTRUCTIONS = "You are Lares's voice interface. Speak naturally and briefly in the user's language. Delegate every business task, lookup or system action to ask_lares. Never claim a task succeeded without its result. Do not expose reasoning or raw tool payloads. If a task is pending or requires approval, tell the user to check the Lares conversation; never approve on their behalf. Use operation=status to check an existing task, never submit it again to check progress.";
export const LARES_TOOL = {
  type: "function", name: "ask_lares", description: "Run a user task in the bound Lares session or check its current result. The Host owns all session and workspace selection.",
  parameters: { type: "object", properties: { operation: { type: "string", enum: ["run", "status"] }, task: { type: "string", maxLength: 16000 } }, required: ["operation"], additionalProperties: false },
};
export function realtimeModelIds(models) { return models.filter((model) => model.mode === "realtime").map((model) => model.id); }
export function validatedRealtimeModels(models, env = process.env) {
  if (env.LARES_VOICE_REALTIME_ENABLED !== "1") return [];
  const validated = new Set(String(env.LARES_VOICE_REALTIME_VALIDATED_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean));
  return realtimeModelIds(models).filter((id) => validated.has(id));
}

/** One tool execution per provider call id, including unknown submission outcomes. */
export function createRealtimeDelegate({ agent, send, notify = () => {}, calls = new Map(), timeoutMs = 120_000, signal, background = false, onCompleted = () => {}, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let active = false;
  const result = (requestId) => {
    const state = agent.snapshot();
    const task = requestId && state.tasks?.find((value) => value.requestId === requestId);
    if (task) return { ...task, status: ["accepted", "running", "waiting"].includes(task.status) ? "pending" : task.status, sessionId: state.sessionId };
    return { status: state.error ? "failed" : state.running ? "pending" : "completed", sessionId: state.sessionId, text: state.utterance?.silent ? "" : (state.utterance?.text || "").slice(0, 16000), error: state.error || undefined };
  };
  const run = async (event) => {
    let args;
    try { args = JSON.parse(event.arguments); } catch { return { status: "failed", error: "invalid_arguments" }; }
    if (event.name !== "ask_lares" || !args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !["operation", "task"].includes(key))) return { status: "failed", error: "invalid_tool" };
    if (args.operation === "status") return result();
    if (args.operation !== "run" || typeof args.task !== "string" || !args.task.trim() || args.task.length > 16000) return { status: "failed", error: "invalid_task" };
    if (!background && (active || agent.snapshot().running)) return { ...result(), status: "pending" };
    active = true;
    try {
      const requestId = `voice-${mintRpcId()}`;
      await agent.submit(args.task, requestId);
      notify({ type: "lares.task", ...result(requestId) });
      if (background && result(requestId).status === "pending") {
        void (async () => {
          while (!signal?.aborted && result(requestId).status === "pending") await sleep(250);
          if (!signal?.aborted) { const value = result(requestId); notify({ type: "lares.task", ...value }); onCompleted(value); }
        })().catch(() => notify({ type: "lares.task", status: "unknown", requestId, sessionId: agent.snapshot().sessionId }));
        return result(requestId);
      }
      const deadline = Date.now() + timeoutMs;
      while (agent.snapshot().running && !signal?.aborted && Date.now() < deadline) await sleep(100);
      const value = result(requestId);
      notify({ type: "lares.task", ...value });
      return value;
    } catch {
      return { status: "unknown", sessionId: agent.snapshot().sessionId, error: "submission_outcome_unknown", instruction: "Check status; do not submit again." };
    } finally { active = false; }
  };
  return {
    async handle(event) {
      if (!event.call_id || calls.has(event.call_id)) return;
      if (calls.size >= 256) throw new Error("voice_session_limit");
      const promise = run(event);
      calls.set(event.call_id, promise);
      const value = await promise;
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify(value) } });
      send({ type: "response.create" });
    },
  };
}
