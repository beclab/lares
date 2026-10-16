import { createVoiceAgentSession } from "./agent-session.js";
import { createVoiceRecords } from "./records.js";
import { createVoiceDialogue, cleanDictation } from "./dialogue.js";
import { readConfig } from "./config.js";
import { VOICE_PRESETS } from "./options.js";

const failure = (code, status) => Object.assign(new Error(code), { code, status });

/** Presets and task policy stay in core; the Host supplies an authenticated scope. */
export function createVoiceHostService(api, { env = process.env, metric = () => {}, records = createVoiceRecords(), config = readConfig, chat } = {}) {
  const ownerOf = (scope) => scope.owner || "@local";
  const keyOf = (scope) => scope.session?.snapshot().sessionId || `voice:${scope.contextId || scope.id}`;
  const append = (scope, role, text, turnId, taskId = null) => records.append(ownerOf(scope), keyOf(scope), {
    id: `${scope.id}:${turnId}:${role}`, voiceId: scope.id, clientId: scope.id, turnId, role, text: text.slice(0, 16000), taskId,
  });
  const scopes = new Set();
  const service = {
    async clean(scope, text) {
      if (typeof text !== "string" || text.length > 16000) throw failure("voice_input_invalid", 400);
      return cleanDictation(text, { config: config(), owner: scope.owner, chat });
    },
    async open(scope, body) {
      if (scope.active || scope.opening || scope.closing) throw failure("voice_session_active", 409);
      const epoch = scope.epoch = (scope.epoch || 0) + 1;
      scope.opening = true;
      try {
      if (body.sessionId != null && (typeof body.sessionId !== "string" || !body.sessionId || body.sessionId.length > 256)) throw failure("voice_session_invalid", 400);
      if (body.contextId != null && (typeof body.contextId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(body.contextId))) throw failure("voice_context_invalid", 400);
      scope.contextId = body.contextId || scope.id;
      const binding = records.read(ownerOf(scope), `voice:${scope.contextId}`).binding;
      const boundSessionId = body.sessionId || binding || null;
      if (boundSessionId) await api.inspect(boundSessionId);
      if (scope.epoch !== epoch) throw failure("voice_session_closed", 409);
      await scope.session?.close();
      const selected = config();
      const preset = body.preset || selected.preset;
      if (!VOICE_PRESETS.includes(preset)) throw failure("voice_preset_invalid", 400);
      scopes.add(scope);
      scope.voiceAbort = new AbortController();
      scope.voiceConfig = { ...selected, preset };
      const history = records.read(ownerOf(scope), boundSessionId || `voice:${scope.contextId || scope.id}`);
      scope.recoveryContext = history.summary || null;
      const restoredRequests = [...new Set(history.records.map((row) => row.taskId).filter(Boolean))].map((requestId) => ({ requestId }));
      scope.session = createVoiceAgentSession(api, { sessionId: boundSessionId,
        preset: scope.authorizedBinding?.agentPreset || env.LARES_VOICE_AGENT_PRESET || undefined, workspaceId: scope.authorizedBinding?.workspaceId || env.LARES_VOICE_WORKSPACE_ID || undefined, restoredRequests,
        metric: (fields) => metric({ voiceId: scope.id, ...fields }),
      });
      await scope.session.open();
      if (scope.epoch !== epoch) throw failure("voice_session_closed", 409);
      scope.recordKey = keyOf(scope);
      scope.voiceResults = []; scope.summaryError = null;
      scope.active = true; scope.readAloud = body.readAloud === true;
      scope.voiceState = { version: 0, running: false, utterance: null, error: null };
      scope.voiceRequests = new Map(); scope.deliveredTasks = new Set(restoredRequests.map((item) => item.requestId));
      scope.dialogue = createVoiceDialogue({ config: scope.voiceConfig, owner: scope.owner, context: history.summary?.recent || [], summary: history.summary?.text || "", chat,
        submit: async (text, requestId, operation) => {
          if (operation === "status") return scope.session.snapshot();
          const id = `${requestId}:delegate`;
          // The source transcript is persisted before any side effect, even for lazy business sessions.
          const before = keyOf(scope);
          append(scope, "task", text, requestId, id);
          let state;
          try { state = await scope.session.submit(text, id, scope.submitMode || "queue"); }
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
      if (scope.voiceConfig.preset === "dictation") return { ...service.state(scope), text: body.text };
      if (scope.voiceConfig.preset === "direct") {
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
      const operation = (scope.voiceSerial || Promise.resolve()).catch(() => {}).then(async () => {
        if (!scope.active || scope.voiceAbort.signal.aborted) throw failure("voice_session_closed", 409);
        scope.submitMode = body.mode === "steer" ? "steer" : "queue";
        scope.voiceState.running = true; scope.voiceState.error = null; scope.voiceState.version++;
        append(scope, "user", body.text, body.requestId);
        try {
          const text = await scope.dialogue.reply(body.text, body.requestId, scope.voiceAbort.signal);
          append(scope, "assistant", text, body.requestId);
          const key = keyOf(scope);
          const checkpointVersion = records.read(ownerOf(scope), key).version;
          scope.summaryTask = scope.dialogue.summarize().then((summary) => records.checkpoint(ownerOf(scope), key, summary, checkpointVersion)).catch((cause) => {
            scope.summaryError = cause.code || cause.message || "voice_summary_failed";
          });
          scope.voiceState.utterance = { key: body.requestId, turn: scope.voiceState.version, step: 0, text, done: true, silent: false };
        } catch (cause) { scope.voiceState.error = cause.code || cause.message || "voice_failed"; throw cause; }
        finally { scope.voiceState.running = false; scope.voiceState.version++; }
        return service.state(scope);
      });
      scope.voiceSerial = operation;
      scope.voiceRequests.set(body.requestId, operation);
      return operation;
    },
    state(scope) {
      const state = scope.session?.snapshot() || {};
      if (!scope.voiceState) return { ...state, contextId: scope.contextId, active: scope.active === true };
      // Completion is keyed by durable request/turn, never by the session's aggregate idle flag.
      for (const task of state.tasks || []) {
        if (!["completed", "failed", "cancelled"].includes(task.status) || scope.deliveredTasks.has(task.requestId)) continue;
        append(scope, "task", JSON.stringify(task), `${task.requestId}:result`, task.requestId);
        scope.deliveredTasks.add(task.requestId);
        scope.voiceResults ??= [];
        scope.voiceResults.push(task);
      }
      if (scope.voiceConfig.preset === "direct") return { ...state, contextId: scope.contextId, active: scope.active === true };
      // Pending business work does not block the next speech turn.
      if (scope.active && !scope.voiceState.running && scope.voiceResults?.length && !scope.voiceInputActive) {
        const task = scope.voiceResults.shift();
        scope.dialogue.observeTask(task);
        const text = task.status === "completed" ? task.text : `Task ${task.status}: ${task.error || ""}`;
        scope.voiceState.utterance = { key: `task:${task.requestId}`, turn: ++scope.voiceState.version, step: 0, text, done: true, silent: false };
        append(scope, "assistant", text, `result:${task.requestId}`, task.requestId);
      }
      return { ...state, ...scope.voiceState, contextId: scope.contextId, active: scope.active === true, backgroundRunning: state.running, summaryError: scope.summaryError || null, preset: scope.voiceConfig.preset };
    },
    async remove(sessionId) {
      for (const scope of scopes) if (scope.session?.snapshot().sessionId === sessionId) { await service.close(scope); scopes.delete(scope); }
      records.clearConversation(sessionId);
    },
    record(scope, role, text, turnId) {
      const key = keyOf(scope);
      if (scope.recordKey && scope.recordKey !== key) {
        for (const row of records.read(ownerOf(scope), scope.recordKey).records) records.append(ownerOf(scope), key, row);
        records.clear(ownerOf(scope), scope.recordKey);
        records.bind(ownerOf(scope), scope.contextId, key);
      }
      scope.recordKey = key;
      return append(scope, role, text.slice(0, 16000), String(turnId || scope.voiceState.version), role === "task" ? String(turnId) : null);
    },
    records(scope) { return records.read(ownerOf(scope), keyOf(scope)); },
    async clearRecords(scope) { const key = keyOf(scope); await service.close(scope); records.clear(ownerOf(scope), key); },
    output(scope, value) { if (typeof value !== "boolean") throw failure("voice_output_invalid", 400); scope.readAloud = value; },
    resume: (scope) => scope.session?.resume(),
    cancel: (scope) => scope.session?.cancel(),
    async close(scope) {
      scope.epoch = (scope.epoch || 0) + 1; scope.opening = false; scope.closing = true;
      scope.active = false; scope.voiceAbort?.abort(); scope.realtimeSocket?.close();
      try {
        scope.capture?.stop(true);
        const cleanup = await Promise.allSettled([scope.duplex?.interrupt(), scope.realtimeAudio?.stop(), scope.session?.close()]);
        await scope.voiceSerial?.catch(() => {});
        await scope.summaryTask;
        scopes.delete(scope);
        const failed = cleanup.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      } finally { scope.closing = false; }
    },
  };
  return service;
}
