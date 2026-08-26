import assert from "node:assert/strict";
import test from "node:test";
import { callRpc, ensureSession, loadTranscript, sendPrompt } from "@lares/core/larepass/chat";
import { promptPayload, rpcPath, unwrapServerResponse, wrapClientRequest } from "@lares/core/larepass/rpc";
import { foldTranscript, textFromBlocks } from "@lares/core/larepass/transcript";

test("rpc envelope wraps POST /api/<method> and unwraps server-response", () => {
  const req = wrapClientRequest("session.prompt", { sessionId: "s1" });
  assert.equal(req.type, "client-request");
  assert.equal(req.method, "session.prompt");
  assert.equal(typeof req.rpcId, "string");
  assert.ok(req.rpcId.length > 0);
  assert.equal(rpcPath("session.list"), "/api/session.list");
  assert.deepEqual(
    unwrapServerResponse({
      type: "server-response",
      rpcId: req.rpcId,
      result: { ok: true, value: { accepted: true } },
    }),
    { ok: true, rpcId: req.rpcId, value: { accepted: true } },
  );
  assert.equal(unwrapServerResponse("<html>login</html>").error.code, "invalid-envelope");
  assert.equal(
    unwrapServerResponse({
      type: "server-response",
      rpcId: "x",
      result: { ok: false, error: { code: "session-not-found", message: "gone" } },
    }).error.code,
    "session-not-found",
  );
});

test("promptPayload is a queued text turn", () => {
  assert.deepEqual(promptPayload("abc", "hello", "Asia/Shanghai"), {
    sessionId: "abc",
    mode: "queue",
    content: [{ type: "text", text: "hello" }],
    clientTimeZone: "Asia/Shanghai",
  });
});

test("foldTranscript keeps human turns and in-flight assistant chunks", () => {
  assert.equal(textFromBlocks([{ type: "text", text: "a" }, { type: "reasoning", text: "x" }, { type: "text", text: "b" }]), "ab");
  const { messages, running, error } = foldTranscript([
    { event: { type: "turn/start", data: { turn: 1 } } },
    { event: { type: "user/message", data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } } },
    { event: { type: "user/message", data: { content: [{ type: "text", text: "secret.md" }], source: { kind: "plugin", plugin: "fs" } } } },
    { event: { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "hel" } } } },
    { event: { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "lo" } } } },
  ]);
  assert.equal(running, true);
  assert.equal(error, "");
  assert.deepEqual(messages, [
    { role: "user", text: "hi" },
    { role: "assistant", text: "hello", pending: true },
  ]);
  const done = foldTranscript([
    { type: "turn/start", data: { turn: 1 } },
    { type: "user/message", data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
    { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "hel" } } },
    { type: "assistant/message", data: { message: { content: [{ type: "text", text: "hello" }] } } },
    { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } },
  ]);
  assert.equal(done.running, false);
  assert.deepEqual(done.messages, [
    { role: "user", text: "hi" },
    { role: "assistant", text: "hello" },
  ]);
});

test("foldTranscript keeps reasoning, tools, and produced files", () => {
  const folded = foldTranscript([
    { type: "turn/start", seq: 1, data: { turn: 1 } },
    { type: "user/message", seq: 2, data: { content: [{ type: "text", text: "draw" }], source: { kind: "user" } } },
    { type: "assistant/chunk", seq: 3, data: { chunk: { type: "reasoning-delta", text: "plan " } } },
    { type: "assistant/chunk", seq: 4, data: { chunk: { type: "reasoning-delta", text: "it" } } },
    {
      type: "tool/call",
      seq: 5,
      data: { callId: "c1", name: "write", arguments: "{\"path\":\"out.png\"}" },
      view: { for: "call", view: { card: "generic", kind: "edit", title: "Write out.png", locations: [{ path: "out.png" }] } },
    },
    { type: "tool/result", seq: 6, data: { callId: "c1", message: { source: { callId: "c1" }, content: [] } } },
    { type: "assistant/chunk", seq: 7, data: { chunk: { type: "text-delta", text: "done" } } },
    { type: "turn/end", seq: 8, data: { turn: 1, reason: { kind: "completed" } } },
  ]);
  assert.equal(folded.running, false);
  assert.deepEqual(folded.items.map((item) => item.type), ["user", "reasoning", "tool", "assistant", "files"]);
  assert.equal(folded.items[1].text, "plan it");
  assert.equal(folded.items[2].title, "Write out.png");
  assert.equal(folded.items[2].status, "done");
  assert.deepEqual(folded.items[4].paths, ["out.png"]);
});

test("callRpc maps auth redirects and business errors", async () => {
  assert.equal(
    (await callRpc(async () => ({ status: 303 }), "session.list")).status,
    "unauthorized",
  );
  const ok = await callRpc(
    async (path, init) => {
      assert.equal(path, "/api/session.create");
      assert.equal(init.method, "POST");
      assert.equal(init.body.type, "client-request");
      assert.equal(init.body.method, "session.create");
      return {
        status: 200,
        body: {
          type: "server-response",
          rpcId: init.body.rpcId,
          result: { ok: true, value: { sessionId: "s1" } },
        },
      };
    },
    "session.create",
    {},
  );
  assert.equal(ok.status, "ok");
  assert.equal(ok.value.sessionId, "s1");
});

test("ensureSession reuses a top-level row before creating", async () => {
  const reused = await ensureSession(async (method) => {
    assert.equal(method, "session.list");
    return {
      ok: true,
      value: {
        items: [
          { sessionId: "child", parentSessionId: "s1", origin: "subagent" },
          { sessionId: "s1" },
        ],
      },
    };
  });
  assert.equal(reused.value.sessionId, "s1");
  const created = await ensureSession(async (method) => {
    if (method === "session.list") return { ok: true, value: { items: [] } };
    assert.equal(method, "session.create");
    return { ok: true, value: { sessionId: "fresh" } };
  });
  assert.equal(created.value.sessionId, "fresh");
});

test("loadTranscript and sendPrompt ride the rpc surface", async () => {
  const snap = await loadTranscript(async (method, payload) => {
    assert.equal(method, "session.history");
    assert.equal(payload.sessionId, "s1");
    return {
      ok: true,
      value: { events: [{ type: "user/message", data: { content: [{ type: "text", text: "q" }] } }] },
    };
  }, "s1");
  assert.deepEqual(snap.value.messages, [{ role: "user", text: "q" }]);
  const sent = await sendPrompt(async (method, payload) => {
    assert.equal(method, "session.prompt");
    assert.equal(payload.sessionId, "s1");
    assert.equal(payload.mode, "queue");
    assert.equal(payload.content[0].text, "ping");
    return { ok: true, value: { accepted: true } };
  }, "s1", "ping");
  assert.equal(sent.value.accepted, true);
});
