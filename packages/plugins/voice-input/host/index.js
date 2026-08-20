/**
 * Voice-input Host routes under /api/dina/voice (STT via /llm/v1 shim; see stt.js).
 */
import { readConfig, writeConfig } from "./config.js";
import { VoiceError, listModels, pickSttModelId, resolveSttModel, sttModelIds, transcribe } from "./stt.js";

export const name = "dina-voice-input";
export const inject = ["webServer"];

const ROUTE_PREFIX = "/api/dina/voice";

/** MIME → filename extension for the STT decoder. */
const EXTENSIONS = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
};

/** @param {string} contentType */
function filenameFor(contentType) {
  const base = String(contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  return `voice.${EXTENSIONS[base] ?? "webm"}`;
}

/** @param {import('node:http').IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      // OpenAI-compatible upload ceiling.
      if (total > 25 * 1024 * 1024) {
        reject(new VoiceError("voice_audio_too_large", 413, "audio exceeds 25MB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendVoiceError(res, err) {
  if (err instanceof VoiceError) {
    sendJson(res, err.status >= 400 ? err.status : 502, { error: { code: err.code, message: err.message } });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  sendJson(res, 500, { error: { code: "voice_failed", message } });
}

async function handleStatus(_req, res) {
  const config = readConfig();
  let modelAvailable = false;
  let resolvedModel = config.model;
  try {
    const models = await listModels();
    resolvedModel = pickSttModelId(models, config.model) ?? "";
    modelAvailable = Boolean(resolvedModel);
  } catch {
    modelAvailable = false;
  }
  sendJson(res, 200, {
    ok: modelAvailable,
    model: resolvedModel,
    modelAvailable,
    language: config.language,
  });
}

async function handleModels(_req, res) {
  const models = await listModels();
  const ids = models.map((model) => model.id);
  const stt = sttModelIds(models);
  sendJson(res, 200, { models: ids, stt, selected: stt[0] ?? null });
}

async function handleGetConfig(_req, res) {
  sendJson(res, 200, readConfig());
}

async function handleSetConfig(req, res) {
  const raw = await readBody(req);
  let patch = {};
  if (raw.length > 0) {
    try {
      patch = JSON.parse(raw.toString("utf8"));
    } catch {
      sendJson(res, 400, { error: { code: "bad_request", message: "invalid JSON body" } });
      return;
    }
  }
  sendJson(res, 200, writeConfig(patch));
}

async function handleTranscribe(req, res) {
  const config = readConfig();
  const model = await resolveSttModel(config.model);
  if (!model) {
    throw new VoiceError(
      "voice_model_unavailable",
      503,
      "Router 目录暂无可用的语音模型",
    );
  }
  const url = new URL(req.url ?? "/", "http://x");
  const language = url.searchParams.get("language")?.trim() || config.language || undefined;
  const contentType = req.headers["content-type"] || "audio/webm";
  const bytes = await readBody(req);
  if (bytes.length === 0) throw new VoiceError("voice_audio_unreadable", 400, "audio content is empty");

  const text = await transcribe({
    bytes,
    filename: filenameFor(contentType),
    contentType,
    model,
    language,
    preferred: config.model,
  });
  sendJson(res, 200, { text });
}

/** @type {Record<string, Record<string, (req, res) => Promise<void>>>} */
const ROUTES = {
  "/status": { GET: handleStatus },
  "/models": { GET: handleModels },
  "/config": { GET: handleGetConfig, POST: handleSetConfig },
  "/transcribe": { POST: handleTranscribe },
};

function route(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  const path = new URL(req.url ?? "/", "http://x").pathname.slice(ROUTE_PREFIX.length) || "/";
  const handlers = ROUTES[path.replace(/\/+$/, "") || "/"];
  if (!handlers) {
    sendJson(res, 404, { error: { code: "not_found", message: `no voice route ${path}` } });
    return;
  }
  const handler = handlers[method];
  if (!handler) {
    sendJson(res, 405, { error: { code: "method_not_allowed", message: `${method} not allowed` } });
    return;
  }
  Promise.resolve(handler(req, res)).catch((err) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendVoiceError(res, err);
  });
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler: route }),
    "dina-voice-input-routes",
  );
}
