import { createVoiceController } from "./controller.js";
import { createDeviceInput } from "./device-input.js";
import { createHostInput } from "./host-input.js";
import { mintRpcId } from "../larepass/rpc.js";

export function createVoiceConversation({ request, transcribe, playback, onReply = () => {}, onPhase, mode = () => "queue", device = "device", metric = () => {}, readAloud = true, preset, presentationSession = false, endpointSilenceMs, idleTimeoutMs, recoveryTimeoutMs, onText = () => {}, onTranscript = null, input: inputPort, captureConfig }) {
  const voiceId = mintRpcId();
  const headers = { "x-lares-voice-id": voiceId, "x-lares-voice-device": device };
  let timer = null;
  let disposed = false;
  let version = -1;
  let lastSessionId = null;
  let spokenKey = null;
  let lastReplyKey = null;
  let mutedKey = null;
  let submitted = false;
  let finalSeen = false;
  let continuous = false;
  let manualCapture = false;
  let reading = false;
  const call = async (path, body, signal) => {
    const res = await request(`/api/lares/voice${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...headers, "x-lares-voice-speaking": controller.getSnapshot().userSpeaking ? "true" : "false" }, ...(body === undefined ? {} : { body }), signal });
    if (!res?.ok) throw new Error(res?.body?.error?.code || "voice_failed");
    return res.body;
  };
  const input = inputPort ?? (device === "headset" ? createHostInput({
    start: (signal) => call("/capture", { config: captureConfig, manual: manualCapture || Boolean(onTranscript) }, signal), status: (signal) => call("/capture", undefined, signal),
    stop: () => call("/capture/stop", {}), cancel: () => call("/capture/cancel", {}),
  }) : createDeviceInput({ transcribe, onPhase, endpointSilenceMs }));
  const controller = createVoiceController({ voiceId, input, idleTimeoutMs, recoveryTimeoutMs, onExpired: () => stop(), onTranscript: onTranscript ? async (value) => { await onTranscript(value); if (!continuous) await stop(); } : null, metric: (event) => {
    metric(event);
    void call("/session/metric", { stage: event.stage, durationMs: event.durationMs }).catch(() => {});
  }, output: { async stop() { playback.stop(); await call("/playback/stop", {}); } }, agent: {
    lazy: true,
    create: async () => null,
    async submit({ text, requestId, signal }) {
      const state = await call("/session/prompt", { text, requestId, mode: mode() }, signal);
      submitted = true;
      lastSessionId = state.sessionId;
      await poll();
    },
    cancel: () => call("/session/cancel", {}),
    running: async () => (await call("/session")).running === true,
  } });
  const poll = async () => {
    if (disposed) return;
    const state = await call("/session");
    if (disposed || controller.getSnapshot().connection !== "open") return;
    lastSessionId = state.sessionId;
    if (lastSessionId) controller.bindSession(lastSessionId);
    if (state.error && state.error !== "voice_cancelled") throw new Error(state.error);
    if (state.version !== version) {
      version = state.version;
      // Reserve playback before releasing the completed Agent turn.
      const reply = state.utterance;
      if (reply?.text && !reply.silent) onText(reply.text);
      const key = reply ? `${state.sessionId}:${reply.key}` : null;
      lastReplyKey = key;
      if (["recording", "transcribing"].includes(controller.getSnapshot().capture)) mutedKey = key;
      const reserve = readAloud && key !== mutedKey && reply?.text && !reply.silent && key !== spokenKey;
      if (reserve) spokenKey = key;
      controller.observeAgent(Boolean(state.running), Boolean(reserve));
      if (!readAloud || reply?.silent) controller.observePlayback(false);
      if (readAloud && key !== mutedKey && reply) onReply({ ...reply, key: `${voiceId}:${state.sessionId}:${reply.key}` }, headers);
    }
    if (device === "headset" && !state.running && !reading) {
      const audio = await call("/playback/status");
      controller.observePlayback(Boolean(audio.playing));
    }
    finalSeen = submitted && !state.running;
    return state;
  };
  const watch = async () => {
    if (disposed || controller.getSnapshot().connection !== "open") return;
    try { await poll(); }
    catch (error) { await controller.disconnect(error.code || error.message || "voice_disconnected"); return; }
    if (!continuous && finalSeen && controller.getSnapshot().playback === "idle") {
      try { await stop(); } catch { await controller.disconnect("voice_disconnected"); }
      return;
    }
    if (!disposed) timer = setTimeout(watch, 250);
  };
  const stop = async () => {
    disposed = true; clearTimeout(timer);
    await controller.disconnect();
    if (!onTranscript) await call("/session/close", {});
  };
  return {
    controller, headers,
    playbackState(playing) {
      reading = playing;
      if (!playing && device === "headset" && !disposed) controller.observePlayback(true);
      else controller.observePlayback(playing);
    },
    get sessionId() { return lastSessionId; },
    async start({ sessionId = null, continuous: nextContinuous = false, manual = false, shouldStart = () => true } = {}) {
      manualCapture = manual;
      continuous = nextContinuous; submitted = false; finalSeen = false; spokenKey = null;
      disposed = false; version = -1;
      clearTimeout(timer);
      const initial = onTranscript ? {} : await call("/session", { sessionId, readAloud, presentationSession, ...(preset ? { preset } : {}) });
      if (!shouldStart()) { await stop(); return; }
      await controller.start({ sessionId, continuous, manual, running: initial.running, shouldStart });
      controller.setOutputMuted(!readAloud);
      if (!onTranscript) void watch();
    },
    stop,
    async pause() { clearTimeout(timer); await controller.pause(); },
    async resume(options = {}) {
      if (onTranscript) { disposed = false; await controller.resume(options); return; }
      const current = await call("/session");
      version = current.version;
      mutedKey = current.utterance ? `${current.sessionId}:${current.utterance.key}` : null;
      spokenKey = mutedKey;
      if (!current.active) await call("/session", { sessionId: lastSessionId, readAloud });
      else await call("/session/resume", {});
      disposed = false;
      await controller.resume(options);
      void watch();
    },
    async setReadAloud(value) {
      readAloud = value === true; mutedKey = lastReplyKey;
      controller.setOutputMuted(!readAloud);
      if (!readAloud) await controller.stopPlayback();
      await call("/session/output", { readAloud });
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
    speak: (request) => call("/speak", request),
  };
}
