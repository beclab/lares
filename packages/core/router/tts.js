import { fetchTtsVoices } from "../voice/tts-voice.js";
import { VoiceError } from "./stt.js";
import { routerShimBaseUrl } from "./gateway.js";

const REQUEST_TIMEOUT_MS = 180_000;

const PCM_RATE = 24000;

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
  const text = request.text.trim();
  if (!text) throw new VoiceError("voice_config_invalid", 400, "nothing to speak");
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
 * Deliver each PCM sentence as Kokoro yields it.
 * A non-stream response comes back as `{ streamed: false, audio }` instead.
 *
 * @param {{ text: string, model: string, signal?: AbortSignal }} request
 * @param {(chunk: Buffer) => Promise<void> | void} onChunk
 */
export async function synthesizeStream(request, onChunk) {
  const text = request.text.trim();
  if (!text) throw new VoiceError("voice_config_invalid", 400, "nothing to speak");
  let res;
  try {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeout])
      : timeout;
    // A complete PCM body. The Qwen speech engine's streaming generator does not
    // yield, so `stream: true` holds the model slot until the client times out
    // and the readout never leaves "preparing".
    res = await fetch(`${routerShimBaseUrl()}/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "audio/l16,audio/wav" },
      body: JSON.stringify({
        model: request.model,
        input: text,
        response_format: "pcm",
        ...(request.voice ? { voice: request.voice } : {}),
      }),
      signal,
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
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("audio/l16")) {
    return { streamed: false, audio: Buffer.from(await res.arrayBuffer()) };
  }
  const sampleRate = Number(res.headers.get("x-audio-sample-rate"));
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new VoiceError("voice_audio_format", 502, "missing or invalid PCM sample rate");
  await request.onFormat?.({ sampleRate, channels: 1, encoding: "pcm_s16le" });
  const reader = res.body.getReader();
  let bytes = 0;
  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.byteLength) { bytes += value.byteLength; await onChunk(Buffer.from(value)); }
  }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!bytes) throw new VoiceError("voice_audio_format", 502, "speech returned no audio");
  return { streamed: true, sampleRate };
}
