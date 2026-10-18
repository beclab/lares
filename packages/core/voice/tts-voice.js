/** A legacy voice belongs only to the model for which it was explicitly saved. */
export function ttsVoiceForModel(config, model) {
  if (Object.hasOwn(config.ttsVoiceByModel || {}, model)) return config.ttsVoiceByModel[model] || undefined;
  return config.ttsModel === model ? config.voice || undefined : undefined;
}

export async function fetchTtsVoices(model, { signal, fetcher = fetch } = {}) {
  const res = await fetcher(`/llm/v1/audio/voices?model=${encodeURIComponent(model)}`, { signal: signal ?? AbortSignal.timeout(10000) });
  const body = await res.json().catch(() => null);
  if ((res.status === 404 && /no preset voices/i.test(String(body?.detail || body?.error?.message || ""))) || res.status === 405 || res.status === 501) return [];
  if (!res.ok) throw new Error("tts_voices_failed");
  if (!Array.isArray(body?.voices)) throw new Error("tts_voices_failed");
  const seen = new Set();
  return body.voices.flatMap(row => {
    const id = typeof row === "string" ? row : row?.id;
    if (typeof id !== "string" || !id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, label: typeof row?.name === "string" && row.name.trim() ? row.name : id }];
  });
}
