import assert from "node:assert/strict";
import test from "node:test";
import { consumeMux } from "@lares/core/larepass/mux";
import { createChatRuntime, pinnedScroll, restoreScroll } from "@lares/core/larepass/runtime";

function sseFrame(payload) {
  return `data: ${JSON.stringify({
    type: "server-request",
    rpcId: "r1",
    method: payload.type,
    payload,
  })}\n\n`;
}

function mockClient({ events = [], sessionId = "s1" } = {}) {
  let probes = 0;
  let histories = 0;
  let muxes = 0;
  let encoder;
  let controller;
  const body = new ReadableStream({
    start(c) {
      controller = c;
      encoder = new TextEncoder();
    },
  });
  return {
    stats: () => ({ probes, histories, muxes }),
    push(payload) {
      controller.enqueue(encoder.encode(sseFrame(payload)));
    },
    close() {
      controller.close();
    },
    probe: async () => {
      probes += 1;
      return { status: "ok", http: 200 };
    },
    ensureSession: async () => ({ ok: true, value: { sessionId } }),
    rpc: async (method) => {
      if (method !== "session.history") throw new Error(method);
      histories += 1;
      return { ok: true, value: { events } };
    },
    prompt: async () => ({ ok: true, value: { accepted: true } }),
    openMux: async () => {
      muxes += 1;
      return { ok: true, http: 200, body };
    },
    consumeMux,
  };
}

test("start keeps the transcript and does not refetch on a second mount", async () => {
  const events = [
    { type: "user/message", seq: 1, data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
  ];
  const client = mockClient({ events });
  const runtime = createChatRuntime(client);
  await runtime.start();
  await runtime.start();
  assert.equal(client.stats().probes, 1);
  assert.equal(client.stats().histories, 1);
  assert.equal(client.stats().muxes, 1);
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "hi" }]);
  assert.equal(runtime.snapshot().phase, "live");
  runtime.dispose();
  client.close();
});

test("subscribe restores the current snapshot before any network", () => {
  const client = mockClient();
  const runtime = createChatRuntime(client);
  let last = null;
  const unsub = runtime.subscribe((snap) => {
    last = snap;
  });
  assert.equal(last.sessionId, "");
  assert.deepEqual(last.messages, []);
  assert.deepEqual(last.items, []);
  unsub();
});

test("mux token deltas reach subscribers without waiting for history", async () => {
  const client = mockClient();
  const runtime = createChatRuntime(client);
  const snaps = [];
  runtime.subscribe((snap) => snaps.push(snap));
  await runtime.start();
  client.push({
    type: "session/event",
    sessionId: "s1",
    event: { type: "turn/start", seq: 1, data: { turn: 1 } },
  });
  client.push({
    type: "session/event",
    sessionId: "s1",
    event: {
      type: "assistant/chunk",
      seq: 2,
      data: { chunk: { type: "text-delta", text: "he" } },
    },
  });
  let last;
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    last = snaps.at(-1);
    if (last?.messages?.[0]?.text === "he") break;
  }
  assert.equal(last.running, true);
  assert.deepEqual(last.messages, [{ role: "assistant", text: "he", pending: true }]);
  runtime.dispose();
  client.close();
});

test("scroll pin follows the bottom until the user scrolls up", () => {
  assert.deepEqual(pinnedScroll(952, 1000, 100), { top: 952, stick: true });
  assert.deepEqual(pinnedScroll(100, 1000, 100), { top: 100, stick: false });
  assert.equal(restoreScroll({ top: 100, stick: false }, 1000, 100), 100);
  assert.equal(restoreScroll({ top: 100, stick: true }, 1200, 100), 1100);
  assert.equal(restoreScroll(null, 1000, 100), 900);
});

test("runtime keeps pinned scroll across remounts and ignores a collapsed viewport", () => {
  const runtime = createChatRuntime(mockClient());
  assert.equal(runtime.scrollTop(5000, 0), null);
  runtime.rememberScroll(0, 5000, 0);
  assert.equal(runtime.scrollTop(5000, 400), 4600);
  runtime.rememberScroll(80, 5000, 400);
  assert.equal(runtime.sticking(), false);
  assert.equal(runtime.scrollTop(5000, 400), 80);
  runtime.pinToBottom();
  assert.equal(runtime.sticking(), true);
  assert.equal(runtime.scrollTop(5000, 400), 4600);
});
