import { createVoiceController } from "./controller.js";
import { createDeviceInput } from "./device-input.js";
import { createHostInput } from "./host-input.js";
import { mintRpcId } from "../larepass/rpc.js";

export function createVoiceConversation({ request, transcribe, playback, onReply = () => {}, onPhase, mode = () => "queue", device = "device", metric = () => {}, readAloud = true, input: inputPort }) {
  const voiceId = mintRpcId();
  const headers = { "x-lares-voice-id": voiceId, "x-lares-voice-device": device };
  let timer = null;
  let disposed = false;
  let version = -1;
  let lastSessionId = null;
  let spokenKey = null;
  let submitted = false;
  let finalSeen = false;
  let continuous = false;
  let reading = false;
  const call = async (path, body, signal) => {
    const res = await request(`/api/lares/voice${path}`, { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body }), signal });
    if (!res?.ok) throw new Error(res?.body?.error?.code || "voice_failed");
    return res.body;
  };
  const input = inputPort ?? (device === "headset" ? createHostInput({
    start: (signal) => call("/capture", {}, signal), status: (signal) => call("/capture", undefined, signal),
    stop: () => call("/capture/stop", {}), cancel: () => call("/capture/cancel", {}),
  }) : createDeviceInput({ transcribe, onPhase }));
  const controller = createVoiceController({ input, metric: (event) => {
    metric(event);
    void call("/session/metric", { stage: event.stage, durationMs: event.durationMs }).catch(() => {});
  }, output: { async stop() { playback.stop(); await call("/playback/stop", {}); } }, agent: {
    create: async () => "@voice-pending",
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
    lastSessionId = state.sessionId;
    if (lastSessionId) controller.bindSession(lastSessionId);
    if (state.error && state.error !== "voice_cancelled") throw new Error(state.error);
    if (state.version !== version) {
      version = state.version;
      // Reserve playback before releasing the completed Agent turn.
      const reply = state.utterance;
      const key = reply ? `${state.sessionId}:${reply.key}` : null;
      const reserve = readAloud && reply?.text && !reply.silent && key !== spokenKey;
      if (reserve) spokenKey = key;
      controller.observeAgent(Boolean(state.running), Boolean(reserve));
      if (!readAloud || reply?.silent) controller.observePlayback(false);
      if (readAloud && reply) onReply({ ...reply, key: `${voiceId}:${state.sessionId}:${reply.key}` }, headers);
    }
    if (device === "headset" && !state.running && !reading) {
      const audio = await call("/playback/status");
      controller.observePlayback(Boolean(audio.playing));
    }
    finalSeen = submitted && !state.running;
    return state;
  };
  const watch = async () => {
    if (disposed) return;
    try { await poll(); }
    catch { await controller.disconnect("voice_disconnected"); return; }
    if (!continuous && finalSeen && controller.getSnapshot().playback === "idle") {
      try { await stop(); } catch { await controller.disconnect("voice_disconnected"); }
      return;
    }
    if (!disposed) timer = setTimeout(watch, 250);
  };
  const stop = async () => {
    disposed = true; clearTimeout(timer);
    await controller.disconnect();
    await call("/session/close", {});
  };
  return {
    controller, headers,
    playbackState(playing) {
      reading = playing;
      if (!playing && device === "headset" && !disposed) controller.observePlayback(true);
      else controller.observePlayback(playing);
    },
    get sessionId() { return lastSessionId; },
    async start({ sessionId = null, continuous: nextContinuous = false } = {}) {
      continuous = nextContinuous; submitted = false; finalSeen = false; spokenKey = null;
      disposed = false; version = -1;
      clearTimeout(timer);
      const initial = await call("/session", { sessionId, readAloud });
      await controller.start({ sessionId, continuous, running: initial.running });
      void watch();
    },
    stop,
    async resume() {
      const current = await call("/session");
      if (!current.active) await call("/session", { sessionId: lastSessionId, readAloud });
      else await call("/session/resume", {});
      disposed = false;
      await controller.resume();
      void watch();
    },
    speak: (request) => call("/speak", request),
  };
}
