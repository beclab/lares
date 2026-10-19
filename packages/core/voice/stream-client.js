import { postReport } from "../log/report.js";
import { PCM_CAPTURE_WORKLET } from "./pcm-worklet.js";
import { createPcmResampler } from "./realtime-audio.js";
import { createPcmStreamPlayer } from "./pcm-player.js";
import { wavBlob } from "./client.js";
import { createBrowserPlayer } from "./browser-playback.js";

export function browserAudioSocket(ticket) {
  const url = new URL("/api/lares/voice/stream", globalThis.location.href); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(url, ["lares-voice", `lares-ticket.${ticket}`]);
}

export async function openAudioStream({ request, headers, operation, model, language, text, source, signal, socket = browserAudioSocket }) {
  const response = await request("/api/lares/voice/stream/ticket", { method: "POST", headers, signal, body: { operation, model, language, text, source } });
  if (!response?.ok) throw new Error(response?.body?.error?.code || "voice_stream_failed");
  if (!response.body.supported) return null;
  if (signal?.aborted) throw new Error("voice_cancelled");
  const connection = socket(response.body.ticket); connection.binaryType = "arraybuffer";
  const cancel = () => connection.close();
  signal?.addEventListener("abort", cancel, { once: true });
  connection.addEventListener("close", () => signal?.removeEventListener("abort", cancel), { once: true });
  return connection;
}

/** Plays one confirmed reply. Receiving audio and rendering it run independently. */
function streamMetric(options, event) {
  if (options.metric) { options.metric(event); return; }
  void postReport({ scope: "voice", event: "metric", voiceId: options.headers?.["x-lares-voice-id"], utteranceKey: options.key, at: Date.now(), ...event }, {
    request: (path, init) => options.request(path, { ...init, headers: { ...init.headers, ...options.headers } }),
  });
}

export async function playAudioStream(options) {
  const started = Date.now();
  const connection = await openAudioStream({ ...options, operation: "tts" });
  if (!connection) throw new Error("voice_stream_failed");
  const file = createBrowserPlayer();
  const player = createPcmStreamPlayer({ onProgress: (frames) => { if (connection.readyState === 1) connection.send(JSON.stringify({ type: "progress", frames })); },
    onMetric: (event) => { if (event.stage === "playback_started") options.onStatus?.("playing"); streamMetric(options, { ...event, durationMs: Date.now() - started }); } });
  let chain = Promise.resolve(), complete = false, firstReceived = false, ready = false, paused = false, segmentIndex = -1;
  options.controls?.({
    get canPause() { return ready; },
    pause() { if (!ready || paused) return; paused = true; player.pause(); file.pause(); if (connection.readyState === 1) connection.send(JSON.stringify({ type: "pause" })); },
    resume() { if (!ready || !paused) return; paused = false; player.resume(); void file.resume()?.catch(() => connection.close()); if (connection.readyState === 1) connection.send(JSON.stringify({ type: "resume" })); },
  });
  try {
    await new Promise((resolve, reject) => {
      const fail = (error) => { reject(error); connection.close(); };
      const cancelled = () => { player.stop(); file.stop(); fail(new Error("voice_cancelled")); };
      options.signal?.addEventListener("abort", cancelled, { once: true });
      connection.addEventListener("message", ({ data }) => {
        if (typeof data !== "string" && !firstReceived) { firstReceived = true; streamMetric(options, { stage: "playback_first_received", durationMs: Date.now() - started }); }
        chain = chain.then(async () => {
          if (options.signal?.aborted) throw new Error("voice_cancelled");
          if (typeof data !== "string") { player.write(new Uint8Array(data)); return; }
          const event = JSON.parse(data);
          if (event.type === "segment") {
            if (event.index !== segmentIndex + 1) throw new Error("voice_reply_sequence");
            segmentIndex = event.index;
          }
          else if (event.type === "segment.end") options.onSegment?.(event);
          else if (event.type === "format") { await player.start(event); ready = true; if (paused) player.pause(); }
          else if (event.type === "file") { ready = true; options.onStatus?.("playing"); await file.play(wavBlob(event.audio)); if (connection.readyState === 1) connection.send(JSON.stringify({ type: "file.done" })); }
          else if (event.type === "error") throw new Error(event.code || "voice_stream_failed");
          else if (event.type === "done") { await player.finish(); complete = true; resolve(); }
        }).catch(fail);
      });
      connection.addEventListener("error", () => fail(new Error("voice_disconnected")), { once: true });
      connection.addEventListener("close", () => { options.signal?.removeEventListener("abort", cancelled); if (!complete) reject(new Error("voice_disconnected")); }, { once: true });
      if (options.signal?.aborted) cancelled();
    });
    return true;
  } finally { player.stop(); file.stop(); connection.close(); }
}

/** A single final ASR result; partials never submit a task or replace the draft. */
export async function startTranscriptionStream(options) {
  const connection = await openAudioStream({ ...options, operation: "stt" });
  if (!connection) return null;
  let final = null, finished = false, completed = false, failed = false, finishAt = 0, resolve, reject;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  void result.catch(() => {});
  let readyResolve, readyReject;
  const ready = new Promise((yes, no) => { readyResolve = yes; readyReject = no; });
  const fail = (error) => {
    if (completed || failed) return;
    failed = true;
    const code = /^voice_[a-z_]+$/.test(error.message) ? error.message : "voice_stream_failed";
    if (code !== "voice_cancelled" && !options.signal?.aborted) void postReport({ scope: "voice", event: "stream-error", stage: "recognition", code }, {
      request: (path, init) => options.request(path, { ...init, headers: { ...init.headers, ...options.headers } }),
    });
    readyReject(error); reject(error); connection.close();
  };
  connection.addEventListener("message", ({ data }) => {
    try {
      const event = JSON.parse(data);
      if (event.type === "ready") readyResolve();
      else if (event.type === "partial") options.onPartial?.(event.text);
      else if (event.type === "final") final = event.text;
      else if (event.type === "done" && finished && final !== null) { completed = true; streamMetric(options, { stage: "recognition_final_tail", durationMs: Date.now() - finishAt }); resolve(final); }
      else if (event.type === "error") fail(new Error(event.code));
    } catch { fail(new Error("voice_stream_failed")); }
  });
  connection.addEventListener("close", () => fail(new Error("voice_disconnected")), { once: true });
  connection.addEventListener("error", () => fail(new Error("voice_disconnected")), { once: true });
  if (options.signal?.aborted) fail(new Error("voice_cancelled"));
  await ready;
  return {
    write(bytes) { if (finished || connection.readyState !== 1 || connection.bufferedAmount > 256 * 1024) throw new Error("voice_audio_backpressure"); connection.send(bytes); },
    async finish() { finishAt = Date.now(); finished = true; connection.send(JSON.stringify({ type: "finish" })); try { return await result; } finally { connection.close(); } },
    cancel() { fail(new Error("voice_cancelled")); },
  };
}

export async function createStreamingCapture(stream, options) {
  const port = await startTranscriptionStream(options);
  if (!port) return null;
  let context, source, node, failure, flushed;
  const release = () => {
    source?.disconnect(); source = null;
    node?.disconnect(); if (node) node.port.onmessage = null; node = null;
    const opened = context; context = null;
    if (opened && opened.state !== "closed") void opened.close().catch(() => {});
  };
  try {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    context = new Context();
    const url = URL.createObjectURL(new Blob([PCM_CAPTURE_WORKLET], { type: "text/javascript" }));
    try { await context.audioWorklet.addModule(url); await context.resume(); } finally { URL.revokeObjectURL(url); }
    if (options.signal?.aborted) throw new Error("voice_cancelled");
    const convert = createPcmResampler(context.sampleRate, 16000);
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, "lares-pcm-capture", { numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = ({ data }) => {
      if (data.type === "flushed") { flushed?.(); return; }
      try { port.write(convert(data.samples)); } catch (cause) { failure = cause; port.cancel(); }
    };
    source.connect(node); node.connect(context.destination);
    return {
      async finish() {
        try {
          await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("voice_timeout")), 2000); flushed = () => { clearTimeout(timer); resolve(); }; node.port.postMessage({ type: "flush" }); });
          // No capture messages may follow the ASR commit, even while finalization waits.
          release();
          if (failure) throw failure;
          return await port.finish();
        } catch (cause) { port.cancel(); throw cause; }
        finally { release(); }
      },
      cancel() { port.cancel(); release(); },
    };
  } catch (cause) { port.cancel(); release(); throw cause; }
}
