import { reduceUtterance } from "./speech.js";
import { speechSegments } from "./script.js";

const fault = code => Object.assign(new Error(code), { code });
const identity = source => JSON.stringify([source.sessionId, source.turn, source.step]);

/** Only trusted Agent events may authorize live text; client input supplies an address, never text. */
export function createReplyStreamRegistry({ inspect, owner, now = Date.now } = {}) {
  const rows = new Map();
  const notify = row => { row.version = (row.version || 0) + 1; for (const wake of row.listeners) wake(); };
  const fail = (row, code) => { row.error = code; row.done = true; row.at = now(); notify(row); };
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
          eligible: frame.speechEligible === true, utterance: null, next: 0, done: false, error: null, at: now(), listeners: new Set() });
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
        else { row.done = true; row.at = now(); notify(row); }
      }
    },
    async bind(scope, source) {
      if (!source || typeof source.sessionId !== "string" || source.sessionId.length > 256 || !Number.isSafeInteger(source.turn) || !Number.isSafeInteger(source.step)) throw fault("voice_reply_invalid");
      if (owner && scope.owner !== owner()) throw fault("voice_reply_forbidden");
      await inspect(source.sessionId);
      const row = rows.get(identity(source));
      if (!row || source.attemptId && source.attemptId !== row.attemptId) throw fault("voice_reply_unavailable");
      if (row.claimed) throw fault("voice_output_owned");
      row.claimed = true;
      return async function* segments(signal) {
        let emitted = [];
        while (!signal.aborted) {
          if (row.error) throw fault(row.error);
          const version = row.version;
          const ready = row.eligible || row.done ? speechSegments(row.utterance?.text || "", { done: row.done }) : [];
          if (emitted.some((text, index) => ready[index] !== text)) throw fault("voice_reply_rewritten");
          for (let index = emitted.length; index < ready.length; index++) {
            if (signal.aborted) throw fault("voice_cancelled");
            yield { text: ready[index], index, attemptId: row.attemptId };
          }
          emitted = ready;
          if (row.done && version === row.version) return;
          if (version !== row.version) continue;
          await new Promise((resolve, reject) => {
            const wake = () => { clearTimeout(timer); row.listeners.delete(wake); signal.removeEventListener("abort", wake); resolve(); };
            const timer = setTimeout(() => { wake(); reject(fault("voice_reply_timeout")); }, 30000);
            row.listeners.add(wake); signal.addEventListener("abort", wake, { once: true });
            if (signal.aborted) wake();
          });
        }
        throw fault("voice_cancelled");
      };
    },
    remove(sessionId) { for (const [key, row] of rows) if (row.sessionId === sessionId) { fail(row, "voice_session_closed"); rows.delete(key); } },
    close() { for (const row of rows.values()) fail(row, "voice_session_closed"); rows.clear(); },
  };
}
