import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceController } from "@olares/lares-core/voice/controller";
import { createDeviceLease } from "@olares/lares-core/voice/lease";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness() {
  let resolve: (text: string) => void = () => {};
  const submitted: any[] = [];
  let creates = 0;
  let cancelled = 0;
  let stopped = 0;
  const controller = createVoiceController({
    input: { capabilities: { bargeIn: false }, capture: () => new Promise<string>((r) => { resolve = r; }), cancel() {} },
    output: { stop() { stopped++; } },
    agent: { create: async () => { creates++; return "new"; }, submit: async (v: any) => { submitted.push(v); }, cancel() { cancelled++; }, running: async () => false },
  });
  return { controller, submitted, say: (text: string) => resolve(text), creates: () => creates, cancelled: () => cancelled, stopped: () => stopped };
}

test("late recognition cannot cross a session switch", async () => {
  const h = harness();
  await h.controller.start({ sessionId: "first" });
  const oldSay = h.say;
  await h.controller.disconnect();
  oldSay("late");
  await flush();
  assert.equal(h.submitted.length, 0);
});
test("only a valid first transcript creates a session; acceptance leaves the agent running", async () => {
  const h = harness();
  await h.controller.start();
  h.say("   "); await flush();
  assert.equal(h.creates(), 0);
  void h.controller.listen(); h.say("hello"); await flush();
  assert.equal(h.creates(), 1);
  assert.equal(h.submitted[0].sessionId, "new");
  assert.equal(h.controller.getSnapshot().agent, "running");
});
test("a manual hold is one take of the open call, so silence does not pause it", async () => {
  const seen: any[] = [];
  let resolve: (text: string) => void = () => {};
  const controller = createVoiceController({
    input: { capabilities: { bargeIn: false }, capture: (options: any) => { seen.push({ continuous: options.continuous, manual: options.manual }); return new Promise<string>((r) => { resolve = r; }); }, cancel() {}, stop() {} },
    output: { stop() {} },
    agent: { create: async () => "s", submit: async () => {}, cancel() {}, running: async () => false },
  });
  await controller.start({ continuous: true, manual: true });
  void controller.listen();
  await flush();
  assert.deepEqual(seen, [{ continuous: true, manual: true }]);
  resolve("");
  await flush();
  const snap = controller.getSnapshot();
  assert.equal(snap.connection, "open");
  assert.equal(snap.capture, "idle");
  assert.equal(snap.error, null);
});
test("stopping speech does not cancel an agent task", async () => {
  const h = harness();
  await h.controller.start({ sessionId: "bound" });
  h.say("work"); await flush();
  await h.controller.stopPlayback();
  assert.equal(h.cancelled(), 0);
  assert.equal(h.controller.getSnapshot().agent, "running");
  await h.controller.cancelTask(); assert.equal(h.cancelled(), 1);
});
test("a disconnect keeps the task and resume does not submit it again", async () => {
  const h = harness();
  await h.controller.start({ sessionId: "bound" });
  h.say("work"); await flush();
  await h.controller.disconnect("offline");
  assert.equal(h.controller.getSnapshot().sessionId, "bound");
  await h.controller.resume();
  assert.equal(h.submitted.length, 1);
  assert.equal(h.cancelled(), 0);
  await h.controller.disconnect();
});
test("device lease rejects a different owner until release or expiry", () => {
  let now = 0;
  const lease = createDeviceLease({ now: () => now, ttlMs: 100 });
  lease.acquire("first");
  assert.throws(() => lease.acquire("second"), /voice_device_busy/);
  lease.release("second");
  assert.equal(lease.owns("first"), true);
  now = 101; lease.acquire("second");
  lease.release("first"); assert.equal(lease.owns("second"), true);
});

test("concurrent starts cannot bind a capture to the losing session", async () => {
  const captures: string[] = [];
  let controller: any;
  controller = createVoiceController({
    input: { capture: () => { captures.push(controller.getSnapshot().sessionId); return new Promise(() => {}); }, cancel() {} },
    output: { stop: async () => { await flush(); } },
    agent: { create: async () => "new", submit: async () => {}, cancel: async () => {}, running: async () => false },
  });
  await Promise.all([controller.start({ sessionId: "first" }), controller.start({ sessionId: "second" })]);
  assert.deepEqual(captures, ["second"]);
  await controller.disconnect();
});

test("continuous listening keeps waiting through silence without creating a task", async () => {
  const h = harness();
  await h.controller.start({ continuous: true });
  h.say(""); await flush();
  assert.equal(h.creates(), 0);
  h.say("a valid task"); await flush();
  assert.equal(h.submitted.length, 1);
  await h.controller.disconnect();
});

test("idle expiry releases voice without cancelling business work", async () => {
  const scheduled = new Map<number, () => void>();
  let key = 0, cancelled = 0, expired = "";
  const controller = createVoiceController({
    input: { capture: () => new Promise(() => {}), cancel() {} }, output: { stop() {} },
    agent: { create: async () => "session", submit: async () => {}, running: async () => true, cancel() { cancelled++; } },
    schedule: (callback: () => void) => { scheduled.set(++key, callback); return key; }, unschedule: (id: number) => scheduled.delete(id),
    onExpired: (code: string) => { expired = code; },
  });
  await controller.start({ sessionId: "bound", continuous: true });
  const timeout = [...scheduled.values()][0]; timeout(); await flush();
  assert.equal(controller.getSnapshot().connection, "closed");
  assert.equal(controller.getSnapshot().sessionId, "bound");
  assert.equal(controller.getSnapshot().error, null);
  assert.equal(expired, "voice_idle_timeout"); assert.equal(cancelled, 0);
});

test("a recovery window ends by closing the call, without an error", async () => {
  const scheduled = new Map<number, () => void>();
  let key = 0, expired = "";
  const controller = createVoiceController({
    input: { capture: () => new Promise(() => {}), cancel() {} }, output: { stop() {} },
    agent: { create: async () => "session", submit: async () => {}, running: async () => false, cancel() {} },
    schedule: (callback: () => void) => { scheduled.set(++key, callback); return key; }, unschedule: (id: number) => scheduled.delete(id),
    onExpired: (code: string) => { expired = code; },
  });
  await controller.start({ sessionId: "bound", continuous: true });
  await controller.disconnect("voice_idle_timeout");
  assert.equal(controller.getSnapshot().connection, "paused");
  assert.equal(controller.getSnapshot().error, null);
  const timeout = [...scheduled.values()][0]; timeout(); await flush();
  assert.equal(expired, "voice_recovery_expired");
  assert.equal(controller.getSnapshot().connection, "closed");
  assert.equal(controller.getSnapshot().error, null);
});

test("a take dropped for transient contention keeps the call open", async () => {
  let failTake: (error: Error) => void = () => {};
  const controller = createVoiceController({
    input: { capabilities: { listenWhileWorking: true }, capture: () => new Promise<string>((_resolve, reject) => { failTake = reject; }), cancel() {}, stop() {} },
    output: { stop() {} },
    agent: { create: async () => "s", submit: async () => {}, cancel() {}, running: async () => false },
  });
  await controller.start({ continuous: true });
  await flush();
  assert.equal(controller.getSnapshot().capture, "recording");
  failTake(Object.assign(new Error("turn_busy"), { code: "turn_busy" }));
  await flush(); await flush();
  const snap = controller.getSnapshot();
  assert.equal(snap.connection, "open");
  assert.equal(snap.error, null);
  // The dropped take is replaced by the next listening one; the call never pauses.
  assert.equal(snap.capture, "recording");
});

test("a recognition failure on a continuous call drops the take and stays open", async () => {
  for (const code of ["voice_failed", "voice_device_lost"]) {
    let failTake: (error: Error) => void = () => {};
    const controller = createVoiceController({
      input: { capabilities: { listenWhileWorking: true }, capture: () => new Promise<string>((_resolve, reject) => { failTake = reject; }), cancel() {}, stop() {} },
      output: { stop() {} },
      agent: { create: async () => "s", submit: async () => {}, cancel() {}, running: async () => false },
    });
    await controller.start({ continuous: true, manual: true });
    void controller.listen();
    await flush();
    failTake(Object.assign(new Error(code), { code }));
    await flush(); await flush();
    const snap = controller.getSnapshot();
    assert.equal(snap.connection, "open", code);
    assert.equal(snap.error, null, code);
    assert.equal(snap.capture, "idle", code);
    await controller.disconnect();
  }
});

test("a recognition failure outside a call still pauses it", async () => {
  let failTake: (error: Error) => void = () => {};
  const controller = createVoiceController({
    input: { capture: () => new Promise<string>((_resolve, reject) => { failTake = reject; }), cancel() {}, stop() {} },
    output: { stop() {} },
    agent: { create: async () => "s", submit: async () => {}, cancel() {}, running: async () => false },
  });
  await controller.start();
  await flush();
  failTake(Object.assign(new Error("voice_failed"), { code: "voice_failed" }));
  await flush(); await flush();
  assert.equal(controller.getSnapshot().connection, "paused");
  assert.equal(controller.getSnapshot().error, "voice_failed");
  await controller.disconnect();
});

test("a hard take error still pauses the call", async () => {
  let failTake: (error: Error) => void = () => {};
  const controller = createVoiceController({
    input: { capabilities: { listenWhileWorking: true }, capture: () => new Promise<string>((_resolve, reject) => { failTake = reject; }), cancel() {}, stop() {} },
    output: { stop() {} },
    agent: { create: async () => "s", submit: async () => {}, cancel() {}, running: async () => false },
    recoveryTimeoutMs: 60_000,
  });
  await controller.start({ continuous: true });
  await flush();
  failTake(Object.assign(new Error("voice_permission_denied"), { code: "voice_permission_denied" }));
  await flush(); await flush();
  const snap = controller.getSnapshot();
  assert.equal(snap.connection, "paused");
  assert.equal(snap.error, "voice_permission_denied");
  await controller.disconnect();
});

test("rendered audio cancels a take that is still recording", async () => {
  let aborted = 0;
  const controller = createVoiceController({
    input: { capabilities: { listenWhileWorking: true }, capture: ({ signal }: any) => new Promise<string>((resolve) => { signal.addEventListener("abort", () => { aborted++; resolve(""); }, { once: true }); }), cancel() {}, stop() {} },
    output: { stop() {} },
    agent: { create: async () => "s", submit: async () => {}, cancel() {}, running: async () => false },
  });
  await controller.start({ continuous: true });
  await flush();
  assert.equal(controller.getSnapshot().capture, "recording");
  controller.observePlayback(true);
  await flush(); await flush();
  assert.ok(aborted >= 1);
  assert.equal(controller.getSnapshot().capture, "idle");
});

test("a playback failure stays visible until a reply renders, not until listening", async () => {
  const controller = createVoiceController({
    input: { capabilities: { listenWhileWorking: true }, capture: () => new Promise<string>(() => {}), cancel() {}, stop() {} },
    output: { stop() {} },
    agent: { create: async () => "s", submit: async () => {}, cancel() {}, running: async () => false },
  });
  await controller.start({ continuous: true });
  await flush();
  controller.notePlaybackError("voice_playback_failed");
  assert.equal(controller.getSnapshot().error, "voice_playback_failed");
  controller.observePlayback(false);
  await flush();
  assert.equal(controller.getSnapshot().error, "voice_playback_failed");
  controller.observePlayback(true);
  assert.equal(controller.getSnapshot().error, null);
  controller.observePlayback(false);
  await controller.disconnect();
});
