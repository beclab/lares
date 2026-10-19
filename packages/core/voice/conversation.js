import { createVoiceController } from "./controller.js";
import { createDeviceInput } from "./device-input.js";
import { createHostInput } from "./host-input.js";
import { mintRpcId } from "../larepass/rpc.js";

export function createVoiceConversation({ request, transcribe, playback, onReply = () => {}, onPhase, mode = () => "queue", device = "device", metric = () => {}, readAloud = true, preset, backend, presentationSession = false, endpointSilenceMs, idleTimeoutMs, recoveryTimeoutMs, onText = () => {}, onTranscript = null, input: inputPort, captureConfig, streamInput, preparation }) {
  const voiceId = mintRpcId();
  const headers = { "x-lares-voice-id": voiceId, "x-lares-voice-device": device };
  let timer = null;
  let outputAbort = null;
  let outputRevision = 0, outputSerial = Promise.resolve(), confirmedReadAloud = readAloud;
  let disposed = false;
  let version = -1;
  let lastSessionId = null;
  let spokenKey = null;
  let lastReplyKey = null;
  let mutedKey = null;
  const mutedTurns = new Set();
  const mute = (reply, sessionId) => { if (Number.isFinite(reply?.turn)) mutedTurns.add(`${sessionId}:${reply.turn}`); };
  let submitted = false;
  let finalSeen = false;
  let continuous = false;
  let manualCapture = false;
  let reading = false, lastUtterance = null;
  const call = async (path, body, signal) => {
    const res = await request(`/api/lares/voice${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...headers, "x-lares-voice-speaking": controller.getSnapshot().userSpeaking ? "true" : "false" }, ...(body === undefined ? {} : { body }), signal });
    if (!res?.ok) throw new Error(res?.body?.error?.code || "voice_failed");
    return res.body;
  };
  const input = inputPort ?? (device === "headset" ? createHostInput({
    start: (signal) => call("/capture", { config: captureConfig, manual: manualCapture || Boolean(onTranscript) }, signal), status: (signal) => call("/capture", undefined, signal),
    stop: () => call("/capture/stop", {}), cancel: () => call("/capture/cancel", {}),
  }) : createDeviceInput({ transcribe, streamInput, preparation, onPhase, endpointSilenceMs }));
  const controller = createVoiceController({ voiceId, input, idleTimeoutMs, recoveryTimeoutMs, onExpired: () => stop(), onTranscript: onTranscript ? async (value) => { await onTranscript(value); if (!continuous) await stop(); } : null, metric: (event) => {
    metric(event);
    void call("/session/metric", { stage: event.stage, durationMs: event.durationMs }).catch(() => {});
  }, output: { get canPause() { return playback.canPause === true; }, key: () => playback.key, pause: () => playback.pause?.(), resume: () => playback.resume?.(), async stop() {
      const reply = lastUtterance;
      playback.stop();
      if (!reply || !Number.isFinite(reply.turn) || typeof lastSessionId !== "string") return;
      await call("/playback/stop", { sessionId: lastSessionId, turn: reply.turn, step: reply.step, attemptId: reply.attemptId });
    } }, agent: {
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
      lastUtterance = reply;
      if (reply?.text && !reply.silent) onText(reply.text);
      const key = reply ? `${state.sessionId}:${reply.key}` : null;
      lastReplyKey = key;
      if (!input.capabilities?.echoTested && ["recording", "transcribing"].includes(controller.getSnapshot().capture)) { mutedKey = key; mute(reply, state.sessionId); }
      const turnMuted = reply && mutedTurns.has(`${state.sessionId}:${reply.turn}`);
      const reserve = !turnMuted && readAloud && key !== mutedKey && reply?.text && !reply.silent && key !== spokenKey;
      if (reserve) spokenKey = key;
      controller.observeAgent(Boolean(state.running), Boolean(reserve));
      if (!readAloud || reply?.silent) controller.observePlayback(false);
      if (!turnMuted && readAloud && key !== mutedKey && reply) onReply({ ...reply, sessionId: state.sessionId, source: { sessionId: state.sessionId, turn: reply.turn, step: reply.step, attemptId: reply.attemptId }, key: `${voiceId}:${state.sessionId}:${reply.key}` }, headers);
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
    disposed = true; outputRevision++; outputAbort?.abort(); clearTimeout(timer);
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
      const initial = onTranscript ? {} : await call("/session", { sessionId, readAloud, presentationSession, ...(preset ? { preset } : {}), ...(backend ? { backend } : {}) });
      if (!shouldStart()) { await stop(); return; }
      // The answer already on screen belongs to the chat reader. Re-subscribing
      // here attaches to a run that reader is about to cancel.
      if (initial?.utterance && typeof initial.sessionId === "string") {
        mute(initial.utterance, initial.sessionId);
        mutedKey = `${initial.sessionId}:${initial.utterance.key}`;
        spokenKey = mutedKey;
      }
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
      mute(current.utterance, current.sessionId);
      mutedKey = current.utterance ? `${current.sessionId}:${current.utterance.key}` : null;
      spokenKey = mutedKey;
      if (!current.active) await call("/session", { sessionId: lastSessionId, readAloud, presentationSession, ...(preset ? { preset } : {}), ...(backend ? { backend } : {}) });
      else await call("/session/resume", {});
      disposed = false;
      await controller.resume(options);
      void watch();
    },
    setReadAloud(value) {
      const next = value === true;
      if (readAloud === next && confirmedReadAloud === next) return Promise.resolve();
      const changed = readAloud !== next;
      readAloud = next;
      const revision = ++outputRevision;
      confirmedReadAloud = undefined;
      if (changed) { mutedKey = lastReplyKey; mute(lastUtterance, lastSessionId); }
      controller.setOutputMuted(!next);
      // Stop local audio immediately, while ordering remote changes per VoiceSession.
      const stopped = Promise.resolve(!next && changed ? controller.stopPlayback() : null).then(() => null, error => error);
      const result = outputSerial.catch(() => {}).then(async () => {
        const error = await stopped;
        if (disposed || revision !== outputRevision) return;
        if (error) throw error;
        const abort = outputAbort = new AbortController();
        try {
          await call("/session/output", { readAloud: next }, AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]));
          if (!disposed && revision === outputRevision) confirmedReadAloud = next;
        } catch (error) {
          if (!disposed && revision === outputRevision) {
            readAloud = false;
            controller.setOutputMuted(true);
            playback.stop();
            controller.observePlayback(false);
          }
          throw error;
        } finally { if (outputAbort === abort) outputAbort = null; }
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
    speak: (request) => call("/speak", request),
  };
}
