import { createVoiceAgentSession } from "./agent-session.js";
import { createVoiceRecords } from "./records.js";
import { createVoiceDialogue, cleanDictation, voiceChat } from "./dialogue.js";
import { readConfig, validateConfigPatch } from "./config.js";
import { listModels } from "../router/stt.js";
import { defaultChatTarget } from "../router/default-route.js";
import { validatedRealtimeModels } from "./realtime.js";
import { VOICE_PRESETS } from "./options.js";
import { voiceCapabilities } from "./capabilities.js";

const failure = (code, status) => Object.assign(new Error(code), { code, status });

/** Presets and task policy stay in core; the Host supplies an authenticated scope. */
export function createVoiceHostService(api, { env = process.env, metric = () => {}, records = createVoiceRecords(), config = readConfig, chat, summaryIdleMs = 60_000 } = {}) {
  const ownerOf = (scope) => scope.owner || "@local";
  const keyOf = (scope) => scope.session?.snapshot().sessionId || `voice:${scope.contextId || scope.id}`;
  const append = (scope, role, text, turnId, taskId = null, fields = {}) => records.append(ownerOf(scope), keyOf(scope), {
    id: `${scope.id}:${turnId}:${role}`, voiceId: scope.id, clientId: scope.id, turnId, role, text: text.slice(0, 16000), taskId, anchorSeq: scope.session?.snapshot().cursor ?? -1, ...fields,
  });
  const ensurePresentation = async (scope) => {
    if (!scope.presentationSession || scope.session.snapshot().sessionId) return;
    const before = keyOf(scope);
    await scope.session.ensureSession();
    if (!scope.active) throw failure("voice_session_closed", 409);
    for (const row of records.read(ownerOf(scope), before).records) records.append(ownerOf(scope), keyOf(scope), row);
    records.clear(ownerOf(scope), before);
    records.bind(ownerOf(scope), scope.contextId, keyOf(scope));
  };
  // Router groups a keyed Realtime session's child requests by its session id (Router ADR-83).
  const chatFor = (scope) => (request) => (chat || voiceChat)({ ...request, ...(scope.routerSessionId ? { headers: { ...request.headers, "x-session-id": scope.routerSessionId } } : {}) });
  // A summary rewrites the whole history on the dialogue model. Queued after every turn it ran
  // behind each utterance on the same model, so it waits for a quiet spell and covers every
  // turn since the last one.
  const summarize = (scope) => {
    clearTimeout(scope.summaryTimer);
    scope.summaryTimer = setTimeout(() => checkpoint(scope), summaryIdleMs);
    scope.summaryTimer.unref?.();
  };
  const checkpoint = (scope) => {
    clearTimeout(scope.summaryTimer); scope.summaryTimer = null;
    if (!scope.dialogue) return;
    if (scope.active && scope.voiceState?.running) { summarize(scope); return; }
    const key = keyOf(scope);
    const checkpointVersion = records.read(ownerOf(scope), key).version;
    scope.summaryTask = Promise.resolve(scope.summaryTask).catch(() => {}).then(() => scope.dialogue.summarize()).then((summary) => records.checkpoint(ownerOf(scope), key, summary, checkpointVersion)).catch((cause) => {
      scope.summaryError = cause.code || cause.message || "voice_summary_failed";
    });
  };
  /**
   * One dialogue step, serialized per scope: a user turn (`text`), a continuation after device results
   * (`text: null`), or the announcement of a finished task. Its outcome becomes the sticky utterance.
   */
  const converse = (scope, { requestId, text, mode, task = null }) => {
    const operation = (scope.voiceSerial || Promise.resolve()).catch(() => {}).then(async () => {
      if (!scope.active || scope.voiceAbort.signal.aborted) throw failure("voice_session_closed", 409);
      if (text !== null) scope.submitMode = mode === "steer" ? "steer" : "queue";
      scope.voiceState.running = true; scope.voiceState.error = null; scope.voiceState.live = null; scope.voiceState.version++;
      const turnId = task ? `result:${task.requestId}` : requestId;
      const fields = task ? { taskTurn: task.turn } : {};
      const taskOf = () => task?.requestId ?? records.read(ownerOf(scope), keyOf(scope)).records.find((row) => row.id === `${scope.id}:${requestId}:user`)?.taskId ?? null;
      if (text !== null) append(scope, "user", text, requestId);
      try {
        if (task) scope.dialogue.observeTask(task);
        const reply = await scope.dialogue.reply(text, requestId, scope.voiceAbort.signal, task ? undefined : (partial, { call = 0, delegated = false } = {}) => {
          // The words being written right now, for a device that reads them while they are written.
          const live = scope.voiceState.live?.key === requestId && scope.voiceState.live.call === call ? scope.voiceState.live : { key: requestId, call, text: "", delegated: false };
          scope.voiceState.live = { ...live, ...(partial === null ? {} : { text: partial }), delegated: live.delegated || delegated };
          if (partial !== null) append(scope, "assistant", partial, turnId, taskOf(), { status: "streaming", ...fields });
        }, { announce: Boolean(task) });
        if (reply.text) append(scope, "assistant", reply.text, turnId, taskOf(), fields);
        summarize(scope);
        const key = task ? `task:${task.requestId}` : requestId;
        scope.voiceState.utterance = { key, turn: scope.voiceState.version, step: 0, text: reply.text, calls: reply.calls, done: true, silent: !reply.text && !reply.calls.length };
      } catch (cause) {
        scope.voiceState.error = cause.code || cause.message || "voice_failed";
        const partial = records.read(ownerOf(scope), keyOf(scope)).records.find((row) => row.id === `${scope.id}:${turnId}:assistant`);
        if (partial) append(scope, "assistant", partial.text, turnId, partial.taskId, { status: "failed", ...fields });
        throw cause;
      }
      finally { scope.voiceState.running = false; scope.voiceState.version++; }
      return service.state(scope);
    });
    scope.voiceSerial = operation;
    return operation;
  };
  const scopes = new Set();
  const service = {
    /** Whether a device's dialogue drives this Agent Session now, so what it writes ends up spoken by that device. */
    drivesDevice(sessionId) {
      return Boolean(sessionId) && [...scopes].some((scope) => scope.active && scope.dialogue?.isDevice() && scope.session?.snapshot().sessionId === sessionId);
    },
    async clean(scope, text, options = {}) {
      if (typeof text !== "string" || text.length > 16000) throw failure("voice_input_invalid", 400);
      if (options.config && Object.keys(options.config).some((key) => key !== "dictationProfiles")) throw failure("voice_config_invalid", 400);
      return cleanDictation(text, { config: { ...config(), ...validateConfigPatch(options.config || {}) }, owner: scope.owner, chat: chatFor(scope), preset: options.preset, signal: options.signal });
    },
    async open(scope, body) {
      if (scope.active || scope.opening || scope.closing) throw failure("voice_session_active", 409);
      const epoch = scope.epoch = (scope.epoch || 0) + 1;
      scope.opening = true;
      try {
      if (body.sessionId != null && (typeof body.sessionId !== "string" || !body.sessionId || body.sessionId.length > 256)) throw failure("voice_session_invalid", 400);
      if (body.contextId != null && (typeof body.contextId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(body.contextId))) throw failure("voice_context_invalid", 400);
      scope.presentationSession = body.presentationSession === true;
      scope.contextId = body.contextId || scope.id;
      const binding = records.read(ownerOf(scope), `voice:${scope.contextId}`).binding;
      const boundSessionId = body.sessionId || binding || null;
      if (boundSessionId) await api.inspect(boundSessionId);
      if (scope.epoch !== epoch) throw failure("voice_session_closed", 409);
      await scope.session?.close();
      const selected = config();
      const preset = body.preset || selected.preset;
      if (!VOICE_PRESETS.includes(preset)) throw failure("voice_preset_invalid", 400);
      const backend = body.backend === undefined ? selected.backend : validateConfigPatch({ backend: body.backend }).backend;
      if (body.backend === "realtime" && !validatedRealtimeModels(await listModels(), env).includes(selected.realtimeModel)) throw failure("voice_realtime_unavailable", 409);
      if (scope.epoch !== epoch) throw failure("voice_session_closed", 409);
      scopes.add(scope);
      scope.voiceAbort = new AbortController();
      scope.voiceConfig = { ...selected, preset, backend };
      scope.voiceCaps = voiceCapabilities(preset, { clientTools: scope.authorizedBinding?.clientTools === true });
      const history = records.read(ownerOf(scope), boundSessionId || `voice:${scope.contextId || scope.id}`);
      scope.recoveryContext = history.summary || null;
      const restoredRequests = [...new Set(history.records.map((row) => row.taskId).filter(Boolean))].map((requestId) => ({ requestId }));
      scope.session = createVoiceAgentSession(api, { sessionId: boundSessionId,
        preset: scope.authorizedBinding?.agentPreset || env.LARES_VOICE_AGENT_PRESET || undefined, workspaceId: scope.authorizedBinding?.workspaceId || env.LARES_VOICE_WORKSPACE_ID || undefined, restoredRequests,
        onChange: () => service.advance(scope),
        metric: (fields) => metric({ voiceId: scope.id, ...fields }),
        fallbackModel: () => defaultChatTarget({ env }),
      });
      await scope.session.open();
      if (scope.epoch !== epoch) throw failure("voice_session_closed", 409);
      scope.recordKey = keyOf(scope);
      scope.voiceResults = []; scope.summaryError = null;
      scope.active = true; scope.readAloud = body.readAloud === true;
      scope.voiceState = { version: 0, running: false, utterance: null, live: null, error: null };
      scope.voiceRequests = new Map(); scope.deliveredTasks = new Set(restoredRequests.map((item) => item.requestId));
      scope.dialogue = !scope.voiceCaps.relay ? null : createVoiceDialogue({ config: scope.voiceConfig, agent: scope.voiceCaps.agent, device: scope.voiceCaps.clientTools, owner: scope.owner, context: history.summary?.recent || [], summary: history.summary?.text || "", chat: chatFor(scope),
        submit: async (text, requestId, operation) => {
          if (operation === "status") return scope.session.snapshot();
          const id = `${requestId}:delegate`;
          // The source transcript is persisted before any side effect, even for lazy business sessions.
          const before = keyOf(scope);
          const source = records.read(ownerOf(scope), keyOf(scope)).records.find((row) => row.id === `${scope.id}:${requestId}:user`);
          if (source) append(scope, "user", source.text, requestId, id);
          append(scope, "task", text, requestId, id);
          // The Agent reads the user's own words first; the dialogue's restatement only carries
          // what earlier turns settled, such as the city a follow-up answer refers to.
          const prompt = source && source.text !== text ? `${source.text}\n\n(Voice assistant's reading of this request: ${text})` : text;
          let state;
          try { state = await scope.session.submit(prompt, id, scope.submitMode || "queue"); }
          finally { if (before !== keyOf(scope)) {
            for (const row of records.read(ownerOf(scope), before).records) records.append(ownerOf(scope), keyOf(scope), row);
            records.clear(ownerOf(scope), before);
            records.bind(ownerOf(scope), scope.contextId, keyOf(scope));
          } }
          return { status: "pending", sessionId: state.sessionId, requestId: id };
        },
      });
      return service.state(scope);
      } finally { if (scope.epoch === epoch) scope.opening = false; }
    },
    async prompt(scope, body) {
      if (!scope.active || !scope.session) throw failure("voice_session_closed", 409);
      if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 16000 || typeof body.requestId !== "string" || !body.requestId || body.requestId.length > 128) throw failure("voice_session_invalid", 400);
      if (scope.voiceCaps.type === "transcription") return { ...service.state(scope), text: body.text };
      await ensurePresentation(scope);
      if (!scope.voiceCaps.relay) {
        const before = keyOf(scope);
        append(scope, "user", body.text, body.requestId, body.requestId);
        try { return await scope.session.submit(body.text, body.requestId, body.mode); }
        finally {
          if (before !== keyOf(scope)) {
            for (const row of records.read(ownerOf(scope), before).records) records.append(ownerOf(scope), keyOf(scope), row);
            records.clear(ownerOf(scope), before);
            records.bind(ownerOf(scope), scope.contextId, keyOf(scope));
          }
        }
      }
      if (scope.voiceRequests.has(body.requestId)) return scope.voiceRequests.get(body.requestId);
      if (scope.voiceRequests.size >= 256) throw failure("voice_session_limit", 429);
      const operation = converse(scope, { requestId: body.requestId, text: body.text, mode: body.mode });
      scope.voiceRequests.set(body.requestId, operation);
      return operation;
    },
    /** Continues the dialogue after a device's tool results, when the device asks for a response. */
    async proceed(scope, body) {
      if (!scope.active || !scope.session) throw failure("voice_session_closed", 409);
      if (typeof body.requestId !== "string" || !body.requestId || body.requestId.length > 128) throw failure("voice_session_invalid", 400);
      if (!scope.dialogue?.hasClientTools()) throw failure("voice_tools_unsupported", 400);
      return converse(scope, { requestId: body.requestId, text: null });
    },
    /**
     * Turns a durable task's completion into one pending spoken utterance.
     * Called from session events, never from a read: a GET that loses its
     * response must not consume the result it was about to return.
     */
    advance(scope) {
      if (!scope.active || !scope.voiceState) return;
      const state = scope.session?.snapshot() || {};
      // Completion is keyed by durable request/turn, never by the session's aggregate idle flag.
      for (const task of state.tasks || []) {
        if (!["completed", "failed", "cancelled"].includes(task.status) || scope.deliveredTasks.has(task.requestId)) continue;
        append(scope, "task", JSON.stringify(task), `${task.requestId}:result`, task.requestId);
        scope.deliveredTasks.add(task.requestId);
        scope.voiceResults ??= [];
        scope.voiceResults.push(task);
      }
      if (!scope.voiceCaps.relay || scope.voiceState.running) return;
      // Pending business work does not block the next speech turn.
      if (!scope.voiceResults?.length || scope.voiceInputActive) return;
      const task = scope.voiceResults.shift();
      // A device hears results through the dialogue, which says them briefly and may act on them.
      if (scope.dialogue.isDevice()) { void converse(scope, { requestId: `task:${task.requestId}`, text: null, task }).catch(() => {}); return; }
      scope.dialogue.observeTask(task);
      const text = task.status === "completed" ? task.text : `Task ${task.status}: ${task.error || ""}`;
      scope.voiceState.utterance = { key: `task:${task.requestId}`, turn: ++scope.voiceState.version, step: 0, text, done: true, silent: false };
      append(scope, "assistant", text, `result:${task.requestId}`, task.requestId, { taskTurn: task.turn });
    },
    /**
     * A queued task result moves into the sticky `utterance` field before the
     * snapshot is returned. The move is idempotent and the utterance survives
     * the read, so a lost response cannot consume the result; HTTP polls and
     * the socket observe the same snapshot.
     */
    state(scope) {
      service.advance(scope);
      const state = scope.session?.snapshot() || {};
      if (!scope.voiceState) return { ...state, contextId: scope.contextId, active: scope.active === true };
      if (scope.voiceCaps.agent && !scope.voiceCaps.relay) return { ...state, contextId: scope.contextId, active: scope.active === true };
      return { ...state, ...scope.voiceState, contextId: scope.contextId, active: scope.active === true, backgroundRunning: state.running, summaryError: scope.summaryError || null, preset: scope.voiceConfig.preset };
    },
    async remove(sessionId) {
      for (const scope of scopes) if (scope.session?.snapshot().sessionId === sessionId) { await service.close(scope); scopes.delete(scope); }
      records.clearConversation(sessionId);
    },
    async record(scope, role, text, turnId, fields = {}) {
      if (!text?.trim()) return;
      if (role === "user") await ensurePresentation(scope);
      const key = keyOf(scope);
      if (scope.recordKey && scope.recordKey !== key) {
        for (const row of records.read(ownerOf(scope), scope.recordKey).records) records.append(ownerOf(scope), key, row);
        records.clear(ownerOf(scope), scope.recordKey);
        records.bind(ownerOf(scope), scope.contextId, key);
      }
      scope.recordKey = key;
      return append(scope, role, text.slice(0, 16000), String(turnId || scope.voiceState.version), role === "task" ? String(turnId) : null, fields);
    },
    async history(scope, body, signal) {
      const { sessionId, version, waitMs = 0 } = body;
      if (typeof sessionId !== "string" || !sessionId || sessionId.length > 256 || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > 20000) throw failure("voice_records_invalid", 400);
      await api.inspect(sessionId);
      const owner = ownerOf(scope);
      const page = () => records.page(owner, sessionId, body);
      let result = page();
      if (waitMs && result.version === version && !signal?.aborted) {
        await new Promise((resolve) => {
          let timer;
          const done = () => { clearTimeout(timer); unsubscribe(); signal?.removeEventListener("abort", done); resolve(); };
          const unsubscribe = records.subscribe(owner, sessionId, done);
          signal?.addEventListener("abort", done, { once: true });
          timer = setTimeout(done, waitMs);
          if (signal?.aborted) done();
        });
        result = page();
      }
      return result;
    },
    records(scope) { return records.read(ownerOf(scope), keyOf(scope)); },
    async clearRecords(scope) { const key = keyOf(scope); await service.close(scope); records.clear(ownerOf(scope), key); },
    output(scope, value) { if (typeof value !== "boolean") throw failure("voice_output_invalid", 400); scope.readAloud = value; },
    resume: (scope) => scope.session?.resume(),
    cancel: (scope) => scope.session?.cancel(),
    instructions(scope, text) {
      if (!scope.dialogue || !scope.voiceCaps?.instructions) throw failure("voice_instructions_unsupported", 400);
      scope.dialogue.setInstructions(text, scope.voiceCaps.instructionLimit);
    },
    tools(scope, tools) {
      if (!scope.dialogue || !scope.voiceCaps?.clientTools) throw failure("voice_tools_unsupported", 400);
      scope.dialogue.setClientTools(tools);
    },
    toolOutput(scope, callId, output) {
      if (!scope.dialogue?.hasClientTools()) throw failure("voice_tools_unsupported", 400);
      return scope.dialogue.toolOutput(callId, output);
    },
    observe(scope, parts) {
      if (!scope.dialogue?.hasClientTools()) throw failure("voice_tools_unsupported", 400);
      scope.dialogue.observe(parts);
    },
    /**
     * Keeps only the heard part of a spoken reply in records and dialogue context.
     * Agent output lives in the dsh log and is not rewritten there.
     */
    truncate(scope, utteranceKey, text) {
      const key = String(utteranceKey || "");
      const turnId = key.startsWith("task:") ? `result:${key.slice(5)}` : key;
      const row = records.read(ownerOf(scope), keyOf(scope)).records.find((item) => item.id === `${scope.id}:${turnId}:assistant`);
      if (!row || row.text === text) return false;
      append(scope, "assistant", text, turnId, row.taskId, { status: "truncated", ...(Number.isInteger(row.taskTurn) ? { taskTurn: row.taskTurn } : {}) });
      if (!key.startsWith("task:") && scope.dialogue?.replaceLastAssistant(text)) summarize(scope);
      return true;
    },
    async withdraw(scope, requestId) {
      if (!scope.session) return "not_cancellable";
      // A delegated assistant task is submitted under its turn id plus ":delegate".
      const ids = [requestId, `${requestId}:delegate`];
      for (const id of ids) {
        const result = await scope.session.withdraw(id);
        if (result !== "not_cancellable") return result;
      }
      return "not_cancellable";
    },
    async close(scope) {
      scope.epoch = (scope.epoch || 0) + 1; scope.opening = false; scope.closing = true;
      scope.active = false; scope.voiceAbort?.abort(); scope.realtimeSocket?.close();
      try {
        scope.capture?.stop(true);
        const cleanup = await Promise.allSettled([scope.duplex?.interrupt(), scope.realtimeAudio?.stop(), scope.session?.close()]);
        await scope.voiceSerial?.catch(() => {});
        if (scope.summaryTimer) checkpoint(scope);
        await scope.summaryTask;
        scopes.delete(scope);
        const failed = cleanup.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      } finally { scope.closing = false; }
    },
  };
  return service;
}
