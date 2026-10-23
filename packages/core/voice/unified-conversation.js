import { createVoiceController } from "./controller.js";
import { createDeviceInput } from "./device-input.js";
import { createPcmStreamPlayer } from "./pcm-player.js";
import { createVoiceProtocolClient } from "./protocol-client.js";
import { createStreamingCapture } from "./stream-client.js";
import { isTransientVoiceError, transientVoiceError } from "./errors.js";
import { mintRpcId } from "../larepass/rpc.js";

const RATE = 24000;
const PROGRESS_MS = 250;
// A commit is final on the Host. If its transcript never comes back the
// composer must stop waiting instead of sitting on 转写中 for minutes.
const COMMIT_TIMEOUT_MS = 60_000;

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
export function createUnifiedConversation({ request, socket: openSocket = browserRealtimeSocket, onPhase, mode = () => "queue", device = "device", metric = () => {}, readAloud = true, preset, presentationSession = false, endpointSilenceMs, idleTimeoutMs, recoveryTimeoutMs, commitTimeoutMs = COMMIT_TIMEOUT_MS, onText = () => {}, onTranscript = null, preparation, media, player: createPlayer = createPcmStreamPlayer, input: inputPort, transcribe = async () => { throw new Error("voice_unsupported"); } }) {
  const voiceId = mintRpcId();
  const headset = device === "headset";
  const headers = { "x-lares-voice-id": voiceId, "x-lares-voice-device": headset ? "headset" : "device" };
  let protocol = null, socketOpen = null, disposed = false, timer = null, lastSessionId = null, continuous = false;
  let turn = null, reply = null, outputSerial = Promise.resolve(), confirmedReadAloud = readAloud, hostHeard = false;
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
      reply = { id: event.response?.id, itemId: null, text: "", audio: false, playedMs: 0, chain: Promise.resolve(), muted: false };
    },
    write(delta) {
      const current = reply;
      if (!current) return;
      // Read-aloud was turned off locally but the Host still has audio on
      // (a lost output update). Converge by cancelling that reply instead of
      // playing something the user asked not to hear.
      if (readAloud !== true) {
        if (!current.muted) { current.muted = true; protocol?.stopOutput(); controller.observePlayback(false); }
        return;
      }
      if (!current.audio) { current.audio = true; current.chain = current.chain.then(() => player.start({ sampleRate: RATE, channels: 1, encoding: "pcm_s16le" })); controller.observePlayback(true); }
      current.chain = current.chain.then(() => { if (reply === current) player.write(decodeBase64(delta)); });
      current.chain.catch(() => {});
    },
    async done() {
      const current = reply;
      if (!current) return;
      let failure = null;
      try {
        if (current.audio) {
          try { await current.chain; await player.finish(); } catch (cause) { failure = cause; }
          if (reply !== current) return;
          if (failure) {
            // Audio that never reached the speaker is a real, visible failure;
            // release the Host gate too instead of leaving the call muted.
            protocol?.stopOutput();
            controller.notePlaybackError(failure.code || failure.message || "voice_playback_failed");
            return;
          }
          protocol?.playbackCompleted(current.itemId);
        }
      } finally {
        // Only this reply may clear playback: a newer reply already owns it.
        if (reply === current) {
          reply = null;
          controller.observePlayback(false);
        }
      }
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
    hostHeard = false;
    current.onPartial = onPartial;
    // The promise exists for the whole take. An error while audio is still
    // streaming has to reject it; waiting until finish() to attach reject left
    // the composer on 转写中.
    let settle, timer = null, committed = false;
    const result = new Promise((resolve, reject) => {
      settle = (error, text) => {
        if (current.done) return;
        current.done = true;
        if (timer) { clearTimeout(timer); timer = null; }
        if (turn === current) turn = null;
        if (error) reject(error); else resolve(text ?? "");
      };
      current.resolve = (text) => settle(null, text);
      current.reject = (error) => settle(error);
    });
    void result.catch(() => {});
    return {
      write(bytes) { if (!current.done && protocol) protocol.append(encodeBase64(bytes)); },
      get committed() { return committed; },
      // The Host submits a conversation turn on commit, so its recording must
      // not be uploaded again. Dictation only returns text and stays replayable.
      get replayable() { return Boolean(onTranscript); },
      finish() {
        if (current.done) return result;
        if (!onTranscript) protocol.setBusyTurn(mode());
        protocol.commit();
        committed = true;
        if (!timer) {
          timer = setTimeout(() => {
            timer = null;
            if (current.done) return;
            // The commit is final on the Host; this client just stops waiting so
            // the composer returns to listening. A late transcript is ignored.
            current.reject?.(transientVoiceError("voice_asr_timeout"));
          }, commitTimeoutMs);
          timer.unref?.();
        }
        return result;
      },
      cancel() { if (!current.done) { protocol?.discard(); settle(null, ""); } },
    };
  };
  const deviceInput = () => createDeviceInput({ media, preparation, onPhase, endpointSilenceMs, transcribe,
    streamInput: (stream, options) => createStreamingCapture(stream, { ...options, sampleRate: RATE, port: async () => transcription(options) }),
  });
  // Headset: the Host owns the microphone; the socket only opens and closes it.
  const hostInput = () => ({
    capabilities: { duplex: false, bargeIn: false, audio: "pcm16-24000" },
    capture({ signal, onReady, onSpeech, onTranscribing }) {
      const current = take();
      current.onSpeech = onSpeech; current.onTranscribing = onTranscribing;
      let timer = null;
      const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
      return new Promise((resolve, reject) => {
        current.armCommit = () => {
          if (timer || turn !== current) return;
          // The Host owns the ASR request. Stop waiting if its transcript never
          // comes back; the take settles without closing the call.
          timer = setTimeout(() => {
            timer = null;
            if (turn !== current) return;
            turn = null;
            current.reject?.(transientVoiceError("voice_asr_timeout"));
          }, commitTimeoutMs);
          timer.unref?.();
        };
        current.resolve = (text) => { clear(); protocol?.deviceInput(false); resolve(text); };
        current.reject = (error) => { clear(); protocol?.deviceInput(false); reject(error); };
        signal.addEventListener("abort", () => { if (turn === current) { turn = null; clear(); protocol?.discard(); protocol?.deviceInput(false); resolve(""); } }, { once: true });
        if (!onTranscript) protocol.setBusyTurn(mode());
        protocol.deviceInput(true);
        onReady?.();
      });
    },
    stop() { const current = turn; current?.armCommit?.(); protocol?.commit(); },
    cancel() { const current = turn; turn = null; protocol?.discard(); protocol?.deviceInput(false); current?.resolve?.(""); },
  });
  const input = inputPort ?? (headset ? hostInput() : deviceInput());

  const onEvent = (event) => {
    switch (event.type) {
      case "input_audio_buffer.speech_started": turn?.onSpeech?.(); break;
      case "input_audio_buffer.committed": turn?.onTranscribing?.(); break;
      case "conversation.item.input_audio_transcription.delta": if (turn?.onPartial) { turn.partial = `${turn.partial || ""}${event.delta}`; turn.onPartial(turn.partial); } break;
      case "conversation.item.input_audio_transcription.completed": {
        // The Host already submitted a non-empty transcript. An empty one did not,
        // so a later blob fallback has to send the words itself.
        hostHeard = Boolean(String(event.transcript || "").trim());
        const current = turn; turn = null; current?.resolve?.(event.transcript || "");
        break;
      }
      case "response.created": playback.begin(event); break;
      case "response.output_item.added": if (reply) reply.itemId = event.item?.id || null; break;
      case "response.output_audio_transcript.delta":
      case "response.output_text.delta": if (reply) { reply.text += event.delta || ""; onText(reply.text); } break;
      case "response.output_audio.delta": playback.write(event.delta); break;
      case "response.done": void playback.done(); break;
      case "lares.device.playback": controller.observePlayback(event.playing === true); break;
      case "error": {
        const code = event.error?.code || "voice_failed";
        // Any error with a take open belongs to that take. Settling it here is
        // what keeps the composer off 转写中; transient contention drops only
        // the take, not the call.
        if (turn) {
          const current = turn;
          turn = null;
          current.reject?.(isTransientVoiceError(code) ? transientVoiceError(code) : Object.assign(new Error(code), { code }));
        }
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
      async submit({ text } = {}) {
        // Audio that never reached the socket still has a recording. The Host did not
        // see that take, so hand the transcript over as a typed turn instead of dropping it.
        const typed = Boolean(text) && !hostHeard;
        hostHeard = false;
        if (typed) protocol?.say(text);
        await poll();
      },
      cancel: () => call("/session/cancel", {}),
      running: async () => (await call("/session")).running === true,
    },
  });
  const poll = async () => {
    if (disposed || onTranscript) return;
    const state = await call("/session");
    // A paused call still has a chat session. Stop watching only after it is closed,
    // otherwise a dropped socket leaves the composer on "working" after the task ends.
    if (disposed || controller.getSnapshot().connection === "closed") return;
    lastSessionId = state.sessionId;
    if (lastSessionId) controller.bindSession(lastSessionId);
    if (state.error && state.error !== "voice_cancelled") throw new Error(state.error);
    // A finished reply is not a running agent: keeping it "running" left the
    // panel on Working forever and blocked the next continuous turn.
    controller.observeAgent(Boolean(state.running), Boolean(reply?.audio));
  };
  const watch = async () => {
    if (disposed || controller.getSnapshot().connection === "closed") return;
    try { await poll(); }
    catch (error) {
      if (controller.getSnapshot().connection === "open") await controller.disconnect(error.code || error.message || "voice_disconnected");
    }
    if (!disposed && controller.getSnapshot().connection !== "closed") timer = setTimeout(watch, 500);
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
