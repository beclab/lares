import assert from "node:assert/strict";
import test from "node:test";
import { listeningPolicy } from "@olares/lares-core/voice/listening";

const policy = (over: any) => listeningPolicy({ automatic: false, acknowledges: true, headset: false, echoCancellation: true, bargeIn: false, ...over });

test("each listening mode gets only its own rules", () => {
  // Lares phone and desktop: the user ends the take; half duplex behind playback reports.
  const ptt = policy({});
  assert.deepEqual([ptt.mode, ptt.confirmedBargeIn, ptt.muteWhilePlaying, ptt.vadVeto, ptt.takeLimitMs, ptt.bargeIn], ["push-to-talk", false, false, false, null, false]);
  // Lares headset, continuous: server_vad with playback reports; barge-in only when Lares enables it.
  assert.deepEqual([policy({ automatic: true, headset: true }).mode, policy({ automatic: true, headset: true }).bargeIn], ["hands-free", false]);
  assert.equal(policy({ automatic: true, headset: true, bargeIn: true }).suspendBargeIn, true);
  // A robot: server_vad without playback reports; full duplex, confirmed by VAD.
  const device = policy({ automatic: true, acknowledges: false });
  assert.deepEqual([device.mode, device.confirmedBargeIn, device.muteWhilePlaying, device.vadVeto, device.takeLimitMs, device.bargeIn], ["device", true, false, true, 10_000, true]);
  // A device that cannot cancel its own echo waits its reply out.
  const echo = policy({ automatic: true, acknowledges: false, echoCancellation: false });
  assert.deepEqual([echo.confirmedBargeIn, echo.muteWhilePlaying], [false, true]);
  // A client without playback reports that commits takes itself keeps the half-duplex mute.
  assert.equal(policy({ acknowledges: false }).muteWhilePlaying, true);
});
