import { VoiceError } from "../router/stt.js";
import { reduceUtterance } from "./speech.js";
import { createSpeechSegmenter } from "./script.js";

const STATUS = { voice_reply_invalid: 400, voice_reply_forbidden: 403 };
const fault = code => new VoiceError(code, STATUS[code] ?? 409, code);
const identity = source => JSON.stringify([source.sessionId, source.turn, source.step]);

/**
 * Trusted Agent text only; a client supplies an address, never the words.
 * Read-while-writing releases each closed sentence as it arrives. Reading the
 * finished answer waits until that text has settled. A tool call ends either readout.
 */
export function createReplyStreamRegistry({ inspect, owner, now = Date.now, segmenterFactory = () => createSpeechSegmenter({ now }), streaming = () => false } = {}) {
  const rows = new Map();
  const notify = row => { row.version = (row.version || 0) + 1; for (const wake of row.listeners) wake(); };
  const fail = (row, code) => { row.segmenter.reset(); row.ready = []; row.error = code; row.done = true; row.at = now(); notify(row); };
  const advance = row => {
    if (!row.subscribers || row.error || streaming() !== true && !row.done) return;
    try { row.ready.push(...row.segmenter.update(row.utterance?.text || "", { done: row.done })); }
    catch (error) { fail(row, error.message === "voice_reply_rewritten" ? error.message : "voice_reply_invalid"); }
  };
  return {
    frame(sessionId, frame) {
      if (frame.type === "start") {
        const key = identity({ sessionId, turn: frame.turn, step: frame.step });
        const previous = rows.get(key);
        if (previous) fail(previous, "voice_reply_replaced");
        for (const [id, row] of rows) {
          if (!row.done && now() - row.at > 180000) fail(row, "voice_reply_timeout");
          if (row.done && now() - row.at > 30000) rows.delete(id);
        }
        if (rows.size >= 128) return;
        rows.set(key, { sessionId, turn: frame.turn, step: frame.step, attemptId: frame.attemptId,
          segmenter: segmenterFactory(), ready: [], utterance: null, next: 0, done: false, error: null, at: now(), listeners: new Set(), subscribers: 0 });
        return;
      }
      for (const row of rows.values()) {
        if (row.sessionId !== sessionId || row.attemptId !== frame.attemptId || row.done) continue;
        if (frame.type === "chunk") {
          if (frame.index < row.next) return;
          if (frame.index !== row.next++) { fail(row, "voice_reply_sequence"); return; }
          row.utterance = reduceUtterance(row.utterance, { type: "assistant/chunk", data: { turn: row.turn, step: row.step, attemptId: row.attemptId, chunkIndex: frame.index, chunk: frame.chunk } });
          if (row.utterance?.silent) fail(row, "voice_reply_untrusted");
          else if ((row.utterance?.text.length || 0) > 8192) fail(row, "voice_text_limit");
          if (!row.error) advance(row);
          notify(row);
        } else if (frame.type === "end" && !row.done) fail(row, "voice_reply_unsettled");
      }
    },
    event(sessionId, event) {
      for (const row of rows.values()) {
        if (row.sessionId !== sessionId || row.done) continue;
        if (event.type === "turn/end" && event.data?.turn === row.turn) { fail(row, "voice_reply_unsettled"); continue; }
        if (event.type !== "assistant/message" || event.data?.turn !== row.turn || event.data?.step !== row.step) continue;
        row.utterance = reduceUtterance(row.utterance, event);
        if (row.utterance.text.length > 8192) { fail(row, "voice_text_limit"); continue; }
        if (row.utterance.silent) fail(row, "voice_reply_untrusted");
        else { row.done = true; row.at = now(); advance(row); notify(row); }
      }
    },
    async bind(scope, source) {
      if (!source || typeof source.sessionId !== "string" || source.sessionId.length > 256 || !Number.isSafeInteger(source.turn) || !Number.isSafeInteger(source.step)) throw fault("voice_reply_invalid");
      if (owner && scope.owner !== owner()) throw fault("voice_reply_forbidden");
      await inspect(source.sessionId);
      const row = rows.get(identity(source));
      if (!row || source.attemptId && source.attemptId !== row.attemptId) throw fault("voice_reply_unavailable");
      return async function* segments(signal) {
        let index = 0;
        row.subscribers += 1;
        advance(row);
        try {
          while (!signal.aborted) {
            if (row.error) throw fault(row.error);
            const version = row.version;
            row.ready.push(...row.segmenter.flush());
            while (index < row.ready.length) {
              if (signal.aborted || row.error) throw fault(row.error || "voice_cancelled");
              yield { text: row.ready[index], index: index++, attemptId: row.attemptId };
            }
            if (row.done && version === row.version) return;
            if (version !== row.version) continue;
            await new Promise((resolve, reject) => {
              const deadline = row.segmenter.deadline;
              const wait = deadline === null ? 30000 : Math.max(0, Math.min(30000, deadline - now()));
              const cleanup = () => { clearTimeout(timer); row.listeners.delete(wake); signal.removeEventListener("abort", wake); };
              const wake = () => { cleanup(); resolve(); };
              const timer = setTimeout(() => { cleanup(); deadline === null ? reject(fault("voice_reply_timeout")) : resolve(); }, wait);
              row.listeners.add(wake); signal.addEventListener("abort", wake, { once: true });
              if (signal.aborted) wake();
            });
          }
          throw fault("voice_cancelled");
        } finally {
          row.subscribers -= 1;
        }
      };
    },
    /** Ends this answer for every subscriber. A later turn is a different row. */
    cancel(source) {
      if (!source || typeof source.sessionId !== "string") return;
      const row = rows.get(identity(source));
      if (!row || row.done) return;
      fail(row, "voice_cancelled");
    },
    remove(sessionId) { for (const [key, row] of rows) if (row.sessionId === sessionId) { fail(row, "voice_session_closed"); rows.delete(key); } },
    close() { for (const row of rows.values()) fail(row, "voice_session_closed"); rows.clear(); },
  };
}
