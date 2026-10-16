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
