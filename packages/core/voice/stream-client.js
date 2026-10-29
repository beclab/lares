import { postReport } from "../log/report.js";
import { PCM_CAPTURE_WORKLET } from "./pcm-worklet.js";
import { createPcmResampler } from "./realtime-audio.js";
import { createPcmStreamPlayer } from "./pcm-player.js";
import { wavPcm } from "./client.js";
import { browserAudioErrorCode, requireAudioWorklet } from "./browser-audio.js";
import { isTransportFault } from "../larepass/host.js";

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

/**
 * What a phone-side failure needs next to the frames: a WebView can keep
 * reporting a running context while the app is hidden or the OS muted it, so
 * the page and platform state travel with the metric.
 */
function clientFacts() {
  const nav = globalThis.navigator || {};
  return {
    visibility: String(globalThis.document?.visibilityState || "unknown").slice(0, 16),
    hidden: globalThis.document?.hidden === true,
    platform: String(nav.userAgentData?.platform || nav.platform || "").slice(0, 40),
    ua: String(nav.userAgent || "").slice(0, 180),
  };
}

const RECONNECT_DELAY_MS = 400;
const RECONNECT_DELAY_CAP_MS = 5_000;

/**
 * A phone loses the socket or the next ticket request together (lock screen,
 * app switch, Wi-Fi/cellular). Either one is the same blip. The caller aborting
 * is what ends the answer; a fixed handful of retries is shorter than the blip.
 */
function reconnectable(error) {
  return error?.message === "voice_disconnected" || isTransportFault(error);
}

function waitToReconnect(signal, delay) {
  return new Promise((resolve) => {
    let timer = 0;
    const finish = () => {
      clearTimeout(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const onVisible = () => { if (!document.hidden) finish(); };
    signal?.addEventListener("abort", finish, { once: true });
    // Dialing while the WebView is frozen only fails again. Wait until it is back,
    // then give the radio a moment.
    if (typeof document !== "undefined" && document.hidden) {
      document.addEventListener("visibilitychange", onVisible);
      return;
    }
    timer = setTimeout(finish, delay);
  });
}

export async function playAudioStream(options) {
  const started = Date.now();
  // A caller can cap attempts. Otherwise the answer stays open until it finishes
  // or the caller aborts: a lock-screen blip outlasts a few quick retries.
  const capped = Number.isFinite(Number(options.reconnectAttempts));
  const attempts = capped ? Math.max(1, Number(options.reconnectAttempts)) : Infinity;
  const reconnectDelay = Number.isFinite(options.reconnectDelayMs) ? Math.max(0, options.reconnectDelayMs) : RECONNECT_DELAY_MS;
  // Frames already rendered before the current socket. A reconnected socket
  // replays the answer from its first segment; dropping this prefix keeps the
  // listener where the dropped connection left off.
  let skipFrames = 0;
  let lastError = null;
  let paused = false;
  const controls = { player: null, connection: null, ready: false };
  options.controls?.({
    get canPause() { return controls.ready; },
    pause() {
      if (paused) return;
      paused = true; controls.player?.pause();
      if (controls.connection?.readyState === 1) controls.connection.send(JSON.stringify({ type: "pause" }));
    },
    resume() {
      if (!paused) return;
      paused = false; controls.player?.resume();
      if (controls.connection?.readyState === 1) controls.connection.send(JSON.stringify({ type: "resume" }));
    },
  });

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      if (options.signal?.aborted) throw new Error("voice_cancelled");
      streamMetric(options, { stage: "playback_reconnect", attempt, skipFrames, code: lastError?.message || "voice_disconnected", ...clientFacts() });
      const delay = Math.min(reconnectDelay * 2 ** Math.min(attempt - 1, 4), RECONNECT_DELAY_CAP_MS);
      await waitToReconnect(options.signal, delay);
      if (options.signal?.aborted) throw new Error("voice_cancelled");
    }
    let connection = null;
    let player = null;
    let gapWatch = null;
    let noteVisibility = null;
    try {
    connection = await openAudioStream({ ...options, operation: "tts" });
    if (!connection) throw new Error("voice_stream_failed");
    let progressNoted = false, progressBlocked = false;
    let lastProgressAt = Date.now(), gapReported = false, gapAt = 0, formatNoted = false;
    let chain = Promise.resolve(), complete = false, ending = false, firstReceived = false, ready = false, segmentIndex = -1;
    // The skipped prefix belongs to this new socket and is acknowledged as it
    // arrives, so the host keeps sending it without waiting for a playhead
    // that only starts after the skip.
    let skipBytes = skipFrames * 2;
    let skippedFrames = 0;
    let skipAckAt = 0;
    player = createPcmStreamPlayer({
      onProgress: (frames) => {
        lastProgressAt = Date.now();
        if (gapReported) { gapReported = false; streamMetric(options, { stage: "playback_gap_end", frames: skipFrames + frames, gapMs: Date.now() - gapAt, ...clientFacts(), context: player.contextState() }); }
        ack(skipFrames + frames);
      },
      onMetric: (event) => {
        if (event.stage === "playback_started") options.onStatus?.("playing");
        streamMetric(options, { ...event, durationMs: Date.now() - started });
      },
    });
    controls.player = player;
    controls.connection = connection;
    controls.ready = false;
    const ack = (frames) => {
      if (connection.readyState !== 1) {
        if (!progressBlocked) { progressBlocked = true; streamMetric(options, { stage: "playback_progress_blocked", readyState: connection.readyState, frames }); }
        return;
      }
      try { connection.send(JSON.stringify({ type: "progress", frames })); }
      catch (error) {
        if (!progressBlocked) { progressBlocked = true; streamMetric(options, { stage: "playback_progress_blocked", code: error?.message || "send_failed", frames }); }
        return;
      }
      if (!progressNoted) { progressNoted = true; streamMetric(options, { stage: "playback_progress_sent", frames }); }
    };
    const writeAudio = async (bytes) => {
      let chunk = bytes;
      if (skipBytes > 0) {
        const drop = Math.min(skipBytes, chunk.length);
        skipBytes -= drop;
        skippedFrames += drop / 2;
        if (Date.now() - skipAckAt >= 40) { skipAckAt = Date.now(); ack(skippedFrames); }
        chunk = chunk.subarray(drop);
        if (!chunk.length) return;
      }
      await player.write(chunk);
    };
    gapWatch = setInterval(() => {
      if (!ready || paused || complete || gapReported || Date.now() - lastProgressAt < 4000) return;
      gapReported = true;
      gapAt = lastProgressAt;
      streamMetric(options, { stage: "playback_gap", gapMs: Date.now() - lastProgressAt, frames: skipFrames + player.playedFrames(), ...clientFacts(), context: player.contextState(), sampleRate: player.sampleRate() });
    }, 1000);
    gapWatch.unref?.();
    noteVisibility = () => {
      if (ready && !complete) streamMetric(options, { stage: "playback_visibility", frames: skipFrames + player.playedFrames(), paused, ...clientFacts(), context: player.contextState() });
    };
    if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("visibilitychange", noteVisibility);
      await new Promise((resolve, reject) => {
        let logged = false;
        const fail = (error) => {
          if (logged) return;
          logged = true;
          reject(error);
        };
        const cancelled = () => { player.stop(); fail(new Error("voice_cancelled")); };
        options.signal?.addEventListener("abort", cancelled, { once: true });
        connection.addEventListener("message", ({ data }) => {
          if (typeof data !== "string" && !firstReceived) { firstReceived = true; streamMetric(options, { stage: "playback_first_received", durationMs: Date.now() - started }); }
          let event = null;
          if (typeof data === "string") {
            try { event = JSON.parse(data); } catch (error) { chain = chain.then(() => { throw error; }).catch(fail); return; }
            if (event?.type === "done") ending = true;
          }
          chain = chain.then(async () => {
            if (options.signal?.aborted) throw new Error("voice_cancelled");
            if (typeof data !== "string") { await writeAudio(new Uint8Array(data)); return; }
            if (event.type === "segment") {
              if (event.index !== segmentIndex + 1) throw new Error("voice_reply_sequence");
              segmentIndex = event.index;
            }
            else if (event.type === "segment.end") options.onSegment?.(event);
            else if (event.type === "format") {
              await player.start(event); ready = controls.ready = true; lastProgressAt = Date.now();
              if (paused) {
                player.pause();
                if (connection.readyState === 1) connection.send(JSON.stringify({ type: "pause" }));
              }
              if (!formatNoted) { formatNoted = true; streamMetric(options, { stage: "playback_client", sampleRate: event.sampleRate, context: player.contextState(), ...clientFacts() }); }
            }
            else if (event.type === "file") {
              // A whole-file answer cannot be offset-skipped; a reconnect plays it again.
              // Render it on the same clock as streamed PCM. A 24 kHz WAV through
              // the media element makes the iPhone speaker buzz.
              const clip = wavPcm(event.audio);
              await player.start({ sampleRate: clip.sampleRate, channels: 1, encoding: "pcm_s16le" });
              ready = controls.ready = true; lastProgressAt = Date.now(); options.onStatus?.("playing");
              if (paused) player.pause();
              await player.write(clip.pcm);
              await player.finish();
              if (connection.readyState === 1) connection.send(JSON.stringify({ type: "file.done" }));
            }
            else if (event.type === "error") throw new Error(event.code || "voice_stream_failed");
            else if (event.type === "done") { await player.finish(); complete = true; resolve(); }
          }).catch(fail);
        });
        const dropped = () => new Error(options.signal?.aborted ? "voice_cancelled" : "voice_disconnected");
        connection.addEventListener("error", () => fail(dropped()), { once: true });
        connection.addEventListener("close", () => {
          options.signal?.removeEventListener("abort", cancelled);
          if (!complete && !ending) fail(dropped());
        }, { once: true });
        if (options.signal?.aborted) cancelled();
      });
      return true;
    } catch (error) {
      lastError = error;
      if (reconnectable(error) && attempt < attempts - 1) {
        skipFrames += player?.playedFrames() || 0;
        continue;
      }
      if (error?.message !== "voice_cancelled") {
        streamMetric(options, { stage: "playback_failed", code: error?.message || "voice_playback_failed", durationMs: Date.now() - started });
      }
      throw error;
    } finally {
      clearInterval(gapWatch);
      if (noteVisibility && typeof document !== "undefined" && document.removeEventListener) document.removeEventListener("visibilitychange", noteVisibility);
      if (player && controls.player === player) { controls.player = null; controls.connection = null; controls.ready = false; }
      player?.stop(); connection?.close();
    }
  }
  throw lastError || new Error("voice_disconnected");
}

/** A single final ASR result; partials never submit a task or replace the draft. */
export async function startTranscriptionStream(options) {
  const connection = await openAudioStream({ ...options, operation: "stt" });
  if (!connection) return null;
  let final = null, finished = false, completed = false, failed = false, finishAt = 0, resolve, reject;
  // The Host owns the ASR request; this bound only stops this client waiting.
  // Falling back to the recorded blob is what keeps the take usable.
  const FINAL_TIMEOUT_MS = 60_000;
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
  const dropped = () => fail(new Error(options.signal?.aborted ? "voice_cancelled" : "voice_disconnected"));
  connection.addEventListener("close", dropped, { once: true });
  connection.addEventListener("error", dropped, { once: true });
  if (options.signal?.aborted) fail(new Error("voice_cancelled"));
  await ready;
  return {
    // A committed take is final on the Host; a late or empty result must not be
    // re-sent as a recording. This socket only transcribes, so replaying is safe.
    get committed() { return finished; },
    get replayable() { return true; },
    write(bytes) { if (finished || connection.readyState !== 1 || connection.bufferedAmount > 256 * 1024) throw new Error("voice_audio_backpressure"); connection.send(bytes); },
    async finish() {
      finishAt = Date.now(); finished = true; connection.send(JSON.stringify({ type: "finish" }));
      let timer;
      const timeout = new Promise((_, no) => { timer = setTimeout(() => no(new Error("voice_asr_timeout")), FINAL_TIMEOUT_MS); });
      try { return await Promise.race([result, timeout]); }
      finally { clearTimeout(timer); connection.close(); }
    },
    cancel() { fail(new Error("voice_cancelled")); },
  };
}

/** `options.port` swaps the `/stream` STT socket for another PCM sink at `options.sampleRate`. */
export async function createStreamingCapture(stream, options) {
  const port = await (options.port ? options.port(options) : startTranscriptionStream(options));
  if (!port) return null;
  let context, source, node, failure, flushed, captured = 0;
  const release = () => {
    source?.disconnect(); source = null;
    node?.disconnect(); if (node) node.port.onmessage = null; node = null;
    const opened = context; context = null;
    if (opened && opened.state !== "closed") void opened.close().catch(() => {});
  };
  try {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context || globalThis.isSecureContext === false) throw new Error(browserAudioErrorCode());
    context = new Context();
    requireAudioWorklet(context);
    const url = URL.createObjectURL(new Blob([PCM_CAPTURE_WORKLET], { type: "text/javascript" }));
    try { await context.audioWorklet.addModule(url); await context.resume(); } finally { URL.revokeObjectURL(url); }
    if (options.signal?.aborted) throw new Error("voice_cancelled");
    const convert = createPcmResampler(context.sampleRate, options.sampleRate || 16000);
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, "lares-pcm-capture", { numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = ({ data }) => {
      if (data.type === "flushed") { flushed?.(); return; }
      try {
        const pcm = convert(data.samples);
        if (pcm?.length) captured += pcm.length;
        port.write(pcm);
      } catch (cause) { failure = cause; port.cancel(); }
    };
    source.connect(node); node.connect(context.destination);
    return {
      get committed() { return port.committed === true; },
      get replayable() { return port.replayable !== false; },
      async finish() {
        try {
          await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("voice_timeout")), 2000); flushed = () => { clearTimeout(timer); resolve(); }; node.port.postMessage({ type: "flush" }); });
          // No capture messages may follow the ASR commit, even while finalization waits.
          release();
          if (failure) throw failure;
          // No PCM reached the socket. Committing it makes the Host drop the take
          // without a transcript, and the composer stays on 转写中.
          if (!captured) { port.cancel(); return ""; }
          return await port.finish();
        } catch (cause) { port.cancel(); throw cause; }
        finally { release(); }
      },
      cancel() { port.cancel(); release(); },
    };
  } catch (cause) { port.cancel(); release(); throw cause; }
}
