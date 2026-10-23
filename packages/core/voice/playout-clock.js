/**
 * How far ahead of playout a reply may be sent, and the socket buffer that
 * means the client has stopped reading. Both gates share this so a dropped
 * progress tick cannot freeze one path while the other keeps going.
 *
 * The player holds about four seconds. While reports are still arriving, the
 * wall clock may lead the speaker by one send-ahead and no further: a long
 * reply is not already played just because time passed. A report that stops
 * falls back to the wall clock, so one missed tick does not end the reply.
 */
export const PLAYOUT_LEAD_MS = 2_000;
export const SOCKET_FUSE_BYTES = 1024 * 1024;

/**
 * Credit for one reply. The playhead moves at 1x and stops when it catches
 * the audio already handed to the client. A gap while the next sentence is
 * synthesized does not pre-pay a burst. Pause freezes the clock.
 */
export function createPlayoutClock({ leadMs = PLAYOUT_LEAD_MS, now = Date.now } = {}) {
  let heard = 0, heardAt = 0, heldAt = 0, playhead = 0, markedAt = 0, sent = 0;
  const stamp = () => heldAt || now();
  const advance = (sentMs) => {
    if (Number.isFinite(sentMs) && sentMs > sent) sent = sentMs;
    const t = stamp();
    if (!markedAt) { markedAt = t; return; }
    playhead = Math.min(sent, playhead + Math.max(0, t - markedAt));
    markedAt = t;
  };
  return {
    heard(ms) { if (Number.isFinite(ms) && ms > heard) { heard = ms; heardAt = stamp(); } },
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
      const wall = Math.max(heard, playhead);
      if (heardAt && stamp() - heardAt <= leadMs) return Math.min(wall, heard + leadMs);
      return wall;
    },
    blocked(sentMs) { return sentMs - this.credit(sentMs) > leadMs; },
    wait(sentMs) {
      const delay = sentMs - leadMs - this.credit(sentMs);
      return delay > 0 ? delay : 0;
    },
  };
}
