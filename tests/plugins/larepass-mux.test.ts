import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeMux,
  iterateSseJson,
  muxSessionEvent,
  muxWsUrl,
  splitSseBlocks,
  sseData,
} from "@lares/core/larepass/mux";
import { foldTranscript, mergeEvents } from "@lares/core/larepass/transcript";

test("muxWsUrl turns the Host HTTP path into a websocket URL", () => {
  assert.equal(
    muxWsUrl("/laresHost/api/events.mux", "https://test.example.com:8180"),
    "wss://test.example.com:8180/laresHost/api/events.mux",
  );
});

test("consumeMux reads browser websocket JSON frames", async () => {
  const listeners = { message: [], close: [] };
  const socket = {
    addEventListener(type, fn) {
      listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = listeners[type].filter((item) => item !== fn);
    },
  };
  const delta = {
    type: "assistant/chunk",
    seq: 1,
    data: { chunk: { type: "text-delta", text: "hi" } },
  };
  const pending = consumeMux(socket, "s1");
  queueMicrotask(() => {
    for (const fn of listeners.message) {
      fn({
        data: JSON.stringify({
          type: "server-request",
          rpcId: "r1",
          method: "session/event",
          payload: { type: "session/event", sessionId: "s1", event: delta },
        }),
      });
    }
    for (const fn of listeners.close) fn();
  });
  const events = [];
  for await (const event of pending) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.chunk.text, "hi");
});

function sseFrame(payload) {
  return `data: ${JSON.stringify({
    type: "server-request",
    rpcId: "r1",
    method: "events.mux",
    payload,
  })}\n\n`;
}

test("SSE splitter keeps a trailing partial block", () => {
  const { blocks, rest } = splitSseBlocks("data: {\"a\":1}\n\ndata: {\"b\"");
  assert.deepEqual(blocks, ['data: {"a":1}']);
  assert.equal(sseData(blocks[0]), '{"a":1}');
  assert.equal(rest, 'data: {"b"');
});

test("muxSessionEvent keeps this session's session/event frames", () => {
  const event = { type: "assistant/chunk", seq: 4, data: { chunk: { type: "text-delta", text: "hi" } } };
  assert.equal(
    muxSessionEvent({
      type: "server-request",
      payload: { type: "session/subscribed", sessionId: "s1", lastSeq: 3 },
    }, "s1"),
    null,
  );
  assert.equal(
    muxSessionEvent({
      type: "server-request",
      payload: { type: "session/event", sessionId: "s2", event },
    }, "s1"),
    null,
  );
  assert.equal(
    muxSessionEvent({
      type: "server-request",
      payload: { type: "session/event", sessionId: "s1", event, view: { for: "call", view: { card: "generic" } } },
    }, "s1")?.seq,
    4,
  );
  assert.equal(
    muxSessionEvent({
      type: "server-request",
      payload: { type: "session/event", sessionId: "s1", event, view: { for: "call", view: { card: "generic" } } },
    }, "s1")?.view?.for,
    "call",
  );
});

test("iterateSseJson yields across chunk boundaries", async () => {
  async function* chunks() {
    const frame = sseFrame({
      type: "session/event",
      sessionId: "s1",
      event: { type: "turn/start", seq: 1, data: { turn: 1 } },
    });
    yield frame.slice(0, 12);
    yield frame.slice(12);
  }
  const envelopes = [];
  for await (const envelope of iterateSseJson(chunks())) envelopes.push(envelope);
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].payload.event.type, "turn/start");
});

test("consumeMux folds token deltas as they arrive", async () => {
  const start = { type: "turn/start", seq: 1, data: { turn: 1 } };
  const user = {
    type: "user/message",
    seq: 2,
    data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } },
  };
  const delta = {
    type: "assistant/chunk",
    seq: 3,
    data: { chunk: { type: "text-delta", text: "he" } },
  };
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseFrame({ type: "session/event", sessionId: "s1", event: start })));
      controller.enqueue(new TextEncoder().encode(sseFrame({ type: "session/event", sessionId: "s1", event: user })));
      controller.enqueue(new TextEncoder().encode(sseFrame({ type: "session/event", sessionId: "s1", event: delta })));
      controller.close();
    },
  });
  let events = [];
  let last;
  for await (const event of consumeMux(stream, "s1")) {
    events = mergeEvents(events, [event]);
    last = foldTranscript(events);
  }
  assert.equal(last.running, true);
  assert.deepEqual(last.messages, [
    { role: "user", text: "hi" },
    { role: "assistant", text: "he", pending: true },
  ]);
  assert.equal(last.items.at(-1).pending, true);
});

test("mergeEvents is seq-idempotent and ordered", () => {
  const merged = mergeEvents(
    [{ type: "turn/start", seq: 1, data: { turn: 1 } }],
    [
      { event: { type: "turn/start", seq: 1, data: { turn: 1 } } },
      { type: "user/message", seq: 2, data: { content: [{ type: "text", text: "a" }] } },
    ],
  );
  assert.deepEqual(merged.map((event) => event.seq), [1, 2]);
});
