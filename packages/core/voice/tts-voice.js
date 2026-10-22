/** A legacy voice belongs only to the model for which it was explicitly saved. */
export function ttsVoiceForModel(config, model) {
  if (Object.hasOwn(config.ttsVoiceByModel || {}, model)) return config.ttsVoiceByModel[model] || undefined;
  return config.ttsModel === model ? config.voice || undefined : undefined;
}

// A cold or busy TTS engine answers 5xx until its model is ready. The directory
// is metadata, so a couple of short retries are enough and keep the settings
// usable instead of failing on the first probe.
const ATTEMPT_TIMEOUT_MS = 8_000;
const RETRY_DELAYS_MS = [500, 1_500];
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const stop = () => { cleanup(); reject(new Error("voice_voices_aborted")); };
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", stop); };
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
  });
}

function attemptSignal(signal) {
  const timeout = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) : null;
  if (signal && timeout && typeof AbortSignal.any === "function") {
    try { return AbortSignal.any([signal, timeout]); } catch { /* caller signal only */ }
  }
  return signal ?? timeout ?? undefined;
}

export async function fetchTtsVoices(model, { signal, fetcher = fetch, retryDelays = RETRY_DELAYS_MS } = {}) {
  const url = `/llm/v1/audio/voices?model=${encodeURIComponent(model)}`;
  const failure = new Error("tts_voices_failed");
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetcher(url, { signal: attemptSignal(signal) });
      const body = await res.json().catch(() => null);
      if ((res.status === 404 && /no preset voices/i.test(String(body?.detail || body?.error?.message || ""))) || res.status === 405 || res.status === 501) return [];
      if (!res.ok) {
        if (TRANSIENT_STATUS.has(res.status) && attempt < retryDelays.length && !signal?.aborted) {
          await delay(retryDelays[attempt], signal);
          continue;
        }
        throw failure;
      }
      if (!Array.isArray(body?.voices)) throw failure;
      const seen = new Set();
      return body.voices.flatMap(row => {
        const id = typeof row === "string" ? row : row?.id;
        if (typeof id !== "string" || !id || seen.has(id)) return [];
        seen.add(id);
        return [{ id, label: typeof row?.name === "string" && row.name.trim() ? row.name : id }];
      });
    } catch (error) {
      if (error === failure) throw failure;
      if (signal?.aborted || attempt >= retryDelays.length) throw failure;
      await delay(retryDelays[attempt], signal);
    }
  }
}
