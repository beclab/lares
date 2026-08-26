/**
 * Voice-input Host routes under /api/lares/voice (STT via /llm/v1 shim).
 */
import { createRouteHandler, readBody, readJsonObject, sendJson } from "@lares/core/tools/http";
import { readConfig } from "@lares/core/voice/config";
import {
  STT_MAX_AUDIO_BYTES,
  saveVoiceConfig,
  transcribeFromHttp,
  voiceModelsPayload,
  voiceStatusPayload,
} from "@lares/core/voice/service";

export const name = "lares-composer-voice";
export const inject = ["webServer"];

const ROUTE_PREFIX = "/api/lares/voice";

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

async function handleTranscribe(req, res) {
  const url = new URL(req.url ?? "/", "http://x");
  const bytes = await readBody(req, {
    maxBytes: STT_MAX_AUDIO_BYTES,
    code: "voice_audio_too_large",
    message: "audio exceeds 25MB",
  });
  sendJson(res, 200, await transcribeFromHttp({
    languageParam: url.searchParams.get("language"),
    contentType: req.headers["content-type"] || "audio/webm",
    bytes,
  }));
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
    "lares-composer-voice-routes",
  );
}
