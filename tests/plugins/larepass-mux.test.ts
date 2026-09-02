import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeMux,
  consumeMuxFrames,
  classifyMuxEnvelope,
  iterateSseJson,
  muxSessionEvent,
  muxWsUrl,
  splitSseBlocks,
  sseData,
} from "@olares/lares-core/larepass/mux";
import { foldTranscript, mergeEvents } from "@olares/lares-core/larepass/transcript";

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

test("consumeMux rereads a sessionId getter so switched chats drop stale frames", async () => {
  const stream = new ReadableStream({
    start(controller) {
      const send = (sessionId, text) => {
        controller.enqueue(new TextEncoder().encode(sseFrame({
          type: "session/event",
          sessionId,
          event: { type: "assistant/chunk", seq: 1, data: { chunk: { type: "text-delta", text } } },
        })));
      };
      send("s1", "keep");
      send("s1", "stale");
      send("s2", "next");
      controller.close();
    },
  });
  const events = [];
  for await (const event of consumeMux(stream, () => (events.length === 0 ? "s1" : "s2"))) {
    events.push(event);
  }
  assert.deepEqual(
    events.map((event) => event.data.chunk.text),
    ["keep", "next"],
  );
});

test("consumeMuxFrames keeps every session's frames so a cache can ingest in the background", async () => {
  const stream = new ReadableStream({
    start(controller) {
      const send = (sessionId, text) => {
        controller.enqueue(new TextEncoder().encode(sseFrame({
          type: "session/event",
          sessionId,
          event: { type: "assistant/chunk", seq: 1, data: { chunk: { type: "text-delta", text } } },
        })));
      };
      send("s1", "keep");
      send("s2", "next");
      controller.close();
    },
  });
  const frames = [];
  for await (const frame of consumeMuxFrames(stream)) frames.push(frame);
  assert.deepEqual(
    frames.map((frame) => [frame.sessionId, frame.event.data.chunk.text]),
    [["s1", "keep"], ["s2", "next"]],
  );
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

test("classifyMuxEnvelope keeps question waits that session/event folding would drop", () => {
  const envelope = {
    type: "server-request",
    rpcId: "q1",
    method: "events.mux",
    payload: {
      type: "question/requested",
      sessionId: "s1",
      questions: [{ id: "bg-style", question: "style?" }],
    },
  };
  assert.deepEqual(classifyMuxEnvelope(envelope), {
    kind: "question",
    sessionId: "s1",
    rpcId: "q1",
    questions: [{ id: "bg-style", question: "style?" }],
  });
  assert.equal(muxSessionEvent(envelope, "s1"), null);
  assert.deepEqual(
    classifyMuxEnvelope({
      type: "server-request",
      rpcId: "q1",
      payload: { type: "question/resolved", sessionId: "s1", questionRpcId: "q1", outcome: "answered" },
    }),
    { kind: "question-resolved", sessionId: "s1", rpcId: "q1", outcome: "answered" },
  );
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
