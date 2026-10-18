import { ttsVoiceForModel } from "./tts-voice.js";
import { speechSegments } from "./script.js";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { synthesizeStream } from "../router/tts.js";
import { pickSttModelId, pickTtsModelId, VoiceError } from "../router/stt.js";
import { routerGatewayUrl, routerAuthHeaders } from "../router/gateway.js";

const fault = (code, status = 409) => new VoiceError(code, status, code);

/** Single-use HTTP grants bind raw audio sockets to the authenticated Host scope. */
export function createAudioStreamGateway({ config, models, replies, synthesize = synthesizeStream, env = process.env, metric = () => {} }) {
  const tickets = new Map(), clients = new Set();
  const server = new WebSocketServer({ noServer: true, maxPayload: 96 * 1024, perMessageDeflate: false,
    handleProtocols: (values) => values.has("lares-voice") ? "lares-voice" : false });
  return {
    async ticket(scope, body) {
      if (scope.device !== "device") return { supported: false };
      if (!["tts", "stt"].includes(body.operation)) throw fault("voice_config_invalid", 400);
      const tts = body.operation === "tts";
      const snapshot = structuredClone(scope.voiceConfig || config());
      if (tts && (scope.presentationSession || !scope.active)) {
        const current = config();
        snapshot.ttsModel = current.ttsModel; snapshot.voice = current.voice;
        snapshot.ttsVoiceByModel = structuredClone(current.ttsVoiceByModel || {});
      }
      const rows = await models();
      if (tts && !(scope.active ? scope.readAloud : snapshot.speak)) throw fault("voice_speak_disabled");
      const selected = tts ? pickTtsModelId(rows, snapshot.ttsModel) : pickSttModelId(rows, body.model || snapshot.model);
      if (!selected || tts && snapshot.ttsModel && selected !== snapshot.ttsModel) throw fault("voice_model_unavailable", 503);
      if (!tts && !rows.find((row) => row.id === selected)?.supportsSttStream) return { supported: false };
      if (tts && !body.source && (typeof body.text !== "string" || !body.text.trim() || body.text.length > 8192)) throw fault("voice_config_invalid", 400);
      for (const [key, grant] of tickets) if (grant.expires < Date.now()) tickets.delete(key);
      if (tickets.size >= 128 || clients.size >= 64) throw fault("voice_busy", 429);
      const reply = tts && body.source ? await replies?.bind(scope, body.source) : null;
      if (body.source && !reply) throw fault("voice_reply_unavailable");
      const ticket = randomUUID();
      tickets.set(ticket, { scope, model: selected, operation: body.operation, text: body.text, reply,
        config: snapshot, language: body.language || snapshot.language, expires: Date.now() + 30000 });
      return { supported: true, ticket };
    },
    upgrade(req, socket, head) {
      const token = String(req.headers["sec-websocket-protocol"] || "").split(",").map((value) => value.trim()).find((value) => value.startsWith("lares-ticket."))?.slice(13);
      const grant = tickets.get(token); tickets.delete(token);
      if (!grant || grant.expires < Date.now()) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      server.handleUpgrade(req, socket, head, (client) => {
        clients.add(client);
        const abort = new AbortController();
        let upstream = null, sentFrames = 0, playedFrames = 0, rate = 0, waiter = null, outputFormat = null;
        let fileDone = null, pausedAt = 0, closing = false;
        let received = 0, committed = false, outputStarted = false;
        const started = Date.now();
        const send = (value) => { if (client.readyState === 1) client.send(JSON.stringify(value)); };
        const close = () => { if (closing) return; closing = true; abort.abort(); waiter?.(); fileDone?.(); clearTimeout(lifetime); upstream?.terminate(); clients.delete(client); client.close(); };
        const error = (cause) => { send({ type: "error", code: cause.code || "voice_stream_failed" }); close(); };
        const lifetime = setTimeout(() => error(fault("voice_timeout")), 180000);
        client.on("close", close); client.on("error", close);
        client.on("message", (raw, binary) => {
          try {
            if (grant.operation === "stt") {
              if (!upstream || upstream.readyState !== 1 || committed) throw fault("voice_stream_state");
              if (binary) {
                received += raw.length;
                if (raw.length % 2 || received > 16000 * 2 * 60 || upstream.bufferedAmount > 256 * 1024) throw fault("voice_audio_backpressure");
                upstream.send(raw);
              } else {
                const frame = JSON.parse(String(raw));
                if (frame.type !== "finish") throw fault("voice_stream_state");
                committed = true; upstream.send(JSON.stringify({ type: "finish" }));
              }
            } else {
              if (binary) throw fault("voice_stream_state");
              const frame = JSON.parse(String(raw));
              if (frame.type === "pause") { if (!pausedAt) pausedAt = Date.now(); waiter?.(); waiter = null; return; }
              if (frame.type === "resume") { pausedAt = 0; waiter?.(); waiter = null; return; }
              if (frame.type === "file.done" && fileDone) { fileDone(); fileDone = null; return; }
              if (frame.type !== "progress" || !Number.isSafeInteger(frame.frames) || frame.frames < playedFrames || frame.frames > sentFrames) throw fault("voice_stream_state");
              playedFrames = frame.frames; waiter?.(); waiter = null;
            }
          } catch (cause) { error(cause); }
        });
        if (grant.operation === "stt") {
          upstream = new WebSocket(`${routerGatewayUrl(env).replace(/^http/, "ws")}/audio/stream?model=${encodeURIComponent(grant.model)}`, {
            headers: routerAuthHeaders(env.LARES_ROUTER_API_KEY, env.OLARES_APP_ID, grant.scope.owner), handshakeTimeout: 15000, maxPayload: 96 * 1024 });
          upstream.on("open", () => { upstream.send(JSON.stringify({ type: "start", sample_rate: 16000, language: grant.language || undefined })); send({ type: "ready" }); });
          upstream.on("message", (raw, binary) => {
            try {
              if (binary) throw fault("voice_audio_format");
              const value = JSON.parse(String(raw));
              if (["partial", "final"].includes(value.type)) send({ type: value.type, text: String(value.text || "") });
              else if (value.type === "error") error(fault("voice_transcribe_failed", 502));
              else if (value.type === "closed") { if (!committed) throw fault("voice_stream_state"); send({ type: "done" }); }
            } catch (cause) { error(cause); }
          });
          upstream.on("error", error);
          upstream.on("close", () => { send({ type: "eof" }); close(); });
        } else {
          // A stop/new output owns the scope's existing duplex lease too.
          const lease = grant.scope.duplex.beginSpeech(abort.signal);
          const segments = grant.reply ? grant.reply(lease.signal) : speechSegments(grant.text, { done: true }).map((text, index) => ({ text, index }));
          let carry = null;
          const run = async () => { for await (const segment of segments) {
          if (!lease.active()) throw fault("voice_cancelled");
          const { text, index } = segment;
          metric({ stage: "synthesis_segment", voiceId: grant.scope.id, index, chars: text.length, at: Date.now() });
          send({ type: "segment", index, attemptId: segment.attemptId, startFrame: sentFrames });
          const result = await synthesize({ text, model: grant.model, voice: ttsVoiceForModel(grant.config, grant.model), signal: lease.signal,
            onFormat(format) { if (outputFormat && (format.channels !== outputFormat.channels || format.encoding !== outputFormat.encoding)) throw fault("voice_audio_format"); outputFormat = format; if (!rate) { rate = format.sampleRate; send({ type: "format", ...format }); } else if (rate !== format.sampleRate) throw fault("voice_audio_format"); },
          }, async (chunk) => {
            if (!lease.active()) throw fault("voice_cancelled");
            if (!rate) throw fault("voice_audio_format", 502);
            if (carry !== null) { chunk = Buffer.concat([Buffer.from([carry]), chunk]); carry = null; }
            if (chunk.length % 2) { carry = chunk[chunk.length - 1]; chunk = chunk.subarray(0, -1); }
            for (let offset = 0; offset < chunk.length; offset += 16384) {
              while (pausedAt || sentFrames - playedFrames > rate * 2 || client.bufferedAmount > 128 * 1024) {
                await new Promise((resolve, reject) => { const timer = setTimeout(() => { waiter = null; reject(fault(pausedAt ? "voice_interruption_timeout" : "voice_audio_backpressure")); }, pausedAt ? Math.max(1, 10000 - (Date.now() - pausedAt)) : 10000); waiter = () => { clearTimeout(timer); resolve(); }; });
                if (!lease.active() || abort.signal.aborted) throw fault("voice_cancelled");
              }
              if (!lease.active() || client.readyState !== 1) throw fault("voice_cancelled");
              const part = chunk.subarray(offset, offset + 16384);
              sentFrames += part.length / 2;
              client.send(part);
              if (!outputStarted) { outputStarted = true; metric({ stage: "synthesis_first_audio", voiceId: grant.scope.id, at: Date.now(), durationMs: Date.now() - started }); }
            }
          });
          send({ type: "segment.end", index, endFrame: sentFrames });
          if (carry !== null) throw fault("voice_audio_format");
          if (!result.streamed) {
            if (rate) throw fault("voice_audio_format");
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(fault("voice_timeout")), 120000);
              fileDone = () => { clearTimeout(timer); resolve(); };
              send({ type: "file", audio: result.audio.toString("base64") });
            });
          }
          if (!lease.active()) throw fault("voice_cancelled");
          } };
          const wake = () => { waiter?.(); waiter = null; fileDone?.(); fileDone = null; close(); };
          lease.signal.addEventListener("abort", wake, { once: true });
          void run().then(() => { if (!abort.signal.aborted) send({ type: "done" }); }).catch(error).finally(() => { lease.signal.removeEventListener("abort", wake); lease.finish(); });
        }
      });
    },
    close() { tickets.clear(); for (const client of clients) client.terminate(); server.close(); },
  };
}
