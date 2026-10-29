import assert from "node:assert/strict";
import test from "node:test";
import { consumeMux } from "@olares/lares-core/larepass/mux";
import { createChatRuntime, pinnedScroll, restoreScroll } from "@olares/lares-core/larepass/runtime";

test("mobile voice playback commands pass through the chat runtime", async () => {
  const calls = [];
  const runtime = createChatRuntime({
    speak: async (text) => {
      calls.push(["speak", text]);
      return { audio: "wav" };
    },
    interruptSpeech: async () => {
      calls.push(["interrupt"]);
      return true;
    },
  });
  assert.deepEqual(await runtime.speak("hello"), { audio: "wav" });
  assert.equal(await runtime.interruptSpeech(), true);
  assert.deepEqual(calls, [["speak", "hello"], ["interrupt"]]);
  runtime.dispose();
});

function sseFrame(payload) {
  return `data: ${JSON.stringify({
    type: "server-request",
    rpcId: "r1",
    method: payload.type,
    payload,
  })}\n\n`;
}

function mockClient({ events = [], eventsById, sessionId = "s1" } = {}) {
  let probes = 0;
  let histories = 0;
  let muxes = 0;
  let encoder;
  let controller;
  const responds = [];
  const byId = eventsById ?? { [sessionId]: events };
  const body = new ReadableStream({
    start(c) {
      controller = c;
      encoder = new TextEncoder();
    },
  });
  return {
    stats: () => ({ probes, histories, muxes, responds }),
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
    rpc: async (method, payload = {}) => {
      if (method === "session.list") {
        return {
          ok: true,
          value: {
            items: [
              { sessionId: "child", parentSessionId: sessionId, origin: "subagent" },
              ...Object.keys(byId).map((id) => ({ sessionId: id, title: id })),
            ],
          },
        };
      }
      if (method === "session.create") {
        return { ok: true, value: { sessionId: "s3" } };
      }
      if (method === "session.history") {
        histories += 1;
        return { ok: true, value: { events: byId[payload.sessionId] || [] } };
      }
      throw new Error(method);
    },
    prompt: async () => ({ ok: true, value: { accepted: true } }),
    respond: async (message) => {
      responds.push(message);
      return { accepted: true };
    },
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

test("session follow streams think and reply without a history reload", async () => {
  const listeners = { message: [], close: [] };
  const sent = [];
  const socket = {
    readyState: 1,
    send(data) {
      sent.push(JSON.parse(data));
    },
    addEventListener(type, fn) {
      listeners[type].push(fn);
    },
    removeEventListener() {},
  };
  const client = mockClient();
  client.openMux = async () => ({ ok: true, http: 101, body: socket });
  const runtime = createChatRuntime(client);
  const snaps = [];
  runtime.subscribe((snap) => snaps.push(snap));
  await runtime.start();
  for (let i = 0; i < 20 && !sent.length; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(sent[0]?.endpoint, "session/follow");
  assert.equal(sent[0]?.payload?.args?.request?.assistantStream, true);
  const streamId = sent[0].streamId;
  const deliver = (value) => {
    for (const fn of listeners.message) fn({ data: JSON.stringify({ type: "item", streamId, value }) });
  };
  deliver({
    type: "snapshot",
    cursor: 1,
    records: [{ type: "event", event: { type: "turn/start", seq: 1, data: { turn: 1 } } }],
    hasMore: false,
    assistantStream: { revision: 0 },
  });
  deliver({
    type: "assistant-stream",
    frame: { type: "start", attemptId: "a", revision: 1, startedAfterSeq: 1, turn: 1, step: 0 },
  });
  deliver({
    type: "assistant-stream",
    frame: {
      type: "chunk",
      attemptId: "a",
      revision: 2,
      index: 0,
      time: 1,
      chunk: { type: "reasoning-delta", index: 0, text: "adding" },
    },
  });
  deliver({
    type: "assistant-stream",
    frame: {
      type: "chunk",
      attemptId: "a",
      revision: 3,
      index: 1,
      time: 2,
      chunk: { type: "text-delta", index: 1, text: "4" },
    },
  });
  let last;
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    last = snaps.at(-1);
    if (last?.items?.some((row) => row.type === "assistant" && row.text === "4")) break;
  }
  assert.equal(last.running, true);
  assert.equal(last.items.find((row) => row.type === "reasoning")?.text, "adding");
  assert.equal(last.items.find((row) => row.type === "assistant")?.text, "4");
  runtime.dispose();
  for (const fn of listeners.close) fn();
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

test("listSessions hides subagents and openSession replaces the transcript", async () => {
  const user = (text) => ({
    type: "user/message",
    seq: 1,
    data: { content: [{ type: "text", text }], source: { kind: "user" } },
  });
  const client = mockClient({
    eventsById: {
      s1: [user("one")],
      s2: [user("two")],
    },
  });
  const runtime = createChatRuntime(client);
  await runtime.start();
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "one" }]);
  assert.deepEqual(
    await runtime.listSessions(),
    [
      { sessionId: "s1", title: "s1", updatedAt: 0, blank: false },
      { sessionId: "s2", title: "s2", updatedAt: 0, blank: false },
    ],
  );
  await runtime.openSession("s2");
  assert.equal(runtime.snapshot().sessionId, "s2");
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "two" }]);
  await runtime.createSession();
  assert.equal(runtime.snapshot().sessionId, "s3");
  assert.deepEqual(runtime.snapshot().messages, []);
  runtime.dispose();
  client.close();
});

test("listSessions is served from cache and openSession restores a remembered transcript immediately", async () => {
  const user = (text) => ({
    type: "user/message",
    seq: 1,
    data: { content: [{ type: "text", text }], source: { kind: "user" } },
  });
  let historyDelay = 0;
  const client = mockClient({
    eventsById: {
      s1: [user("one")],
      s2: [user("two")],
    },
  });
  const originalRpc = client.rpc;
  client.rpc = async (method, payload = {}) => {
    if (method === "session.history" && historyDelay) {
      await new Promise((resolve) => setTimeout(resolve, historyDelay));
    }
    return originalRpc(method, payload);
  };
  const runtime = createChatRuntime(client);
  await runtime.start();
  const cached = runtime.snapshot().sessions;
  assert.deepEqual(
    cached.map((row) => row.sessionId),
    ["s1", "s2"],
  );
  const listed = await runtime.listSessions();
  assert.equal(listed, cached);
  await runtime.openSession("s2");
  historyDelay = 50;
  const pending = runtime.openSession("s1");
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "one" }]);
  await pending;
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "one" }]);
  runtime.dispose();
  client.close();
});

test("openSession exposes historyLoading until the transcript arrives", async () => {
  const user = (text) => ({
    type: "user/message",
    seq: 1,
    data: { content: [{ type: "text", text }], source: { kind: "user" } },
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const client = mockClient({
    eventsById: {
      s1: [user("one")],
      s2: [user("two")],
    },
  });
  const originalRpc = client.rpc;
  client.rpc = async (method, payload = {}) => {
    if (method === "session.history" && payload.sessionId === "s2") await gate;
    return originalRpc(method, payload);
  };
  const runtime = createChatRuntime(client);
  await runtime.start();
  assert.equal(runtime.snapshot().historyLoading, false);
  const pending = runtime.openSession("s2");
  assert.equal(runtime.snapshot().sessionId, "s2");
  assert.equal(runtime.snapshot().historyLoading, true);
  assert.deepEqual(runtime.snapshot().messages, []);
  release();
  await pending;
  assert.equal(runtime.snapshot().historyLoading, false);
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "two" }]);
  runtime.dispose();
  client.close();
});

test("a slower history fetch does not overwrite a later session", async () => {
  const user = (text) => ({
    type: "user/message",
    seq: 1,
    data: { content: [{ type: "text", text }], source: { kind: "user" } },
  });
  let releaseS2;
  const gateS2 = new Promise((resolve) => {
    releaseS2 = resolve;
  });
  const client = mockClient({
    eventsById: {
      s1: [user("one")],
      s2: [user("two")],
    },
  });
  const originalRpc = client.rpc;
  client.rpc = async (method, payload = {}) => {
    if (method === "session.history" && payload.sessionId === "s2") await gateS2;
    return originalRpc(method, payload);
  };
  const runtime = createChatRuntime(client);
  await runtime.start();
  const pendingS2 = runtime.openSession("s2");
  await runtime.openSession("s1");
  releaseS2();
  await pendingS2;
  assert.equal(runtime.snapshot().sessionId, "s1");
  assert.equal(runtime.snapshot().historyLoading, false);
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "one" }]);
  const histories = client.stats().histories;
  const pending = runtime.openSession("s2");
  assert.equal(runtime.snapshot().sessionId, "s2");
  assert.equal(runtime.snapshot().historyLoading, false);
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "two" }]);
  await pending;
  assert.equal(client.stats().histories, histories);
  runtime.dispose();
  client.close();
});

test("switching away mid-load still keeps the later session and fills the abandoned cache", async () => {
  const user = (text) => ({
    type: "user/message",
    seq: 1,
    data: { content: [{ type: "text", text }], source: { kind: "user" } },
  });
  let releaseS2;
  let releaseS3;
  const gateS2 = new Promise((resolve) => {
    releaseS2 = resolve;
  });
  const gateS3 = new Promise((resolve) => {
    releaseS3 = resolve;
  });
  const client = mockClient({
    eventsById: {
      s1: [user("one")],
      s2: [user("two")],
      s3: [user("three")],
    },
  });
  const originalRpc = client.rpc;
  client.rpc = async (method, payload = {}) => {
    if (method === "session.history" && payload.sessionId === "s2") await gateS2;
    if (method === "session.history" && payload.sessionId === "s3") await gateS3;
    return originalRpc(method, payload);
  };
  const runtime = createChatRuntime(client);
  await runtime.start();
  const pendingS2 = runtime.openSession("s2");
  const pendingS3 = runtime.openSession("s3");
  assert.equal(runtime.snapshot().sessionId, "s3");
  assert.equal(runtime.snapshot().historyLoading, true);
  assert.deepEqual(runtime.snapshot().messages, []);
  releaseS2();
  await pendingS2;
  assert.equal(runtime.snapshot().sessionId, "s3");
  assert.deepEqual(runtime.snapshot().messages, []);
  releaseS3();
  await pendingS3;
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "three" }]);
  const pending = runtime.openSession("s2");
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "two" }]);
  await pending;
  runtime.dispose();
  client.close();
});

test("createSession leaves the previous transcript before session.create returns", async () => {
  const user = (text) => ({
    type: "user/message",
    seq: 1,
    data: { content: [{ type: "text", text }], source: { kind: "user" } },
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const client = mockClient({ events: [user("one")] });
  const originalRpc = client.rpc;
  let creates = 0;
  let histories = 0;
  client.rpc = async (method, payload = {}) => {
    if (method === "session.create") {
      creates += 1;
      await gate;
    }
    if (method === "session.history") histories += 1;
    return originalRpc(method, payload);
  };
  const runtime = createChatRuntime(client);
  await runtime.start();
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "one" }]);
  const pending = runtime.createSession();
  assert.equal(runtime.snapshot().sessionId, "");
  assert.deepEqual(runtime.snapshot().messages, []);
  assert.equal(runtime.snapshot().historyLoading, false);
  assert.equal(creates, 1);
  const startedHistories = histories;
  release();
  await pending;
  assert.equal(runtime.snapshot().sessionId, "s3");
  assert.deepEqual(runtime.snapshot().messages, []);
  assert.equal(histories, startedHistories);
  runtime.dispose();
  client.close();
});

test("createSession is a no-op when the current chat is already empty", async () => {
  const client = mockClient({ events: [] });
  const originalRpc = client.rpc;
  let creates = 0;
  client.rpc = async (method, payload = {}) => {
    if (method === "session.create") creates += 1;
    return originalRpc(method, payload);
  };
  const runtime = createChatRuntime(client);
  await runtime.start();
  await runtime.createSession();
  assert.equal(creates, 0);
  assert.equal(runtime.snapshot().sessionId, "s1");
  runtime.dispose();
  client.close();
});

test("createSession reuses a listed blank session without calling session.create", async () => {
  const user = (text) => ({
    type: "user/message",
    seq: 1,
    data: { content: [{ type: "text", text }], source: { kind: "user" } },
  });
  const client = mockClient({
    eventsById: {
      s1: [user("one")],
      spare: [],
    },
  });
  const originalRpc = client.rpc;
  let creates = 0;
  client.rpc = async (method, payload = {}) => {
    if (method === "session.list") {
      return {
        ok: true,
        value: {
          items: [
            { sessionId: "s1", title: "s1" },
            { sessionId: "spare", title: "", blank: true },
          ],
        },
      };
    }
    if (method === "session.create") {
      creates += 1;
      return originalRpc(method, payload);
    }
    return originalRpc(method, payload);
  };
  const runtime = createChatRuntime(client);
  await runtime.start();
  await runtime.refreshSessions();
  const pending = runtime.createSession();
  assert.equal(runtime.snapshot().sessionId, "spare");
  assert.deepEqual(runtime.snapshot().messages, []);
  assert.equal(creates, 0);
  await pending;
  assert.equal(runtime.snapshot().sessionId, "spare");
  assert.equal(creates, 0);
  runtime.dispose();
  client.close();
});

test("createSession does not steal the view if another chat was opened while creating", async () => {
  const user = (text) => ({
    type: "user/message",
    seq: 1,
    data: { content: [{ type: "text", text }], source: { kind: "user" } },
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const client = mockClient({
    eventsById: {
      s1: [user("one")],
      s2: [user("two")],
    },
  });
  const originalRpc = client.rpc;
  client.rpc = async (method, payload = {}) => {
    if (method === "session.create") await gate;
    return originalRpc(method, payload);
  };
  const runtime = createChatRuntime(client);
  await runtime.start();
  const pending = runtime.createSession();
  await runtime.openSession("s2");
  release();
  await pending;
  assert.equal(runtime.snapshot().sessionId, "s2");
  assert.deepEqual(runtime.snapshot().messages, [{ role: "user", text: "two" }]);
  runtime.dispose();
  client.close();
});

function fakeSocket() {
  const listeners = { message: new Set(), close: new Set() };
  const sent = [];
  return {
    readyState: 1,
    sent,
    send(data) {
      sent.push(JSON.parse(data));
    },
    addEventListener(type, fn) {
      listeners[type]?.add(fn);
    },
    removeEventListener(type, fn) {
      listeners[type]?.delete(fn);
    },
    deliver(message) {
      for (const fn of listeners.message) fn({ data: JSON.stringify(message) });
    },
    close() {
      for (const fn of listeners.close) fn();
    },
  };
}

async function until(check) {
  for (let i = 0; i < 50; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function remoteEventsClient() {
  const socket = fakeSocket();
  const results = [];
  const client = {
    socket,
    results,
    probe: async () => ({ status: "ok", http: 200 }),
    ensureSession: async () => ({ ok: true, value: { sessionId: "s1" } }),
    rpc: async (method, payload = {}) => {
      if (method === "session.list") return { ok: true, value: { items: [{ sessionId: "s1", title: "s1" }] } };
      if (method === "session.history") return { ok: true, value: { events: [] } };
      if (method === "$events/result") {
        results.push(payload);
        return { ok: true, value: null };
      }
      throw new Error(method);
    },
    openMux: async () => ({ ok: true, http: 200, body: socket }),
    consumeMux,
  };
  return client;
}

test("Host question and approval waterfalls surface on the snapshot and answer through $events/result", async () => {
  const client = remoteEventsClient();
  const runtime = createChatRuntime(client);
  await runtime.start();
  await until(() => client.socket.sent.some((frame) => frame.endpoint === "$events"));
  const open = client.socket.sent.find((frame) => frame.endpoint === "$events");
  assert.deepEqual(open.payload, { args: {} });
  const item = (value) => client.socket.deliver({ type: "item", streamId: open.streamId, value });
  item({ type: "ready", clientId: "c1", host: { home: "/root" } });
  item({
    type: "waterfall",
    event: "user-questions/request",
    eventId: "e1",
    agentId: "s1",
    request: { questions: [{ id: "bg-style", question: "style?", options: [{ label: "nature" }] }], wait: { callId: "call1", timed: true } },
  });
  item({ type: "waterfall", event: "something/else", eventId: "e2", agentId: "s1", request: {} });
  await until(() => runtime.snapshot().question && client.results.length === 1);
  assert.equal(runtime.snapshot().question.questions[0].id, "bg-style");
  assert.deepEqual(client.results[0], { clientId: "c1", eventId: "e2", outcome: { kind: "next" } });

  const answered = await runtime.answerQuestion([{ id: "bg-style", selected: ["nature"] }]);
  assert.equal(answered.ok, true);
  assert.deepEqual(client.results[1], {
    clientId: "c1",
    eventId: "e1",
    outcome: { kind: "result", value: { answers: [{ id: "bg-style", selected: ["nature"] }] } },
  });
  assert.equal(runtime.snapshot().question, null);

  item({ type: "waterfall", event: "approval/request", eventId: "e3", agentId: "s1", request: { toolName: "bash", callId: "call2", reason: "rm" } });
  await until(() => runtime.snapshot().approval);
  assert.equal(runtime.snapshot().approval.toolName, "bash");
  item({ type: "cancel", eventId: "e3" });
  await until(() => !runtime.snapshot().approval);
  assert.equal(runtime.snapshot().approval, null);
  runtime.dispose();
  client.socket.close();
});

test("a dropped mux retries without a send-failed banner", async () => {
  const client = mockClient();
  let muxes = 0;
  const reader = (read) => ({ getReader: () => ({ read, releaseLock() {} }) });
  client.openMux = async () => {
    muxes += 1;
    if (muxes === 1) {
      return { ok: true, http: 200, body: reader(async () => { throw new Error("The network connection was lost."); }) };
    }
    return { ok: true, http: 200, body: reader(async () => ({ done: true })) };
  };
  const runtime = createChatRuntime(client);
  await runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(muxes, 1);
  assert.equal(runtime.snapshot().failed, "");
  for (let i = 0; i < 20 && muxes < 2; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(muxes >= 2);
  assert.equal(runtime.snapshot().failed, "");
  runtime.dispose();
});