import { writeReport } from "../log/report.js";
import { createPcmResampler, pcmSamples } from "./realtime-audio.js";
import { realtimeModelIds, validatedRealtimeModels } from "./realtime.js";
import { readConfig, validateConfigPatch, writeConfig } from "./config.js";
import {
  chartModelId,
  installVoiceChart,
  resumeVoiceChart,
  stopVoiceChart,
  voiceChartsStatus,
  voiceChartStatus,
} from "./install.js";
import {
  beginHostCapture,
  endHostCapture,
  openBluetoothPlayback,
  playBluetoothAudio,
  readHostCapture,
  resetHostCapture,
  stopBluetoothPlayback,
} from "./session.js";
import { createCaptureSession } from "./capture.js";
import { createDuplexCoordinator } from "./duplex.js";
import { createDeviceLease } from "./lease.js";
import { normalizeSttPcm } from "./pcm.js";
import { gapAfter, speechSegments } from "./script.js";
import {
  listTtsVoices,
  pcmToWav,
  pickTtsVoice,
  silencePcm,
  synthesize,
  synthesizeStream,
} from "../router/tts.js";
import {
  STT_MAX_AUDIO_BYTES,
  VoiceError,
  listModels,
  pickSttModelId,
  pickTtsModelId,
  resolveSttModel,
  sttModelIds,
  transcribe,
  ttsModelIds,
} from "../router/stt.js";

export { STT_MAX_AUDIO_BYTES };

const duplex = createDuplexCoordinator(stopBluetoothPlayback);
const deviceLease = createDeviceLease();
const scopes = new Map();

export function voiceSessionPrompt(sessionId) {
  return [...scopes.values()].some((scope) => scope.session?.snapshot().sessionId === sessionId && scope.active && Date.now() - scope.seen < 30_000);
}

export function voiceScope(id, owner = "", device = "headset") {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) throw new VoiceError("voice_session_invalid", 400, "invalid voice connection");
  const key = `${owner}:${id}`;
  for (const [other, scope] of scopes) {
    if (Date.now() - scope.seen > 120_000 && !deviceLease.owns(scope)) {
      scopes.delete(other);
      void scope.duplex.interrupt().catch(() => {});
      scope.capture?.stop(true);
      void scope.session?.close();
    }
  }
  let scope = scopes.get(key);
  if (!scope) {
    if (scopes.size >= 128) throw new VoiceError("voice_busy", 429, "too many voice connections");
    scope = { id, owner, device, seen: Date.now(), capture: null, duplex: null };
    scope.duplex = createDuplexCoordinator(async () => {
      if (deviceLease.owns(scope)) {
        await stopBluetoothPlayback();
        deviceLease.release(scope);
      }
    });
    scopes.set(key, scope);
  }
  if (scope.device !== device) {
    if (deviceLease.owns(scope)) throw new VoiceError("voice_device_busy", 409, "stop the current audio device first");
    scope.device = device;
  }
  scope.seen = Date.now();
  return scope;
}

function scopedPlayback(scope) {
  if (scope.device === "device") return Promise.resolve({ skipped: true });
  deviceLease.acquire(scope);
  return openBluetoothPlayback({ waitForDrain: true }).then((player) => {
    if (player.skipped) deviceLease.release(scope);
    return {
      ...player,
      async write(chunk) { deviceLease.touch(scope); return player.write(chunk); },
      async close() { try { return await player.close?.(); } finally { deviceLease.release(scope); } },
      abort() { try { player.abort?.(); } finally { deviceLease.release(scope); } },
    };
  }, (error) => { deviceLease.release(scope); throw error; });
}

export async function voiceStatusPayload(options) {
  const config = readConfig();
  let modelAvailable = false;
  let resolvedModel = config.model;
  try {
    const models = await listModels(options);
    resolvedModel = pickSttModelId(models, config.model) ?? "";
    modelAvailable = Boolean(resolvedModel);
  } catch {
    modelAvailable = false;
  }
  return {
    ok: modelAvailable,
    model: resolvedModel,
    modelAvailable,
    language: config.language,
  };
}

export async function voiceModelsPayload(options) {
  const models = await listModels(options);
  const config = readConfig();
  const ids = models.map((model) => model.id);
  const stt = sttModelIds(models);
  const tts = ttsModelIds(models);
  let charts = null;
  try {
    charts = await voiceChartsStatus();
  } catch {
    charts = null;
  }
  return {
    models: ids,
    stt,
    tts,
    realtime: realtimeModelIds(models),
    realtimeReady: validatedRealtimeModels(models),
    selected: pickSttModelId(models, config.model),
    ttsSelected: pickTtsModelId(models, config.ttsModel),
    charts,
  };
}

export async function saveVoiceConfig(body) {
  const patch = validateConfigPatch(body);
  if (patch.model || patch.ttsModel || patch.realtimeModel || patch.backend === "realtime") {
    const models = await listModels();
    if (patch.realtimeModel && !realtimeModelIds(models).includes(patch.realtimeModel)) throw new VoiceError("voice_model_unavailable", 400, "Realtime model is not available");
    if (patch.backend === "realtime" && !validatedRealtimeModels(models).includes(patch.realtimeModel || readConfig().realtimeModel)) throw new VoiceError("voice_realtime_unavailable", 409, "Realtime model has not been validated");
    if (patch.model && !sttModelIds(models).includes(patch.model)) {
      throw new VoiceError("voice_model_unavailable", 400, "selected voice model is not available");
    }
    if (patch.ttsModel && !ttsModelIds(models).includes(patch.ttsModel)) {
      throw new VoiceError("voice_model_unavailable", 400, "selected speech model is not available");
    }
  }
  return writeConfig(patch);
}

export function installVoice(kind) {
  return installVoiceChart(kind);
}

export function stopVoice(kind) {
  return stopVoiceChart(kind);
}

export function resumeVoice(kind) {
  return resumeVoiceChart(kind);
}

const PROBE_TIMEOUT_MS = 45_000;

function probeWav() {
  return pcmToWav(Buffer.alloc(6400), 16000);
}

/**
 * Ask the chart's model through Router. An engine that answers — even to
 * reject silence — is connected. A stopped chart is not.
 * @param {"stt" | "tts"} kind
 */
export async function probeVoice(kind, options = {}) {
  const status = await (options.status ?? voiceChartStatus)(kind);
  if (status.phase !== "running") {
    throw new VoiceError("voice_probe_failed", 409, "voice app is not running");
  }
  const models = await (options.listModels ?? listModels)({ refresh: true });
  const ids = kind === "tts" ? ttsModelIds(models) : sttModelIds(models);
  const model = chartModelId(kind, ids);
  if (!model) throw new VoiceError("voice_probe_failed", 503, "voice model is not registered");
  if (kind === "tts") {
    const speak = options.synthesize ?? synthesize;
    const audio = await speak({ text: "你好", model, timeoutMs: PROBE_TIMEOUT_MS });
    if (!audio?.length) throw new VoiceError("voice_probe_failed", 502, "speech returned no audio");
    return { ok: true, app: status.app, model };
  }
  const hear = options.transcribe ?? transcribe;
  try {
    await hear({
      bytes: probeWav(),
      filename: "probe.wav",
      contentType: "audio/wav",
      model,
      once: true,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
  } catch (err) {
    if (!(err instanceof VoiceError) || err.code !== "voice_audio_unreadable") {
      const statusCode = err && typeof err === "object" && "status" in err ? Number(err.status) : 502;
      throw new VoiceError("voice_probe_failed", statusCode || 502, err instanceof Error ? err.message : "probe failed");
    }
  }
  return { ok: true, app: status.app, model };
}

function cancelledSpeech() {
  return new VoiceError("voice_cancelled", 499, "speech was superseded");
}

const readouts = new WeakMap();

/** model id → pinned voice. A failed lookup is not cached, so the next readout asks again. */
const pinnedVoices = new Map();

async function pinnedVoice(model, listVoices = listTtsVoices) {
  if (pinnedVoices.has(model)) return pinnedVoices.get(model);
  let voice = null;
  try {
    voice = pickTtsVoice(await listVoices(model));
  } catch {
    return null;
  }
  if (voice) pinnedVoices.set(model, voice);
  return voice;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function partIndex(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** How long a readout of a streaming answer waits for its next sentence before it lets the headset go. */
const STREAM_IDLE_MS = 30_000;

function joinable(current, id, key, part) {
  if (current?.id !== id) return null;
  if (key && current.signal.aborted) throw cancelledSpeech();
  if (key || part > 0) return current.signal.aborted ? null : current;
  return current.active() ? current : null;
}

/**
 * Every open page asks to read the same answer. A request for the readout
 * already under way joins it instead of restarting the headset and cancelling
 * the page that asked first.
 *
 * `options.key` names an answer that is still being written: each request
 * carries the text so far, and `options.done` once it is complete. The readout
 * appends the sentences it has not seen yet, so the headset reads on without a
 * restart. A keyed request without `options.part` only hands over the text.
 * Once interrupted, a key stays cancelled.
 *
 * `options.part` asks for one sentence instead of the whole answer, so a page
 * can play it while the rest is still being written or synthesized. A later
 * sentence joins its readout even after synthesis has finished.
 *
 * Without a key the text is the whole answer and names its readout.
 *
 * @returns {Promise<{ bluetooth: string, audio: Buffer } | { sentences: number }>}
 */
export async function speakFromConfig(text, options = {}) {
  const config = options.config ?? readConfig();
  if (!config.speak) throw new VoiceError("voice_speak_disabled", 409, "speech playback is off");
  const key = typeof options.key === "string" && options.key ? options.key : null;
  const done = key ? options.done === true : true;
  const segments = speechSegments(text, { done });
  const part = partIndex(options.part);
  const coordinator = options.coordinator ?? options.scope?.duplex ?? duplex;
  const id = key ?? text;
  let readout = joinable(readouts.get(coordinator), id, key, part);
  if (!readout) {
    if (!segments.length) {
      if (key && part === null) return { sentences: 0 };
      throw new VoiceError("voice_config_invalid", 400, "nothing to speak");
    }
    const model = options.model ?? await pickTtsModelId(await listModels(), config.ttsModel);
    if (!model) throw new VoiceError("voice_tts_unavailable", 503, "no speech model available");
    readout = joinable(readouts.get(coordinator), id, key, part) ?? startReadout(coordinator, id, model, options);
  }
  readout.extend(segments, done);
  if (part === null) return key ? { sentences: readout.segments.length } : readout.result;
  if (part >= readout.segments.length) {
    throw new VoiceError("voice_config_invalid", 400, `answer has ${readout.segments.length} sentence(s)`);
  }
  readout.requestedPart = Math.max(readout.requestedPart, part);
  readout.extend([], false);
  return readout.parts[part].promise;
}

function startReadout(coordinator, id, model, options) {
  const lease = coordinator.beginSpeech(options.signal);
  let wake = () => {};
  const readout = {
    id,
    createdAt: Date.now(),
    firstAudio: false,
    active: lease.active,
    signal: lease.signal,
    segments: [],
    parts: [],
    final: false,
    requestedPart: 0,
    extend(segments, done) {
      if (readout.final) { wake(); return; }
      for (const sentence of segments.slice(readout.segments.length)) {
        readout.segments.push(sentence);
        readout.parts.push(deferred());
      }
      if (done) readout.final = true;
      wake();
    },
    /** true once more text arrives or the readout is cancelled, false after `idleMs` of silence. */
    more(idleMs) {
      return new Promise((resolve) => {
        const settle = (value) => {
          clearTimeout(timer);
          lease.signal.removeEventListener("abort", woken);
          wake = () => {};
          resolve(value);
        };
        const woken = () => settle(true);
        const timer = setTimeout(() => settle(false), idleMs);
        wake = woken;
        lease.signal.addEventListener("abort", woken, { once: true });
      });
    },
  };
  readout.result = pinnedVoice(model, options.listVoices)
    .then((voice) => readAloud(readout, model, voice, lease, options));
  readout.result.catch(() => {});
  readouts.set(coordinator, readout);
  return readout;
}

async function readAloud(readout, model, voice, lease, options) {
  const openPlayback = options.openPlayback ?? (options.scope ? () => scopedPlayback(options.scope) : openBluetoothPlayback);
  const synthesize = options.synthesize ?? synthesizeStream;
  const playFile = options.playFile ?? (options.scope ? async (audio) => {
    if (options.scope.device === "device") return { played: false };
    deviceLease.acquire(options.scope);
    try { return await playBluetoothAudio(audio); } finally { deviceLease.release(options.scope); }
  } : playBluetoothAudio);
  const toWav = options.pcmToWav ?? pcmToWav;
  const gap = options.silencePcm ?? silencePcm;
  const idleMs = options.idleMs ?? STREAM_IDLE_MS;
  let opening;
  let player;
  const abortPlayer = () => player?.abort?.();
  lease.signal.addEventListener("abort", abortPlayer);
  const pcm = [];
  let sentence = [];
  let streamed = false;
  let fileAudio;
  const release = () => {
    lease.signal.removeEventListener("abort", abortPlayer);
    lease.finish();
  };
  const dropParts = (err) => {
    for (const part of readout.parts) part.reject(err);
  };
  const headsetState = async () => {
    const opened = opening ? await opening : null;
    return opened && !opened.skipped ? "played" : "skipped";
  };
  // The speaker drains in real time; synthesis must not wait on it, or the
  // browser copy arrives only after the headset has finished.
  let feeding = Promise.resolve();
  const writeChunk = (chunk) => {
    if (!chunk?.length) return;
    if (!readout.firstAudio) {
      readout.firstAudio = true;
      if (options.scope) writeReport({ scope: "voice", event: "metric", voiceId: options.scope.id, stage: "synthesis_first_audio", durationMs: Date.now() - readout.createdAt, queueDepth: readout.segments.length });
    }
    pcm.push(chunk);
    sentence.push(chunk);
    if (!lease.active()) return;
    opening ??= openPlayback();
    opening.catch(() => {});
    feeding = feeding.then(async () => {
      player ??= await opening;
      if (player.skipped || !lease.active()) return;
      try {
        await player.write(chunk);
      } catch {
        player.skipped = true;
        player.abort?.();
      }
    });
    if (options.scope?.device === "headset") return feeding;
  };
  try {
    for (let index = 0; lease.active();) {
      if (index >= readout.segments.length) {
        if (readout.final) break;
        if (!(await readout.more(idleMs))) readout.final = true;
        continue;
      }
      if (options.key && index > readout.requestedPart + 1) {
        if (!(await readout.more(idleMs))) throw new VoiceError("voice_playback_timeout", 408, "playback consumer stopped");
        continue;
      }
      sentence = [];
      if (index > 0) await writeChunk(gap(gapAfter(readout.segments[index - 1])));
      const outcome = await synthesize({ text: readout.segments[index], model, voice, signal: lease.signal }, writeChunk);
      if (!outcome.streamed) {
        fileAudio = outcome.audio;
        readout.parts[0].resolve({ audio: fileAudio, bluetooth: "skipped" });
        readout.final = true;
        break;
      }
      streamed = true;
      readout.parts[index].resolve({ audio: toWav(Buffer.concat(sentence)), bluetooth: await headsetState() });
      index += 1;
    }
  } catch (err) {
    void opening?.then((opened) => opened.abort?.());
    release();
    const failure = lease.signal.aborted ? cancelledSpeech() : err;
    dropParts(failure);
    throw failure;
  }
  const headset = opening ? await opening : null;
  if (!lease.active()) {
    headset?.abort?.();
    release();
    dropParts(cancelledSpeech());
    throw cancelledSpeech();
  }
  if (!streamed) dropParts(new VoiceError("voice_config_invalid", 400, "this engine returns the answer whole"));
  const audio = streamed ? toWav(Buffer.concat(pcm)) : fileAudio;
  if (streamed && headset && !headset.skipped) {
    void feeding
      .then(() => (headset.skipped || !lease.active() ? headset.abort?.() : headset.close()))
      .catch(() => headset.abort?.())
      .finally(release);
    return { bluetooth: "played", audio };
  }
  headset?.abort?.();
  let bluetooth = "skipped";
  if (!streamed && fileAudio) {
    try {
      if ((await playFile(fileAudio)).played) bluetooth = "played";
    } catch {
      // Browser playback remains available.
    }
  }
  release();
  return { bluetooth, audio };
}

export function playbackStatus(scope) { return { playing: (scope?.duplex ?? duplex).isSpeaking() }; }

export function interruptSpeech(scope) {
  return (scope?.duplex ?? duplex).interrupt();
}

export function languageForTranscribe(requestedLanguage, configLanguage) {
  if (requestedLanguage === null) return configLanguage || undefined;
  return validateConfigPatch({ language: requestedLanguage }).language || undefined;
}

export async function transcribeFromHttp({ languageParam, contentType, bytes, signal }) {
  const config = readConfig();
  const text = await transcribeAudio({
    bytes,
    contentType,
    language: languageForTranscribe(languageParam, config.language),
    preferred: config.model,
    signal,
  });
  return { text };
}

function createHostCapture(scope) {
  return createCaptureSession({
    async open() {
      deviceLease.acquire(scope);
      try { const opened = await beginHostCapture(); if (!opened.ready) deviceLease.release(scope); return opened; } catch (error) { deviceLease.release(scope); throw error; }
    },
    read(from) { if (!deviceLease.owns(scope)) throw new VoiceError("voice_device_busy", 409, "audio lease expired"); deviceLease.touch(scope); return readHostCapture(from); },
    async close() { if (!deviceLease.owns(scope)) return; try { await endHostCapture(); } finally { deviceLease.release(scope); } },
    reset: resetHostCapture,
    transcribe(wav, signal) {
      const config = readConfig();
      return transcribeAudio({ bytes: wav, contentType: "audio/wav", language: languageForTranscribe(null, config.language), preferred: config.model, signal });
    },
  });
}
const defaultScope = { duplex };
function captureFor(scope = defaultScope) { return scope.capture ??= createHostCapture(scope); }
export async function captureStart(scope = defaultScope) {
  deviceLease.acquire(scope);
  await interruptSpeech(scope);
  return captureFor(scope).start();
}
export function captureStop(cancel, scope = defaultScope) {
  captureFor(scope).stop(cancel);
  return captureFor(scope).status();
}
export function captureStatus(scope = defaultScope) { return captureFor(scope).status(); }

export async function transcribeAudio({ bytes, contentType, language, preferred, signal }) {
  const model = await resolveSttModel(preferred);
  if (!model) {
    throw new VoiceError("voice_model_unavailable", 503, "no voice model available in the Router catalog");
  }
  if (bytes.length === 0) throw new VoiceError("voice_audio_unreadable", 400, "audio content is empty");
  const pcm = await normalizeSttPcm(bytes, contentType);
  signal?.throwIfAborted();
  return transcribe({
    bytes: pcm,
    filename: "voice.wav",
    contentType: "audio/wav",
    model,
    language,
    preferred,
    signal,
  });
}


/** Host input and output share one physical lease; half-duplex is intentional. */
export async function openRealtimeHostAudio(scope, send) {
  if (scope.device !== "headset") return null;
  deviceLease.acquire(scope);
  let closed = false;
  let capturing = false;
  let offset = 0;
  let player = null;
  let timer = null;
  let generation = 0;
  const convert = createPcmResampler(16000);
  const start = async () => {
    if (closed || capturing) return;
    const opened = await beginHostCapture();
    if (!opened.ready) throw new VoiceError("voice_bluetooth_not_ready", 503, "headset is not ready");
    capturing = true; offset = opened.offset;
  };
  const read = async () => {
    if (closed) return;
    if (!deviceLease.owns(scope)) throw new VoiceError("voice_device_busy", 409, "audio lease expired");
    deviceLease.touch(scope);
    if (capturing) {
      const bytes = await readHostCapture(offset, { maxBytes: 32_000 });
      offset += bytes.length;
      if (bytes.length) send({ type: "input_audio_buffer.append", audio: Buffer.from(convert(pcmSamples(bytes))).toString("base64") });
    }
    if (!closed) timer = setTimeout(() => { void read().catch(() => scope.realtimeSocket?.close()); }, 100);
  };
  try { await start(); void read(); }
  catch (error) { deviceLease.release(scope); throw error; }
  return {
    async write(bytes) {
      if (closed) return;
      if (capturing) { capturing = false; await endHostCapture(); }
      if (!player) {
        player = await openBluetoothPlayback({ waitForDrain: true });
        if (player.skipped) throw new VoiceError("voice_device_unavailable", 503, "headset speaker is unavailable");
      }
      deviceLease.touch(scope);
      await player.write(bytes);
    },
    async finish() {
      const epoch = generation;
      const current = player; player = null;
      await current?.close();
      if (!closed && epoch === generation) await start();
    },
    async interrupt() {
      generation++;
      player?.abort(); player = null;
      await stopBluetoothPlayback();
      if (!closed) await start();
    },
    async stop() {
      if (closed) return;
      closed = true; generation++; clearTimeout(timer);
      player?.abort(); player = null;
      try { if (deviceLease.owns(scope)) { await endHostCapture(); await stopBluetoothPlayback(); } }
      finally { deviceLease.release(scope); }
    },
  };
}
