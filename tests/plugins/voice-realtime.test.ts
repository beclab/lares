import assert from "node:assert/strict";
import test from "node:test";
import { createRealtimeDelegate, realtimeModelIds, validatedRealtimeModels } from "@olares/lares-core/voice/realtime";
import { createPcmResampler, pcmSamples } from "@olares/lares-core/voice/realtime-audio";

function delegate({ running = false, fails = false, timeoutMs = 100 } = {}) {
  let count = 0;
  const sent: any[] = [];
  let state: any = { sessionId: "bound", running, utterance: null };
  const agent = {
    snapshot: () => state,
    async submit(text: string) {
      count++; if (fails) throw new Error("unknown outcome");
      state = { sessionId: "bound", running: timeoutMs === 0, utterance: { text: `result: ${text}` } };
    },
  };
  const bridge = createRealtimeDelegate({ agent, send: (value: any) => sent.push(value), timeoutMs });
  const call = (id: string, args: any) => bridge.handle({ call_id: id, name: "ask_lares", arguments: JSON.stringify(args) });
  return { sent, call, count: () => count };
}
test("Realtime catalog is explicit and requires the model validation gate", () => {
  const models = [{ id: "voice", mode: "realtime" }, { id: "chat-realtime-name", mode: "chat" }];
  assert.deepEqual(realtimeModelIds(models), ["voice"]);
  assert.deepEqual(validatedRealtimeModels(models, {}), []);
  assert.deepEqual(validatedRealtimeModels(models, { LARES_VOICE_REALTIME_ENABLED: "1", LARES_VOICE_REALTIME_VALIDATED_MODELS: "voice,missing" }), ["voice"]);
});
test("a repeated provider call submits exactly once and returns its real result", async () => {
  const h = delegate();
  await Promise.all([h.call("same", { operation: "run", task: "hello" }), h.call("same", { operation: "run", task: "hello" })]);
  assert.equal(h.count(), 1);
  assert.equal(h.sent.filter((item) => item.type === "conversation.item.create").length, 1);
  assert.match(h.sent[0].item.output, /result: hello/);
});
test("Realtime cannot replace the Host session or add tool parameters", async () => {
  const h = delegate(); await h.call("bad", { operation: "run", task: "hello", sessionId: "victim" });
  assert.equal(h.count(), 0); assert.match(h.sent[0].item.output, /invalid_tool/);
});
test("checking pending tasks and a timed-out wait never resubmits", async () => {
  const h = delegate({ timeoutMs: 0 });
  await h.call("run", { operation: "run", task: "hello" });
  await h.call("status", { operation: "status" });
  assert.equal(h.count(), 1);
  assert.match(h.sent[0].item.output, /pending/);
  assert.match(h.sent[2].item.output, /pending/);
});
test("unknown task acceptance is retained, not retried", async () => {
  const h = delegate({ fails: true });
  await h.call("run", { operation: "run", task: "hello" });
  await h.call("run", { operation: "run", task: "hello" });
  assert.equal(h.count(), 1); assert.match(h.sent[0].item.output, /unknown/);
});
test("streaming PCM conversion preserves sample count across uneven frames", () => {
  const convert = createPcmResampler(44100);
  let count = 0;
  for (let i = 0; i < 441; i++) count += convert(new Float32Array(100).fill(0.5)).length / 2;
  assert.ok(Math.abs(count - 24000) <= 1);
  assert.throws(() => pcmSamples(new Uint8Array(3)), /voice_audio_format/);
  assert.throws(() => createPcmResampler(0), /voice_audio_format/);
});

test("background delegation returns pending promptly and reports its own durable result later", async () => {
  const signal = new AbortController();
  const sent: any[] = [], completed: any[] = [];
  let task: any;
  let wake: () => void = () => {};
  const bridge = createRealtimeDelegate({ background: true, signal: signal.signal,
    agent: { snapshot: () => ({ sessionId: "bound", running: task?.status === "running", tasks: task ? [task] : [] }),
      submit: async (_text: string, requestId: string) => { task = { requestId, status: "running", text: "" }; } },
    send: (event: any) => sent.push(event), onCompleted: (value: any) => completed.push(value),
    sleep: () => new Promise<void>((resolve) => { wake = resolve; }),
  });
  await bridge.handle({ call_id: "background", name: "ask_lares", arguments: JSON.stringify({ operation: "run", task: "slow lookup" }) });
  assert.equal(JSON.parse(sent[0].item.output).status, "pending");
  task = { ...task, status: "completed", text: "actual result" }; wake();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed[0].text, "actual result");
  signal.abort();
});
