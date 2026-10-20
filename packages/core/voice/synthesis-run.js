/** One answer is `sessionId + turn + step + attemptId`. Listeners share that id. */
export function utteranceKey(source) {
  if (!source || typeof source.sessionId !== "string" || !Number.isSafeInteger(source.turn) || !Number.isSafeInteger(source.step)) return "";
  return JSON.stringify([source.sessionId, source.turn, source.step, source.attemptId || ""]);
}

/**
 * Synthesizes each answer once and fans the PCM out.
 * Cancelling stops delivery immediately. The current response body is still
 * read to the end before the next request is allowed to start, so a cut-off
 * transfer cannot occupy the speech path for the following answer.
 */
export function createSynthesisRuns({ synthesize, metric = () => {} }) {
  const runs = new Map();
  let chain = Promise.resolve();
  const enqueue = (task) => {
    const next = chain.then(task, task);
    chain = next.then(() => {}, () => {});
    return next;
  };

  function start(key, open, request) {
    const subscribers = new Set();
    const events = [];
    const abort = new AbortController();
    let cancelled = false;
    let settled = false;
    let carry = null;
    const notify = () => { for (const listener of subscribers) listener(); };
    const push = (event) => { events.push(event); notify(); };
    const finished = (async () => {
      const segments = open(abort.signal);
      try {
        for await (const segment of segments) {
          if (cancelled) break;
          metric({ stage: "synthesis_segment", voiceId: request.voiceId, index: segment.index, chars: segment.text?.length || 0, at: Date.now() });
          push({ type: "segment", index: segment.index, attemptId: segment.attemptId });
          const result = await enqueue(async () => {
            if (cancelled) return { skipped: true };
            return synthesize({
              text: segment.text,
              model: request.model,
              voice: request.voice,
              onFormat(format) { push({ type: "format", format }); },
            }, async (chunk) => {
              if (cancelled || !chunk?.byteLength) return;
              let buf = Buffer.from(chunk);
              if (carry !== null) { buf = Buffer.concat([Buffer.from([carry]), buf]); carry = null; }
              if (buf.length % 2) { carry = buf[buf.length - 1]; buf = buf.subarray(0, -1); }
              if (!buf.length) return;
              push({ type: "audio", chunk: buf });
            });
          });
          if (cancelled || result?.skipped) break;
          if (carry !== null) throw Object.assign(new Error("voice_audio_format"), { code: "voice_audio_format" });
          push({ type: "segment.end", index: segment.index });
          if (!result.streamed) {
            push({ type: "file", audio: result.audio });
            break;
          }
        }
        push(cancelled ? { type: "cancelled" } : { type: "done" });
      } catch (err) {
        const code = err?.code || err?.message || "voice_failed";
        push(cancelled || code === "voice_cancelled" ? { type: "cancelled" } : { type: "error", code });
      } finally {
        settled = true;
        notify();
        await segments?.return?.().catch(() => {});
      }
    })();
    return {
      events,
      get settled() { return settled; },
      subscribe(listener) { subscribers.add(listener); listener(); return () => subscribers.delete(listener); },
      cancel() { if (cancelled || settled) return; cancelled = true; abort.abort(); notify(); },
      finished,
    };
  }

  return {
    /** `open` is used only for the first subscriber of `key`. */
    attach(key, open, request) {
      let run = runs.get(key);
      if (!run) {
        run = start(key, open, request);
        runs.set(key, run);
        run.finished.finally(() => { if (runs.get(key) === run) runs.delete(key); });
      }
      return run;
    },
    cancel(key) { if (key) runs.get(key)?.cancel(); },
    close() { for (const run of runs.values()) run.cancel(); runs.clear(); },
  };
}
