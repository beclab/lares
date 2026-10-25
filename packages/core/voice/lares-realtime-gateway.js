import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { validateConfigPatch } from "./config.js";
import { echoVerdict } from "./echo.js";
import { createNoiseGate, createSpeechEndpoint, frameRms } from "./endpoint.js";
import { pcmSamples } from "./realtime-audio.js";
import { createPlayoutClock, PLAYOUT_LEAD_MS, SOCKET_FUSE_BYTES } from "./playout-clock.js";
import { createSpeechSegmenter, speechSegments } from "./script.js";
import { bindRouterSession } from "../router/session-alias.js";
import { REALTIME_MODEL_PRESETS, voiceCapabilities } from "./capabilities.js";
import { listeningPolicy } from "./listening.js";

const FORMAT = Object.freeze({ type: "audio/pcm", rate: 24000 });
const BYTES_PER_MS = 48;
const TURN_BYTES = 60_000 * BYTES_PER_MS;
// Audio kept from just before speech starts, so the first syllable is not cut.
const PREROLL_BYTES = 300 * BYTES_PER_MS;
const CHUNK_BYTES = 500 * BYTES_PER_MS;
const SPEECH_RMS = 0.004;
// Interruption policy (docs/realtime-protocol.md): speech must last this long to suspect barge-in,
// and a suspected interruption that never resolves stops the reply.
const BARGE_IN_MS = 500;
// A device take ends once streaming ASR has heard this much more of it without a new word.
const WORDS_SETTLED_MS = 1000;
// Streaming ASR can repeat its last words for a second while the speaker is still mid-word: on the
// robot "could you change the color f…" was cut there four times in one test. While a voice was
// heard this recently the words have to stay unchanged this much longer before the take ends.
const VOICE_RECENT_MS = 300;
const WORDS_SETTLED_VOICED_MS = 2500;
// How long a barge-in waits for ASR's first words before deciding whether they were the reply's echo.
const ECHO_WAIT_MS = 1500;
const BARGE_IN_LIMIT_MS = 10_000;
// Room echo outlasts the last sample a client was sent by roughly this much.
const ECHO_TAIL_MS = 400;
const TICKET_MS = 30_000;
// How often a reply read while it is written is checked for new sentences.
const LIVE_POLL_MS = 100;
// A device's camera frame arrives as one data URL; everything else stays far below this.
const MAX_FRAME = 512 * 1024;
const IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
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
// `done === false` is a live partial. A finished utterance sets done, and a caller
// that never reports it (tests, a one-shot reply) is spoken as-is.
const speakableUtterance = (utterance) => (Boolean(utterance?.text) || Boolean(utterance?.calls?.length)) && utterance.done !== false && !utterance.silent;
/** Device tools in Realtime function shape; `ask_lares` stays the dialogue's own. */
function clientTools(value) {
  if (!Array.isArray(value) || value.length > 64 || JSON.stringify(value).length > 64_000) fail("unsupported_parameter");
  const names = new Set();
  return value.map((entry) => {
    const tool = only(entry, ["type", "name", "description", "parameters"]);
    if (tool.type !== "function" || typeof tool.name !== "string" || !TOOL_NAME.test(tool.name) || tool.name === "ask_lares" || names.has(tool.name)) fail("unsupported_parameter");
    if (tool.description !== undefined && (typeof tool.description !== "string" || tool.description.length > 4000)) fail("unsupported_parameter");
    if (tool.parameters !== undefined && (!tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters))) fail("unsupported_parameter");
    names.add(tool.name);
    return { name: tool.name, description: tool.description || "", parameters: tool.parameters };
  });
}
/** Spoken segments are cleaned clauses; rejoin them without inventing spaces inside CJK text. */
export function joinSpoken(parts) {
  return parts.reduce((text, part) => `${text}${separator(text, part)}${part}`, "");
}

/**
 * `lares-realtime-v1` (docs/realtime-protocol.md) on one endpoint. Bearer voice-key callers get a
 * scope owned by the socket; ticket sockets attach to the Lares client's open voice scope.
 */
export function createLaresRealtimeGateway({ service, config, transcribe, synthesize, openTranscription, detectSpeech, speechGate, keys, hostOwner = "", hostAudio, busyDefault = () => "queue", bargeIn = () => process.env.LARES_VOICE_BARGE_IN === "1", segment = speechSegments, createSegmenter = createSpeechSegmenter, streaming = () => false, onError = () => {}, onOpen = () => {}, metric = () => {}, limit = 64, playbackAckGraceMs = 60_000 }) {
  const server = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false, handleProtocols: (values) => values.has("lares-voice") ? "lares-voice" : false });
  const clients = new Map();
  const tickets = new Map();

  function run(client, { scope, model, preset, owned, sessionId }) {
    const caps = voiceCapabilities(preset, { clientTools: owned && scope.authorizedBinding?.clientTools === true });
    const { type } = caps;
    const headset = !owned && scope.device === "headset";
    scope.voiceOverrides ??= {};
    let chunks = [], bytes = 0, turnMs = 0, totalMs = 0, speaking = false, speechMs = 0, itemId = null, partial = "", stream = null;
    // When streaming ASR first repeated the take's words unchanged; 0 while they are still growing.
    let wordsSince = 0, voicedAt = 0;
    // What the microphone heard while a device played a reply, reported once the reply has stopped:
    // the only way to tell from the logs why speaking over a reply did or did not interrupt it.
    let listen = null;
    const reportListen = () => {
      const heard = listen; listen = null;
      try {
        const levels = heard.levels.sort((a, b) => a - b);
        const at = (q) => Number((levels[Math.min(levels.length - 1, Math.floor(levels.length * q))] ?? 0).toFixed(4));
        const { noise, learned } = replyGate.levels();
        metric({ event: "device-reply-listen", voiceId: scope.id, ms: Math.round(heard.ms), p50: at(0.5), p95: at(0.95), max: at(1), echoNoise: Number((noise ?? 0).toFixed(4)), echoLearned: Number(learned.toFixed(4)), overEchoMs: Math.round(heard.overEcho), modelVoiceMs: Math.round(heard.modelVoice), voicedMs: Math.round(heard.voiced), barges: heard.barges, gate: modelGate?.kind || "energy" });
      } catch {}
    };
    // A device take whose speaker was already talking again when its words came back: the first
    // part of one request, held until the rest arrives.
    let carry = "";
    let automatic = false, silenceMs = config().endpointSilenceMs || 500, endpoint = createSpeechEndpoint({ silenceMs });
    let audioOutput = type === "realtime" && (owned || scope.readAloud === true), busyTurn = null, echoCancellation = true;
    // The take being transcribed holds this session's one ASR request; the next take only buffers until it is done.
    let transcribing = false;
    let closed = false, busy = false, pendingCommit = false, configuring = false, alive = true, generation = 0, submittedTurns = 0;
    let response = null, awaitingPlayback = false, acknowledges = false, lastReply = null, lastSpoken = null, turn = null, port = null, unbind = () => {};
    let hostOutput = Promise.resolve();
    let ackTimer = null;
    // Device sessions follow OpenAI item semantics: items only add context and `response.create` asks for a reply.
    let pendingText = null, pendingCreate = false, declared = [], toolChoice = "auto";
    // A client that never acknowledges playback is assumed to play what it was sent in real time.
    let playbackUntil = 0;
    // The room's level persists across takes; a take only tells the gate when someone speaks.
    const noiseGate = createNoiseGate();
    // While a device plays a reply its microphone hears that reply. This gate learns the echo's level,
    // so only speech that stands out from it can become a barge-in.
    const replyGate = createNoiseGate();
    // A device's room is judged by a speech model when there is one (speechGate), so a fan, a motor
    // or a microphone's gain is never a voice however loud it is. Until it has loaded, or when it
    // cannot, loudness decides and Router's VAD checks each take and each barge-in afterwards.
    // Loaded with the session, so a device's first words are already heard by the model; the model
    // itself is shared by the process and this is only its per-session state.
    let modelGate = null;
    if (speechGate) Promise.resolve().then(speechGate).then((gate) => { if (!closed) modelGate = gate; }).catch((cause) => { try { onError(cause, scope); } catch {} });
    const roomGate = () => (modelGate && listening().mode === "device" ? modelGate : noiseGate);
    // Speech heard during a device's reply, before it is confirmed as a person.
    let barge = null;
    const tasks = new Map();
    const spoken = new Map();
    const played = new Map();

    // A client that vanishes in the middle of a reply never acknowledges it.
    // Without a watchdog the half-duplex gate stays closed for that connection
    // and every later utterance fails with waiting_for_playback.
    const PLAYBACK_ACK_GRACE_MS = playbackAckGraceMs;
    const clearAckWatch = () => { if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; } };
    const watchAck = () => {
      clearAckWatch();
      if (!awaitingPlayback || closed) return;
      ackTimer = setTimeout(() => {
        ackTimer = null;
        if (closed || !awaitingPlayback) return;
        awaitingPlayback = false;
        send({ type: "lares.playback.timeout" });
      }, PLAYBACK_ACK_GRACE_MS);
      ackTimer.unref?.();
    };

    const bargeActive = () => type === "realtime" && !headset && echoCancellation && bargeIn() === true;
    const listening = () => listeningPolicy({ automatic, acknowledges, headset, echoCancellation, bargeIn: bargeActive() });
    const playing = () => Date.now() < playbackUntil + ECHO_TAIL_MS;
    const send = (event) => {
      if (closed || client.readyState !== 1) return;
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
      lares: { capabilities: { ...REALTIME_CAPABILITIES, barge_in: type === "realtime" && listening().bargeIn, client_tools: caps.clientTools }, context_id: scope.contextId, device: headset ? "headset" : "device" },
    });
    const reset = () => {
      clearTimeout(barge?.timer);
      chunks = []; bytes = 0; turnMs = 0; pendingCommit = false; speaking = false; speechMs = 0; itemId = null; partial = ""; barge = null; wordsSince = 0;
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
      // Audio that never left the server will not be acknowledged. Holding the
      // gate here is how a failed or empty reply silences every later one.
      if (!current.outputMs) { awaitingPlayback = false; clearAckWatch(); }
      if (current.done) return;
      current.done = true;
      if (current.message) {
        remember(current);
        const text = joinSpoken(current.sentences.map((sentence) => sentence.text));
        const item = { id: current.itemId, object: "realtime.item", type: "message", role: "assistant", status: status === "completed" ? "completed" : "incomplete", content: [audioOutput ? { type: "output_audio", transcript: text } : { type: "output_text", text }] };
        send({ type: "response.output_item.done", response_id: current.id, output_index: 0, item });
        send({ type: "conversation.item.done", item });
      }
      send({ type: "response.done", response: { id: current.id, object: "realtime.response", status, output: current.calls, usage: ZERO_USAGE, metadata: { lares: { origin: current.origin, usage: { billing: "child-models", input_audio_ms: Math.round(current.inputMs), output_audio_ms: Math.round(current.outputMs) } } } } });
      queueMicrotask(drainCreate);
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
      clearAckWatch();
      finish(current, status);
      if (truncate) truncateTo(current, played.get(current.itemId) ?? 0);
    };
    const playOut = async (current, audio) => {
      if (current.abort.signal.aborted || current.done || closed) return;
      if (headset) {
        if (!current.devicePlaying) { current.devicePlaying = true; send({ type: "lares.device.playback", playing: true }); }
        hostOutput = hostOutput.then(() => current.abort.signal.aborted ? undefined : port?.write(audio));
        current.outputMs += audio.length / BYTES_PER_MS;
        return hostOutput;
      }
      if (acknowledges) { awaitingPlayback = true; watchAck(); }
      // A client that announces playback acknowledgement used to stop after two
      // seconds unless later ticks kept arriving. Those ticks are observations.
      // The reply keeps moving with the clock; the socket fuse is only for a
      // client that has stopped reading.
      if (!current.clock) current.clock = createPlayoutClock({ leadMs: PLAYOUT_LEAD_MS });
      const clock = current.clock;
      let sentAt = Date.now();
      for (let offset = 0; offset < audio.length; offset += CHUNK_BYTES) {
        clock.start();
        clock.heard(played.get(current.itemId) ?? 0);
        while ((acknowledges && clock.blocked(current.outputMs)) || client.bufferedAmount > SOCKET_FUSE_BYTES) {
          if (current.abort.signal.aborted || current.done || closed || client.readyState !== 1) return;
          clock.heard(played.get(current.itemId) ?? 0);
          if (client.bufferedAmount > SOCKET_FUSE_BYTES && Date.now() - sentAt > 10_000) throw new Error("voice_audio_backpressure");
          if (!((acknowledges && clock.blocked(current.outputMs)) || client.bufferedAmount > SOCKET_FUSE_BYTES)) break;
          const delay = client.bufferedAmount > SOCKET_FUSE_BYTES ? 20 : Math.max(20, Math.min(200, clock.wait(current.outputMs)));
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        if (current.abort.signal.aborted || current.done || closed || client.readyState !== 1) return;
        const chunk = audio.subarray(offset, offset + CHUNK_BYTES);
        current.outputMs += chunk.length / BYTES_PER_MS;
        if (!acknowledges) playbackUntil = Math.max(playbackUntil, Date.now()) + chunk.length / BYTES_PER_MS;
        send({ type: "response.output_audio.delta", response_id: current.id, item_id: current.itemId, output_index: 0, content_index: 0, delta: chunk.toString("base64") });
        sentAt = Date.now();
      }
    };
    const emitCalls = (current, calls) => {
      for (const call of calls) {
        const outputIndex = current.calls.length + (current.message ? 1 : 0);
        const item = { id: `item_${randomUUID()}`, object: "realtime.item", type: "function_call", status: "completed", name: call.name, call_id: call.call_id, arguments: call.arguments };
        send({ type: "response.output_item.added", response_id: current.id, output_index: outputIndex, item: { ...item, status: "in_progress", arguments: "" } });
        send({ type: "response.function_call_arguments.done", response_id: current.id, item_id: item.id, output_index: outputIndex, call_id: call.call_id, name: call.name, arguments: call.arguments });
        send({ type: "response.output_item.done", response_id: current.id, output_index: outputIndex, item });
        send({ type: "conversation.item.done", item });
        current.calls.push(item);
      }
    };
    // `live` reads a reply while the dialogue is still writing it: its items are sentences and, once
    // the dialogue has finished, the reply's calls.
    const respond = async (text, origin, key, input, calls = [], live = null) => {
      if (response) cancel("cancelled");
      const current = { id: `resp_${randomUUID()}`, itemId: `item_${randomUUID()}`, origin, key, inputMs: input, outputMs: 0, sentences: [], abort: new AbortController(), suspended: null, done: false, message: Boolean(text), calls: [] };
      response = current;
      if (current.message && !live) lastSpoken = { text, origin, key };
      const part = { response_id: current.id, item_id: current.itemId, output_index: 0, content_index: 0 };
      send({ type: "response.created", response: { id: current.id, object: "realtime.response", status: "in_progress", output: [], metadata: { lares: { origin } } } });
      if (current.message) send({ type: "response.output_item.added", response_id: current.id, output_index: 0, item: { id: current.itemId, object: "realtime.item", type: "message", role: "assistant", status: "in_progress", content: [] } });
      // Calls go out before the speech so a gesture can accompany the words it belongs to. A reply
      // read while it is written only knows its calls at the end, so they follow its first words.
      emitCalls(current, calls);
      if (!current.message) { finish(current, "completed"); return; }
      if (!audioOutput) {
        current.sentences = [{ text, endMs: 0 }];
        send({ type: "response.output_text.delta", ...part, delta: text });
        send({ type: "response.output_text.done", ...part, text });
        finish(current, "completed");
        return;
      }
      const sentences = live ? [] : segment(text).filter((value) => value.trim());
      const items = live ? live.items : (sentences.length ? sentences : [text]).map((sentence) => ({ text: sentence }));
      scope.outputAbort = current.abort;
      try {
        for await (const item of items) {
          if (current.abort.signal.aborted || closed) return;
          if (item.calls) { emitCalls(current, item.calls); continue; }
          const sentence = item.text;
          if (current.suspended && await current.suspended.wait === "stop") return;
          if (current.abort.signal.aborted || closed) return;
          send({ type: "response.output_audio_transcript.delta", ...part, delta: `${separator(current.sentences.at(-1)?.text, sentence)}${sentence}` });
          // A slice has to reach the player before synthesize continues, so a
          // caller that pauses after the first slice can still be interrupted.
          // A device starts speaking at the engine's first chunk; Lares's own clients keep whole
          // sentences until streamed speech has been accepted there.
          const audio = await synthesize(sentence, scope, (pcm) => playOut(current, pcm), { stream: listening().mode === "device" });
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
      finish(current, live?.status ?? "completed");
    };
    const speak = (text, origin, key, input, calls, live) => { void respond(text, origin, key, input, calls, live).catch((cause) => report(cause)); };

    /**
     * Read-while-writing for a device: once the GPU lets the dialogue and speech models run side by
     * side (`streaming`), a reply's closed sentences are spoken while the dialogue is still writing.
     * The first sentence waits for the second, or for the call to end, because a model sometimes says
     * a few words before it delegates to the Agent, and those words are never the reply. A call that
     * starts delegating releases nothing more.
     */
    const readsWhileWriting = () => audioOutput && listening().mode === "device" && streaming() === true;
    const followLive = (key, input) => {
      const segmenter = createSegmenter();
      const queue = [];
      let wake = null, call = 0, held = [], started = false, ended = false, timer = null;
      const live = { status: "completed", items: (async function* items() {
        while (true) {
          while (queue.length) { const item = queue.shift(); if (item.end) return; yield item; }
          await new Promise((resolve) => { wake = resolve; });
          wake = null;
        }
      })() };
      const push = (item) => { queue.push(item); wake?.(); };
      const release = () => {
        if (!held.length) return;
        if (!started) { started = true; lastReply = key; speak(held[0], "turn", key, input, [], live); }
        for (const text of held) push({ text });
        held = [];
      };
      const take = (texts) => {
        held.push(...texts.filter((text) => text.trim()));
        if (started || held.length >= 2) release();
      };
      const read = (text, done) => {
        try { take([...segmenter.update(text, { done }), ...(done ? [] : segmenter.flush())]); }
        catch { ended = true; }
      };
      const poll = () => {
        if (ended || closed) return;
        const state = service.state(scope)?.live;
        if (!state || state.key !== key) return;
        // A new chat call starts from scratch: anything held from the previous one was never the reply.
        if (state.call !== call) { call = state.call; held = []; segmenter.reset(); }
        if (state.delegated) { held = []; return; }
        read(state.text, false);
      };
      timer = setInterval(poll, LIVE_POLL_MS);
      const end = (status) => {
        clearInterval(timer);
        live.status = status;
        push({ end: true });
      };
      return {
        get started() { return started; },
        /** The dialogue has finished: speak the rest of its words, then its calls. */
        finish(utterance) {
          clearInterval(timer);
          if (!started) { ended = true; return false; }
          if (!ended && utterance?.text) read(utterance.text, true);
          release();
          if (utterance?.text) lastSpoken = { text: utterance.text, origin: "turn", key };
          if (utterance?.calls?.length) push({ calls: utterance.calls });
          end("completed");
          return true;
        },
        /** The turn failed or was taken back: keep what was said, mark the reply incomplete. */
        stop() { ended = true; if (started) end("incomplete"); else clearInterval(timer); },
      };
    };

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
      const live = readsWhileWriting() ? followLive(requestId, input) : null;
      try { state = text === null ? await service.proceed(scope, { requestId }) : await service.prompt(scope, { text, requestId, ...(mode ? { mode } : {}) }); }
      catch (cause) { live?.stop(); throw cause; }
      finally { observeTasks(); }
      if (closed) { live?.stop(); return; }
      if (epoch !== generation) {
        live?.stop();
        // Interrupted before the task was confirmed: take the submission back when dsh still allows it.
        if (!turn.accepted) await service.withdraw?.(scope, requestId).catch(() => {});
        return;
      }
      if (live) {
        if (state.utterance?.key !== requestId || !speakableUtterance(state.utterance)) live.stop();
        else if (live.finish(state.utterance)) return;
      }
      // A snapshot taken while the answer is still streaming only has the first
      // sentence. Speaking that and remembering the key drops the rest.
      if (speakableUtterance(state.utterance)) { lastReply = state.utterance.key; speak(state.utterance.text, "turn", state.utterance.key, input, state.utterance.calls); }
    };
    const userItem = (id, content) => send({ type: "conversation.item.done", item: { id, object: "realtime.item", type: "message", role: "user", status: "completed", content: [content] } });
    // One line per device take: what the room sounded like and why the take ended, which is the
    // only way to tune the noise gate against a real room.
    const reportTake = (taken, ms, speech, ended) => {
      try {
        const levels = taken.map((chunk) => frameRms(pcmSamples(chunk))).sort((a, b) => a - b);
        const at = (q) => Number((levels[Math.min(levels.length - 1, Math.floor(levels.length * q))] ?? 0).toFixed(4));
        const { noise, learned } = noiseGate.levels();
        metric({ event: "device-take", voiceId: scope.id, gate: modelGate?.kind || "energy", ms: Math.round(ms), ended, speech, chunks: levels.length, p50: at(0.5), p95: at(0.95), max: at(1), noise: Number((noise ?? 0).toFixed(4)), learned: Number(learned.toFixed(4)) });
      } catch {}
    };
    const commit = async (ended = "client") => {
      if (closed) return;
      // A commit with no samples still has a client waiting in transcribing.
      // Returning here never completes that take, so the composer stays on 转写中.
      if (!bytes) {
        const id = itemId || `item_${randomUUID()}`;
        reset();
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: id, content_index: 0, transcript: "" });
        if (carry && !busy) void flushCarry().catch(report);
        return;
      }
      // The previous turn is still being transcribed or submitted. The mic is
      // shared and the client cannot know that, so queue this take instead of
      // rejecting it; the composer would otherwise see a hard turn_busy.
      if (busy) { pendingCommit = true; return; }
      const taken = chunks, input = Buffer.concat(taken), id = itemId || `item_${randomUUID()}`, ms = input.length / BYTES_PER_MS, opened = stream, held = barge, policy = listening();
      stream = null; reset(); scope.voiceInputActive = false; busy = true;
      send({ type: "input_audio_buffer.committed", item_id: id, previous_item_id: null });
      let epoch = generation, text = null;
      transcribing = true;
      try {
        try {
          // A server_vad take from a client without playback reports is often only the room or
          // the reply's echo when loudness opened it. Router's VAD decides before ASR and the
          // dialogue spend anything on it; when it cannot answer, the take goes through as before.
          // A take the speech model opened has been heard as a voice already.
          const speech = policy.vadVeto && detectSpeech && !modelGate ? await detectSpeech(input, scope) : null;
          if (policy.vadVeto) reportTake(taken, ms, speech, ended);
          if (speech === 0) {
            await opened?.ready.then((value) => value?.cancel());
            noiseGate.learn(taken.map((chunk) => frameRms(pcmSamples(chunk))));
            if (!closed) send({ type: "conversation.item.input_audio_transcription.completed", item_id: id, content_index: 0, transcript: "" });
            if (carry) { const held = carry; carry = ""; userItem(id, { type: "input_audio", transcript: held }); if (type === "realtime") await submit(held, id, epoch, 0); }
            return;
          }
          const live = opened && await opened.ready;
          if (live) text = await live.finish().catch(() => null);
          text ??= await transcribe(input, scope);
          // A take that ended while its barge-in was still unconfirmed: the VAD has confirmed a voice,
          // and the whole take's words now say whether it was the reply's own.
          if (held && !closed) {
            if (echoVerdict(text, replyText(), true) === "echo") { learnEcho(taken, text); text = ""; }
            else interrupt(id, held.at);
          }
        } catch (cause) {
          // A device cannot show an error and keeps listening, so a take ASR could not read is
          // dropped like noise; only the log keeps it.
          if (policy.mode !== "device" || closed) throw cause;
          try { onError(cause, scope); } catch {}
          send({ type: "conversation.item.input_audio_transcription.failed", item_id: id, content_index: 0, error: { type: "transcription_error", code: "transcription_failed", message: "Speech could not be transcribed" } });
          return;
        } finally { resumeStream(); }
        if (type === "transcription" && owned) text = await service.clean(scope, text);
        if (closed || epoch !== generation) return;
        if (response?.suspended) {
          // Barge-in resolves on the interrupting turn: silence resumes the reply, words stop it.
          if (!text.trim()) { response.suspended.settle("resume"); return; }
          cancel("cancelled", { truncate: true });
          epoch = generation;
        }
        // An empty transcript still completes the item, so a client waiting on its take can settle.
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: id, content_index: 0, transcript: text });
        const heard = text.trim();
        // The speaker is already talking again: a pause split one request ("search Beijing" ...
        // "weather today"), so this part waits for the rest instead of becoming a turn of its own.
        if (heard && policy.mode === "device" && speaking) { carry = carry ? `${carry} ${heard}` : heard; return; }
        const said = [carry, heard].filter(Boolean).join(" ");
        carry = "";
        if (!said) return;
        userItem(id, { type: "input_audio", transcript: said });
        if (type === "realtime") await submit(said, id, epoch, ms);
      } catch (cause) { if (!closed && epoch === generation) report(cause); }
      finally {
        busy = false;
        if (pendingCommit) { pendingCommit = false; void commit().catch(report); }
        else drainTyped();
      }
    };
    const flushCarry = async () => {
      if (!carry || closed) return;
      if (busy) { pendingCommit = true; return; }
      const said = carry, id = `item_${randomUUID()}`, epoch = generation;
      carry = ""; busy = true;
      try {
        userItem(id, { type: "input_audio", transcript: said });
        if (type === "realtime") await submit(said, id, epoch, 0);
      } catch (cause) { if (!closed && epoch === generation) report(cause); }
      finally {
        busy = false;
        if (pendingCommit) { pendingCommit = false; void commit().catch(report); }
        else drainTyped();
      }
    };
    // Typed text that arrives while a take is in flight waits its turn instead
    // of being rejected: on a shared link the client cannot tell it is early.
    const typedQueue = [];
    const drainTyped = () => {
      if (closed || busy) return;
      if (!typedQueue.length) { drainCreate(); return; }
      const next = typedQueue.shift();
      void runTyped(next).catch(report);
    };
    const create = () => {
      if (busy || response) { pendingCreate = true; return; }
      if (pendingText !== null) { const text = pendingText; pendingText = null; void runTyped({ id: `item_${randomUUID()}`, text }).catch(report); return; }
      void proceed().catch(report);
    };
    function drainCreate() { if (pendingCreate && !closed && !busy && !response) { pendingCreate = false; create(); } }
    const proceed = async () => {
      if (closed) return;
      busy = true;
      try { await submit(null, `resp_turn_${randomUUID()}`, generation, 0); }
      finally { busy = false; drainTyped(); }
    };
    const deviceItem = (item) => {
      if (item.type === "function_call_output") {
        const output = only(item, ["id", "type", "call_id", "output"]);
        if (typeof output.call_id !== "string" || !output.call_id || output.call_id.length > 128 || typeof output.output !== "string" || output.output.length > 16000) fail("unsupported_parameter");
        try { service.toolOutput(scope, output.call_id, output.output); } catch (cause) { if (cause.code === "voice_tool_unknown") fail("unsupported_parameter"); throw cause; }
        return;
      }
      only(item, ["id", "type", "role", "content"]);
      if (item.type !== "message" || item.role !== "user" || !Array.isArray(item.content) || !item.content.length || item.content.length > 4) fail("unsupported_parameter");
      const texts = [], images = [];
      for (const value of item.content) {
        if (value?.type === "input_text") {
          const part = only(value, ["type", "text"]);
          if (typeof part.text !== "string" || !part.text.trim() || part.text.length > 16000) fail("unsupported_parameter");
          texts.push(part.text);
        } else if (value?.type === "input_image") {
          const part = only(value, ["type", "image_url", "detail"]);
          if (typeof part.image_url !== "string" || part.image_url.length > MAX_FRAME - 1024 || !IMAGE_URL.test(part.image_url)) fail("unsupported_parameter");
          images.push({ type: "image_url", image_url: { url: part.image_url } });
        } else fail("unsupported_parameter");
      }
      if (images.length) service.observe(scope, images);
      if (texts.length) {
        const text = [pendingText, ...texts].filter(Boolean).join("\n");
        if (text.length > 16000) fail("unsupported_parameter");
        pendingText = text;
      }
    };
    const runTyped = async ({ id, text }) => {
      if (closed) return;
      busy = true;
      userItem(id, { type: "input_text", text });
      try { await submit(text, id, generation, 0); }
      finally { busy = false; drainTyped(); }
    };
    const typed = async (event) => {
      if (type !== "realtime") fail("unsupported_parameter");
      if (caps.clientTools) return deviceItem(only(event.item, ["id", "type", "role", "content", "call_id", "output"]));
      const item = only(event.item, ["id", "type", "role", "content"]);
      const content = Array.isArray(item.content) && item.content.length === 1 ? only(item.content[0], ["type", "text"]) : fail("unsupported_parameter");
      if (item.type !== "message" || item.role !== "user" || content.type !== "input_text" || typeof content.text !== "string" || !content.text.trim() || content.text.length > 16000) fail("unsupported_parameter");
      const id = typeof item.id === "string" && item.id ? item.id.slice(0, 128) : `item_${randomUUID()}`;
      if (busy) { if (typedQueue.length >= 8) fail("turn_busy"); typedQueue.push({ id, text: content.text }); return; }
      await runTyped({ id, text: content.text });
    };
    const startStream = () => {
      const current = { queue: [], live: null, id: itemId };
      current.write = (chunk) => { if (current.live) current.live.write(chunk); else current.queue.push(chunk); };
      current.ready = Promise.resolve(openTranscription?.(scope, (text) => {
        if (text.startsWith(partial) && text.length > partial.length && itemId === current.id) send({ type: "conversation.item.input_audio_transcription.delta", item_id: current.id, content_index: 0, delta: text.slice(partial.length) });
        // ASR reports after every step it decodes: the same words again mean it heard more and no new word.
        if (itemId === current.id) wordsSince = text.trim() && text === partial ? wordsSince || Date.now() : 0;
        partial = text;
        if (itemId === current.id) judgeEcho(false);
      })).catch(() => null).then((live) => {
        current.live = live;
        for (const chunk of live ? current.queue : []) live.write(chunk);
        current.queue = [];
        return live;
      });
      return current;
    };
    // The next take's stream opens once the previous take's ASR is done, with what it already heard.
    const resumeStream = () => {
      transcribing = false;
      if (openTranscription && !stream && itemId && !closed) { stream = startStream(); for (const kept of chunks) stream.write(kept); }
    };
    const append = (audio) => {
      if (awaitingPlayback && !bargeActive()) fail("waiting_for_playback");
      const policy = listening();
      // Half duplex for a client without playback acknowledgements that cannot tell its echo from
      // the user: while its speaker is still playing the reply, the microphone mostly hears that
      // reply. Dropped quietly, because the client cannot tell when to stop sending.
      if (policy.muteWhilePlaying && playing()) return;
      // Audio that arrives while the previous take is being transcribed belongs
      // to the next turn; keep it and let that commit queue behind the first one.
      if (typeof audio !== "string" || audio.length > 64000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio)) fail("unsupported_audio_format");
      const chunk = Buffer.from(audio, "base64");
      if (chunk.length % 2) fail("unsupported_audio_format");
      const ms = chunk.length / BYTES_PER_MS;
      const rms = frameRms(pcmSamples(chunk));
      if (rms >= SPEECH_RMS) touch();
      // server_vad hears the room all the time. Until someone speaks only a short pre-roll is
      // kept, so steady noise neither fills the take nor streams to ASR, and only audio that
      // clears the room's level counts as speech that can end.
      const duringReply = policy.confirmedBargeIn && playing();
      const room = roomGate();
      room.hear?.(chunk);
      // During a device's reply its own voice is in the room too, and a speech model hears that as
      // speech: only what also stands out from the reply's echo can be a person.
      // The speech model's verdict has no side effects, so during a reply it is read on its own too:
      // the reply listen report below says which of the two gates a barge-in failed.
      const overEcho = duringReply && replyGate.voiced(rms, speaking, ms);
      const modelVoice = duringReply && room !== noiseGate ? room.voiced(rms, speaking, ms) : null;
      const voiced = !automatic ? rms >= SPEECH_RMS
        : duringReply ? overEcho && (room === noiseGate || modelVoice)
        : room.voiced(rms, speaking, ms);
      if (duringReply) {
        listen ??= { ms: 0, levels: [], overEcho: 0, modelVoice: 0, voiced: 0, barges: 0 };
        listen.ms += ms;
        if (listen.levels.length < 20_000) listen.levels.push(rms);
        if (overEcho) listen.overEcho += ms;
        if (modelVoice) listen.modelVoice += ms;
        if (voiced) listen.voiced += ms;
      } else if (listen) reportListen();
      totalMs += ms;
      if (automatic && !speaking && !voiced) {
        chunks.push(chunk); bytes += chunk.length;
        while (chunks.length > 1 && bytes - chunks[0].length >= PREROLL_BYTES) bytes -= chunks.shift().length;
        turnMs = bytes / BYTES_PER_MS; speechMs = 0;
        return;
      }
      if (bytes + chunk.length > TURN_BYTES) {
        if (!automatic) fail("audio_limit_exceeded");
        // A take that never fell quiet is closed rather than refusing everything after it.
        send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: Math.round(totalMs), item_id: itemId });
        void commit("overflow").catch(report);
        return;
      }
      itemId ??= `item_${randomUUID()}`;
      if (openTranscription && !stream && !transcribing) { stream = startStream(); for (const kept of chunks) stream.write(kept); }
      chunks.push(chunk); bytes += chunk.length; turnMs += ms;
      stream?.write(chunk);
      if (voiced) { speechMs += ms; voicedAt = Date.now(); } else speechMs = 0;
      if (voiced && !speaking) {
        speaking = true; scope.voiceInputActive = true;
        // Loudness gates count a frame as speech only near the take's peak, which is how they keep a
        // room's hum out. A speech model has already said which frames are a voice: its quieter
        // syllables are speech too, or a phrase after one loud syllable reads as a knock.
        if (room !== noiseGate) endpoint = createSpeechEndpoint({ silenceMs, relative: 0 });
        // A device stops playing on speech_started, so during its reply that waits for confirmation.
        if (duringReply) { barge = { at: Math.round(totalMs), checking: false }; listen.barges++; }
        else send({ type: "input_audio_buffer.speech_started", audio_start_ms: Math.round(totalMs), item_id: itemId });
      }
      if (barge && !barge.checking && speechMs >= BARGE_IN_MS) confirmBarge();
      if (policy.suspendBargeIn && response && !response.suspended && speechMs >= BARGE_IN_MS) suspend(response);
      if (policy.takeLimitMs && turnMs >= policy.takeLimitMs) {
        send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: Math.round(totalMs), item_id: itemId });
        void commit("limit").catch(report);
        return;
      }
      // A speech model hears any voice, including people talking to each other across the room, and
      // keeps such a take open. The speaker has finished once ASR stops finding new words in it.
      const settled = Date.now() - voicedAt < VOICE_RECENT_MS ? WORDS_SETTLED_VOICED_MS : WORDS_SETTLED_MS;
      if (policy.mode === "device" && speaking && !barge && wordsSince && Date.now() - wordsSince >= settled) {
        send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: Math.round(totalMs), item_id: itemId });
        void commit("words").catch(report);
        return;
      }
      if (automatic && endpoint.push(voiced ? 1 : 0, rms, ms)) {
        send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: Math.round(totalMs), item_id: itemId });
        void commit("silence").catch(report);
      } else if (automatic && endpoint.abandoned()) {
        // A sound too short to be a phrase opened the take; it would otherwise hold it, and an ASR
        // stream, until the take limit. `cleared` tells the client the speech it was told of is gone.
        reportTake(chunks, turnMs, null, "short");
        send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: Math.round(totalMs), item_id: itemId });
        send({ type: "input_audio_buffer.cleared" });
        reset(); scope.voiceInputActive = false;
        // What was held for a continuation that turned out to be a cough still has to be answered.
        if (carry) void flushCarry().catch(report);
      }
    };
    // Full duplex for a device: only a person stops the reply. With the speech model the gate has
    // already heard one; on the loudness path Router's VAD decides, and when it cannot answer, the
    // speech is taken as a person.
    const confirmBarge = () => {
      const current = barge;
      current.checking = true;
      if (modelGate) { heardPerson(current); return; }
      void Promise.resolve(detectSpeech ? detectSpeech(Buffer.concat(chunks), scope) : null).catch(() => null).then((seconds) => {
        if (closed || barge !== current) return;
        if (seconds === 0) { reset(); scope.voiceInputActive = false; return; }
        heardPerson(current);
      });
    };
    // A device without echo cancellation hears its own reply, and a speech model hears that as a
    // person; its words give it away. When the take is streaming to ASR, the barge-in waits for the
    // first words (at most ECHO_WAIT_MS) and goes through only when they are not the reply's.
    const replyText = () => [...new Set([...[...spoken.values()].slice(-2), ...(response ? [response] : [])])].flatMap((item) => item.sentences.map((sentence) => sentence.text)).join(" ");
    const heardPerson = (current) => {
      if (!stream) { interrupt(itemId, current.at); return; }
      current.listening = true;
      current.timer = setTimeout(() => judgeEcho(true), ECHO_WAIT_MS);
      judgeEcho(false);
    };
    const judgeEcho = (final) => {
      const current = barge;
      if (closed || !current?.listening) return;
      const verdict = echoVerdict(partial, replyText(), final);
      if (!verdict) return;
      clearTimeout(current.timer);
      if (verdict === "person") { interrupt(itemId, current.at); return; }
      learnEcho(chunks, partial);
      reset(); scope.voiceInputActive = false;
    };
    // An echo's loudness is what the reply gate should not let through next time.
    const learnEcho = (taken, heard) => {
      replyGate.learn(taken.map((chunk) => frameRms(pcmSamples(chunk))));
      try { metric({ event: "device-echo", voiceId: scope.id, heard: String(heard || "").slice(0, 80) }); } catch {}
    };
    const interrupt = (id, at) => {
      clearTimeout(barge?.timer);
      barge = null;
      send({ type: "input_audio_buffer.speech_started", audio_start_ms: at, item_id: id });
      // The device plays in real time: what it has not played when it stops was never heard. The
      // server has usually sent the whole reply already, so the last spoken one is cut instead.
      const unplayed = Math.max(0, playbackUntil - Date.now());
      const current = response || [...spoken.values()].at(-1);
      if (current && unplayed) {
        const heard = Math.max(0, current.outputMs - unplayed);
        if (current === response) { played.set(current.itemId, heard); cancel("cancelled", { truncate: true }); }
        else truncateTo(current, heard);
      }
      playbackUntil = 0;
    };
    const suspend = (current) => {
      let settle;
      const wait = new Promise((resolve) => { settle = resolve; });
      const timer = setTimeout(() => { if (response === current) cancel("cancelled", { truncate: true }); }, BARGE_IN_LIMIT_MS);
      current.suspended = { wait, settle: (value) => { clearTimeout(timer); if (current.suspended?.wait === wait) current.suspended = null; settle(value); } };
    };

    const configure = async (event) => {
      const session = only(event.session, ["type", "model", "audio", "output_modalities", "instructions", "lares", ...(caps.clientTools ? ["tools", "tool_choice"] : [])]);
      if ((session.type && session.type !== type) || (session.model && session.model !== model)) fail("unsupported_parameter");
      const next = { automatic, silenceMs, audioOutput, busyTurn, echoCancellation, overrides: { ...scope.voiceOverrides } };
      let contextId = null, instructions = null;
      if (session.tool_choice !== undefined && !["auto", "none"].includes(session.tool_choice)) fail("unsupported_parameter");
      const tools = session.tools === undefined ? declared : clientTools(session.tools);
      const choice = session.tool_choice ?? toolChoice;
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
        if (!caps.instructions || typeof session.instructions !== "string" || session.instructions.length > caps.instructionLimit) fail("unsupported_parameter");
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
      // A reopened context starts a fresh dialogue, so declared tools are applied again.
      if (caps.clientTools && (contextId || tools !== declared || choice !== toolChoice)) service.tools(scope, choice === "none" ? [] : tools);
      declared = tools; toolChoice = choice;
      if (!owned && next.audioOutput !== audioOutput) scope.readAloud = next.audioOutput;
      ({ automatic, silenceMs, audioOutput, busyTurn, echoCancellation } = next);
      scope.voiceOverrides = next.overrides;
      endpoint = createSpeechEndpoint({ silenceMs });
      send({ type: "session.updated", session: view() });
    };
    const truncate = (event) => {
      const current = spoken.get(event.item_id) || (response?.itemId === event.item_id ? response : null);
      playbackUntil = 0;
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
          if (caps.clientTools) { create(); return; }
          if (busy || response) fail("turn_busy");
          if (!lastSpoken) fail("unsupported_parameter");
          speak(lastSpoken.text, lastSpoken.origin, lastSpoken.key, 0);
          return;
        case "response.cancel":
          // The client has stopped listening. A reply that already finished must
          // not keep the next utterance behind waiting_for_playback.
          awaitingPlayback = false; playbackUntil = 0;
          clearAckWatch();
          if (busy && turn) generation++;
          cancel("cancelled");
          return;
        case "lares.playback.progress":
          acknowledges = true;
          if (typeof event.item_id === "string" && Number.isFinite(event.played_ms) && event.played_ms >= 0) played.set(event.item_id, event.played_ms);
          // Progress is the client proving it is still rendering the reply.
          watchAck();
          return;
        case "lares.playback.completed": acknowledges = true; awaitingPlayback = false; clearAckWatch(); return;
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
      closed = true; response?.abort.abort(); generation++; reset(); clearAckWatch(); clearInterval(heartbeat); clearInterval(results); clearTimeout(idle);
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
        if (!speakableUtterance(state.utterance) || state.utterance.key === lastReply) return;
        lastReply = state.utterance.key;
        speak(state.utterance.text, String(state.utterance.key).startsWith("task:") ? "task" : "turn", state.utterance.key, 0, state.utterance.calls);
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
      const preset = REALTIME_MODEL_PRESETS[model];
      if (!preset || !key.models.includes(model)) return refuse(socket, 403, "Forbidden");
      const dependencies = config();
      if ([dependencies.model, dependencies.chatModel, dependencies.ttsModel, dependencies.realtimeModel].some((id) => id === model || id?.endsWith(`/${model}`))) return refuse(socket, 503, "Service Unavailable");
      const scope = { id: randomUUID(), owner: hostOwner, authorizedBinding: { sessionId: key.sessionId, workspaceId: key.workspaceId, clientTools: key.clientTools === true }, device: "device", routerSessionId: routerSession(req.headers["x-session-id"]), voiceOverrides: {} };
      try { onOpen({ voiceId: scope.id, keyId: key.id, model, routerSession: scope.routerSessionId, remote: req.socket?.remoteAddress }); } catch {}
      server.handleUpgrade(req, socket, head, (client) => run(client, { scope, model, preset, owned: true, sessionId: key.sessionId }));
    },
    close() { for (const close of clients.values()) close(); server.close(); tickets.clear(); },
  };
}
