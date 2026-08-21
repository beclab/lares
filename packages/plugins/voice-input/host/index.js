/**
 * Voice-input Host routes under /api/lares/voice (STT via /llm/v1 shim; see stt.js).
 */
import { createRouteHandler, readBody, readJsonObject, sendJson } from "../../shared/host/http.js";
import { readConfig, validateConfigPatch, writeConfig } from "./config.js";
import { VoiceError, listModels, pickSttModelId, resolveSttModel, sttModelIds, transcribe } from "./stt.js";

export const name = "lares-voice-input";
export const inject = ["webServer"];

const ROUTE_PREFIX = "/api/lares/voice";

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
  const selected = pickSttModelId(models, readConfig().model);
  sendJson(res, 200, { models: ids, stt, selected });
}

async function handleGetConfig(_req, res) {
  sendJson(res, 200, readConfig());
}

async function handleSetConfig(req, res) {
  const body = await readJsonObject(req);
  const patch = validateConfigPatch(body);
  if (patch.model) {
    const available = sttModelIds(await listModels());
    if (!available.includes(patch.model)) {
      throw new VoiceError("voice_model_unavailable", 400, "selected voice model is not available");
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
  const requestedLanguage = url.searchParams.get("language");
  const language = requestedLanguage === null
    ? config.language || undefined
    : validateConfigPatch({ language: requestedLanguage }).language || undefined;
  const contentType = req.headers["content-type"] || "audio/webm";
  const bytes = await readBody(req, {
    maxBytes: 25 * 1024 * 1024,
    code: "voice_audio_too_large",
    message: "audio exceeds 25MB",
  });
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

const handler = createRouteHandler({
  prefix: ROUTE_PREFIX,
  routes: ROUTES,
  fallbackCode: "voice_failed",
});

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }),
    "lares-voice-input-routes",
  );
}
