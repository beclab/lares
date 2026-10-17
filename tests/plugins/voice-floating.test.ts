import assert from "node:assert/strict";
import test from "node:test";
import { voicePanelPresentation } from "@olares/lares-core/voice/presentation";
test("timer and level updates do not change the live status and cancel overrides preparation", () => {
  const view = { mode: "continuous", holding: true, snapshot: { capture: "recording", inputReady: true, playback: "idle" } };
  assert.equal(voicePanelPresentation(view).phase, "recording");
  assert.equal(voicePanelPresentation({ ...view, elapsedMs: 500, levels: [.1] }).status, voicePanelPresentation(view).status);
  assert.equal(voicePanelPresentation({ ...view, busy: true, cancelArmed: true }).status, "gesture.cancelRelease");
  assert.equal(voicePanelPresentation({ ...view, snapshot: { ...view.snapshot, inputReady: false } }).phase, "preparing");
  assert.equal(voicePanelPresentation({ mode: "single", stage: "processing" }).pending, true);
});

test("inline labels retain a stable primary action while recording, cancelling and working", async () => {
  const { voiceInputPresentation } = await import("@olares/lares-core/voice/presentation");
  const base = { mode: "continuous", levels: [], holding: true, elapsedMs: 4000, snapshot: { capture: "recording", inputReady: true, playback: "idle" } };
  assert.equal(voiceInputPresentation(base).label, "gesture.release");
  assert.equal(voiceInputPresentation(base).elapsed, "0:04");
  assert.equal(voiceInputPresentation({ ...base, cancelArmed: true }).label, "gesture.cancelRelease");
  const working = voiceInputPresentation({ ...base, holding: false, snapshot: { capture: "idle", playback: "idle", agent: "running" } });
  assert.equal(working.label, "dictation.hold"); assert.equal(working.status, "call.working"); assert.equal(working.disabled, false);
});
