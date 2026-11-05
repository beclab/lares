/** Longest take a device's room can hold open before Router's VAD decides it. */
export const DEVICE_TAKE_MS = 10_000;

/**
 * How a realtime session listens, decided from what its client does (docs/realtime-protocol.md,
 * "Listening modes"). Each rule belongs to exactly one mode, so neither path changes the other.
 *
 * - push-to-talk: the client ends each take itself (Lares phone: release; desktop: tap again).
 *   Half duplex, gated by the client's playback reports.
 * - hands-free: server_vad from a client that reports playback (Lares headset, continuous).
 *   Half duplex unless LARES_VOICE_BARGE_IN turns on its suspend-and-resolve barge-in.
 * - device: server_vad from a client that sends no playback reports, such as a robot that hears
 *   its room all the time. Full duplex: speech during a reply is confirmed by Router's VAD and only
 *   then interrupts it. A device that says it cannot cancel its own echo stays half duplex instead,
 *   because its reply would interrupt itself.
 */
export function listeningPolicy({ automatic, acknowledges, headset, echoCancellation, bargeIn }) {
  const device = automatic && !acknowledges && !headset;
  const confirmedBargeIn = device && echoCancellation;
  return Object.freeze({
    mode: device ? "device" : automatic ? "hands-free" : "push-to-talk",
    confirmedBargeIn,
    // A client that never reports playback, with no way to tell its own echo from the user.
    muteWhilePlaying: !acknowledges && !headset && !confirmedBargeIn && !bargeIn,
    vadVeto: device,
    takeLimitMs: device ? DEVICE_TAKE_MS : null,
    suspendBargeIn: automatic && bargeIn,
    bargeIn: confirmedBargeIn || bargeIn,
  });
}
