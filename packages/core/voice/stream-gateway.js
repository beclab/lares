import { ttsVoiceForModel } from "./tts-voice.js";
import { speechSegments } from "./script.js";
import { createPlayoutClock, SOCKET_FUSE_BYTES } from "./playout-clock.js";
import { createSynthesisRuns, utteranceKey } from "./synthesis-run.js";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { synthesizeStream } from "../router/tts.js";
import { pickSttModelId, pickTtsModelId, VoiceError } from "../router/stt.js";
import { routerGatewayUrl, routerAuthHeaders } from "../router/gateway.js";

const fault = (code, status = 409) => new VoiceError(code, status, code);

/** Single-use HTTP grants bind raw audio sockets to the authenticated Host scope. */
export function createAudioStreamGateway({ config, models, replies, synthesize = synthesizeStream, env = process.env, metric = () => {}, playbackStallMs = 45_000, pauseHoldMs = 120_000, lifetimeMs = 300_000 }) {
  const tickets = new Map(), clients = new Set();
  const synthesis = createSynthesisRuns({ synthesize, metric });
  const server = new WebSocketServer({ noServer: true, maxPayload: 96 * 1024, perMessageDeflate: false,
    handleProtocols: (values) => values.has("lares-voice") ? "lares-voice" : false });
  return {
    async ticket(scope, body) {
      if (!["tts", "stt"].includes(body.operation)) throw fault("voice_config_invalid", 400);
      const tts = body.operation === "tts";
      if (!tts && scope.device !== "device") return { supported: false };
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
      tickets.set(ticket, { scope, model: selected, operation: body.operation, text: body.text, reply, replySource: body.source || null,
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
        let upstream = null, sentFrames = 0, playedFrames = 0, rate = 0, eventWaiter = null, creditWaiter = null, outputFormat = null;
        const clock = createPlayoutClock();
        let fileDone = null, pausedAt = 0, closing = false, ttsKey = null;
        let received = 0, committed = false, outputStarted = false;
        const started = Date.now();
        const send = (value) => { if (client.readyState === 1) client.send(JSON.stringify(value)); };
        const close = () => {
          if (closing) return;
          closing = true; abort.abort(); eventWaiter?.(); creditWaiter?.(); eventWaiter = creditWaiter = null; fileDone?.(); clearTimeout(lifetime); upstream?.terminate();
          // A consumer that disappeared stops its synthesis instead of leaving
          // the whole answer to be rendered with nobody listening.
          if (ttsKey) synthesis.release(ttsKey);
          clients.delete(client); client.close();
        };
        const error = (cause) => {
          const code = cause?.code || "voice_stream_failed";
          if (grant.operation === "tts" && code !== "voice_cancelled") metric({ stage: "playback_stop", voiceId: grant.scope.id, code, sentFrames, playedFrames });
          send({ type: "error", code }); close();
        };
        const lifetime = setTimeout(() => error(fault("voice_timeout")), lifetimeMs);
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
              if (frame.type === "pause") { clock.pause(); if (!pausedAt) pausedAt = Date.now(); creditWaiter?.(); creditWaiter = null; return; }
              if (frame.type === "resume") { clock.resume(); pausedAt = 0; creditWaiter?.(); creditWaiter = null; return; }
              if (frame.type === "file.done" && fileDone) { fileDone(); fileDone = null; return; }
              if (frame.type !== "progress" || !Number.isSafeInteger(frame.frames) || frame.frames < playedFrames || frame.frames > sentFrames) throw fault("voice_stream_state");
              const firstProgress = playedFrames === 0 && frame.frames > 0;
              playedFrames = frame.frames;
              if (rate) clock.heard(frame.frames * 1000 / rate);
              creditWaiter?.(); creditWaiter = null;
              if (firstProgress) metric({ stage: "playback_progress", voiceId: grant.scope.id, frames: playedFrames });
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
          const key = grant.replySource ? utteranceKey(grant.replySource) : `text:${grant.text}`;
          ttsKey = key;
          const run = synthesis.attach(key, (signal) => grant.reply ? grant.reply(signal) : (async function* text() {
            const parts = speechSegments(grant.text, { done: true });
            for (let index = 0; index < parts.length; index += 1) yield { text: parts[index], index };
          })(), { model: grant.model, voice: ttsVoiceForModel(grant.config, grant.model), voiceId: grant.scope.id });
          let cursor = 0;
          const wakeEvent = () => { const fn = eventWaiter; eventWaiter = null; fn?.(); };
          // New PCM must not clear the playout timer. A long answer keeps
          // producing chunks; waking the credit wait on each one restarted the
          // stall deadline, so a phone that had already played its buffer never
          // received the rest and never got an error either.
          const unsub = run.subscribe(wakeEvent);
          const waitFor = () => new Promise((resolve, reject) => {
            if (abort.signal.aborted) { reject(fault("voice_cancelled")); return; }
            const wake = () => { abort.signal.removeEventListener("abort", wake); eventWaiter = null; if (abort.signal.aborted) reject(fault("voice_cancelled")); else resolve(); };
            eventWaiter = wake;
            abort.signal.addEventListener("abort", wake, { once: true });
          });
          let reportedWait = false;
          const pump = async () => {
            while (!abort.signal.aborted) {
              if (cursor >= run.events.length) {
                if (run.settled) return;
                await waitFor();
                continue;
              }
              const event = run.events[cursor++];
              if (event.type === "segment") send({ type: "segment", index: event.index, attemptId: event.attemptId, startFrame: sentFrames });
              else if (event.type === "format") {
                const format = event.format;
                if (outputFormat && (format.channels !== outputFormat.channels || format.encoding !== outputFormat.encoding)) throw fault("voice_audio_format");
                outputFormat = format;
                if (!rate) { rate = format.sampleRate; send({ type: "format", ...format }); }
                else if (rate !== format.sampleRate) throw fault("voice_audio_format");
              } else if (event.type === "audio") {
                if (!rate) throw fault("voice_audio_format", 502);
                for (let offset = 0; offset < event.chunk.length; offset += 16384) {
                  // Stay a short lead ahead of playout. Reported frames move
                  // the playhead; if those ticks stop, the reply still advances
                  // with the clock. The socket buffer is only a fuse for a
                  // client that has stopped reading.
                  const sentMs = () => sentFrames * 1000 / rate;
                  while (clock.paused || clock.blocked(sentMs()) || client.bufferedAmount > SOCKET_FUSE_BYTES) {
                    if (!reportedWait) { reportedWait = true; metric({ stage: "playback_wait", voiceId: grant.scope.id, sentFrames, playedFrames, paused: clock.paused }); }
                    await new Promise((resolve, reject) => {
                      const reading = !clock.paused && client.bufferedAmount <= SOCKET_FUSE_BYTES;
                      const limit = clock.paused ? Math.max(1, pauseHoldMs - (Date.now() - pausedAt)) : reading ? Math.max(15, Math.min(250, clock.wait(sentMs()) || 15)) : playbackStallMs;
                      const timer = setTimeout(() => { creditWaiter = null; if (reading) resolve(); else reject(fault(clock.paused ? "voice_interruption_timeout" : "voice_audio_backpressure")); }, limit);
                      creditWaiter = () => { clearTimeout(timer); resolve(); };
                      if (!(clock.paused || clock.blocked(sentMs()) || client.bufferedAmount > SOCKET_FUSE_BYTES)) { clearTimeout(timer); creditWaiter = null; resolve(); }
                    });
                    if (abort.signal.aborted || client.readyState !== 1) throw fault("voice_cancelled");
                  }
                  clock.start();
                  if (client.readyState !== 1) throw fault("voice_cancelled");
                  const part = event.chunk.subarray(offset, offset + 16384);
                  sentFrames += part.length / 2;
                  client.send(part);
                  if (!outputStarted) { outputStarted = true; metric({ stage: "synthesis_first_audio", voiceId: grant.scope.id, at: Date.now(), durationMs: Date.now() - started }); }
                }
              } else if (event.type === "segment.end") send({ type: "segment.end", index: event.index, endFrame: sentFrames });
              else if (event.type === "file") {
                if (rate) throw fault("voice_audio_format");
                await new Promise((resolve, reject) => {
                  const timer = setTimeout(() => reject(fault("voice_timeout")), 120000);
                  fileDone = () => { clearTimeout(timer); resolve(); };
                  send({ type: "file", audio: Buffer.from(event.audio).toString("base64") });
                });
              } else if (event.type === "done") { send({ type: "done" }); return; }
              else if (event.type === "cancelled") throw fault("voice_cancelled");
              else if (event.type === "error") throw fault(event.code || "voice_stream_failed");
            }
          };
          // `done` means the bytes have been handed over. The browser still has up to
          // the two-second send-ahead queued. Closing now is a disconnect and stops that tail.
          void pump().catch((cause) => { if (!abort.signal.aborted) error(cause); }).finally(() => unsub());
        }
      });
    },
    cancel(source) {
      synthesis.cancel(utteranceKey(source));
      replies?.cancel?.(source);
    },
    close() { tickets.clear(); synthesis.close(); for (const client of clients) client.terminate(); server.close(); },
  };
}
