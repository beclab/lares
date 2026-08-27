import assert from "node:assert/strict";
import test from "node:test";
import { callRpc, ensureSession, groupSessionsByRecency, loadTranscript, rootSessions, sendPrompt, summarizeSession, visibleHistorySessions } from "@lares/core/larepass/chat";
import { promptPayload, rpcPath, unwrapServerResponse, wrapClientRequest } from "@lares/core/larepass/rpc";
import { STAGE_COPY } from "@lares/core/larepass/stage-copy";
import { foldTranscript, textFromBlocks } from "@lares/core/larepass/transcript";
import { toolVariantIcon } from "@lares/core/larepass/tool-row";

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
  assert.equal(folded.items[2].title, "Write");
  assert.equal(folded.items[2].summary, "out.png");
  assert.equal(folded.items[2].status, "done");
  assert.deepEqual(folded.items[4].paths, ["out.png"]);
});

test("foldTranscript projects injected context and keeps think/tool/retry order", () => {
  const folded = foldTranscript([
    { type: "turn/start", seq: 1, data: { turn: 1 } },
    { type: "user/message", seq: 2, data: { content: [{ type: "text", text: "run ffmpeg" }], source: { kind: "user" } } },
    {
      type: "user/message",
      seq: 3,
      data: {
        content: [{ type: "text", text: "<system-reminder>\nInstructions from: AGENTS.md\n" }],
        source: { kind: "agent-instructions", form: "instructions", changes: [{ path: "AGENTS.md" }] },
      },
    },
    {
      type: "user/message",
      seq: 4,
      data: {
        content: [{ type: "text", text: "<system-reminder>\n<available_skills>\n" }],
        source: { kind: "plugin", plugin: "skill-catalog", form: "catalog" },
      },
    },
    { type: "assistant/chunk", seq: 5, data: { turn: 1, step: 1, chunk: { type: "reasoning-delta", index: 0, text: "Need ffmpeg.\n" } } },
    {
      type: "tool/call",
      seq: 6,
      data: { callId: "c1", name: "ffmpeg_encode", arguments: "{\"filter\":\"testsrc2\"}" },
    },
    {
      type: "llm/retry",
      seq: 7,
      data: { retryId: "r1", retry: 5, maxRetries: 5, mode: "normal", delayMs: 9000, failure: { message: "timeout" } },
    },
    { type: "assistant/chunk", seq: 8, data: { turn: 1, step: 2, chunk: { type: "reasoning-delta", index: 0, text: "Done. Report encoder." } } },
    { type: "assistant/chunk", seq: 9, data: { turn: 1, step: 2, chunk: { type: "text-delta", index: 1, text: "ok" } } },
    { type: "turn/end", seq: 10, data: { turn: 1, reason: { kind: "completed" } } },
  ]);
  assert.deepEqual(folded.items.map((item) => item.type), [
    "user",
    "context",
    "context",
    "reasoning",
    "tool",
    "retry",
    "reasoning",
    "assistant",
  ]);
  assert.equal(folded.items[1].label, "AGENTS.md");
  assert.equal(folded.items[2].label, "skill-catalog");
  assert.equal(folded.items[4].title, "Tool call");
  assert.equal(folded.items[4].summary, "ffmpeg_encode · testsrc2");
  assert.equal(folded.items[5].retry, 5);
  assert.equal(folded.items[5].seconds, 9);
  assert.deepEqual(folded.messages.map((row) => row.role), ["user", "assistant"]);
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
  assert.equal(reused.value.sessions[0].sessionId, "s1");
  assert.equal(reused.value.sessions.length, 1);
  const created = await ensureSession(async (method) => {
    if (method === "session.list") return { ok: true, value: { items: [] } };
    assert.equal(method, "session.create");
    return { ok: true, value: { sessionId: "fresh" } };
  });
  assert.equal(created.value.sessionId, "fresh");
});

test("rootSessions drops subagent rows and summarizeSession picks a title", () => {
  assert.deepEqual(
    rootSessions([
      { sessionId: "child", parentSessionId: "s1", origin: "subagent", title: "tool" },
      { sessionId: "s1", title: "hello", updatedAt: 9 },
      { name: "orphan" },
    ]).map(summarizeSession),
    [{ sessionId: "s1", title: "hello", updatedAt: 9, blank: false }],
  );
  assert.equal(summarizeSession({ sessionId: "s2", name: "  draft  ", createdAt: 3 }).title, "draft");
  assert.equal(
    summarizeSession({
      sessionId: "s3",
      updatedAt: 2,
      projections: { values: { title: "gpu check" } },
    }).title,
    "gpu check",
  );
});

test("history groups by today and the previous 7 days and hides spare blanks", () => {
  const now = Date.parse("2026-08-26T12:00:00+08:00");
  const today = Date.parse("2026-08-26T09:00:00+08:00");
  const week = Date.parse("2026-08-22T09:00:00+08:00");
  const older = Date.parse("2026-07-01T09:00:00+08:00");
  const grouped = groupSessionsByRecency(
    visibleHistorySessions(
      [
        { sessionId: "blank", title: "", updatedAt: today, blank: true },
        { sessionId: "cur", title: "", updatedAt: today, blank: true },
        { sessionId: "a", title: "today", updatedAt: today, blank: false },
        { sessionId: "b", title: "week", updatedAt: week, blank: false },
        { sessionId: "c", title: "old", updatedAt: older, blank: false },
      ],
      "cur",
    ),
    now,
  );
  assert.deepEqual(grouped.map((section) => [section.id, section.rows.map((row) => row.sessionId)]), [
    ["today", ["cur", "a"]],
    ["week", ["b"]],
    ["older", ["c"]],
  ]);
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

test("toolVariantIcon follows dsh VARIANT_ICONS and stage copy stays English", () => {
  assert.equal(toolVariantIcon("search"), "search");
  assert.equal(toolVariantIcon("read"), "browse");
  assert.equal(toolVariantIcon("bash"), "api");
  assert.equal(toolVariantIcon("write"), "edit");
  assert.equal(toolVariantIcon("edit"), "edit");
  assert.equal(toolVariantIcon("code"), "code");
  assert.equal(toolVariantIcon("others"), "sparkle");
  assert.equal(STAGE_COPY.think, "Think");
  assert.equal(STAGE_COPY.contextInjection, "Context injection");
  assert.equal(STAGE_COPY.retry.started, "Retried model request");
});
