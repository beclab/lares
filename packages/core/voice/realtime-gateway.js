import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { routerAuthHeaders, routerGatewayUrl } from "../router/gateway.js";
import { createRealtimeDelegate, LARES_TOOL, REALTIME_INSTRUCTIONS, validatedRealtimeModels } from "./realtime.js";

/** HTTP-issued, single-use tickets keep upstream credentials and tools on the Host. */
export function createRealtimeGateway({ models, config, audio, env = process.env }) {
  const tickets = new Map();
  const connections = new Set();
  const server = new WebSocketServer({ noServer: true, maxPayload: 96 * 1024, perMessageDeflate: false, handleProtocols: (values) => values.has("lares-voice") ? "lares-voice" : false });
  return {
    async ticket(scope) {
      if (!scope.active || !scope.session) throw Object.assign(new Error("voice session closed"), { status: 409, code: "voice_session_closed" });
      const selected = config().realtimeModel;
      if (!validatedRealtimeModels(await models(), env).includes(selected)) throw Object.assign(new Error("Realtime model has not been validated"), { status: 409, code: "voice_realtime_unavailable" });
      for (const [key, value] of tickets) if (value.expires < Date.now() || value.scope === scope) tickets.delete(key);
      const ticket = randomUUID();
      tickets.set(ticket, { scope, model: selected, expires: Date.now() + 30_000 });
      return { ticket };
    },
    upgrade(req, socket, head) {
      const token = String(req.headers["sec-websocket-protocol"] || "").split(",").map((s) => s.trim()).find((s) => s.startsWith("lares-ticket."))?.slice(13);
      const grant = tickets.get(token);
      tickets.delete(token);
      if (!grant || grant.expires < Date.now() || !grant.scope.active || grant.scope.realtimeSocket) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
      }
      server.handleUpgrade(req, socket, head, (client) => {
        const { scope } = grant;
        scope.realtimeSocket = client;
        connections.add(client);
        const base = routerGatewayUrl(env).replace(/^http/, "ws");
        const upstream = new WebSocket(`${base}/realtime?model=${encodeURIComponent(grant.model)}`, {
          headers: routerAuthHeaders(env.LARES_ROUTER_API_KEY, env.OLARES_APP_ID, scope.owner), handshakeTimeout: 15_000, maxPayload: 2 * 1024 * 1024,
        });
        let closed = false;
        const lifetime = new AbortController();
        let ready = false;
        let audioPort = null;
        let output = Promise.resolve();
        let queued = 0;
        let alive = true;
        let currentItem = null;
        let receivedMs = 0;
        let audioGeneration = 0;
        const sendClient = (value) => {
          if (client.readyState !== WebSocket.OPEN) return;
          if (client.bufferedAmount > 1024 * 1024) { close("voice_audio_backpressure"); return; }
          client.send(JSON.stringify(value));
        };
        const send = (value) => {
          if (closed || upstream.readyState !== WebSocket.OPEN) return;
          if (upstream.bufferedAmount > 1024 * 1024) { close("voice_audio_backpressure"); return; }
          upstream.send(JSON.stringify(value));
        };
        const close = (code = null) => {
          if (closed) return;
          if (code) sendClient({ type: "lares.error", code });
          closed = true; clearInterval(heartbeat); clearTimeout(openTimeout);
          lifetime.abort();
          void Promise.resolve(audioPort?.stop()).catch(() => {});
          upstream.close(); client.close();
          scope.realtimeSocket = null;
          connections.delete(client);
        };
        const openTimeout = setTimeout(() => close("voice_realtime_timeout"), 20_000);
        const heartbeat = setInterval(() => {
          if (!alive) { close("voice_disconnected"); return; }
          alive = false; scope.seen = Date.now(); client.ping();
        }, 10_000);
        client.on("pong", () => { alive = true; });
        const delegate = createRealtimeDelegate({ agent: scope.session, send, notify: sendClient, calls: scope.realtimeCalls ??= new Map(), signal: lifetime.signal });
        upstream.on("open", () => send({ type: "session.update", session: {
          type: "realtime", model: grant.model, instructions: REALTIME_INSTRUCTIONS, output_modalities: ["audio"], tools: [LARES_TOOL], tool_choice: "auto",
          audio: { input: { format: { type: "audio/pcm", rate: 24000 }, turn_detection: { type: "server_vad", create_response: true, interrupt_response: false } }, output: { format: { type: "audio/pcm", rate: 24000 } } },
        } }));
        upstream.on("message", (raw) => {
          let event;
          try { event = JSON.parse(raw.toString()); } catch { close("voice_realtime_protocol"); return; }
          if (!event || typeof event !== "object" || Array.isArray(event)) { close("voice_realtime_protocol"); return; }
          if (event.type === "session.updated" && !ready) {
            ready = true; clearTimeout(openTimeout);
            void Promise.resolve(audio?.(scope, send)).then((port) => {
              audioPort = port; scope.realtimeAudio = port;
              if (closed) { void port?.stop(); return; }
              sendClient({ type: "lares.ready", model: grant.model, device: scope.device, bargeIn: false });
            }).catch(() => close("voice_device_unavailable"));
            return;
          }
          if (event.type === "response.function_call_arguments.done") {
            void delegate.handle(event).catch(() => close("voice_realtime_tool_failed")); return;
          }
          if (["response.output_audio.delta", "response.audio.delta"].includes(event.type)) {
            if (typeof event.delta !== "string") return;
            currentItem = event.item_id || currentItem;
            receivedMs += Buffer.byteLength(event.delta, "base64") / 48;
            if (scope.device === "headset") {
              sendClient({ type: "lares.playback", playing: true });
              const bytes = Buffer.from(event.delta, "base64"); queued += bytes.length;
              if (queued > 512 * 1024) { close("voice_audio_backpressure"); return; }
              const epoch = audioGeneration;
              output = output.then(() => epoch === audioGeneration ? audioPort?.write(bytes) : undefined).finally(() => { queued -= bytes.length; });
              output.catch(() => close("voice_device_unavailable"));
            } else sendClient(event);
            return;
          }
          if (["response.output_audio.done", "response.audio.done"].includes(event.type)) {
            output = output.then(() => audioPort?.finish());
            output.then(() => { sendClient({ type: "lares.playback", playing: false }); sendClient(event); }).catch(() => close("voice_device_unavailable")); return;
          }
          if (event.type === "response.created") { receivedMs = 0; currentItem = null; }
          if (event.type === "error" && event.error?.code === "response_cancel_not_active") return;
          if (event.type === "error") { close("voice_realtime_upstream"); return; }
          if (["response.created", "response.done", "response.output_audio_transcript.delta", "response.audio_transcript.delta", "conversation.item.input_audio_transcription.completed", "input_audio_buffer.speech_started", "input_audio_buffer.speech_stopped"].includes(event.type)) sendClient(event);
        });
        client.on("message", (raw) => {
          if (!ready) return;
          scope.seen = Date.now();
          let event;
          try { event = JSON.parse(raw.toString()); } catch { close("voice_realtime_protocol"); return; }
          if (!event || typeof event !== "object" || Array.isArray(event)) { close("voice_realtime_protocol"); return; }
          if (event.type === "input_audio_buffer.append" && scope.device === "device" && typeof event.audio === "string" && event.audio.length <= 64 * 1024 && /^[A-Za-z0-9+/]*={0,2}$/.test(event.audio)) send({ type: event.type, audio: event.audio });
          else if (event.type === "response.cancel") { audioGeneration++; send({ type: "response.cancel" }); void Promise.resolve(audioPort?.interrupt()).catch(() => close("voice_device_unavailable")); }
          else if (event.type === "conversation.item.truncate" && typeof currentItem === "string" && event.item_id === currentItem && event.content_index === 0 && Number.isInteger(event.audio_end_ms) && event.audio_end_ms >= 0 && event.audio_end_ms <= Math.ceil(receivedMs)) send({ type: event.type, item_id: currentItem, content_index: 0, audio_end_ms: event.audio_end_ms });
          else close("voice_realtime_event_forbidden");
        });
        upstream.on("error", () => close("voice_realtime_unavailable"));
        upstream.on("close", () => close("voice_disconnected"));
        client.on("error", () => close()); client.on("close", () => close());
      });
    },
    close() { for (const socket of connections) socket.close(); server.close(); tickets.clear(); },
  };
}
