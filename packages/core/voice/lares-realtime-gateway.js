import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { validateConfigPatch } from "./config.js";
import { createSpeechEndpoint, frameRms } from "./endpoint.js";
import { pcmSamples } from "./realtime-audio.js";
import { speechSegments } from "./script.js";
import { bindRouterSession } from "../router/session-alias.js";

const PRESETS = Object.freeze({ "voice-dictation": "dictation", "voice-chat": "chat", "voice-assistant": "assistant", "voice-direct": "direct" });
const FORMAT = Object.freeze({ type: "audio/pcm", rate: 24000 });
const BYTES_PER_MS = 48;
const TURN_BYTES = 60_000 * BYTES_PER_MS;
const CHUNK_BYTES = 500 * BYTES_PER_MS;
const SPEECH_RMS = 0.004;
// Interruption policy (docs/realtime-protocol.md): speech must last this long to suspect barge-in,
// and a suspected interruption that never resolves stops the reply.
const BARGE_IN_MS = 500;
const BARGE_IN_LIMIT_MS = 10_000;
const TICKET_MS = 30_000;
// Usage lives in the child ASR/LLM/TTS requests; the OpenAI shape stays parseable (Router ADR-83).
const ZERO_USAGE = Object.freeze({ total_tokens: 0, input_tokens: 0, output_tokens: 0, input_token_details: { text_tokens: 0, audio_tokens: 0, cached_tokens: 0 }, output_token_details: { text_tokens: 0, audio_tokens: 0 } });
const TASK_STATUS = Object.freeze({ accepted: "pending", waiting: "pending", running: "running", completed: "completed", failed: "failed", cancelled: "cancelled" });

export const REALTIME_CAPABILITIES = Object.freeze({ protocol: "lares-realtime-v1", transport: "websocket", barge_in: false, playback_ack: true, message_truncation: "played", turn_detection: ["manual", "server_vad"], user_transcription: true, context_resume: true, client_tools: false });

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
const ticketOf = (req) => String(req.headers["sec-websocket-protocol"] || "").split(",").map((value) => value.trim()).find((value) => value.startsWith("lares-ticket."))?.slice(13);
const CJK_END = /[　-〿㐀-鿿＀-￯]$/;
const CJK_START = /^[　-〿㐀-鿿＀-￯]/;
const separator = (before, after) => !before || CJK_END.test(before) || CJK_START.test(after) ? "" : " ";
/** Spoken segments are cleaned clauses; rejoin them without inventing spaces inside CJK text. */
export function joinSpoken(parts) {
  return parts.reduce((text, part) => `${text}${separator(text, part)}${part}`, "");
}

/**
 * `lares-realtime-v1` (docs/realtime-protocol.md) on one endpoint. Bearer voice-key callers get a
 * scope owned by the socket; ticket sockets attach to the Lares client's open voice scope.
 */
export function createLaresRealtimeGateway({ service, config, transcribe, synthesize, openTranscription, keys, hostOwner = "", hostAudio, busyDefault = () => "queue", bargeIn = () => process.env.LARES_VOICE_BARGE_IN === "1", segment = speechSegments, onError = () => {}, onOpen = () => {}, limit = 64 }) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 96 * 1024, perMessageDeflate: false, handleProtocols: (values) => values.has("lares-voice") ? "lares-voice" : false });
  const clients = new Map();
  const tickets = new Map();

  function run(client, { scope, model, preset, owned, sessionId }) {
    const type = preset === "dictation" ? "transcription" : "realtime";
    const headset = !owned && scope.device === "headset";
    scope.voiceOverrides ??= {};
    let chunks = [], bytes = 0, turnMs = 0, totalMs = 0, speaking = false, speechMs = 0, itemId = null, partial = "", stream = null;
    let automatic = false, silenceMs = config().endpointSilenceMs || 500, endpoint = createSpeechEndpoint({ silenceMs });
    let audioOutput = type === "realtime" && (owned || scope.readAloud === true), busyTurn = null, echoCancellation = true;
    let closed = false, busy = false, pendingCommit = false, configuring = false, alive = true, generation = 0, submittedTurns = 0;
    let response = null, awaitingPlayback = false, acknowledges = false, lastReply = null, lastSpoken = null, turn = null, port = null, unbind = () => {};
    let hostOutput = Promise.resolve();
    const tasks = new Map();
    const spoken = new Map();
    const played = new Map();

    const bargeActive = () => type === "realtime" && !headset && echoCancellation && bargeIn() === true;
    const send = (event) => {
      if (client.readyState !== 1) return;
      if (client.bufferedAmount > 1024 * 1024) { close(); return; }
      client.send(JSON.stringify({ event_id: `event_${randomUUID()}`, ...event }));
    };
    const report = (cause, eventId) => {
      const known = cause instanceof ProtocolError;
      if (!known) { try { onError(cause, scope); } catch {} }
      send({ type: "error", error: { type: known ? cause.type : "server_error", code: known ? cause.code : "upstream_failed", message: known ? "Unsupported or invalid realtime event" : "Voice operation failed", ...(eventId ? { event_id: eventId } : {}) } });
    };
    const view = () => ({
      id: scope.id, object: "realtime.session", type, model,
      ...(type === "realtime" ? { output_modalities: [audioOutput ? "audio" : "text"] } : {}),
      audio: {
        input: { format: FORMAT, turn_detection: automatic ? { type: "server_vad", silence_duration_ms: silenceMs } : null, ...(scope.voiceOverrides.language ? { transcription: { language: scope.voiceOverrides.language } } : {}) },
        ...(type === "realtime" ? { output: { format: FORMAT, ...(scope.voiceOverrides.voice ? { voice: scope.voiceOverrides.voice } : {}) } } : {}),
      },
      lares: { capabilities: { ...REALTIME_CAPABILITIES, barge_in: bargeActive() }, context_id: scope.contextId, device: headset ? "headset" : "device" },
    });
    const reset = () => {
      chunks = []; bytes = 0; turnMs = 0; pendingCommit = false; speaking = false; speechMs = 0; itemId = null; partial = "";
      stream?.ready.then((value) => value?.cancel()); stream = null;
      endpoint = createSpeechEndpoint({ silenceMs });
    };

    // Responses: one reply at a time, synthesized sentence by sentence so truncate lands on what was heard.
    const remember = (current) => {
      spoken.set(current.itemId, current);
      while (spoken.size > 8) spoken.delete(spoken.keys().next().value);
    };
    const finish = (current, status) => {
      if (response === current) response = null;
      if (current.done) return;
      current.done = true;
      remember(current);
      const text = joinSpoken(current.sentences.map((sentence) => sentence.text));
      const item = { id: current.itemId, object: "realtime.item", type: "message", role: "assistant", status: status === "completed" ? "completed" : "incomplete", content: [audioOutput ? { type: "output_audio", transcript: text } : { type: "output_text", text }] };
      send({ type: "response.output_item.done", response_id: current.id, output_index: 0, item });
      send({ type: "conversation.item.done", item });
      send({ type: "response.done", response: { id: current.id, object: "realtime.response", status, output: [], usage: ZERO_USAGE, metadata: { lares: { origin: current.origin, usage: { billing: "child-models", input_audio_ms: Math.round(current.inputMs), output_audio_ms: Math.round(current.outputMs) } } } } });
    };
    const truncateTo = (current, audioEndMs) => {
      const heard = Math.max(0, Math.min(audioEndMs, current.outputMs));
      current.sentences = current.sentences.filter((sentence) => sentence.endMs <= heard + 1);
      const kept = current.sentences.map((sentence) => sentence.text);
      service.truncate?.(scope, current.key, joinSpoken(kept));
      send({ type: "conversation.item.truncated", item_id: current.itemId, content_index: 0, audio_end_ms: Math.round(heard) });
    };
    const cancel = (status = "cancelled", { truncate = false } = {}) => {
      const current = response;
      if (!current) return;
      current.abort.abort(); generation++;
      current.suspended?.settle("stop");
      if (headset) { hostOutput = Promise.resolve(); void Promise.resolve(port?.interrupt()).catch(() => close()); send({ type: "lares.device.playback", playing: false }); }
      awaitingPlayback = false;
      finish(current, status);
      if (truncate) truncateTo(current, played.get(current.itemId) ?? 0);
    };
    const playOut = async (current, audio) => {
      if (headset) {
        if (!current.devicePlaying) { current.devicePlaying = true; send({ type: "lares.device.playback", playing: true }); }
        hostOutput = hostOutput.then(() => current.abort.signal.aborted ? undefined : port?.write(audio));
        current.outputMs += audio.length / BYTES_PER_MS;
        return hostOutput;
      }
      if (acknowledges) awaitingPlayback = true;
      for (let offset = 0; offset < audio.length; offset += CHUNK_BYTES) {
        const chunk = audio.subarray(offset, offset + CHUNK_BYTES);
        current.outputMs += chunk.length / BYTES_PER_MS;
        send({ type: "response.output_audio.delta", response_id: current.id, item_id: current.itemId, output_index: 0, content_index: 0, delta: chunk.toString("base64") });
      }
    };
    const respond = async (text, origin, key, input) => {
      if (response) cancel("cancelled");
      const current = { id: `resp_${randomUUID()}`, itemId: `item_${randomUUID()}`, origin, key, inputMs: input, outputMs: 0, sentences: [], abort: new AbortController(), suspended: null, done: false };
      response = current; lastSpoken = { text, origin, key };
      const part = { response_id: current.id, item_id: current.itemId, output_index: 0, content_index: 0 };
      send({ type: "response.created", response: { id: current.id, object: "realtime.response", status: "in_progress", output: [], metadata: { lares: { origin } } } });
      send({ type: "response.output_item.added", response_id: current.id, output_index: 0, item: { id: current.itemId, object: "realtime.item", type: "message", role: "assistant", status: "in_progress", content: [] } });
      if (!audioOutput) {
        current.sentences = [{ text, endMs: 0 }];
        send({ type: "response.output_text.delta", ...part, delta: text });
        send({ type: "response.output_text.done", ...part, text });
        finish(current, "completed");
        return;
      }
      const sentences = segment(text).filter((value) => value.trim());
      scope.outputAbort = current.abort;
      try {
        for (const sentence of sentences.length ? sentences : [text]) {
          if (current.suspended && await current.suspended.wait === "stop") return;
          if (current.abort.signal.aborted || closed) return;
          send({ type: "response.output_audio_transcript.delta", ...part, delta: `${separator(current.sentences.at(-1)?.text, sentence)}${sentence}` });
          const audio = await synthesize(sentence, scope, (pcm) => playOut(current, pcm));
          if (current.abort.signal.aborted || closed) return;
          if (audio) await playOut(current, audio);
          current.sentences.push({ text: sentence, endMs: current.outputMs });
        }
        if (headset) {
          await hostOutput; await port?.finish();
          send({ type: "lares.device.playback", playing: false });
        }
      } catch (cause) {
        if (current.abort.signal.aborted || closed) return;
        finish(current, "failed");
        throw cause;
      }
      if (current.abort.signal.aborted || closed) return;
      send({ type: "response.output_audio_transcript.done", ...part, transcript: joinSpoken(current.sentences.map((sentence) => sentence.text)) });
      send({ type: "response.output_audio.done", ...part });
      finish(current, "completed");
    };
    const speak = (text, origin, key, input) => { void respond(text, origin, key, input).catch((cause) => report(cause)); };

    // Turns.
    const observeTasks = () => {
      const snapshot = scope.session?.snapshot();
      if (owned && scope.routerSessionId && snapshot?.sessionId && !scope.aliasBound) { scope.aliasBound = true; unbind = bindRouterSession(snapshot.sessionId, scope.routerSessionId); }
      for (const task of snapshot?.tasks || []) {
        const status = TASK_STATUS[task.status] || "unknown";
        if (turn && task.requestId.startsWith(turn.id)) turn.accepted = true;
        if (tasks.get(task.requestId) === status) continue;
        tasks.set(task.requestId, status);
        send({ type: "lares.task.updated", task_id: task.requestId, status, session_id: snapshot.sessionId || null });
      }
    };
    const submit = async (text, requestId, epoch, input) => {
      submittedTurns++;
      turn = { id: requestId, accepted: false };
      const running = scope.session?.snapshot().running === true;
      const mode = running ? busyTurn || busyDefault() : undefined;
      let state;
      try { state = await service.prompt(scope, { text, requestId, ...(mode ? { mode } : {}) }); }
      finally { observeTasks(); }
      if (closed) return;
      if (epoch !== generation) {
        // Interrupted before the task was confirmed: take the submission back when dsh still allows it.
        if (!turn.accepted) await service.withdraw?.(scope, requestId).catch(() => {});
        return;
      }
      if (state.utterance?.text && !state.utterance.silent) { lastReply = state.utterance.key; speak(state.utterance.text, "turn", state.utterance.key, input); }
    };
    const userItem = (id, content) => send({ type: "conversation.item.done", item: { id, object: "realtime.item", type: "message", role: "user", status: "completed", content: [content] } });
    const commit = async ({ endpointed = false } = {}) => {
      if (!bytes) return;
      // Server VAD keeps listening while a turn is processed; the next endpoint waits for it.
      if (busy && endpointed) { pendingCommit = true; return; }
      if (busy) fail("turn_busy");
      const input = Buffer.concat(chunks), id = itemId || `item_${randomUUID()}`, ms = input.length / BYTES_PER_MS, opened = stream;
      stream = null; reset(); scope.voiceInputActive = false; busy = true;
      send({ type: "input_audio_buffer.committed", item_id: id, previous_item_id: null });
      let epoch = generation;
      try {
        let text = null;
        const live = opened && await opened.ready;
        if (live) text = await live.finish().catch(() => null);
        text ??= await transcribe(input, scope);
        if (preset === "dictation" && owned) text = await service.clean(scope, text);
        if (closed || epoch !== generation) return;
        if (response?.suspended) {
          // Barge-in resolves on the interrupting turn: silence resumes the reply, words stop it.
          if (!text.trim()) { response.suspended.settle("resume"); return; }
          cancel("cancelled", { truncate: true });
          epoch = generation;
        }
        // An empty transcript still completes the item, so a client waiting on its take can settle.
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: id, content_index: 0, transcript: text });
        if (!text.trim()) return;
        userItem(id, { type: "input_audio", transcript: text });
        if (preset !== "dictation") await submit(text, id, epoch, ms);
      } catch (cause) { if (!closed && epoch === generation) report(cause); }
      finally {
        busy = false;
        if (pendingCommit) { pendingCommit = false; void commit({ endpointed: true }).catch(report); }
      }
    };
    const typed = async (event) => {
      if (type !== "realtime") fail("unsupported_parameter");
      const item = only(event.item, ["id", "type", "role", "content"]);
      const content = Array.isArray(item.content) && item.content.length === 1 ? only(item.content[0], ["type", "text"]) : fail("unsupported_parameter");
      if (item.type !== "message" || item.role !== "user" || content.type !== "input_text" || typeof content.text !== "string" || !content.text.trim() || content.text.length > 16000) fail("unsupported_parameter");
      if (busy) fail("turn_busy");
      busy = true;
      const id = typeof item.id === "string" && item.id ? item.id.slice(0, 128) : `item_${randomUUID()}`;
      userItem(id, { type: "input_text", text: content.text });
      try { await submit(content.text, id, generation, 0); }
      finally { busy = false; }
    };
    const startStream = () => {
      const current = { queue: [], live: null, id: itemId };
      current.write = (chunk) => { if (current.live) current.live.write(chunk); else current.queue.push(chunk); };
      current.ready = Promise.resolve(openTranscription?.(scope, (text) => {
        if (text.startsWith(partial) && text.length > partial.length && itemId === current.id) send({ type: "conversation.item.input_audio_transcription.delta", item_id: current.id, content_index: 0, delta: text.slice(partial.length) });
        partial = text;
      })).catch(() => null).then((live) => {
        current.live = live;
        for (const chunk of live ? current.queue : []) live.write(chunk);
        current.queue = [];
        return live;
      });
      return current;
    };
    const append = (audio) => {
      if (awaitingPlayback && !bargeActive()) fail("waiting_for_playback");
      if (busy && !automatic) fail("turn_busy");
      if (typeof audio !== "string" || audio.length > 64000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio)) fail("unsupported_audio_format");
      const chunk = Buffer.from(audio, "base64");
      if (chunk.length % 2) fail("unsupported_audio_format");
      if (bytes + chunk.length > TURN_BYTES) fail("audio_limit_exceeded");
      itemId ??= `item_${randomUUID()}`;
      if (openTranscription && !stream) stream = startStream();
      chunks.push(chunk); bytes += chunk.length; turnMs += chunk.length / BYTES_PER_MS; totalMs += chunk.length / BYTES_PER_MS;
      stream?.write(chunk);
      const rms = frameRms(pcmSamples(chunk));
      if (rms >= SPEECH_RMS) { touch(); speechMs += chunk.length / BYTES_PER_MS; } else speechMs = 0;
      if (rms >= SPEECH_RMS && !speaking) { speaking = true; scope.voiceInputActive = true; send({ type: "input_audio_buffer.speech_started", audio_start_ms: Math.round(totalMs), item_id: itemId }); }
      if (automatic && bargeActive() && response && !response.suspended && speechMs >= BARGE_IN_MS) suspend(response);
      if (automatic && endpoint.push(1, rms, chunk.length / BYTES_PER_MS)) {
        send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: Math.round(totalMs), item_id: itemId });
        void commit({ endpointed: true }).catch(report);
      }
    };
    const suspend = (current) => {
      let settle;
      const wait = new Promise((resolve) => { settle = resolve; });
      const timer = setTimeout(() => { if (response === current) cancel("cancelled", { truncate: true }); }, BARGE_IN_LIMIT_MS);
      current.suspended = { wait, settle: (value) => { clearTimeout(timer); if (current.suspended?.wait === wait) current.suspended = null; settle(value); } };
    };

    const configure = async (event) => {
      const session = only(event.session, ["type", "model", "audio", "output_modalities", "instructions", "lares"]);
      if ((session.type && session.type !== type) || (session.model && session.model !== model)) fail("unsupported_parameter");
      const next = { automatic, silenceMs, audioOutput, busyTurn, echoCancellation, overrides: { ...scope.voiceOverrides } };
      let contextId = null, instructions = null;
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
      if (session.instructions !== undefined) {
        if (preset !== "chat" || typeof session.instructions !== "string" || session.instructions.length > 2000) fail("unsupported_parameter");
        instructions = session.instructions;
      }
      if (session.lares !== undefined) {
        const lares = only(session.lares, ["context_id", "echo_cancellation", "busy_turn"]);
        if (lares.echo_cancellation !== undefined && typeof lares.echo_cancellation !== "boolean") fail("unsupported_parameter");
        if (lares.busy_turn !== undefined && lares.busy_turn !== null && !["queue", "steer"].includes(lares.busy_turn)) fail("unsupported_parameter");
        if (lares.busy_turn !== undefined) next.busyTurn = lares.busy_turn;
        if (lares.echo_cancellation !== undefined) next.echoCancellation = lares.echo_cancellation;
        if (lares.context_id !== undefined && lares.context_id !== scope.contextId) {
          if (!owned || typeof lares.context_id !== "string") fail("unsupported_parameter");
          if (submittedTurns || bytes || busy) fail("context_locked");
          contextId = lares.context_id;
        }
      }
      if (contextId) {
        configuring = true;
        try {
          await service.close(scope);
          await service.open(scope, { preset, sessionId, contextId, readAloud: false });
        } catch { fail("unsupported_parameter"); }
        finally { configuring = false; }
      }
      if (instructions !== null) service.instructions(scope, instructions);
      if (!owned && next.audioOutput !== audioOutput) scope.readAloud = next.audioOutput;
      ({ automatic, silenceMs, audioOutput, busyTurn, echoCancellation } = next);
      scope.voiceOverrides = next.overrides;
      endpoint = createSpeechEndpoint({ silenceMs });
      send({ type: "session.updated", session: view() });
    };
    const truncate = (event) => {
      const current = spoken.get(event.item_id) || (response?.itemId === event.item_id ? response : null);
      if (!current || event.content_index !== 0 || !Number.isInteger(event.audio_end_ms) || event.audio_end_ms < 0) fail("unsupported_parameter");
      if (response === current) cancel("cancelled");
      truncateTo(current, event.audio_end_ms);
    };
    const handle = async (event) => {
      switch (event.type) {
        case "session.update": return configure(event);
        case "input_audio_buffer.append": return append(event.audio);
        case "input_audio_buffer.commit": return commit();
        case "input_audio_buffer.clear": reset(); scope.voiceInputActive = false; send({ type: "input_audio_buffer.cleared" }); return;
        case "conversation.item.create": return typed(event);
        case "conversation.item.truncate": return truncate(event);
        case "response.create":
          if (event.response !== undefined && (typeof event.response !== "object" || event.response === null || Object.keys(event.response).length)) fail("unsupported_parameter");
          if (busy || response) fail("turn_busy");
          if (!lastSpoken) fail("unsupported_parameter");
          speak(lastSpoken.text, lastSpoken.origin, lastSpoken.key, 0);
          return;
        case "response.cancel":
          if (busy && turn) generation++;
          cancel("cancelled");
          return;
        case "lares.playback.progress":
          acknowledges = true;
          if (typeof event.item_id === "string" && Number.isFinite(event.played_ms) && event.played_ms >= 0) played.set(event.item_id, event.played_ms);
          return;
        case "lares.playback.completed": acknowledges = true; awaitingPlayback = false; return;
        case "lares.task.cancel": {
          if (typeof event.task_id !== "string" || !tasks.has(event.task_id)) fail("task_not_cancellable");
          if (await service.withdraw(scope, event.task_id) === "not_cancellable") fail("task_not_cancellable");
          observeTasks();
          return;
        }
        case "lares.device.input.pause":
          if (!headset) fail("unsupported_event");
          await port?.pauseInput(); reset(); return;
        case "lares.device.input.resume":
          if (!headset) fail("unsupported_event");
          await port?.resumeInput(); return;
        default: fail("unsupported_event");
      }
    };

    const close = () => {
      if (closed) return;
      closed = true; response?.abort.abort(); generation++; reset(); clearInterval(heartbeat); clearInterval(results); clearTimeout(idle);
      unbind(); clients.delete(client); client.close();
      void Promise.resolve(port?.stop()).catch(() => {});
      if (scope.realtimeSocket === client) scope.realtimeSocket = null;
      if (owned) void service.close(scope).catch(() => {});
    };
    let idle;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => { send({ type: "error", error: { type: "invalid_request_error", code: "session_expired", message: "Voice session idle" } }); close(); }, config().idleTimeoutMs || 300000);
    };
    touch();
    clients.set(client, close);
    if (!owned) scope.realtimeSocket = client;
    const heartbeat = setInterval(() => { if (!alive) close(); else { alive = false; client.ping(); } }, 15000);
    const results = setInterval(() => {
      if (!scope.active) return;
      try {
        observeTasks();
        if (busy || speaking || awaitingPlayback || response) return;
        const state = service.state(scope);
        if (!state.utterance?.text || state.utterance.key === lastReply || state.utterance.silent) return;
        lastReply = state.utterance.key;
        speak(state.utterance.text, String(state.utterance.key).startsWith("task:") ? "task" : "turn", state.utterance.key, 0);
      } catch { close(); }
    }, 250);
    client.on("pong", () => { alive = true; });
    client.on("close", close); client.on("error", close);
    const opening = owned ? service.open(scope, { preset, sessionId, readAloud: false }) : Promise.resolve();
    void opening.then(async () => {
      if (headset) port = await hostAudio(scope, (event) => { if (event.type === "input_audio_buffer.append") { try { append(event.audio); } catch {} } });
      if (closed) { void port?.stop(); return; }
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
    }).catch(() => { send({ type: "error", error: { type: "server_error", code: "upstream_failed", message: "Voice session failed to open" } }); close(); });
  }

  return {
    /** Ticket for a Lares client's already open pipeline scope; single use, 30 s. */
    ticket(scope) {
      if (!scope.active || !scope.session) throw Object.assign(new Error("voice session closed"), { status: 409, code: "voice_session_closed" });
      for (const [key, value] of tickets) if (value.expires < Date.now() || value.scope === scope) tickets.delete(key);
      const ticket = randomUUID();
      tickets.set(ticket, { scope, expires: Date.now() + TICKET_MS });
      return { ticket };
    },
    accepts(req) { return Boolean(req.headers.authorization) || tickets.has(ticketOf(req)); },
    upgrade(req, socket, head) {
      if (clients.size >= limit) return refuse(socket, 429, "Too Many Requests");
      if (!req.headers.authorization) {
        const token = ticketOf(req), grant = tickets.get(token);
        tickets.delete(token);
        if (!grant || grant.expires < Date.now()) return refuse(socket, 401, "Unauthorized");
        if (!grant.scope.active || grant.scope.realtimeSocket) return refuse(socket, 403, "Forbidden");
        const preset = grant.scope.voiceConfig?.preset || "chat";
        server.handleUpgrade(req, socket, head, (client) => run(client, { scope: grant.scope, model: `voice-${preset}`, preset, owned: false }));
        return;
      }
      const key = keys.verify(req.headers.authorization);
      if (!key) return refuse(socket, 401, "Unauthorized");
      const model = new URL(req.url, "http://voice.invalid").searchParams.get("model");
      const preset = PRESETS[model];
      if (!preset || !key.models.includes(model)) return refuse(socket, 403, "Forbidden");
      const dependencies = config();
      if ([dependencies.model, dependencies.chatModel, dependencies.ttsModel, dependencies.realtimeModel].some((id) => id === model || id?.endsWith(`/${model}`))) return refuse(socket, 503, "Service Unavailable");
      const scope = { id: randomUUID(), owner: hostOwner, authorizedBinding: { sessionId: key.sessionId, workspaceId: key.workspaceId }, device: "device", routerSessionId: routerSession(req.headers["x-session-id"]), voiceOverrides: {} };
      try { onOpen({ voiceId: scope.id, keyId: key.id, model, routerSession: scope.routerSessionId, remote: req.socket?.remoteAddress }); } catch {}
      server.handleUpgrade(req, socket, head, (client) => run(client, { scope, model, preset, owned: true, sessionId: key.sessionId }));
    },
    close() { for (const close of clients.values()) close(); server.close(); tickets.clear(); },
  };
}
