import assert from "node:assert/strict";
import test from "node:test";
import { createSentencePlayer, readoutState } from "../../packages/core/voice/speech.js";
import { playAudioStream, startTranscriptionStream } from "../../packages/core/voice/stream-client.js";
import { voiceCallFailure, voiceIndicatorPresentation, voiceInputPresentation, voicePanelPresentation } from "../../packages/core/voice/presentation.js";
import { createVoiceConversation } from "../../packages/core/voice/conversation.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve: (value?: unknown) => void, reject: (error?: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fakeSocket() {
  const socket = new EventTarget() as EventTarget & { readyState: number, binaryType: string, send: () => void, close: () => void };
  socket.readyState = 1;
  socket.binaryType = "";
  socket.send = () => {};
  socket.close = () => {
    if (socket.readyState === 3) return;
    socket.readyState = 3;
    socket.dispatchEvent(new Event("close"));
  };
  return socket;
}

const ticket = async () => ({ ok: true, body: { supported: true, ticket: "t" } });

async function panelHarness({ speak = false, device = "", startGate = null as null | ReturnType<typeof deferred> } = {}) {
  const { createVoicePanel } = await import("../../packages/core/voice/panel.js");
  const { createVoiceController } = await import("../../packages/core/voice/controller.js");
  const calls: any[] = [];
  const panel = createVoicePanel({
    complete: async () => assert.fail("no draft insertion"),
    loadConfig: async () => ({ speak }),
    create: async ({ onDevice }: any) => {
      if (device) onDevice(device);
      const changes: any[] = [];
      const controller = createVoiceController({
        input: { capture: () => new Promise(() => {}), cancel() {} },
        agent: { cancel: () => assert.fail("no task cancellation"), running: async () => false },
        output: { stop() {} },
      });
      const conversation = {
        controller, changes,
        start: async (value) => { await startGate?.promise; return controller.start({ ...value, manual: true }); },
        pause: () => controller.pause(),
        resume: (value) => controller.resume(value),
        stop: () => controller.disconnect(),
        setReadAloud(value) { const pending = deferred(); changes.push({ value, ...pending }); return pending.promise; },
      };
      calls.push(conversation);
      return conversation;
    },
  });
  await panel.open({ mode: "continuous", sessionId: "one" });
  const started = panel.start();
  if (!startGate) await started;
  return { panel, calls, started };
}

test("a muted continuous call does not ask the server to change output", async () => {
  const paths: string[] = [];
  const call = createVoiceConversation({
    readAloud: false,
    input: { capture: () => new Promise(() => {}), cancel() {} },
    playback: { stop() {} },
    request: async (path) => { paths.push(path); return { ok: true, body: { active: true, version: 1, running: false, sessionId: "s" } }; },
  });
  try {
    await call.start({ continuous: true, manual: true });
    await call.setReadAloud(false);
    assert.equal(paths.some((path) => path.endsWith("/session/output")), false);
    assert.equal(call.controller.getSnapshot().outputMuted, true);
  } finally { await call.stop(); }
});

test("repeating mute does not post output again", async () => {
  const output: boolean[] = [];
  const call = createVoiceConversation({
    readAloud: false,
    input: { capture: () => new Promise(() => {}), cancel() {} },
    playback: { stop() {} },
    request: async (path, options) => {
      if (path.endsWith("/session/output")) output.push(options.body.readAloud);
      return { ok: true, body: { active: true, version: 1, running: false } };
    },
  });
  try {
    await call.start({ continuous: true, manual: true });
    await call.setReadAloud(false);
    await call.setReadAloud(false);
    assert.deepEqual(output, []);
  } finally { await call.stop(); }
});

test("a failed mute ack does not raise the readout banner on a phone", async () => {
  const { panel, calls } = await panelHarness();
  try {
    const muted = panel.setReadAloud(false);
    assert.equal(await muted, true);
    assert.equal(calls[0].changes.length, 0);
    const enabled = panel.setReadAloud(true);
    await flush();
    calls[0].changes[0].reject(Object.assign(new Error("voice_output_failed"), { code: "voice_output_failed" }));
    assert.equal(await enabled, false);
    assert.equal(panel.getSnapshot().readAloudError, "voice_output_failed");
    const again = panel.setReadAloud(false);
    await flush();
    assert.equal(panel.getSnapshot().readAloudError, null);
    calls[0].changes[1].reject(new Error("voice_output_failed"));
    assert.equal(await again, true);
    assert.equal(panel.getSnapshot().readAloudError, null);
    assert.equal(calls[0].changes[1].value, false);
  } finally { await panel.dispose(); }
});

test("turning readout on still reports a failed sync and stays muted", async () => {
  const { panel, calls } = await panelHarness();
  try {
    const enabled = panel.setReadAloud(true);
    await flush();
    calls[0].changes[0].reject(new Error("voice_output_failed"));
    assert.equal(await enabled, false);
    assert.equal(panel.getSnapshot().readAloudError, "voice_output_failed");
    const retry = panel.retryReadAloud();
    await flush();
    calls[0].changes[1].resolve();
    assert.equal(await retry, true);
    assert.equal(panel.getSnapshot().readAloudError, null);
  } finally { await panel.dispose(); }
});

test("a late enable failure cannot put the banner back after the user mutes", async () => {
  const { panel, calls } = await panelHarness();
  try {
    const enabled = panel.setReadAloud(true);
    await flush();
    const muted = panel.setReadAloud(false);
    await flush();
    calls[0].changes[0].reject(new Error("late"));
    calls[0].changes[1].reject(new Error("voice_output_failed"));
    await enabled; await muted;
    assert.equal(panel.getSnapshot().readAloudError, null);
  } finally { await panel.dispose(); }
});

test("leaving the voice screen drops the readout banner and ignores a late failure", async () => {
  const { panel, calls } = await panelHarness();
  try {
    const enabled = panel.setReadAloud(true);
    await flush();
    const closed = panel.close();
    calls[0].changes[0].reject(new Error("voice_output_failed"));
    await enabled;
    await closed;
    assert.equal(panel.getSnapshot().visible, false);
    assert.equal(panel.getSnapshot().readAloudError, null);
  } finally { await panel.dispose(); }
});

test("pausing while the call is still on screen keeps an enable failure", async () => {
  const { panel, calls } = await panelHarness();
  try {
    const enabled = panel.setReadAloud(true);
    await flush();
    calls[0].changes[0].reject(new Error("voice_output_failed"));
    assert.equal(await enabled, false);
    await panel.pause();
    assert.equal(panel.getSnapshot().visible, true);
    assert.equal(panel.getSnapshot().readAloudError, "voice_output_failed");
  } finally { await panel.dispose(); }
});

test("dictation never syncs readout and never raises the banner", async () => {
  const { createVoicePanel } = await import("../../packages/core/voice/panel.js");
  let created = 0;
  const panel = createVoicePanel({
    create: async () => { created += 1; throw new Error("no call"); },
    complete: async () => {},
    loadConfig: async () => ({ speak: true }),
  });
  try {
    assert.equal(await panel.setReadAloud(true), true);
    assert.equal(await panel.setReadAloud(false), true);
    assert.equal(created, 0);
    assert.equal(panel.getSnapshot().readAloudError, null);
    assert.equal(panel.getSnapshot().mode, "single");
  } finally { await panel.dispose(); }
});

test("a mute preference that arrives before the call is ready is not a sync", async () => {
  const gate = deferred();
  const { panel, calls, started } = await panelHarness({ startGate: gate });
  try {
    await flush();
    assert.equal(await panel.setReadAloud(false), true);
    assert.equal(calls[0].changes.length, 0);
    gate.resolve();
    await started;
    assert.equal(calls[0].changes.length, 0);
    assert.equal(panel.getSnapshot().readAloudError, null);
  } finally { await panel.dispose(); }
});

test("two enable clicks share one output request", async () => {
  const { panel, calls } = await panelHarness();
  try {
    const first = panel.setReadAloud(true);
    const second = panel.setReadAloud(true);
    assert.equal(first, second);
    await flush();
    assert.equal(calls[0].changes.length, 1);
    calls[0].changes[0].resolve();
    assert.equal(await first, true);
  } finally { await panel.dispose(); }
});

test("switching sessions forgets the previous readout failure", async () => {
  const { panel, calls } = await panelHarness();
  try {
    const enabled = panel.setReadAloud(true);
    await flush();
    calls[0].changes[0].reject(new Error("voice_output_failed"));
    assert.equal(await enabled, false);
    await panel.bind("two");
    await panel.open();
    await panel.start();
    assert.equal(panel.getSnapshot().sessionId, "two");
    assert.equal(panel.getSnapshot().readAloudError, null);
    assert.equal(calls.length, 2);
  } finally { await panel.dispose(); }
});

test("a headset mute failure stays visible because the host may keep playing", async () => {
  const { panel, calls } = await panelHarness({ device: "headset" });
  try {
    const enabled = panel.setReadAloud(true);
    await flush();
    calls[0].changes[0].resolve();
    await enabled;
    const muted = panel.setReadAloud(false);
    await flush();
    calls[0].changes[1].reject(Object.assign(new Error("voice_output_failed"), { code: "voice_output_failed" }));
    assert.equal(await muted, false);
    assert.equal(panel.getSnapshot().device, "headset");
    assert.equal(panel.getSnapshot().readAloudError, "voice_output_failed");
  } finally { await panel.dispose(); }
});

test("resuming a paused call reapplies silence without resurrecting the banner", async () => {
  const { panel, calls } = await panelHarness();
  try {
    const enabled = panel.setReadAloud(true);
    await flush();
    calls[0].changes[0].reject(new Error("voice_output_failed"));
    await enabled;
    await panel.close();
    assert.equal(panel.getSnapshot().readAloudError, null);
    await panel.setReadAloud(false);
    await panel.open({ mode: "continuous", sessionId: "one" });
    await panel.start();
    await flush();
    assert.equal(calls[0].changes.some((change) => change.value === false), false);
    assert.equal(panel.getSnapshot().readAloudError, null);
  } finally { await panel.dispose(); }
});

test("mute stops local audio before the server answers, and a failed ack stays silent", async () => {
  const stops: string[] = [];
  let fail = true;
  const call = createVoiceConversation({
    readAloud: true, device: "device",
    input: { capture: () => new Promise(() => {}), cancel() {} },
    playback: { stop() { stops.push("stop"); } },
    request: async (path) => {
      if (path.endsWith("/session/output") && fail) {
        assert.equal(stops.length, before + 1);
        return { ok: false, body: { error: { code: "voice_output_failed" } } };
      }
      return { ok: true, body: { active: true, version: 1, running: false } };
    },
  });
  let before = 0;
  try {
    await call.start({ continuous: true, manual: true });
    before = stops.length;
    await assert.rejects(call.setReadAloud(false), /voice_output_failed/);
    assert.equal(call.controller.getSnapshot().outputMuted, true);
  } finally { await call.stop(); }
});

test("enabling does not replay the reply already on screen, and mute drops the next one", async () => {
  let state: any = { active: true, version: 1, running: false, sessionId: "s", utterance: { key: "old", text: "old", done: true, turn: 1 } };
  const played: string[] = [];
  const call = createVoiceConversation({
    readAloud: false,
    input: { capture: () => new Promise(() => {}), cancel() {} },
    playback: { stop() {} },
    request: async (path) => ({ ok: true, body: path.endsWith("/session/output") ? { ok: true } : state }),
    onReply: (reply) => played.push(reply.text),
  });
  try {
    await call.start({ continuous: true, manual: true });
    await call.setReadAloud(true);
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.deepEqual(played, []);
    state = { ...state, version: 2, utterance: { key: "new", text: "new", done: true, turn: 2 } };
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.deepEqual(played, ["new"]);
    await call.setReadAloud(false);
    state = { ...state, version: 3, utterance: { key: "quiet", text: "quiet", done: true, turn: 3 } };
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.deepEqual(played, ["new"]);
  } finally { await call.stop(); }
});

test("a paused call does not speak a reply that arrives after pause", async () => {
  let state: any = { active: true, version: 1, running: false, sessionId: "s", utterance: null };
  const played: string[] = [];
  const call = createVoiceConversation({
    readAloud: true,
    input: { capture: () => new Promise(() => {}), cancel() {} },
    playback: { stop() {} },
    request: async () => ({ ok: true, body: state }),
    onReply: (reply) => played.push(reply.text),
  });
  try {
    await call.start({ continuous: true, manual: true });
    await call.pause();
    state = { ...state, version: 2, utterance: { key: "late", text: "late", done: true, turn: 1 } };
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.deepEqual(played, []);
  } finally { await call.stop(); }
});

test("output sync still posts when AbortSignal.any and timeout are missing", async () => {
  const saved = { any: AbortSignal.any, timeout: AbortSignal.timeout };
  const output: boolean[] = [];
  try {
    Object.defineProperty(AbortSignal, "any", { configurable: true, writable: true, value: undefined });
    Object.defineProperty(AbortSignal, "timeout", { configurable: true, writable: true, value: undefined });
    const call = createVoiceConversation({
      readAloud: false,
      input: { capture: () => new Promise(() => {}), cancel() {} },
      playback: { stop() {} },
      request: async (path, options) => {
        if (path.endsWith("/session/output")) output.push(options.body.readAloud);
        return { ok: true, body: { active: true, version: 1, running: false } };
      },
    });
    try {
      await call.start({ continuous: true, manual: true });
      await call.setReadAloud(true);
      assert.deepEqual(output, [true]);
      assert.equal(call.controller.getSnapshot().outputMuted, false);
    } finally { await call.stop(); }
  } finally {
    Object.defineProperty(AbortSignal, "any", { configurable: true, writable: true, value: saved.any });
    Object.defineProperty(AbortSignal, "timeout", { configurable: true, writable: true, value: saved.timeout });
  }
});

test("stopping playback is a cancellation, not a dropped listen connection", async () => {
  const controller = new AbortController();
  let socket: ReturnType<typeof fakeSocket>;
  const pending = playAudioStream({
    text: "你好",
    signal: controller.signal,
    request: ticket,
    socket: () => (socket = fakeSocket()),
  });
  await flush();
  controller.abort();
  socket.close();
  await assert.rejects(pending, (error: Error) => error.message === "voice_cancelled");
});

test("a socket that closes after done still finishes audio already accepted", async () => {
  let socket: ReturnType<typeof fakeSocket>;
  const pending = playAudioStream({ text: "我是一个可爱的小猫咪", request: ticket, socket: () => (socket = fakeSocket()) });
  await flush();
  socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "done" }) }));
  socket.close();
  assert.equal(await pending, true);
});

test("a socket that closes on its own is still voice_disconnected", async () => {
  let socket: ReturnType<typeof fakeSocket>;
  const pending = playAudioStream({ text: "你好", request: ticket, socket: () => (socket = fakeSocket()) });
  await flush();
  socket.close();
  await assert.rejects(pending, (error: Error) => error.message === "voice_disconnected");
});

test("an aborted transcription close is not voice_disconnected", async () => {
  const controller = new AbortController();
  let socket: ReturnType<typeof fakeSocket>;
  const pending = startTranscriptionStream({
    signal: controller.signal,
    request: ticket,
    socket: () => (socket = fakeSocket()),
  });
  await flush();
  controller.abort();
  socket.close();
  await assert.rejects(pending, (error: Error) => error.message === "voice_cancelled");
});

test("a transcription socket that dies before it is ready is voice_disconnected", async () => {
  let socket: ReturnType<typeof fakeSocket>;
  const pending = startTranscriptionStream({ request: ticket, socket: () => (socket = fakeSocket()) });
  await flush();
  socket.close();
  await assert.rejects(pending, (error: Error) => error.message === "voice_disconnected");
});

test("a dropped readout socket clears the badge instead of warning about voice settings", async () => {
  const failures: unknown[] = [];
  let reject: (error: Error) => void = () => {};
  const player = createSentencePlayer({
    stream: () => new Promise((_, no) => { reject = no; }),
    send: async () => ({ sentences: 1 }),
    play: async () => {},
    halt() {},
    silence() {},
    fail: (error) => failures.push(error),
  });
  player.follow({ key: "drop", text: "你好。", done: true, source: { sessionId: "s", turn: 1, step: 0 } });
  await flush();
  assert.equal(readoutState.getSnapshot()?.status, "preparing");
  reject(new Error("voice_disconnected"));
  await flush();
  assert.equal(readoutState.getSnapshot(), null);
  assert.deepEqual(failures, []);
});

test("a real playback failure still stays on the readout", async () => {
  const failures: unknown[] = [];
  let reject: (error: Error) => void = () => {};
  const player = createSentencePlayer({
    stream: () => new Promise((_, no) => { reject = no; }),
    send: async () => ({ sentences: 1 }),
    play: async () => {},
    halt() {},
    silence() {},
    fail: (error) => failures.push(error),
  });
  player.follow({ key: "lost", text: "你好。", done: true, source: { sessionId: "s", turn: 2, step: 0 } });
  await flush();
  reject(Object.assign(new Error("voice_device_lost"), { code: "voice_device_lost" }));
  await flush();
  assert.equal(readoutState.getSnapshot()?.status, "error");
  assert.equal(readoutState.getSnapshot()?.error, "voice_device_lost");
  assert.equal(failures.length, 1);
  readoutState.publish(null);
});

test("stopping the reader swallows a disconnect from the stream it just aborted", async () => {
  const failures: unknown[] = [];
  let reject: (error: Error) => void = () => {};
  const player = createSentencePlayer({
    stream: () => new Promise((_, no) => { reject = no; }),
    send: async () => ({ sentences: 1 }),
    play: async () => {},
    halt() {},
    silence() {},
    fail: (error) => failures.push(error),
  });
  player.follow({ key: "a", text: "你好。", done: true, source: { sessionId: "s", turn: 1, step: 0 } });
  await flush();
  player.stop();
  reject(new Error("voice_disconnected"));
  await flush();
  assert.deepEqual(failures, []);
});

test("a dropped continuous call stays quiet; hold is the way back", () => {
  for (const outputMuted of [true, false]) {
    const view = { visible: true, mode: "continuous", snapshot: { connection: "paused", outputMuted, error: "voice_disconnected", playback: "idle" } };
    const ui = voiceInputPresentation(view);
    assert.equal(ui.error, null);
    assert.equal(ui.label, "dictation.hold");
    assert.equal(voiceCallFailure(view), null);
    assert.equal(voiceIndicatorPresentation(view).visible, false);
    assert.equal(voiceIndicatorPresentation(view).error, null);
    assert.notEqual(ui.status, "error.voice_disconnected");
    assert.notEqual(ui.status, "error.voice_background");
  }
});

test("dictation still reports a dropped socket", () => {
  const view = { visible: true, mode: "single", snapshot: { connection: "paused", error: "voice_disconnected", playback: "idle" } };
  assert.equal(voicePanelPresentation(view).status, "error.voice_disconnected");
});

test("a muted dictation disconnect does not ask the user to resume listening", () => {
  const view = { visible: true, mode: "single", snapshot: { connection: "paused", outputMuted: true, error: "voice_disconnected", playback: "idle" } };
  assert.equal(voicePanelPresentation(view).error, "voice_background");
});

test("a paused device failure can still be resumed from one banner", () => {
  const view = { visible: true, mode: "continuous", snapshot: { connection: "paused", error: "voice_device_lost", playback: "idle" } };
  assert.deepEqual(voiceCallFailure(view), { code: "voice_device_lost", action: "resume" });
});

test("recovery and idle endings are quiet; hold stays the way back", () => {
  for (const error of ["voice_recovery_expired", "voice_idle_timeout"]) {
    const view = { visible: true, mode: "continuous", snapshot: { connection: "closed", error, playback: "idle" } };
    assert.equal(voiceCallFailure(view), null);
    assert.equal(voicePanelPresentation(view).error, null);
    assert.equal(voiceInputPresentation(view).label, "dictation.hold");
  }
});

test("a healthy call and a dictation error are not call-failure banners", () => {
  assert.equal(voiceCallFailure({ visible: true, mode: "continuous", snapshot: { connection: "open", playback: "playing" } }), null);
  assert.equal(voiceCallFailure({ visible: true, mode: "single", error: "voice_failed", snapshot: { connection: "paused" } }), null);
});

test("dispose drops an in-flight enable so it cannot fail a dead panel", async () => {
  const { panel, calls } = await panelHarness();
  const enabled = panel.setReadAloud(true);
  await flush();
  await panel.dispose();
  calls[0].changes[0].reject(new Error("voice_output_failed"));
  await enabled;
  assert.equal(panel.getSnapshot().readAloudError, null);
});

test("a poll failure while muted does not start readout", async () => {
  let polls = 0;
  const played: string[] = [];
  const call = createVoiceConversation({
    readAloud: false,
    input: { capture: () => new Promise(() => {}), cancel() {} },
    playback: { stop() {} },
    request: async (path) => {
      if (path.endsWith("/session") && polls++ > 0) return { ok: false, body: { error: { code: "voice_failed" } } };
      return { ok: true, body: { active: true, version: 1, running: false, sessionId: "s", utterance: { key: "x", text: "不应朗读", done: true, turn: 1 } } };
    },
    onReply: (reply) => played.push(reply.text),
  });
  try {
    await call.start({ continuous: true, manual: true });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.deepEqual(played, []);
    assert.equal(call.controller.getSnapshot().outputMuted, true);
    assert.equal(call.controller.getSnapshot().connection, "paused");
  } finally { await call.stop(); }
});
