/**
 * How far ahead of playout a reply may be sent, and the socket buffer that
 * means the client has stopped reading. Both gates share this so a dropped
 * progress tick cannot freeze one path while the other keeps going.
 *
 * The client's queue holds about four seconds. This lead stays inside that
 * queue: a chunk past the lead is still under the cap.
 */
export const PLAYOUT_LEAD_MS = 2_000;
export const SOCKET_FUSE_BYTES = 1024 * 1024;

/**
 * Credit for one reply. The playhead moves at 1x and stops when it catches
 * the audio already handed to the client. A gap while the next sentence is
 * synthesized does not pre-pay a burst, and a missing progress tick does not
 * hold the rest: time keeps the playhead moving up to what was sent. Pause
 * freezes it.
 */
export function createPlayoutClock({ leadMs = PLAYOUT_LEAD_MS, now = Date.now } = {}) {
  let heard = 0, heldAt = 0, playhead = 0, markedAt = 0, sent = 0;
  const stamp = () => heldAt || now();
  const advance = (sentMs) => {
    if (Number.isFinite(sentMs) && sentMs > sent) sent = sentMs;
    const t = stamp();
    if (!markedAt) { markedAt = t; return; }
    playhead = Math.min(sent, playhead + Math.max(0, t - markedAt));
    markedAt = t;
  };
  return {
    heard(ms) { if (Number.isFinite(ms) && ms > heard) heard = ms; },
    pause() {
      if (heldAt) return;
      advance(sent);
      heldAt = now();
    },
    resume() {
      if (!heldAt) return;
      heldAt = 0;
      markedAt = now();
    },
    get paused() { return heldAt !== 0; },
    start() { if (!markedAt) markedAt = now(); },
    credit(sentMs) {
      advance(sentMs);
      return Math.max(heard, playhead);
    },
    blocked(sentMs) { return sentMs - this.credit(sentMs) > leadMs; },
    wait(sentMs) {
      const delay = sentMs - leadMs - this.credit(sentMs);
      return delay > 0 ? delay : 0;
    },
  };
}
