import assert from "node:assert/strict";
import test from "node:test";
import { voicePanelPosition } from "../../packages/web/composer-voice/src/client/floating.js";
import { voicePanelPresentation } from "@olares/lares-core/voice/presentation";
const viewport = { width: 1000, height: 800 };
test("desktop panel prefers above the trigger and stays inside the viewport", () => {
  assert.deepEqual(voicePanelPosition({ anchor: { top: 700, bottom: 744, right: 900 }, width: 400, height: 320, viewport }), { left: 500, top: 368 });
  const edge = voicePanelPosition({ anchor: { top: 700, bottom: 744, right: 80 }, width: 400, height: 320, viewport });
  assert.equal(edge.left, 12); assert.ok(edge.top >= 12);
});
test("panel flips below when above cannot fit, with a stable fallback if its anchor unmounts", () => {
  assert.deepEqual(voicePanelPosition({ anchor: { top: 20, bottom: 64, right: 900 }, width: 400, height: 320, viewport }), { left: 500, top: 76 });
  assert.deepEqual(voicePanelPosition({ anchor: null, width: 400, height: 320, viewport }), { left: 300, top: 468 });
});
test("narrow layout uses the bottom of the visual viewport, including keyboard offsets", () => {
  assert.deepEqual(voicePanelPosition({ anchor: null, width: 390, height: 280, viewport: { left: 0, top: 30, width: 390, height: 400 } }), { left: 0, top: 150 });
});
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
