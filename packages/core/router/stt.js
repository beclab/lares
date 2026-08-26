import { randomBytes } from "node:crypto";
import { createInFlightCoalescer } from "../tools/async.js";
import { routerCatalogRows } from "./catalog.js";
import { routerShimBaseUrl } from "./gateway.js";

const STT_HINTS = /whisper|\bstt\b|\basr\b|transcri/i;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const UNDECODABLE_HINTS = [
  "end of file",
  "format not recognised",
  "format not recognized",
  "invalid data found",
  "moov atom not found",
  "unknown file extension",
  "failed to load audio",
];

export class VoiceError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function sttModelIds(models) {
  return models
    .filter((model) => model.mode === "audio" && STT_HINTS.test(model.id))
    .map((model) => model.id);
}

export function pickSttModelId(models, preferred) {
  const stt = sttModelIds(models);
  const want = (preferred ?? "").trim();
  if (want && stt.includes(want)) return want;
  return stt[0] ?? null;
}

export function classifyFailure(status, body) {
  const lowered = body.toLowerCase();
  if (UNDECODABLE_HINTS.some((hint) => lowered.includes(hint))) return "voice_audio_unreadable";
  if (status === 400 || status === 415 || status === 422) return "voice_audio_unreadable";
  if (status === 404) return "voice_model_unavailable";
  return "voice_failed";
}

export function retryable(status) {
  return RETRYABLE_STATUS.has(status);
}

export const STT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const AUDIO_EXTENSIONS = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
};

export function audioFilenameForContentType(contentType) {
  const base = String(contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  return `voice.${AUDIO_EXTENSIONS[base] ?? "webm"}`;
}

const REQUEST_TIMEOUT_MS = 180_000;
const CATALOG_TIMEOUT_MS = 15_000;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const RESOLVED_TTL_MS = 120_000;

const coalesceCatalog = createInFlightCoalescer();
/** @type {{ expires: number, rows: { id: string, mode: string | null }[] } | null} */
let catalog = null;

async function fetchCatalog() {
  const res = await fetch(`${routerShimBaseUrl()}/models`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  });
  if (!res.ok) throw new VoiceError("voice_model_unavailable", 503, `Router /models returned ${res.status}`);
  const rows = routerCatalogRows(await res.json()).map(({ id, mode }) => ({ id, mode }));
  catalog = { expires: Date.now() + RESOLVED_TTL_MS, rows };
  return rows;
}

/** @returns {Promise<{ id: string, mode: string | null }[]>} */
export async function listModels(options) {
  if (!options?.refresh && catalog && catalog.expires > Date.now()) return catalog.rows;
  if (options?.refresh) return fetchCatalog();
  return coalesceCatalog(fetchCatalog);
}

/** @returns {Promise<string[]>} */
export async function listModelIds() {
  return (await listModels()).map((model) => model.id);
}

/** @type {{ expires: number, id: string, preferred: string } | null} */
let resolved = null;

/** Cached STT model id (short TTL). @param {string} [preferred] */
export async function resolveSttModel(preferred, options) {
  const want = (preferred ?? "").trim();
  if (
    !options?.refresh
    && resolved
    && resolved.expires > Date.now()
    && resolved.preferred === want
  ) {
    return resolved.id;
  }
  const id = pickSttModelId(await listModels(options), want);
  resolved = id ? { expires: Date.now() + RESOLVED_TTL_MS, id, preferred: want } : null;
  return id;
}

export function forgetSttModel() {
  resolved = null;
  catalog = null;
}

/** @param {Record<string, string>} fields @param {{ filename: string, contentType: string, bytes: Buffer }} file */
function multipartBody(fields, file) {
  const boundary = `----lares-voice-${randomBytes(12).toString("hex")}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n`
      + `Content-Type: ${file.contentType}\r\n\r\n`,
    ),
  );
  parts.push(file.bytes);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
}

/** @param {Response} res */
async function readTranscript(res) {
  const text = await res.text();
  try {
    const payload = JSON.parse(text);
    if (payload && typeof payload === "object" && payload.text != null) return String(payload.text).trim();
    if (typeof payload === "string") return payload.trim();
  } catch {
    if (text.trim()) return text.trim();
  }
  throw new VoiceError("voice_failed", 502, "invalid transcription response");
}

/**
 * @param {{ bytes: Buffer, filename: string, contentType: string, model: string, language?: string, prompt?: string, preferred?: string }} take
 * @returns {Promise<string>}
 */
export async function transcribe(take) {
  let model = take.model;
  for (let attempt = 0; ; attempt += 1) {
    const fields = { model };
    if (take.language) fields.language = take.language;
    if (take.prompt) fields.prompt = take.prompt;
    const { boundary, body } = multipartBody(fields, {
      filename: take.filename,
      contentType: take.contentType,
      bytes: take.bytes,
    });

    /** @type {VoiceError} */
    let failure;
    try {
      const res = await fetch(`${routerShimBaseUrl()}/audio/transcriptions`, {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return await readTranscript(res);
      const text = await res.text();
      failure = new VoiceError(classifyFailure(res.status, text), res.status, text.slice(0, 400));
      if (!retryable(res.status)) throw failure;
    } catch (err) {
      if (err instanceof VoiceError) throw err;
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
      failure = timedOut
        ? new VoiceError("voice_timeout", 504, "transcription timed out")
        : new VoiceError("voice_failed", 502, `router unreachable: ${err?.message ?? err}`);
    }

    if (attempt >= RETRY_BACKOFF_MS.length) throw failure;
    await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS[attempt]));
    const refreshed = await resolveSttModel(take.preferred, { refresh: true }).catch(() => null);
    if (refreshed) model = refreshed;
  }
}
