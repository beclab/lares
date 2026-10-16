import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { verifyVoicePrincipal, authorizeVoicePreset } from "./external.js";
import { createSpeechEndpoint, frameRms } from "./endpoint.js";
import { pcmSamples } from "./realtime-audio.js";

export const COMPOSITE_CAPABILITIES = Object.freeze({ protocol: "olares-voice-ws-v1", transport: "websocket", input: "pcm16-mono-24000", output: "pcm16-mono-24000", turnDetection: ["manual", "server_vad"], contextResume: true, requiresPlaybackAck: true, clientTools: false, truncation: false, webrtc: false, sip: false, usage: "child-models" });

/** Minimal declared Realtime subset. It never accepts arbitrary client tools or business bindings. */
export function createCompositeGateway({ service, config, transcribe, synthesize, secret, grants = {}, hostOwner = "", enabled = false }) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 96 * 1024, perMessageDeflate: false });
  const clients = new Map();
  const nonces = new Map();
  return {
    capabilities: () => ({ ...COMPOSITE_CAPABILITIES, enabled: enabled && typeof secret === "string" && secret.length >= 32 }),
    upgrade(req, socket, head) {
      let identity;
      let grant;
      try {
        if (!enabled) throw new Error("voice_external_disabled");
        identity = verifyVoicePrincipal(req.headers, secret);
        const model = new URL(req.url, "http://voice.invalid").searchParams.get("model");
        grant = authorizeVoicePreset(identity, grants, model);
        if (["assistant", "direct"].includes(grant.preset) && grant.owner !== hostOwner) throw new Error("voice_external_owner_mismatch");
        const dependencies = config();
        if ([dependencies.model, dependencies.chatModel, dependencies.ttsModel, dependencies.realtimeModel].some((id) => id === model || id?.endsWith(`/${model}`))) throw new Error("voice_recursive_model");
        for (const [nonce, expires] of nonces) if (expires < Date.now()) nonces.delete(nonce);
        if (nonces.has(identity.nonce) || nonces.size >= 4096 || clients.size >= 64) throw new Error("voice_external_limit");
        nonces.set(identity.nonce, Date.now() + 120000);
      } catch {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
      }
      server.handleUpgrade(req, socket, head, (client) => {
        clients.set(client, () => close());
        const scope = { id: randomUUID(), owner: grant.owner, authorizedBinding: grant, device: "device" };
        let chunks = [], bytes = 0, automatic = false, closed = false, busy = false, generation = 0, seconds = 0;
        let endpoint = createSpeechEndpoint({ silenceMs: config().endpointSilenceMs || 500 });
        let lastReply = null;
        let awaitingPlayback = false;
        let audioOutput = true;
        let responseId = null;
        let speaking = false;
        let configuring = false;
        let submittedTurns = 0;
        let alive = true;
        const send = (event) => {
          if (client.readyState !== 1) return;
          if (client.bufferedAmount > 1024 * 1024) { close(); return; }
          client.send(JSON.stringify({ event_id: randomUUID(), ...event }));
        };
        const reset = () => { chunks = []; bytes = 0; speaking = false; endpoint = createSpeechEndpoint({ silenceMs: config().endpointSilenceMs || 500 }); };
        const done = (id, status = "completed") => send({ type: "response.done", response: { id, status, output: [] }, voice_usage: { input_audio_seconds: seconds, billing: "child-models" } });
        const emit = async (text, id, epoch) => {
          responseId = id;
          send({ type: "response.created", response: { id, status: "in_progress" } });
          send({ type: "response.output_audio_transcript.delta", response_id: id, delta: text });
          if (!audioOutput) { done(id); return; }
          scope.outputAbort = new AbortController();
          const audio = await synthesize(text, scope);
          if (closed || epoch !== generation) return;
          awaitingPlayback = true;
          for (let offset = 0; offset < audio.length; offset += 24000) send({ type: "response.output_audio.delta", response_id: id, item_id: id, delta: audio.subarray(offset, offset + 24000).toString("base64") });
          send({ type: "response.output_audio.done", response_id: id });
          done(id);
        };
        const commit = async () => {
          if (!bytes || busy) return;
          const input = Buffer.concat(chunks); reset(); busy = true;
          const epoch = generation;
          const id = randomUUID(); submittedTurns++;
          try {
            let text = await transcribe(input, scope);
            if (grant.preset === "dictation") text = await service.clean(scope, text);
            if (closed || epoch !== generation || !text.trim()) return;
            send({ type: "conversation.item.input_audio_transcription.completed", item_id: id, content_index: 0, transcript: text });
            if (grant.preset === "dictation") return;
            const state = await service.prompt(scope, { text, requestId: id });
            if (closed || epoch !== generation) return;
            if (state.utterance?.text && !state.utterance.silent) { lastReply = state.utterance.key; await emit(state.utterance.text, id, epoch); }
          } catch (cause) { if (!closed && epoch === generation) send({ type: "error", error: { code: cause.code || "voice_failed", message: "Voice operation failed" } }); }
          finally { busy = false; }
        };
        const close = () => {
          if (closed) return;
          closed = true; scope.outputAbort?.abort(); generation++; reset(); clearInterval(heartbeat); clearInterval(results); clearTimeout(idle);
          clients.delete(client); client.close(); void service.close(scope).catch(() => {});
        };
        let idle;
        const touch = () => { clearTimeout(idle); idle = setTimeout(close, config().idleTimeoutMs || 300000); };
        touch();
        const heartbeat = setInterval(() => { if (!alive) close(); else { alive = false; client.ping(); } }, 15000);
        const results = setInterval(() => {
          if (!scope.active || busy || speaking || awaitingPlayback) return;
          try {
            const state = service.state(scope);
            if (!state.utterance?.text || state.utterance.key === lastReply || state.utterance.silent) return;
            lastReply = state.utterance.key; busy = true;
            void emit(state.utterance.text, randomUUID(), generation).catch(() => close()).finally(() => { busy = false; });
          } catch { close(); }
        }, 250);
        client.on("pong", () => { alive = true; });
        client.on("close", close); client.on("error", close);
        void service.open(scope, { preset: grant.preset, sessionId: grant.sessionId, readAloud: false }).then(() => {
          send({ type: "session.created", session: { id: scope.id, voice_context_id: scope.contextId, model: identity.model, type: "realtime", capabilities: COMPOSITE_CAPABILITIES } });
          client.on("message", async (raw) => {
            try {
              if (configuring) throw new Error("voice_not_ready");
              const event = JSON.parse(raw.toString());
              if (event.type === "session.update") {
                touch();
                const session = event.session || {};
                if (session.type && session.type !== "realtime") throw new Error("voice_session_forbidden");
                if (session.audio?.input && Object.keys(session.audio.input).some((key) => !["format", "turn_detection"].includes(key))) throw new Error("voice_audio_unsupported");
                if (session.audio?.output && Object.keys(session.audio.output).some((key) => key !== "format")) throw new Error("voice_audio_unsupported");
                if (Object.keys(session).some((key) => !["type", "model", "audio", "output_modalities", "voice_context_id"].includes(key)) || (session.model && session.model !== identity.model)) throw new Error("voice_session_forbidden");
                if (session.voice_context_id && session.voice_context_id !== scope.contextId) {
                  if (submittedTurns || bytes || busy) throw new Error("voice_context_locked");
                  configuring = true;
                  try {
                    await service.close(scope);
                    await service.open(scope, { preset: grant.preset, sessionId: grant.sessionId, contextId: session.voice_context_id, readAloud: false });
                  } finally { configuring = false; }
                }
                const detection = session.audio?.input?.turn_detection;
                if (detection && (detection.type !== "server_vad" || Object.keys(detection).some((key) => key !== "type"))) throw new Error("voice_turn_detection_unsupported");
                for (const format of [session.audio?.input?.format, session.audio?.output?.format].filter(Boolean)) if (format.type !== "audio/pcm" || format.rate !== 24000) throw new Error("voice_audio_format");
                if (session.output_modalities && (!Array.isArray(session.output_modalities) || session.output_modalities.length !== 1 || !["audio", "text"].includes(session.output_modalities[0]))) throw new Error("voice_output_unsupported");
                audioOutput = !session.output_modalities || session.output_modalities[0] === "audio";
                automatic = detection?.type === "server_vad";
                send({ type: "session.updated", session: { id: scope.id, voice_context_id: scope.contextId, model: identity.model, type: "realtime", capabilities: COMPOSITE_CAPABILITIES } });
              } else if (event.type === "input_audio_buffer.append") {
                if (awaitingPlayback) throw new Error("voice_waiting_for_playback");
                if (busy) throw new Error("voice_turn_busy");
                if (typeof event.audio !== "string" || event.audio.length > 64000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(event.audio)) throw new Error("voice_audio_format");
                const chunk = Buffer.from(event.audio, "base64");
                if (chunk.length % 2 || bytes + chunk.length > 2880000) throw new Error("voice_audio_limit");
                chunks.push(chunk); bytes += chunk.length; seconds += chunk.length / 48000;
                const samples = pcmSamples(chunk);
                if (frameRms(samples) >= 0.004) touch();
                if (frameRms(samples) >= 0.004 && !speaking) { speaking = true; scope.voiceInputActive = true; send({ type: "input_audio_buffer.speech_started" }); }
                if (automatic && endpoint.push(1, frameRms(samples), chunk.length / 48)) {
                  scope.voiceInputActive = false; send({ type: "input_audio_buffer.speech_stopped" }); void commit();
                }
              } else if (event.type === "input_audio_buffer.commit") { scope.voiceInputActive = false; void commit(); }
              else if (event.type === "input_audio_buffer.clear") { reset(); scope.voiceInputActive = false; send({ type: "input_audio_buffer.cleared" }); }
              else if (event.type === "voice.playback.completed") { awaitingPlayback = false; }
              else if (event.type === "response.cancel") { scope.outputAbort?.abort(); generation++; reset(); awaitingPlayback = false; done(responseId || randomUUID(), "cancelled"); }
              else throw new Error("voice_event_unsupported");
            } catch (cause) { send({ type: "error", error: { code: cause.message, message: "Unsupported or invalid voice event" } }); }
          });
        }).catch(close);
      });
    },
    close() { for (const close of clients.values()) close(); server.close(); },
  };
}
