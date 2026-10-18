/** Explicit audition is independent of automatic read-aloud and business sessions. */
export async function previewTts({ model, voice, text, signal }, { fetcher = fetch, createAudio = url => new Audio(url) } = {}) {
  const response = await fetcher("/llm/v1/audio/speech", {
    method: "POST", headers: { "content-type": "application/json" }, signal,
    body: JSON.stringify({ model, input: text, response_format: "wav", ...(voice ? { voice } : {}) }),
  });
  if (!response.ok) throw new Error("tts_preview_failed");
  const blob = await response.blob(); signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  try {
    await new Promise((resolve, reject) => {
      const audio = createAudio(url);
      let done = false;
      const finish = error => {
        if (done) return; done = true;
        audio.pause(); audio.removeAttribute?.("src"); audio.load?.();
        signal.removeEventListener("abort", cancelled);
        error ? reject(error) : resolve();
      };
      const cancelled = () => finish(signal.reason);
      audio.addEventListener("ended", () => finish(), { once: true });
      audio.addEventListener("error", () => finish(new Error("tts_preview_failed")), { once: true });
      signal.addEventListener("abort", cancelled, { once: true });
      if (signal.aborted) cancelled(); else Promise.resolve(audio.play()).catch(finish);
    });
  } finally { URL.revokeObjectURL(url); }
}
