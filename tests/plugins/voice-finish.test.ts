import assert from "node:assert/strict";
import test from "node:test";
import { voiceIndicatorPresentation } from "../../packages/core/voice/presentation.js";
import { VOICE_DEFAULTS } from "../../packages/core/voice/options.js";
import { createVoiceConversation } from "../../packages/core/voice/conversation.js";

test("paused and ended voice hides the indicator even with a running task or late reply", () => {
  const view = { visible: true, mode: "continuous", busy: false, snapshot: { connection: "paused", agent: "running", playback: "idle" } };
  assert.deepEqual(voiceIndicatorPresentation(view), { visible: false, orb: false, ticking: false, error: null });
  for (const connection of ["paused", "closed"]) {
    assert.equal(voiceIndicatorPresentation({ ...view, snapshot: { ...view.snapshot, connection, playback: "playing" } }).visible, false);
  }
  assert.equal(voiceIndicatorPresentation({ ...view, snapshot: { ...view.snapshot, connection: "open" } }).orb, true);
  const failed = voiceIndicatorPresentation({ ...view, error: "offline" });
  assert.equal(failed.visible, true); assert.equal(failed.orb, false); assert.equal(failed.ticking, false);
});

test("only active dictation recording needs the UI timer", () => {
  const view = { visible: true, mode: "single", startedAt: 1, snapshot: { capture: "recording" } };
  assert.equal(voiceIndicatorPresentation(view).ticking, true);
  assert.equal(voiceIndicatorPresentation({ ...view, visible: false }).ticking, false);
});

test("Lares defaults to muted output; enabling never replays the current reply", async () => {
  assert.equal(VOICE_DEFAULTS.speak, false);
  let state: any = { active: true, version: 1, running: false, sessionId: "test", utterance: { key: "old", text: "old", done: true } };
  const played: string[] = [], paths: string[] = [];
  const call = createVoiceConversation({ readAloud: false,
    input: { capture: () => new Promise<string>(() => {}), cancel() {} }, playback: { stop() {} },
    request: async (path, options) => { paths.push(path); return { ok: true, body: state }; },
    onReply: (reply) => played.push(reply.text),
  });
  try {
    await call.start({ continuous: true, manual: true });
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.deepEqual(played, []);
    assert.equal(paths.some((path) => path.endsWith("/speak")), false);
    await call.setReadAloud(true);
    state = { ...state, version: 2 };
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.deepEqual(played, []);
    state = { ...state, version: 3, utterance: { key: "new", text: "new", done: true } };
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.deepEqual(played, ["new"]);
    await call.pause();
    state = { ...state, version: 4, utterance: { key: "late", text: "late", done: true } };
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.deepEqual(played, ["new"]);
  } finally { await call.stop(); }
});

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function syncHarness(startGate = null) {
  const { createVoicePanel } = await import("../../packages/core/voice/panel.js");
  const { createVoiceController } = await import("../../packages/core/voice/controller.js");
  const calls: any[] = [];
  const panel = createVoicePanel({ complete: async () => assert.fail("no draft insertion"),
    loadConfig: async () => ({ speak: false }),
    create: async () => {
      const changes: any[] = [];
      const controller = createVoiceController({ input: { capture: () => new Promise(() => {}), cancel() {} },
        agent: { cancel: () => assert.fail("no task cancellation") }, output: { stop() {} } });
      const conversation = { controller, changes, start: async value => { await startGate?.promise; return controller.start({ ...value, manual: true }); },
        pause: () => controller.pause(), resume: value => controller.resume(value), stop: () => controller.disconnect(),
        setReadAloud(value) { const pending = deferred(); changes.push({ value, ...pending }); return pending.promise; } };
      calls.push(conversation); return conversation;
    },
  });
  await panel.open({ mode: "continuous", sessionId: "one" });
  const started = panel.start();
  if (!startGate) await started;
  return { panel, calls, started };
}

test("read-aloud sync deduplicates notifications, reports failures and supports retry", async () => {
  const { panel, calls } = await syncHarness();
  try {
    await panel.setReadAloud(false);
    assert.equal(calls[0].changes.length, 0);
    const first = panel.setReadAloud(true), duplicate = panel.setReadAloud(true);
    assert.equal(first, duplicate);
    await flush();
    assert.equal(calls[0].changes.length, 1);
    calls[0].changes[0].reject(new Error("voice_output_failed"));
    assert.equal(await first, false);
    assert.equal(panel.getSnapshot().readAloudError, "voice_output_failed");
    const retry = panel.retryReadAloud(); await flush();
    calls[0].changes[1].resolve(); assert.equal(await retry, true);
    assert.equal(panel.getSnapshot().readAloudError, null);
    await panel.setReadAloud(true); assert.equal(calls[0].changes.length, 2);
  } finally { await panel.dispose(); }
});

test("old read-aloud completions cannot overwrite a newer preference or session", async () => {
  const { panel, calls } = await syncHarness();
  try {
    const old = panel.setReadAloud(true); await flush();
    const latest = panel.setReadAloud(false); await flush();
    calls[0].changes[1].resolve(); await latest;
    calls[0].changes[0].reject(new Error("late")); await old;
    assert.equal(panel.getSnapshot().readAloudError, null);
    const switched = panel.setReadAloud(true); await flush();
    await panel.bind("two"); await panel.open(); await panel.start();
    assert.equal(calls.length, 2);
    calls[0].changes[2].reject(new Error("old session")); await switched;
    assert.equal(panel.getSnapshot().readAloudError, null);
    assert.equal(panel.getSnapshot().sessionId, "two");
  } finally { await panel.dispose(); }
});

test("remote output changes are serialized; mute stops local audio before remote response", async () => {
  const output: any[] = [], stops: string[] = [];
  const call = createVoiceConversation({ readAloud: false, onTranscript() {},
    input: { capture: () => new Promise(() => {}), cancel() {} }, playback: { stop() { stops.push("stop"); } },
    request: async (path, options) => {
      if (path.endsWith("/session/output")) { const pending = deferred(); output.push({ value: options.body.readAloud, ...pending }); await pending.promise; }
      return { ok: true, body: {} };
    },
  });
  try {
    await call.start({ continuous: true, manual: true });
    await call.setReadAloud(false); assert.equal(output.length, 0);
    const stoppedBefore = stops.length;
    const enabled = call.setReadAloud(true); await flush(); assert.equal(output[0].value, true);
    const disabled = call.setReadAloud(false);
    assert.equal(stops.length, stoppedBefore + 1); assert.equal(call.controller.getSnapshot().outputMuted, true);
    await flush(); assert.equal(output.length, 1);
    output[0].resolve(); await enabled; await flush();
    assert.equal(output[1].value, false);
    output[1].resolve(); await disabled;
    await call.setReadAloud(false); assert.equal(output.length, 2); assert.equal(stops.length, stoppedBefore + 1);
  } finally { await call.stop(); }
});


test("failed output sync stays muted until explicit retry succeeds", async () => {
  let failed = true;
  const call = createVoiceConversation({ readAloud: false, onTranscript() {},
    input: { capture: () => new Promise(() => {}), cancel() {} }, playback: { stop() {} },
    request: async path => path.endsWith("/session/output") && failed
      ? { ok: false, body: { error: { code: "voice_output_failed" } } }
      : { ok: true, body: {} },
  });
  try {
    await call.start({ continuous: true, manual: true });
    await assert.rejects(call.setReadAloud(true), /voice_output_failed/);
    assert.equal(call.controller.getSnapshot().outputMuted, true);
    failed = false; await call.setReadAloud(true);
    assert.equal(call.controller.getSnapshot().outputMuted, false);
  } finally { await call.stop(); }
});


test("settings received during call startup apply only after the session is ready", async () => {
  const gate = deferred();
  const { panel, calls, started } = await syncHarness(gate);
  try {
    await flush();
    await panel.setReadAloud(true);
    assert.equal(calls[0].changes.length, 0);
    gate.resolve(); await flush();
    assert.equal(calls[0].changes.length, 1);
    assert.equal(calls[0].changes[0].value, true);
    calls[0].changes[0].resolve(); await started;
  } finally { await panel.dispose(); }
});
