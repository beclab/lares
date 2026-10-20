import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { validateConfigPatch } from "./config.js";
import { createSpeechEndpoint, frameRms } from "./endpoint.js";
import { pcmSamples } from "./realtime-audio.js";

const PRESETS = Object.freeze({ "voice-dictation": "dictation", "voice-chat": "chat", "voice-assistant": "assistant", "voice-direct": "direct" });
const FORMAT = Object.freeze({ type: "audio/pcm", rate: 24000 });
const BYTES_PER_MS = 48;
const TURN_BYTES = 60_000 * BYTES_PER_MS;
const CHUNK_BYTES = 500 * BYTES_PER_MS;
const SPEECH_RMS = 0.004;
// Usage lives in the child ASR/LLM/TTS requests; the OpenAI shape stays parseable (Router ADR-83).
const ZERO_USAGE = Object.freeze({ total_tokens: 0, input_tokens: 0, output_tokens: 0, input_token_details: { text_tokens: 0, audio_tokens: 0, cached_tokens: 0 }, output_token_details: { text_tokens: 0, audio_tokens: 0 } });
const TASK_STATUS = Object.freeze({ accepted: "pending", waiting: "pending", running: "running", completed: "completed", failed: "failed", cancelled: "cancelled" });

export const REALTIME_CAPABILITIES = Object.freeze({ protocol: "lares-realtime-v1", transport: "websocket", barge_in: false, playback_ack: true, message_truncation: "none", turn_detection: ["manual", "server_vad"], user_transcription: true, context_resume: true, client_tools: false });

class ProtocolError extends Error {
  constructor(code, type = "invalid_request_error") { super(code); this.code = code; this.type = type; }
}
const fail = (code, type) => { throw new ProtocolError(code, type); };
const only = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) fail("unsupported_parameter");
  return value;
};
const refuse = (socket, status, text) => { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`); };
const routerSession = (value) => typeof value === "string" && value.trim() && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;

/**
 * `lares-realtime-v1` for server-side callers holding an owner-issued voice key (docs/realtime-protocol.md).
 * The key owner is the caller; identity headers on the request are ignored.
 */
export function createLaresRealtimeGateway({ service, config, transcribe, synthesize, keys, hostOwner = "", limit = 64 }) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 96 * 1024, perMessageDeflate: false });
  const clients = new Map();

  function run(client, { key, model, preset, routerSessionId }) {
    const type = preset === "dictation" ? "transcription" : "realtime";
    const scope = { id: randomUUID(), owner: hostOwner, authorizedBinding: { sessionId: key.sessionId, workspaceId: key.workspaceId }, device: "device", routerSessionId, voiceOverrides: {} };
    let chunks = [], bytes = 0, inputMs = 0, speaking = false;
    let automatic = false, silenceMs = config().endpointSilenceMs || 500, endpoint = createSpeechEndpoint({ silenceMs });
    let audioOutput = type === "realtime", busyTurn = null;
    let closed = false, busy = false, configuring = false, alive = true, generation = 0, submittedTurns = 0;
    let response = null, awaitingPlayback = false, acknowledges = false, lastReply = null;
    const tasks = new Map();

    const send = (event) => {
      if (client.readyState !== 1) return;
      if (client.bufferedAmount > 1024 * 1024) { close(); return; }
      client.send(JSON.stringify({ event_id: `event_${randomUUID()}`, ...event }));
    };
    const report = (cause, eventId) => {
      const known = cause instanceof ProtocolError;
      send({ type: "error", error: { type: known ? cause.type : "server_error", code: known ? cause.code : "upstream_failed", message: known ? "Unsupported or invalid realtime event" : "Voice operation failed", ...(eventId ? { event_id: eventId } : {}) } });
    };
    const view = () => ({
      id: scope.id, object: "realtime.session", type, model,
      ...(type === "realtime" ? { output_modalities: [audioOutput ? "audio" : "text"] } : {}),
      audio: {
        input: { format: FORMAT, turn_detection: automatic ? { type: "server_vad", silence_duration_ms: silenceMs } : null, ...(scope.voiceOverrides.language ? { transcription: { language: scope.voiceOverrides.language } } : {}) },
        ...(type === "realtime" ? { output: { format: FORMAT, ...(scope.voiceOverrides.voice ? { voice: scope.voiceOverrides.voice } : {}) } } : {}),
      },
      lares: { capabilities: REALTIME_CAPABILITIES, context_id: scope.contextId },
    });
    const reset = () => { chunks = []; bytes = 0; speaking = false; endpoint = createSpeechEndpoint({ silenceMs }); };

    const finish = (status) => {
      const { id, itemId, origin, inputMs: input, outputMs } = response;
      response = null;
      send({ type: "response.output_item.done", response_id: id, output_index: 0, item: { id: itemId, type: "message", role: "assistant", status: status === "completed" ? "completed" : "incomplete" } });
      send({ type: "response.done", response: { id, object: "realtime.response", status, output: [], usage: ZERO_USAGE, metadata: { lares: { origin, usage: { billing: "child-models", input_audio_ms: Math.round(input), output_audio_ms: Math.round(outputMs) } } } } });
    };
    const respond = async (text, origin, epoch, input) => {
      const id = `resp_${randomUUID()}`, itemId = `item_${randomUUID()}`;
      response = { id, itemId, origin, inputMs: input, outputMs: 0 };
      const part = { response_id: id, item_id: itemId, output_index: 0, content_index: 0 };
      send({ type: "response.created", response: { id, object: "realtime.response", status: "in_progress", output: [], metadata: { lares: { origin } } } });
      send({ type: "response.output_item.added", response_id: id, output_index: 0, item: { id: itemId, type: "message", role: "assistant", status: "in_progress", content: [] } });
      if (!audioOutput) {
        send({ type: "response.output_text.delta", ...part, delta: text });
        send({ type: "response.output_text.done", ...part, text });
        finish("completed");
        return;
      }
      send({ type: "response.output_audio_transcript.delta", ...part, delta: text });
      send({ type: "response.output_audio_transcript.done", ...part, transcript: text });
      scope.outputAbort = new AbortController();
      const output = async (audio) => {
        if (closed || epoch !== generation) return;
        if (acknowledges) awaitingPlayback = true;
        for (let offset = 0; offset < audio.length; offset += CHUNK_BYTES) {
          const chunk = audio.subarray(offset, offset + CHUNK_BYTES);
          response.outputMs += chunk.length / BYTES_PER_MS;
          send({ type: "response.output_audio.delta", ...part, delta: chunk.toString("base64") });
        }
      };
      try {
        const audio = await synthesize(text, scope, output);
        if (closed || epoch !== generation) return;
        if (audio) await output(audio);
      } catch (cause) {
        if (response?.id === id) finish("failed");
        throw cause;
      }
      send({ type: "response.output_audio.done", ...part });
      finish("completed");
    };

    const observeTasks = () => {
      const snapshot = scope.session?.snapshot();
      for (const task of snapshot?.tasks || []) {
        const status = TASK_STATUS[task.status] || "unknown";
        if (tasks.get(task.requestId) === status) continue;
        tasks.set(task.requestId, status);
        send({ type: "lares.task.updated", task_id: task.requestId, status, session_id: snapshot.sessionId || null });
      }
    };
    const turn = async (text, requestId, epoch, input) => {
      submittedTurns++;
      const running = scope.session?.snapshot().running === true;
      const state = await service.prompt(scope, { text, requestId, ...(busyTurn && running ? { mode: busyTurn } : {}) });
      if (closed || epoch !== generation) return;
      observeTasks();
      if (state.utterance?.text && !state.utterance.silent) { lastReply = state.utterance.key; await respond(state.utterance.text, "turn", epoch, input); }
    };
    const commit = async () => {
      if (!bytes) return;
      if (busy) fail("turn_busy");
      const input = Buffer.concat(chunks), itemId = `item_${randomUUID()}`, ms = input.length / BYTES_PER_MS;
      reset(); scope.voiceInputActive = false; busy = true;
      send({ type: "input_audio_buffer.committed", item_id: itemId, previous_item_id: null });
      const epoch = generation;
      try {
        let text = await transcribe(input, scope);
        if (preset === "dictation") text = await service.clean(scope, text);
        if (closed || epoch !== generation || !text.trim()) return;
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: itemId, content_index: 0, transcript: text });
        if (preset !== "dictation") await turn(text, itemId, epoch, ms);
      } catch (cause) { if (!closed && epoch === generation) report(cause); }
      finally { busy = false; }
    };
    const typed = async (event) => {
      if (type !== "realtime") fail("unsupported_parameter");
      const item = only(event.item, ["id", "type", "role", "content"]);
      const content = Array.isArray(item.content) && item.content.length === 1 ? only(item.content[0], ["type", "text"]) : fail("unsupported_parameter");
      if (item.type !== "message" || item.role !== "user" || content.type !== "input_text" || typeof content.text !== "string" || !content.text.trim() || content.text.length > 16000) fail("unsupported_parameter");
      if (busy) fail("turn_busy");
      busy = true;
      const epoch = generation;
      try { await turn(content.text, typeof item.id === "string" && item.id ? item.id.slice(0, 128) : `item_${randomUUID()}`, epoch, 0); }
      finally { busy = false; }
    };
    const configure = async (event) => {
      const session = only(event.session, ["type", "model", "audio", "output_modalities", "lares"]);
      if ((session.type && session.type !== type) || (session.model && session.model !== model)) fail("unsupported_parameter");
      const next = { automatic, silenceMs, audioOutput, busyTurn, overrides: { ...scope.voiceOverrides } };
      let contextId = null;
      if (session.audio !== undefined) {
        const audio = only(session.audio, type === "realtime" ? ["input", "output"] : ["input"]);
        if (audio.input !== undefined) {
          const input = only(audio.input, ["format", "turn_detection", "transcription"]);
          if (input.format !== undefined && (input.format?.type !== FORMAT.type || input.format?.rate !== FORMAT.rate)) fail("unsupported_audio_format");
          if (input.turn_detection === null) next.automatic = false;
          else if (input.turn_detection !== undefined) {
            const detection = only(input.turn_detection, ["type", "silence_duration_ms"]);
            if (detection.type !== "server_vad") fail("unsupported_parameter");
            if (detection.silence_duration_ms !== undefined && (!Number.isInteger(detection.silence_duration_ms) || detection.silence_duration_ms < 200 || detection.silence_duration_ms > 3000)) fail("unsupported_parameter");
            next.automatic = true;
            next.silenceMs = detection.silence_duration_ms ?? next.silenceMs;
          }
          if (input.transcription !== undefined) {
            const { language } = only(input.transcription, ["language"]);
            try { next.overrides.language = validateConfigPatch({ language: language ?? "" }).language || undefined; } catch { fail("unsupported_parameter"); }
          }
        }
        if (audio.output !== undefined) {
          const output = only(audio.output, ["format", "voice"]);
          if (output.format !== undefined && (output.format?.type !== FORMAT.type || output.format?.rate !== FORMAT.rate)) fail("unsupported_audio_format");
          if (output.voice !== undefined) {
            try { next.overrides.voice = validateConfigPatch({ voice: output.voice ?? "" }).voice || undefined; } catch { fail("unsupported_parameter"); }
          }
        }
      }
      if (session.output_modalities !== undefined) {
        if (type !== "realtime" || !Array.isArray(session.output_modalities) || session.output_modalities.length !== 1 || !["audio", "text"].includes(session.output_modalities[0])) fail("unsupported_parameter");
        next.audioOutput = session.output_modalities[0] === "audio";
      }
      if (session.lares !== undefined) {
        const lares = only(session.lares, ["context_id", "echo_cancellation", "busy_turn"]);
        if (lares.echo_cancellation !== undefined && typeof lares.echo_cancellation !== "boolean") fail("unsupported_parameter");
        if (lares.busy_turn !== undefined && lares.busy_turn !== null && !["queue", "steer"].includes(lares.busy_turn)) fail("unsupported_parameter");
        if (lares.busy_turn !== undefined) next.busyTurn = lares.busy_turn;
        if (lares.context_id !== undefined && lares.context_id !== scope.contextId) {
          if (typeof lares.context_id !== "string") fail("unsupported_parameter");
          if (submittedTurns || bytes || busy) fail("context_locked");
          contextId = lares.context_id;
        }
      }
      if (contextId) {
        configuring = true;
        try {
          await service.close(scope);
          await service.open(scope, { preset, sessionId: key.sessionId, contextId, readAloud: false });
        } catch { fail("unsupported_parameter"); }
        finally { configuring = false; }
      }
      ({ automatic, silenceMs, audioOutput, busyTurn } = next);
      scope.voiceOverrides = next.overrides;
      endpoint = createSpeechEndpoint({ silenceMs });
      send({ type: "session.updated", session: view() });
    };
    const append = (event) => {
      if (awaitingPlayback) fail("waiting_for_playback");
      if (busy) fail("turn_busy");
      if (typeof event.audio !== "string" || event.audio.length > 64000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(event.audio)) fail("unsupported_audio_format");
      const chunk = Buffer.from(event.audio, "base64");
      if (chunk.length % 2) fail("unsupported_audio_format");
      if (bytes + chunk.length > TURN_BYTES) fail("audio_limit_exceeded");
      chunks.push(chunk); bytes += chunk.length; inputMs += chunk.length / BYTES_PER_MS;
      const rms = frameRms(pcmSamples(chunk));
      if (rms >= SPEECH_RMS) touch();
      if (rms >= SPEECH_RMS && !speaking) { speaking = true; scope.voiceInputActive = true; send({ type: "input_audio_buffer.speech_started", audio_start_ms: Math.round(inputMs), item_id: null }); }
      if (automatic && endpoint.push(1, rms, chunk.length / BYTES_PER_MS)) {
        send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: Math.round(inputMs), item_id: null });
        void commit().catch(report);
      }
    };
    const cancelTask = async (event) => {
      const status = typeof event.task_id === "string" ? tasks.get(event.task_id) : undefined;
      if (status !== "pending" && status !== "running") fail("task_not_cancellable");
      await service.cancel(scope);
    };
    const handle = async (event) => {
      switch (event.type) {
        case "session.update": return configure(event);
        case "input_audio_buffer.append": return append(event);
        case "input_audio_buffer.commit": return commit();
        case "input_audio_buffer.clear": reset(); scope.voiceInputActive = false; send({ type: "input_audio_buffer.cleared" }); return;
        case "conversation.item.create": return typed(event);
        case "response.cancel":
          if (!response) return;
          scope.outputAbort?.abort(); generation++; reset(); awaitingPlayback = false;
          finish("cancelled");
          return;
        case "lares.playback.progress": acknowledges = true; return;
        case "lares.playback.completed": acknowledges = true; awaitingPlayback = false; return;
        case "lares.task.cancel": return cancelTask(event);
        default: fail("unsupported_event");
      }
    };

    const close = () => {
      if (closed) return;
      closed = true; scope.outputAbort?.abort(); generation++; reset(); clearInterval(heartbeat); clearInterval(results); clearTimeout(idle);
      clients.delete(client); client.close(); void service.close(scope).catch(() => {});
    };
    let idle;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => { send({ type: "error", error: { type: "invalid_request_error", code: "session_expired", message: "Voice session idle" } }); close(); }, config().idleTimeoutMs || 300000);
    };
    touch();
    clients.set(client, close);
    const heartbeat = setInterval(() => { if (!alive) close(); else { alive = false; client.ping(); } }, 15000);
    const results = setInterval(() => {
      if (!scope.active) return;
      try {
        observeTasks();
        if (busy || speaking || awaitingPlayback || response) return;
        const state = service.state(scope);
        if (!state.utterance?.text || state.utterance.key === lastReply || state.utterance.silent) return;
        lastReply = state.utterance.key; busy = true;
        const origin = String(state.utterance.key).startsWith("task:") ? "task" : "turn";
        void respond(state.utterance.text, origin, generation, 0).catch(() => close()).finally(() => { busy = false; });
      } catch { close(); }
    }, 250);
    client.on("pong", () => { alive = true; });
    client.on("close", close); client.on("error", close);
    void service.open(scope, { preset, sessionId: key.sessionId, readAloud: false }).then(() => {
      send({ type: "session.created", session: view() });
      client.on("message", async (raw, binary) => {
        let event;
        try {
          if (configuring) fail("turn_busy");
          if (binary) fail("unsupported_event");
          try { event = JSON.parse(raw.toString()); } catch { fail("unsupported_event"); }
          if (!event || typeof event.type !== "string") fail("unsupported_event");
          await handle(event);
        } catch (cause) { report(cause, typeof event?.event_id === "string" ? event.event_id : undefined); }
      });
    }).catch(close);
  }

  return {
    upgrade(req, socket, head) {
      const key = keys.verify(req.headers.authorization);
      if (!key) return refuse(socket, 401, "Unauthorized");
      const model = new URL(req.url, "http://voice.invalid").searchParams.get("model");
      const preset = PRESETS[model];
      if (!preset || !key.models.includes(model)) return refuse(socket, 403, "Forbidden");
      const dependencies = config();
      if ([dependencies.model, dependencies.chatModel, dependencies.ttsModel, dependencies.realtimeModel].some((id) => id === model || id?.endsWith(`/${model}`))) return refuse(socket, 503, "Service Unavailable");
      if (clients.size >= limit) return refuse(socket, 429, "Too Many Requests");
      server.handleUpgrade(req, socket, head, (client) => run(client, { key, model, preset, routerSessionId: routerSession(req.headers["x-session-id"]) }));
    },
    close() { for (const close of clients.values()) close(); server.close(); },
  };
}
