import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceAgentSession } from "@olares/lares-core/voice/agent-session";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness() {
  const frames: any[] = [];
  let wake: (() => void) | null = null;
  let created = 0;
  let prompted = 0;
  let cancelled = 0;
  let fail = false;
  const api = {
    create: async () => { created++; return { sessionId: "voice-session" }; },
    async *follow(_request: unknown, signal: AbortSignal) {
      yield { type: "snapshot", records: [{ event: { seq: 0, type: "assistant/message", data: { turn: 0, content: [{ type: "text", text: "history" }] } } }] };
      while (!signal.aborted) {
        if (frames.length) { yield frames.shift(); continue; }
        await new Promise<void>((resolve) => { wake = resolve; signal.addEventListener("abort", resolve, { once: true }); });
      }
    },
    prompt: async (_request: unknown, signal: AbortSignal) => { signal.throwIfAborted(); prompted++; if (fail) throw new Error("unknown outcome"); return { accepted: true }; },
    cancel: async () => { cancelled++; },
  };
  const session = createVoiceAgentSession(api);
  const event = (seq: number, type: string, data: any) => { frames.push({ type: "event", event: { seq, type, data } }); wake?.(); };
  return { session, event, created: () => created, prompted: () => prompted, cancelled: () => cancelled, fail: () => { fail = true; } };
}
test("voice creates lazily, subscribes first, and never reads history", async () => {
  const h = harness();
  await h.session.submit("  ", "empty"); assert.equal(h.created(), 0);
  await h.session.submit("task", "call");
  assert.equal(h.session.snapshot().utterance, null);
  assert.equal(h.session.snapshot().running, true);
  h.event(0.5, "turn/start", { turn: 1 });
  h.event(1, "user/message", { source: { kind: "user", rpcId: "call" } });
  h.event(2, "assistant/message", { turn: 1, content: [{ type: "text", text: "result" }] });
  h.event(3, "turn/end", { turn: 1, reason: { kind: "completed" } });
  await tick();
  assert.equal(h.session.snapshot().running, false);
  assert.equal(h.session.snapshot().utterance?.text, "result");
  await h.session.close();
});
test("a repeated call id cannot submit twice, including after an unknown outcome", async () => {
  const h = harness(); h.fail();
  await assert.rejects(h.session.submit("task", "call"));
  await assert.rejects(h.session.submit("task", "call"));
  assert.equal(h.prompted(), 1);
  await h.session.close();
});
test("disconnecting the voice observer does not cancel its dsh task", async () => {
  const h = harness(); await h.session.submit("task", "call");
  await h.session.close(); assert.equal(h.cancelled(), 0);
});
test("the cancel task action calls dsh explicitly", async () => {
  const h = harness(); await h.session.submit("task", "call");
  await h.session.cancel(); assert.equal(h.cancelled(), 1);
  await h.session.close();
});

test("a different client's turn cannot replace or complete an owned queued request", async () => {
  const h = harness();
  await h.session.submit("ours", "own");
  h.event(1, "turn/start", { turn: 1 });
  h.event(2, "user/message", { source: { kind: "user", rpcId: "own" } });
  h.event(3, "assistant/message", { turn: 1, content: [{ type: "text", text: "ours" }] });
  h.event(4, "turn/end", { turn: 1, reason: { kind: "completed" } });
  await tick();
  await h.session.submit("next", "queued");
  h.event(5, "turn/start", { turn: 2 });
  h.event(6, "user/message", { source: { kind: "user", rpcId: "other-client" } });
  h.event(7, "assistant/message", { turn: 2, content: [{ type: "text", text: "private to other client" }] });
  h.event(8, "turn/end", { turn: 2, reason: { kind: "completed" } });
  await tick();
  assert.equal(h.session.snapshot().utterance, null);
  assert.equal(h.session.snapshot().running, true);
  h.event(9, "turn/start", { turn: 3 });
  h.event(10, "user/message", { source: { kind: "user", rpcId: "queued" } });
  h.event(11, "assistant/message", { turn: 3, content: [{ type: "text", text: "next result" }] });
  h.event(12, "turn/end", { turn: 3, reason: { kind: "completed" } });
  await tick();
  assert.equal(h.session.snapshot().utterance?.text, "next result");
  assert.equal(h.session.snapshot().running, false);
  await h.session.close();
});

test("queue and steer retain each request's result instead of overwriting pending", async () => {
  const h = harness();
  await h.session.submit("first", "one");
  await h.session.submit("queued", "two");
  h.event(1, "turn/start", { turn: 1 });
  h.event(2, "user/message", { source: { kind: "user", rpcId: "one" } });
  h.event(3, "assistant/message", { turn: 1, content: [{ type: "text", text: "first result" }] });
  h.event(4, "turn/end", { turn: 1, reason: { kind: "completed" } });
  await tick();
  assert.equal(h.session.snapshot().running, true);
  assert.equal(h.session.snapshot().tasks.find((t: any) => t.requestId === "one").status, "completed");
  h.event(5, "turn/start", { turn: 2 });
  h.event(6, "user/message", { source: { kind: "user", rpcId: "two" } });
  await h.session.submit("clarify", "steer", "steer");
  h.event(7, "user/message", { source: { kind: "user", rpcId: "steer" } });
  h.event(8, "assistant/message", { turn: 2, content: [{ type: "text", text: "combined answer" }] });
  h.event(9, "turn/end", { turn: 2, reason: { kind: "completed" } });
  await tick();
  const tasks = h.session.snapshot().tasks;
  assert.equal(tasks.find((t: any) => t.requestId === "one").text, "first result");
  assert.equal(tasks.find((t: any) => t.requestId === "two").text, "combined answer");
  assert.equal(tasks.find((t: any) => t.requestId === "steer").turn, 2);
  assert.equal(h.session.snapshot().running, false);
  await h.session.close();
});

test("withdraw removes a queued prompt from the dsh inbox and cancels only the running turn", async () => {
  const frames: any[] = [];
  let wake: (() => void) | null = null;
  const removed: any[] = [];
  let cancelled = 0;
  const api = {
    create: async () => ({ sessionId: "voice-session" }),
    async *follow(_request: unknown, signal: AbortSignal) {
      yield { type: "snapshot", records: [], projections: { asOfSeq: 0, values: { inbox: { "next-turn": [] } } } };
      while (!signal.aborted) {
        if (frames.length) { yield frames.shift(); continue; }
        await new Promise<void>((resolve) => { wake = resolve; signal.addEventListener("abort", resolve, { once: true }); });
      }
    },
    prompt: async () => ({ accepted: true }),
    cancel: async () => { cancelled++; },
    updateQueue: async (request: any) => { removed.push(request); return { accepted: true }; },
  };
  const session = createVoiceAgentSession(api);
  const event = (seq: number, type: string, data: any) => { frames.push({ type: "event", event: { seq, type, data } }); wake?.(); };
  await session.submit("first", "running-one");
  await session.submit("second", "queued-two");
  event(1, "turn/start", { turn: 1 });
  event(2, "user/message", { source: { kind: "user", rpcId: "running-one" } });
  event(3, "agent/inbox/spliced", { target: "next-turn", start: 0, removedCount: 0, inserted: [{ id: "inbox-2", source: { kind: "user", rpcId: "queued-two" } }] });
  await tick();
  assert.equal(await session.withdraw("queued-two"), "withdrawn");
  assert.deepEqual(removed, [{ sessionId: "voice-session", itemId: "inbox-2", action: { kind: "remove" } }]);
  assert.equal(session.snapshot().tasks.find((task: any) => task.requestId === "queued-two").status, "cancelled");
  assert.equal(cancelled, 0);
  assert.equal(await session.withdraw("running-one"), "cancelled");
  assert.equal(cancelled, 1);
  assert.equal(await session.withdraw("unknown"), "not_cancellable");
  await session.close();
});

test("a hand-off refused for an unavailable model moves the Session to default-chat and retries once", async () => {
  const selected: any[] = [], prompts: string[] = [], metrics: any[] = [];
  let refuse = 1;
  const api = {
    create: async () => ({ sessionId: "voice-session" }),
    async *follow(_request: unknown, signal: AbortSignal) { yield { type: "snapshot", records: [] }; await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })); },
    prompt: async (request: any) => {
      prompts.push(request.requestId);
      if (refuse-- > 0) throw Object.assign(new Error("model gone"), { code: "session/model-unavailable" });
      return { accepted: true };
    },
    selectModel: async (request: any) => { selected.push(request); return { selected: request }; },
    cancel: async () => {},
  };
  const session = createVoiceAgentSession(api, { fallbackModel: async () => "Olares/small", metric: (fields: any) => metrics.push(fields) });
  await session.submit("turn on the light", "call");
  assert.deepEqual(prompts, ["call", "call"]);
  assert.deepEqual(selected, [{ sessionId: "voice-session", provider: "olares-router", model: "Olares/small" }]);
  assert.ok(metrics.some((item) => item.stage === "agent_model_fallback" && item.model === "Olares/small"));
  await session.close();
});

test("other refusals, or no default-chat to move to, are not retried", async () => {
  for (const [code, fallback] of [["session/model-unavailable", null], ["session/agent-busy", "Olares/small"]] as const) {
    let prompts = 0, selects = 0;
    const api = {
      create: async () => ({ sessionId: "voice-session" }),
      async *follow(_request: unknown, signal: AbortSignal) { yield { type: "snapshot", records: [] }; await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })); },
      prompt: async () => { prompts++; throw Object.assign(new Error("refused"), { code }); },
      selectModel: async () => { selects++; },
      cancel: async () => {},
    };
    const session = createVoiceAgentSession(api, { fallbackModel: async () => fallback });
    await assert.rejects(session.submit("task", "call"), /refused/);
    assert.equal(prompts, 1);
    assert.equal(selects, 0);
    await session.close();
  }
});
