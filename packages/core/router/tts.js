import { speechInput } from "../voice/tts-input.js";
import { fetchTtsVoices } from "../voice/tts-voice.js";
import { VoiceError } from "./stt.js";
import { routerShimBaseUrl } from "./gateway.js";

const REQUEST_TIMEOUT_MS = 180_000;

const PCM_RATE = 24000;

/** audio/L16 carries its clock in the media type. A custom header only fills that in. */
export function declaredPcmRate(contentType, headerValue) {
  const match = /(?:^|[;\s])rate\s*=\s*(\d+)/i.exec(String(contentType || ""));
  const fromType = match ? Number(match[1]) : NaN;
  const fromHeader = Number(headerValue);
  const usable = (rate) => Number.isInteger(rate) && rate >= 8000 && rate <= 192000;
  if (usable(fromType)) return fromType;
  if (usable(fromHeader)) return fromHeader;
  return null;
}

/** @returns {Promise<string[]>} Exact preset IDs; failures remain distinguishable from no presets. */
export async function listTtsVoices(model) {
  const voices = await fetchTtsVoices(model, { fetcher: (path, options) => fetch(`${routerShimBaseUrl()}${path.replace("/llm/v1", "")}`, options) });
  return voices.map(row => row.id);
}

/** Kokoro concatenates chunks with no gap. This is the silence we insert between sentences. */
export function silencePcm(ms, sampleRate = PCM_RATE) {
  const samples = Math.max(0, Math.round((sampleRate * ms) / 1000));
  return Buffer.alloc(samples * 2);
}

/** Wrap 24 kHz mono s16le in a WAV header for a browser that has no host speaker. */
export function pcmToWav(pcm, sampleRate = PCM_RATE) {
  const body = Buffer.from(pcm);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + body.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

/**
 * @param {{ text: string, model: string }} request
 * @returns {Promise<Buffer>}
 */
export async function synthesize(request) {
  const spoken = request.text.trim();
  if (!spoken) throw new VoiceError("voice_config_invalid", 400, "nothing to speak");
  const text = speechInput(request.model, spoken);
  let res;
  try {
    res = await fetch(`${routerShimBaseUrl()}/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "audio/wav,application/octet-stream" },
      body: JSON.stringify({
        model: request.model,
        input: text,
        response_format: "wav",
        ...(request.voice ? { voice: request.voice } : {}),
      }),
      signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new VoiceError(
      timedOut ? "voice_timeout" : "voice_failed",
      timedOut ? 504 : 502,
      timedOut ? "speech timed out" : `router unreachable: ${err?.message ?? err}`,
    );
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    throw new VoiceError(res.status === 404 ? "voice_tts_unavailable" : "voice_failed", res.status, detail);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * How long a streamed request may go without its first audio before it is abandoned for a whole
 * one. Qwen3-TTS (audio engines v1.1.31) yields its first chunk in about 0.24 s; an engine whose
 * streaming generator does not yield would otherwise hold the request until it times out.
 */
export const STREAM_FIRST_AUDIO_MS = 3_000;

/**
 * Deliver each PCM sentence as Kokoro yields it.
 * A non-stream response comes back as `{ streamed: false, audio }` instead.
 * `stream: true` asks the engine to yield while it synthesizes, so playback starts at its first
 * chunk instead of after the whole sentence; with no audio within STREAM_FIRST_AUDIO_MS the
 * sentence is requested whole instead.
 *
 * @param {{ text: string, model: string, voice?: string, signal?: AbortSignal, headers?: Record<string, string>, stream?: boolean, firstAudioMs?: number }} request
 * @param {(chunk: Buffer) => Promise<void> | void} onChunk
 */
export async function synthesizeStream(request, onChunk) {
  if (request.stream) {
    try {
      return await speak(request, onChunk, { stream: true, firstAudioMs: request.firstAudioMs ?? STREAM_FIRST_AUDIO_MS });
    } catch (err) {
      if (!err?.firstAudioMissed || request.signal?.aborted) throw err;
    }
  }
  return speak(request, onChunk, { stream: false });
}

async function speak(request, onChunk, { stream, firstAudioMs }) {
  const spoken = request.text.trim();
  if (!spoken) throw new VoiceError("voice_config_invalid", 400, "nothing to speak");
  const text = speechInput(request.model, spoken);
  // Abandons a stream that has not started; once audio flows it may take as long as it needs.
  const silence = new AbortController();
  const waiting = stream ? setTimeout(() => silence.abort(), firstAudioMs) : null;
  const missed = () => Object.assign(new VoiceError("voice_timeout", 504, "speech stream sent no audio"), { firstAudioMissed: true });
  let res;
  try {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = AbortSignal.any([timeout, silence.signal, ...(request.signal ? [request.signal] : [])]);
    // A complete PCM body unless the caller asked for a stream; see synthesizeStream.
    res = await fetch(`${routerShimBaseUrl()}/audio/speech`, {
      method: "POST",
      headers: { ...request.headers, "content-type": "application/json", accept: "audio/l16,audio/wav" },
      body: JSON.stringify({
        model: request.model,
        input: text,
        response_format: "pcm",
        ...(request.voice ? { voice: request.voice } : {}),
        ...(stream ? { stream: true } : {}),
      }),
      signal,
    });
  } catch (err) {
    clearTimeout(waiting);
    if (silence.signal.aborted && !request.signal?.aborted) throw missed();
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new VoiceError(
      timedOut ? "voice_timeout" : "voice_failed",
      timedOut ? 504 : 502,
      timedOut ? "speech timed out" : `router unreachable: ${err?.message ?? err}`,
    );
  }
  if (!res.ok) {
    clearTimeout(waiting);
    const detail = (await res.text()).slice(0, 400);
    throw new VoiceError(res.status === 404 ? "voice_tts_unavailable" : "voice_failed", res.status, detail);
  }
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("audio/l16")) {
    clearTimeout(waiting);
    return { streamed: false, audio: Buffer.from(await res.arrayBuffer()) };
  }
  const sampleRate = declaredPcmRate(type, res.headers.get("x-audio-sample-rate"));
  if (sampleRate === null) { clearTimeout(waiting); throw new VoiceError("voice_audio_format", 502, "missing or invalid PCM sample rate"); }
  await request.onFormat?.({ sampleRate, channels: 1, encoding: "pcm_s16le" });
  const reader = res.body.getReader();
  let bytes = 0;
  try {
  while (true) {
    let next;
    try { next = await reader.read(); }
    catch (err) { if (!bytes && silence.signal.aborted && !request.signal?.aborted) throw missed(); throw err; }
    const { done, value } = next;
    if (done) break;
    if (value?.byteLength) { if (!bytes) clearTimeout(waiting); bytes += value.byteLength; await onChunk(Buffer.from(value)); }
  }
  } finally {
    clearTimeout(waiting);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!bytes) throw new VoiceError("voice_audio_format", 502, "speech returned no audio");
  return { streamed: true, sampleRate };
}
