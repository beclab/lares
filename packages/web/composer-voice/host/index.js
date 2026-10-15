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
  voiceStatusPayload,
} from "@olares/lares-core/voice/service";
import { bluetoothRequest, ensureBluetoothReady } from "@olares/lares-core/voice/link";
import { gpuAppAction, gpuModePayload, saveSlicePlan, switchReadingMode } from "@olares/lares-core/voice/gpu-mode";
import { writeReport } from "@olares/lares-core/log/report";

export const name = "lares-composer-voice";
export const inject = ["webServer"];

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

function wantsRefresh(req) {
  return new URL(req.url ?? "/", "http://x").searchParams.get("refresh") === "1";
}

async function handleStatus(req, res) {
  sendJson(res, 200, await voiceStatusPayload({ refresh: wantsRefresh(req) }));
}

async function handleModels(req, res) {
  sendJson(res, 200, await voiceModelsPayload({ refresh: wantsRefresh(req) }));
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
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  const part = Number.isInteger(body.part) ? body.part : undefined;
  const key = typeof body.key === "string" && body.key ? body.key : undefined;
  let spoken;
  try {
    spoken = await speakFromConfig(
      typeof body.text === "string" ? body.text : "",
      { signal: controller.signal, part, key, done: body.done === true },
    );
  } finally {
    res.off("close", abort);
  }
  if (key && part === undefined) {
    sendJson(res, 200, { sentences: spoken.sentences });
    return;
  }
  sendJson(res, 200, {
    bluetooth: spoken.bluetooth === "played" ? "played" : "skipped",
    audio: Buffer.from(spoken.audio).toString("base64"),
  });
}

async function handlePlaybackStop(_req, res) {
  await interruptSpeech();
  sendJson(res, 200, { stopped: true });
}

async function handleCaptureStart(_req, res) {
  sendJson(res, 200, await captureStart());
}

async function handleCaptureStop(_req, res) {
  sendJson(res, 200, captureStop(false));
}

async function handleCaptureCancel(_req, res) {
  sendJson(res, 200, captureStop(true));
}

async function handleCaptureStatus(_req, res) {
  sendJson(res, 200, captureStatus());
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
    head: bytes.subarray(0, 16).toString("hex"),
    ascii: bytes.subarray(0, 24).toString("utf8").replace(/[^\x20-\x7e]/g, "."),
  });
  try {
    const result = await transcribeFromHttp({
      languageParam: url.searchParams.get("language"),
      contentType,
      bytes,
    });
    writeReport({
      scope: "voice",
      event: "transcribe-ok",
      chars: String(result?.text ?? "").length,
      head: String(result?.text ?? "").slice(0, 40),
    });
    sendJson(res, 200, result);
  } catch (err) {
    writeReport({
      scope: "voice",
      event: "transcribe-fail",
      code: err?.code || "voice_failed",
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** @type {Record<string, Record<string, (req, res) => Promise<void>>>} */
const ROUTES = {
  "/status": { GET: handleStatus },
  "/models": { GET: handleModels },
  "/config": { GET: handleGetConfig, POST: handleSetConfig },
  "/install": { POST: handleInstall },
  "/gpu-mode": { GET: handleGetGpuMode, POST: handleSetGpuMode },
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
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler: voiceHandler }),
    "lares-composer-voice-routes",
  );
}
