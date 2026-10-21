import { createVoiceController } from "./controller.js";
import { createDeviceInput } from "./device-input.js";
import { createPcmStreamPlayer } from "./pcm-player.js";
import { createVoiceProtocolClient } from "./protocol-client.js";
import { createStreamingCapture } from "./stream-client.js";
import { mintRpcId } from "../larepass/rpc.js";

const RATE = 24000;
const PROGRESS_MS = 250;

export function encodeBase64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
const decodeBase64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export function browserRealtimeSocket(ticket) {
  const url = new URL("/api/lares/voice/realtime", globalThis.location.href); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(url, ["lares-voice", `lares-ticket.${ticket}`]);
}

/**
 * The Lares client conversation over `lares-realtime-v1` (docs/realtime-protocol.md). It keeps the
 * shape of `createVoiceConversation`, so the panel and controller stay transport-neutral: the
 * microphone streams PCM into the socket, the Host transcribes, submits and speaks, and the reply
 * audio plays from the socket instead of a separate synthesis stream.
 */
export function createUnifiedConversation({ request, socket: openSocket = browserRealtimeSocket, onPhase, mode = () => "queue", device = "device", metric = () => {}, readAloud = true, preset, presentationSession = false, endpointSilenceMs, idleTimeoutMs, recoveryTimeoutMs, onText = () => {}, onTranscript = null, preparation, media, player: createPlayer = createPcmStreamPlayer, input: inputPort }) {
  const voiceId = mintRpcId();
  const headset = device === "headset";
  const headers = { "x-lares-voice-id": voiceId, "x-lares-voice-device": headset ? "headset" : "device" };
  let protocol = null, socketOpen = null, disposed = false, timer = null, lastSessionId = null, continuous = false;
  let turn = null, reply = null, outputSerial = Promise.resolve(), confirmedReadAloud = readAloud;
  const call = async (path, body, signal) => {
    const res = await request(`/api/lares/voice${path}`, { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body }), signal });
    if (!res?.ok) throw new Error(res?.body?.error?.code || "voice_failed");
    return res.body;
  };
  const sessionBody = (sessionId) => ({ sessionId, readAloud, presentationSession, preset: onTranscript ? "dictation" : preset, backend: "pipeline" });

  // Reply playback: one PCM player per response, acknowledged back to the Host.
  const player = createPlayer({ onProgress: (frames) => {
    if (!reply || !protocol) return;
    reply.playedMs = frames / (RATE / 1000);
    if (Date.now() - (reply.reported || 0) >= PROGRESS_MS) { reply.reported = Date.now(); protocol.playbackProgress(reply.itemId, Math.round(reply.playedMs)); }
  } });
  const playback = {
    begin(event) {
      reply = { id: event.response?.id, itemId: null, text: "", audio: false, playedMs: 0, chain: Promise.resolve() };
    },
    write(delta) {
      const current = reply;
      if (!current) return;
      if (!current.audio) { current.audio = true; current.chain = current.chain.then(() => player.start({ sampleRate: RATE, channels: 1, encoding: "pcm_s16le" })); controller.observePlayback(true); }
      current.chain = current.chain.then(() => { if (reply === current) player.write(decodeBase64(delta)); });
      current.chain.catch(() => {});
    },
    async done() {
      const current = reply;
      if (!current) return;
      if (current.audio) {
        try { await current.chain; await player.finish(); } catch {}
        if (reply !== current) return;
        protocol?.playbackCompleted(current.itemId);
      }
      if (reply === current) reply = null;
      controller.observePlayback(false);
    },
    async stop() {
      const current = reply;
      reply = null;
      player.stop();
      if (!current || !protocol) return;
      protocol.stopOutput();
      if (current.itemId && current.audio) protocol.truncate(current.itemId, current.playedMs);
    },
  };

  // Takes: the device microphone streams PCM over the socket; the Host transcribes on commit.
  const take = () => {
    const current = { resolve: null, reject: null, onPartial: null };
    turn = current;
    return current;
  };
  const transcription = ({ onPartial }) => {
    if (!protocol) throw new Error("voice_disconnected");
    const current = take();
    current.onPartial = onPartial;
    return {
      write(bytes) { if (turn === current && protocol) protocol.append(encodeBase64(bytes)); },
      finish() {
        return new Promise((resolve, reject) => {
          current.resolve = resolve; current.reject = reject;
          if (!onTranscript) protocol.setBusyTurn(mode());
          protocol.commit();
        });
      },
      cancel() { if (turn === current) { turn = null; protocol?.discard(); } },
    };
  };
  const deviceInput = () => createDeviceInput({ media, preparation, onPhase, endpointSilenceMs,
    transcribe: async () => { throw new Error("voice_unsupported"); },
    streamInput: (stream, options) => createStreamingCapture(stream, { ...options, sampleRate: RATE, port: async () => transcription(options) }),
  });
  // Headset: the Host owns the microphone; the socket only opens and closes it.
  const hostInput = () => ({
    capabilities: { duplex: false, bargeIn: false, audio: "pcm16-24000" },
    capture({ signal, onReady, onSpeech, onTranscribing }) {
      const current = take();
      current.onSpeech = onSpeech; current.onTranscribing = onTranscribing;
      return new Promise((resolve, reject) => {
        current.resolve = (text) => { protocol?.deviceInput(false); resolve(text); };
        current.reject = (error) => { protocol?.deviceInput(false); reject(error); };
        signal.addEventListener("abort", () => { if (turn === current) { turn = null; protocol?.discard(); protocol?.deviceInput(false); resolve(""); } }, { once: true });
        if (!onTranscript) protocol.setBusyTurn(mode());
        protocol.deviceInput(true);
        onReady?.();
      });
    },
    stop() { protocol?.commit(); },
    cancel() { const current = turn; turn = null; protocol?.discard(); protocol?.deviceInput(false); current?.resolve?.(""); },
  });
  const input = inputPort ?? (headset ? hostInput() : deviceInput());

  const onEvent = (event) => {
    switch (event.type) {
      case "input_audio_buffer.speech_started": turn?.onSpeech?.(); break;
      case "input_audio_buffer.committed": turn?.onTranscribing?.(); break;
      case "conversation.item.input_audio_transcription.delta": if (turn?.onPartial) { turn.partial = `${turn.partial || ""}${event.delta}`; turn.onPartial(turn.partial); } break;
      case "conversation.item.input_audio_transcription.completed": { const current = turn; turn = null; current?.resolve?.(event.transcript || ""); break; }
      case "response.created": playback.begin(event); break;
      case "response.output_item.added": if (reply) reply.itemId = event.item?.id || null; break;
      case "response.output_audio_transcript.delta":
      case "response.output_text.delta": if (reply) { reply.text += event.delta || ""; onText(reply.text); } break;
      case "response.output_audio.delta": playback.write(event.delta); break;
      case "response.done": void playback.done(); break;
      case "lares.device.playback": controller.observePlayback(event.playing === true); break;
      case "error": {
        const code = event.error?.code || "voice_failed";
        if (turn && ["unsupported_audio_format", "audio_limit_exceeded", "turn_busy", "waiting_for_playback", "upstream_failed"].includes(code)) { const current = turn; turn = null; current.reject?.(new Error(code)); }
        if (code === "session_expired") void controller.disconnect("voice_idle_timeout");
        break;
      }
      default: break;
    }
  };
  const connect = async () => {
    if (protocol) return;
    const { ticket } = await call("/realtime/ticket", {});
    const ws = openSocket(ticket);
    socketOpen = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("voice_realtime_timeout")), 15_000);
      protocol = createVoiceProtocolClient(ws, {
        onEvent: (event) => { if (event.type === "session.created") { clearTimeout(timeout); resolve(); } onEvent(event); },
        onClose: () => { clearTimeout(timeout); reject(new Error("voice_disconnected")); protocol = null; const current = turn; turn = null; current?.reject?.(new Error("voice_disconnected")); if (!disposed) void controller.disconnect("voice_disconnected"); },
      });
    });
    socketOpen.catch(() => {});
    await socketOpen;
    // Device takes keep client endpointing; the headset microphone lives on the Host, so its VAD does.
    protocol.configure({ type: onTranscript ? "transcription" : "realtime", automatic: headset && continuous, audio: readAloud });
  };
  const disconnectSocket = () => { const current = protocol; protocol = null; current?.close(); };

  const controller = createVoiceController({ voiceId, input, idleTimeoutMs, recoveryTimeoutMs, onExpired: () => stop(),
    onTranscript: onTranscript ? async (value) => { await onTranscript(value); if (!continuous) await stop(); } : null,
    metric: (event) => { metric(event); void call("/session/metric", { stage: event.stage, durationMs: event.durationMs }).catch(() => {}); },
    output: { get canPause() { return !headset; }, key: () => reply?.id, pause: () => player.pause?.(), resume: () => player.resume?.(), stop: () => playback.stop() },
    agent: {
      lazy: true,
      create: async () => null,
      // The Host submitted this turn when its audio was committed; only the lifecycle remains to observe.
      async submit() { await poll(); },
      cancel: () => call("/session/cancel", {}),
      running: async () => (await call("/session")).running === true,
    },
  });
  const poll = async () => {
    if (disposed || onTranscript) return;
    const state = await call("/session");
    if (disposed || controller.getSnapshot().connection !== "open") return;
    lastSessionId = state.sessionId;
    if (lastSessionId) controller.bindSession(lastSessionId);
    if (state.error && state.error !== "voice_cancelled") throw new Error(state.error);
    controller.observeAgent(Boolean(state.running) || Boolean(reply), Boolean(reply?.audio));
  };
  const watch = async () => {
    if (disposed || controller.getSnapshot().connection !== "open") return;
    try { await poll(); }
    catch (error) { await controller.disconnect(error.code || error.message || "voice_disconnected"); return; }
    if (!disposed) timer = setTimeout(watch, 500);
  };
  const stop = async () => {
    disposed = true; clearTimeout(timer);
    player.stop(); reply = null;
    await controller.disconnect();
    disconnectSocket();
    await call("/session/close", {}).catch(() => {});
  };
  return {
    controller, headers,
    // Reply audio is played here, not by the panel's reader.
    playbackState() {},
    get sessionId() { return lastSessionId; },
    async start({ sessionId = null, continuous: nextContinuous = false, manual = false, shouldStart = () => true } = {}) {
      continuous = nextContinuous; disposed = false; clearTimeout(timer);
      const initial = await call("/session", sessionBody(sessionId));
      if (!shouldStart()) { await stop(); return; }
      await connect();
      if (!shouldStart()) { await stop(); return; }
      await controller.start({ sessionId, continuous, manual, running: initial.running, shouldStart });
      controller.setOutputMuted(!readAloud);
      if (!onTranscript) void watch();
    },
    stop,
    async pause() { clearTimeout(timer); await controller.pause(); },
    async resume(options = {}) {
      disposed = false;
      if (!onTranscript) {
        const current = await call("/session");
        if (!current.active) await call("/session", sessionBody(lastSessionId));
        else await call("/session/resume", {});
      }
      await connect();
      await controller.resume(options);
      if (!onTranscript) void watch();
    },
    setReadAloud(value) {
      const next = value === true;
      if (readAloud === next && confirmedReadAloud === next) return Promise.resolve();
      readAloud = next;
      controller.setOutputMuted(!next);
      const stopped = !next ? Promise.resolve(controller.stopPlayback()).then(() => null, (error) => error) : Promise.resolve(null);
      const result = outputSerial.catch(() => {}).then(async () => {
        const error = await stopped;
        if (error) throw error;
        if (protocol) protocol.setOutput(next);
        confirmedReadAloud = next;
      });
      outputSerial = result;
      return result;
    },
    records: async () => {
      const res = await request("/api/lares/voice/records", { method: "GET", headers });
      if (!res?.ok) throw new Error("voice_records_failed");
      return res.body;
    },
    clearRecords: async () => {
      await stop();
      const res = await request("/api/lares/voice/records", { method: "DELETE", headers });
      if (!res?.ok) throw new Error("voice_records_failed");
    },
    speak: (body) => call("/speak", body),
  };
}
