import { listModels as voiceModels } from "@olares/lares-core/router/stt";
import { createReplyStreamRegistry } from "@olares/lares-core/voice/reply-stream";
import { createAudioStreamGateway } from "@olares/lares-core/voice/stream-gateway";
import { createLaresRealtimeGateway } from "@olares/lares-core/voice/lares-realtime-gateway";
import { createVoiceKeyStore } from "@olares/lares-core/voice/keys";
import { publishRealtimeUpgrade } from "@olares/lares-core/voice/internal-upgrade";
import { busyEnterBehavior, CONVERSATION_SETTINGS_NAMESPACE } from "@olares/lares-core/larepass/submission-settings";
import { createRouterAudio } from "@olares/lares-core/voice/router-audio";
import { createVoiceHostService } from "@olares/lares-core/voice/host-service";
import { registerRealtime } from "./realtime.js";
/**
 * Voice-input Host routes under /api/lares/voice (STT via /llm/v1 shim).
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRouteHandler, readBody, readJsonObject, sendJson } from "@olares/lares-core/tools/http";
import { readConfig } from "@olares/lares-core/voice/config";
import {
  STT_MAX_AUDIO_BYTES,
  voiceScope,
  voiceSessionPrompt,
  playbackStatus,
  installVoice,
  probeVoice,
  resumeVoice,
  saveVoiceConfig,
  stopVoice,
  captureStart,
  captureStatus,
  captureStop,
  interruptSpeech,
  speakFromConfig,
  transcribeFromHttp,
  voiceModelsPayload,
  voiceCapabilitiesPayload,
  voiceStatusPayload,
  openRealtimeHostAudio,
} from "@olares/lares-core/voice/service";
import { bluetoothRequest, ensureBluetoothReady } from "@olares/lares-core/voice/link";
import { gpuAppAction, gpuModePayload, readingModePayload, saveSlicePlan, speechGpu, streamingEnabled, switchReadingMode } from "@olares/lares-core/voice/gpu-mode";
import { routerEndUser } from "@olares/lares-core/router/gateway";
import { SPOKEN_PROMPT } from "@olares/lares-core/voice/agent-session";
import { writeReport } from "@olares/lares-core/log/report";

export const name = "lares-composer-voice";
export const inject = ["webServer", "sessionController", "settings"];

const ROUTE_PREFIX = "/api/lares/voice";
const require = createRequire(import.meta.url);
const VAD_DIST = dirname(require.resolve("@ricky0123/vad-web"));
const ORT_DIST = dirname(require.resolve("onnxruntime-web"));
const VAD_MODEL = fileURLToPath(new URL("../assets/silero_vad_v5.onnx", import.meta.url));
const VAD_ASSETS = {
  "vad.js": { path: join(VAD_DIST, "bundle.min.js"), type: "text/javascript; charset=utf-8" },
  "vad.worklet.js": { path: join(VAD_DIST, "vad.worklet.bundle.min.js"), type: "text/javascript; charset=utf-8" },
  "silero_vad_v5.onnx": { path: VAD_MODEL, type: "application/octet-stream" },
  "ort.js": { path: join(ORT_DIST, "ort.min.js"), type: "text/javascript; charset=utf-8" },
  "ort-wasm-simd-threaded.mjs": { path: join(ORT_DIST, "ort-wasm-simd-threaded.mjs"), type: "text/javascript; charset=utf-8" },
  "ort-wasm-simd-threaded.wasm": { path: join(ORT_DIST, "ort-wasm-simd-threaded.wasm"), type: "application/wasm" },
};

function scopeFor(req) {
  const scope = voiceScope(String(req.headers["x-lares-voice-id"] || ""), routerEndUser(process.env, req.headers), req.headers["x-lares-voice-device"] === "device" ? "device" : "headset");
  scope.voiceInputActive = req.headers["x-lares-voice-speaking"] === "true";
  return scope;
}

function wantsRefresh(req) {
  return new URL(req.url ?? "/", "http://x").searchParams.get("refresh") === "1";
}

async function handleStatus(req, res) {
  sendJson(res, 200, await voiceStatusPayload({ refresh: wantsRefresh(req) }));
}

async function handleModels(req, res) {
  sendJson(res, 200, await voiceModelsPayload({ refresh: wantsRefresh(req) }));
}

async function handleCapabilities(req, res) {
  sendJson(res, 200, await voiceCapabilitiesPayload({ refresh: wantsRefresh(req) }));
}

async function handleGetConfig(_req, res) {
  sendJson(res, 200, readConfig());
}

async function handleSetConfig(req, res) {
  sendJson(res, 200, await saveVoiceConfig(await readJsonObject(req)));
}

async function handleGetGpuMode(_req, res) {
  sendJson(res, 200, await gpuModePayload());
}

async function handleReadingMode(req, res) {
  sendJson(res, 200, await readingModePayload());
}

async function handleSetGpuMode(req, res) {
  const body = await readJsonObject(req);
  sendJson(res, 200, await switchReadingMode(body.streaming));
}

async function handleSetSlicePlan(req, res) {
  const body = await readJsonObject(req);
  sendJson(res, 200, await saveSlicePlan(body.apps));
}

async function handleGpuApp(req, res) {
  const body = await readJsonObject(req);
  sendJson(res, 200, await gpuAppAction(body.app, body.op));
}

async function handleInstall(req, res) {
  const body = await readJsonObject(req);
  const kind = body.kind === "tts" ? "tts" : body.kind === "stt" ? "stt" : "";
  if (body.op === "stop") {
    sendJson(res, 200, await stopVoice(kind));
    return;
  }
  if (body.op === "resume") {
    sendJson(res, 200, await resumeVoice(kind));
    return;
  }
  if (body.op === "probe") {
    sendJson(res, 200, await probeVoice(kind));
    return;
  }
  sendJson(res, 200, await installVoice(kind));
}

async function handleSpeak(req, res) {
  const body = await readJsonObject(req);
  const scope = scopeFor(req);
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  const part = Number.isInteger(body.part) ? body.part : undefined;
  const key = typeof body.key === "string" && body.key ? body.key : undefined;
  let spoken;
  try {
    spoken = await speakFromConfig(
      typeof body.text === "string" ? body.text : "",
      { signal: controller.signal, part, key, done: body.done === true, scope, config: { ...readConfig(), speak: scope.active ? scope.readAloud : readConfig().speak } },
    );
  } finally {
    res.off("close", abort);
  }
  if (key && part === undefined || spoken.sentences === 0) {
    sendJson(res, 200, { sentences: spoken.sentences });
    return;
  }
  sendJson(res, 200, {
    bluetooth: spoken.bluetooth === "played" ? "played" : "skipped",
    audio: Buffer.from(spoken.audio).toString("base64"),
  });
}

async function handlePlaybackStop(req, res) {
  const body = await readJsonObject(req);
  const scope = scopeFor(req);
  streams?.cancel(body);
  await interruptSpeech(scope, body);
  sendJson(res, 200, { stopped: true });
}

async function handleCaptureStart(req, res) {
  sendJson(res, 200, await captureStart(scopeFor(req), await readJsonObject(req)));
}

async function handleCaptureStop(req, res) {
  sendJson(res, 200, captureStop(false, scopeFor(req)));
}

async function handleCaptureCancel(req, res) {
  sendJson(res, 200, captureStop(true, scopeFor(req)));
}

async function handleCaptureStatus(req, res) {
  sendJson(res, 200, captureStatus(scopeFor(req)));
}

async function handleReady(_req, res) {
  sendJson(res, 200, await ensureBluetoothReady());
}

async function handleBluetooth(req, res) {
  sendJson(res, 200, await bluetoothRequest(await readJsonObject(req)));
}

async function handleTranscribe(req, res) {
  const url = new URL(req.url ?? "/", "http://x");
  const contentType = req.headers["content-type"] || "audio/webm";
  const bytes = await readBody(req, {
    maxBytes: STT_MAX_AUDIO_BYTES,
    code: "voice_audio_too_large",
    message: "audio exceeds 25MB",
  });
  writeReport({
    scope: "voice",
    event: "transcribe-in",
    bytes: bytes.length,
    type: String(contentType),
  });
  try {
    const controller = new AbortController();
    res.once("close", () => controller.abort());
    const result = await transcribeFromHttp({
      signal: controller.signal,
      languageParam: url.searchParams.get("language"),
      modelParam: url.searchParams.get("model"),
      contentType,
      bytes,
    });
    writeReport({
      scope: "voice",
      event: "transcribe-ok",
      chars: String(result?.text ?? "").length,
    });
    sendJson(res, 200, result);
  } catch (err) {
    writeReport({
      scope: "voice",
      event: "transcribe-fail",
      code: err?.code || "voice_failed",
    });
    throw err;
  }
}

/** The owner's busy-Enter choice also decides a spoken turn that arrives while the Agent runs. */
function busyEnterDefault(ctx) {
  try { return busyEnterBehavior(ctx.settings?.describe?.().find((descriptor) => descriptor.ns === CONVERSATION_SETTINGS_NAMESPACE)?.value?.busyEnter); }
  catch { return "queue"; }
}

/** @type {Record<string, Record<string, (req, res) => Promise<void>>>} */
let voiceHost;
let realtime;
let voiceKeys;
async function handleVoiceSession(req, res) {
  const scope = scopeFor(req);
  const body = await readJsonObject(req);
  sendJson(res, 200, await voiceHost.open(scope, body));
}
async function handleVoiceState(req, res) {
  const scope = scopeFor(req);
  sendJson(res, 200, voiceHost.state(scope));
}
async function handleVoicePrompt(req, res) {
  const scope = scopeFor(req);
  const body = await readJsonObject(req);
  sendJson(res, 200, await voiceHost.prompt(scope, body));
}
async function handleVoiceCancel(req, res) {
  await voiceHost.cancel(scopeFor(req));
  sendJson(res, 200, { cancelled: true });
}
async function handleVoiceClose(req, res) {
  const scope = scopeFor(req);
  await voiceHost.close(scope);
  captureStop(true, scope);
  await interruptSpeech(scope);
  sendJson(res, 200, { closed: true });
}

const ROUTES = {
  "/stream/ticket": { POST: async (req, res) => sendJson(res, 200, await streams.ticket(scopeFor(req), await readJsonObject(req))) },
  "/realtime/ticket": { POST: async (req, res) => sendJson(res, 200, await realtime.ticket(scopeFor(req))) },
  "/keys": {
    GET: (_req, res) => sendJson(res, 200, { keys: voiceKeys.list() }),
    POST: async (req, res) => sendJson(res, 201, voiceKeys.issue(await readJsonObject(req))),
    DELETE: async (req, res) => { const value = await readJsonObject(req); const revoked = voiceKeys.revoke(value.id); sendJson(res, revoked ? 200 : 404, { revoked }); },
  },
  "/dictation/clean": { POST: async (req, res) => { const value = await readJsonObject(req); const abort = new AbortController(); res.once("close", () => abort.abort()); sendJson(res, 200, { text: await voiceHost.clean({ owner: routerEndUser(process.env, req.headers) }, value.text, { preset: value.preset, config: value.config, signal: abort.signal }) }); } },
  "/history": { POST: async (req, res) => {
    const abort = new AbortController();
    const close = () => abort.abort();
    res.once("close", close);
    try { sendJson(res, 200, await voiceHost.history({ owner: routerEndUser(process.env, req.headers) }, await readJsonObject(req), abort.signal)); }
    finally { res.removeListener("close", close); }
  } },
  "/records": {
    GET: (req, res) => sendJson(res, 200, voiceHost.records(scopeFor(req))),
    DELETE: async (req, res) => { await voiceHost.clearRecords(scopeFor(req)); sendJson(res, 200, { ok: true }); },
  },
  "/session/output": { POST: async (req, res) => { const value = await readJsonObject(req); voiceHost.output(scopeFor(req), value.readAloud); sendJson(res, 200, { ok: true }); } },
  "/session/resume": { POST: async (req, res) => { const scope = scopeFor(req); await voiceHost.resume(scope); sendJson(res, 200, voiceHost.state(scope)); } },
  "/session/metric": { POST: async (req, res) => {
    const scope = scopeFor(req);
    const value = await readJsonObject(req);
    if (["recognition", "interrupt"].includes(value.stage) && Number.isFinite(value.durationMs) && value.durationMs >= 0 && value.durationMs <= 3_600_000) writeReport({ scope: "voice", event: "metric", voiceId: scope.id, stage: value.stage, durationMs: value.durationMs });
    sendJson(res, 200, { ok: true });
  } },
  "/playback/status": { GET: (req, res) => sendJson(res, 200, playbackStatus(scopeFor(req))) },
  "/session": { POST: handleVoiceSession, GET: handleVoiceState },
  "/session/prompt": { POST: handleVoicePrompt },
  "/session/cancel": { POST: handleVoiceCancel },
  "/session/close": { POST: handleVoiceClose },
  "/status": { GET: handleStatus },
  "/models": { GET: handleModels },
  "/capabilities": { GET: handleCapabilities },
  "/config": { GET: handleGetConfig, POST: handleSetConfig },
  "/install": { POST: handleInstall },
  "/gpu-mode": { GET: handleGetGpuMode, POST: handleSetGpuMode },
  "/reading-mode": { GET: handleReadingMode },
  "/gpu-mode/slices": { POST: handleSetSlicePlan },
  "/gpu-mode/app": { POST: handleGpuApp },
  "/speak": { POST: handleSpeak },
  "/playback/stop": { POST: handlePlaybackStop },
  "/ready": { POST: handleReady },
  "/capture": { POST: handleCaptureStart, GET: handleCaptureStatus },
  "/capture/stop": { POST: handleCaptureStop },
  "/capture/cancel": { POST: handleCaptureCancel },
  "/bluetooth": { POST: handleBluetooth },
  "/transcribe": { POST: handleTranscribe },
};

const handler = createRouteHandler({
  prefix: ROUTE_PREFIX,
  routes: ROUTES,
  fallbackCode: "voice_failed",
});

async function voiceHandler(req, res) {
  const pathname = new URL(req.url ?? "/", "http://x").pathname;
  const prefix = `${ROUTE_PREFIX}/vad/`;
  if (!pathname.startsWith(prefix)) {
    await handler(req, res);
    return;
  }
  const asset = VAD_ASSETS[pathname.slice(prefix.length)];
  if (!asset || (req.method ?? "GET").toUpperCase() !== "GET") {
    sendJson(res, 404, { error: { code: "voice_failed", message: "VAD asset not found" } });
    return;
  }
  const bytes = await readFile(asset.path);
  res.writeHead(200, {
    "cache-control": "public, max-age=31536000, immutable",
    "content-length": String(bytes.length),
    "content-type": asset.type,
  });
  res.end(bytes);
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
let streams;
export function apply(ctx) {
  const replies = createReplyStreamRegistry({ inspect: id => ctx.sessionController.inspect(id), owner: () => routerEndUser(), streaming: () => streamingEnabled() });
  ctx.effect(() => {
    let stop = false;
    const probe = async () => {
      while (!stop) {
        try { await speechGpu(); } catch { /* keep the last card; a time-sliced card stays ineligible */ }
        await new Promise((resolve) => setTimeout(resolve, 30_000));
      }
    };
    void probe();
    return () => { stop = true; };
  });
  ctx.on("agent/assistant-stream", ({ agent, frame }) => replies.frame(agent.id, frame));
  ctx.on("session/event", (session, event) => replies.event(session.id, event));
  ctx.on("api-session/removed", id => replies.remove(id));
  ctx.on("agent/disposed", ({ agent }) => replies.remove(agent.id));
  ctx.effect(() => () => replies.close());
  streams = createAudioStreamGateway({ replies, config: readConfig, models: () => voiceModels(), metric: (fields) => writeReport({ scope: "voice", event: "metric", ...fields }) });
  ctx.effect(() => {
    const unregister = ctx.webServer.registerUpgrade({ path: "/api/lares/voice/stream", handler: (req, socket, head) => streams.upgrade(req, socket, head) });
    return () => { unregister(); streams.close(); };
  });
  voiceHost = createVoiceHostService(ctx.sessionController, { metric: (fields) => writeReport({ scope: "voice", event: "metric", ...fields }) });
  voiceKeys = createVoiceKeyStore();
  ctx.on("api-session/removed", (sessionId) => voiceHost.remove(sessionId));
  ctx.effect(() => {
    const unified = createLaresRealtimeGateway({ service: voiceHost, config: readConfig, ...createRouterAudio(readConfig), keys: voiceKeys, hostOwner: routerEndUser(),
      hostAudio: openRealtimeHostAudio, busyDefault: () => busyEnterDefault(ctx),
      onError: (cause, scope) => writeReport({ scope: "voice", event: "realtime-error", voiceId: scope.id, code: cause?.code || cause?.message || "voice_failed" }),
      onOpen: (fields) => writeReport({ scope: "voice", event: "realtime-open", ...fields }) });
    realtime = registerRealtime(ctx, voiceHost, unified);
    const unpublish = publishRealtimeUpgrade((req, socket, head) => unified.upgrade(req, socket, head));
    return () => { unpublish(); realtime.dispose(); unified.close(); };
  });
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler: voiceHandler }),
    "lares-composer-voice-routes",
  );
  ctx.inject(["systemPrompt"], (promptCtx) => {
    promptCtx.systemPrompt.section({ name: "app:spoken-reply", order: 9800, text: (assembly) => voiceSessionPrompt(assembly.scope?.id) ? SPOKEN_PROMPT : "" });
  });
}
