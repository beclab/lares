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
    prompt: async () => { prompted++; if (fail) throw new Error("unknown outcome"); return { accepted: true }; },
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
