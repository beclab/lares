import { createVoiceController } from "./controller.js";
import { createPcmBrowserAudio } from "./realtime-audio.js";
import { mintRpcId } from "../larepass/rpc.js";

export function createRealtimeConversation({ request, socket: openSocket, device = "device", playback, onCaption = () => {}, idleTimeoutMs, recoveryTimeoutMs, readAloud = true, presentationSession = false }) {
  const voiceId = mintRpcId();
  const headers = { "x-lares-voice-id": voiceId, "x-lares-voice-device": device };
  let socket;
  let intentional = false;
  let currentItem = null;
  let responseActive = false;
  let receivedMs = 0;
  let boundSessionId = null;
  let pollTimer;
  let audio;
  const send = (value) => {
    if (socket?.readyState !== 1) return;
    if (socket.bufferedAmount > 1024 * 1024) { void controller.disconnect("voice_audio_backpressure"); return; }
    socket.send(JSON.stringify(value));
  };
  const call = async (path, body) => {
    const res = await request(`/api/lares/voice${path}`, { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body }) });
    if (!res?.ok) throw new Error(res?.body?.error?.code || "voice_failed");
    return res.body;
  };
  const stopPlayback = async () => {
    const played = Math.min(receivedMs, audio?.playedMs() || 0);
    audio?.stopPlayback(); playback?.stop?.();
    if (responseActive) send({ type: "response.cancel" });
    responseActive = false;
    if (currentItem && device === "device") send({ type: "conversation.item.truncate", item_id: currentItem, content_index: 0, audio_end_ms: played });
    controller.observePlayback(false);
  };
  const controller = createVoiceController({ voiceId, idleTimeoutMs, recoveryTimeoutMs,
    onExpired: async () => { intentional = true; clearTimeout(pollTimer); socket?.close(); await audio?.stop(); await call("/session/close", {}); },
    input: { capabilities: { duplex: device === "device", bargeIn: false, listenWhileWorking: true, audio: "pcm16-24000" },
      capture: ({ signal }) => new Promise((resolve, reject) => {
        send({ type: "lares.input.resume" });
        if (device === "device") void audio.start().catch(reject);
        signal.addEventListener("abort", () => resolve(""), { once: true });
      }), cancel: async () => { send({ type: "lares.input.pause" }); audio?.pauseInput(); },
    }, output: { stop: stopPlayback }, agent: {
      create: async () => boundSessionId,
      submit: async () => {},
      cancel: () => call("/session/cancel", {}),
      running: async () => (await call("/session")).running === true,
    },
  });
  audio = createPcmBrowserAudio({ send, onPlayback: (playing) => controller.observePlayback(playing), onError: (error) => { void controller.disconnect(error.message); } });
  const connect = async () => {
    intentional = false;
    const grant = await call("/realtime/ticket", {});
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket?.close(); reject(new Error("voice_realtime_timeout")); }, 20_000);
      socket = openSocket(grant.ticket);
      const connectedSocket = socket;
      socket.addEventListener("message", (message) => {
        if (socket !== connectedSocket) return;
        let event;
        try { event = JSON.parse(message.data); } catch { return; }
        if (!event || typeof event !== "object") return;
        if (event.type === "input_audio_buffer.speech_started") controller.noteActivity();
        if (event.type === "lares.ready") { clearTimeout(timeout); resolve(); }
        else if (event.type === "lares.error") { clearTimeout(timeout); reject(new Error(event.code)); void controller.disconnect(event.code); }
        else if (["response.output_audio.delta", "response.audio.delta"].includes(event.type)) {
          currentItem = event.item_id || currentItem;
          receivedMs += atob(event.delta).length / 48;
          try { audio.write(event.delta); } catch (error) { void controller.disconnect(error.message); }
        } else if (event.type === "response.created") { responseActive = true; receivedMs = 0; currentItem = null; }
        else if (event.type === "response.done") responseActive = false;
        else if (event.type === "lares.playback") controller.observePlayback(event.playing === true);
        else if (event.type === "lares.task") {
          if (event.sessionId) { boundSessionId = event.sessionId; controller.bindSession(boundSessionId); }
          controller.observeAgent(event.status === "pending");
        } else if (["response.output_audio_transcript.delta", "response.audio_transcript.delta", "response.output_text.delta", "response.text.delta"].includes(event.type)) onCaption(event.delta, "assistant");
      });
      socket.addEventListener("error", () => { if (socket !== connectedSocket) return; clearTimeout(timeout); reject(new Error("voice_disconnected")); });
      socket.addEventListener("close", () => {
        if (socket !== connectedSocket) return;
        clearTimeout(timeout); reject(new Error("voice_disconnected"));
        if (!intentional) void controller.disconnect("voice_disconnected");
      });
    });
  };
  const watch = async () => {
    if (intentional || controller.getSnapshot().connection !== "open") return;
    try {
      const state = await call("/session");
      if (state.sessionId) { boundSessionId = state.sessionId; controller.bindSession(boundSessionId); }
      controller.observeAgent(Boolean(state.running));
    } catch { await controller.disconnect("voice_disconnected"); return; }
    pollTimer = setTimeout(watch, 1000);
  };
  return {
    controller, headers,
    async start({ sessionId = null } = {}) {
      boundSessionId = sessionId;
      const initial = await call("/session", { sessionId, readAloud, presentationSession });
      await connect();
      await controller.start({ sessionId, continuous: true, running: initial.running });
      controller.setOutputMuted(!readAloud);
      void watch();
    },
    async setReadAloud(value) {
      readAloud = value === true; controller.setOutputMuted(!readAloud);
      if (!readAloud) await stopPlayback();
      send({ type: "lares.output", enabled: readAloud });
    },
    async stop() {
      intentional = true; clearTimeout(pollTimer);
      await controller.disconnect(); await audio?.stop(); socket?.close();
      await call("/session/close", {});
    },
    async pause() {
      intentional = true; clearTimeout(pollTimer);
      await controller.pause(); await audio?.stop(); socket?.close();
    },
    async resume() {
      const state = await call("/session");
      if (!state.active) await call("/session", { sessionId: boundSessionId, readAloud });
      else await call("/session/resume", {});
      await audio?.stop();
      await connect(); await controller.resume(); void watch();
    },
  };
}
