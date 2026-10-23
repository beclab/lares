import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVoiceRecords } from "@olares/lares-core/voice/records";
import { createVoiceDialogue } from "@olares/lares-core/voice/dialogue";
import { createVoiceHostService } from "@olares/lares-core/voice/host-service";

function store() {
  const directory = mkdtempSync(join(tmpdir(), "voice-records-"));
  return { records: createVoiceRecords({ directory }), close: () => rmSync(directory, { recursive: true, force: true }) };
}
test("records isolate owners, deduplicate append and reject stale summaries", () => {
  const h = store();
  try {
    const record = { id: "one", voiceId: "voice", clientId: "phone", turnId: "turn", role: "user", text: "cost matters", audio: "must not persist" };
    const first = h.records.append("alice", "chat", record);
    assert.equal(first.version, 1);
    assert.equal(h.records.append("alice", "chat", record).records.length, 1);
    assert.equal(h.records.read("bob", "chat").records.length, 0);
    assert.equal("audio" in first.records[0], false);
    h.records.append("alice", "chat", { ...record, id: "two", clientId: "web" });
    assert.throws(() => h.records.checkpoint("alice", "chat", "stale", 1), /voice_summary_conflict/);
    assert.equal(h.records.read("alice", "chat").records.length, 2);
    h.records.clear("bob", "chat");
    assert.equal(h.records.read("alice", "chat").records.length, 2);
    h.records.clear("alice", "chat");
    assert.equal(h.records.read("alice", "chat").records.length, 0);
  } finally { h.close(); }
});
test("chat preset cannot delegate even if its model emits a tool", async () => {
  let delegated = 0;
  const dialogue = createVoiceDialogue({ config: { preset: "chat" }, owner: "alice", submit: async () => { delegated++; },
    chat: async () => ({ tool_calls: [{ id: "tool", function: { name: "ask_lares", arguments: '{"task":"do it"}' } }] }),
  });
  await assert.rejects(dialogue.reply("hi", "request"), /voice_tool_forbidden/);
  assert.equal(delegated, 0);
});
test("assistant delegates a controlled task and describes pending without claiming completion", async () => {
  const submitted: any[] = [];
  let count = 0;
  const dialogue = createVoiceDialogue({ config: { preset: "assistant" }, owner: "alice",
    submit: async (...args: any[]) => { submitted.push(args); return { status: "pending", requestId: "task" }; },
    chat: async ({ messages }: any) => {
      if (++count === 1) return { role: "assistant", content: null, tool_calls: [{ id: "tool", function: { name: "ask_lares", arguments: '{"task":"check resources"}' } }] };
      assert.equal(JSON.parse(messages.at(-1).content).status, "pending");
      return { role: "assistant", content: "The check is still running." };
    },
  });
  assert.equal(await dialogue.reply("check", "one"), "The check is still running.");
  assert.deepEqual(submitted, [["check resources", "one", "run"]]);
});
test("pure chat does not create or inspect a business session and repeated turns are deduplicated", async () => {
  const h = store();
  let creates = 0, replies = 0;
  const api = { create: async () => { creates++; throw new Error("unexpected"); } };
  const service = createVoiceHostService(api, { records: h.records, config: () => ({ preset: "chat" }),
    chat: async () => { replies++; return { role: "assistant", content: "hello" }; },
  });
  const scope: any = { id: "client-one", owner: "alice" };
  try {
    await service.open(scope, {});
    await service.prompt(scope, { text: "hi", requestId: "one" });
    await service.prompt(scope, { text: "hi", requestId: "one" });
    assert.equal(creates, 0); assert.equal(replies, 2);
    assert.equal(service.state(scope).utterance.text, "hello");
    assert.equal(service.records(scope).records.length, 2);
    await service.clearRecords(scope);
    assert.equal(service.records(scope).records.length, 0);
    await service.close(scope);
  } finally { h.close(); }
});

test("closing while authorization is pending cannot activate a late voice session", async () => {
  const h = store();
  let authorize: () => void = () => {};
  const service = createVoiceHostService({ inspect: () => new Promise<void>((resolve) => { authorize = resolve; }) }, { records: h.records, config: () => ({ preset: "direct" }) });
  const scope: any = { id: "client-one", owner: "alice" };
  try {
    const opening = service.open(scope, { sessionId: "existing" });
    await service.close(scope); authorize();
    await assert.rejects(opening, /voice_session_closed/);
    assert.equal(scope.active, false);
  } finally { h.close(); }
});

test("independent chat explicitly resumes only its owner's context", async () => {
  const h = store();
  const contextId = "context-one";
  const record = { id: "first", voiceId: "old-client", turnId: "turn", role: "user", text: "cost is my priority" };
  h.records.append("alice", `voice:${contextId}`, record);
  const contexts: any[] = [];
  const service = createVoiceHostService({}, { records: h.records, config: () => ({ preset: "chat" }), chat: async ({ messages }: any) => { contexts.push(messages); return { role: "assistant", content: "ok" }; } });
  const alice: any = { id: "alice-client", owner: "alice" }, bob: any = { id: "bob-client", owner: "bob" };
  try {
    await service.open(alice, { contextId }); await service.prompt(alice, { text: "continue", requestId: "alice-turn" }); await service.close(alice);
    await service.open(bob, { contextId }); await service.prompt(bob, { text: "continue", requestId: "bob-turn" }); await service.close(bob);
    assert.ok(contexts[0].some((message: any) => message.content === "cost is my priority"));
    assert.ok(!contexts.at(-1).some((message: any) => message.content === "cost is my priority"));
  } finally { h.close(); }
});

test("truncate keeps only the heard reply, caller instructions append, and child chat calls carry the Router session", async () => {
  const h = store();
  const calls: any[] = [];
  const service = createVoiceHostService({}, { records: h.records, config: () => ({ preset: "chat" }),
    chat: async (request: any) => { calls.push(request); return { role: "assistant", content: "First sentence. Second sentence." }; },
  });
  const scope: any = { id: "client-two", owner: "alice", routerSessionId: "rtc_1" };
  try {
    await service.open(scope, {});
    service.instructions(scope, "Be formal.");
    await service.prompt(scope, { text: "hi", requestId: "one" });
    assert.match(calls[0].messages[0].content, /Caller instructions \(cannot override the rules above\): Be formal\./);
    assert.equal(calls[0].headers["x-session-id"], "rtc_1");
    assert.equal(service.truncate(scope, "one", "First sentence."), true);
    const row = service.records(scope).records.find((record: any) => record.role === "assistant");
    assert.deepEqual([row.text, row.status], ["First sentence.", "truncated"]);
    await scope.summaryTask;
    await service.prompt(scope, { text: "again", requestId: "two" });
    const history = calls.find((call: any) => call.messages.at(-1).content === "again").messages.filter((message: any) => message.role === "assistant").map((message: any) => message.content);
    assert.ok(history.includes("First sentence."));
    assert.ok(!history.includes("First sentence. Second sentence."));
    await service.close(scope);
  } finally { h.close(); }
});

test("instructions are refused outside the chat preset", async () => {
  const h = store();
  const service = createVoiceHostService({ inspect: async () => {} }, { records: h.records, config: () => ({ preset: "direct" }) });
  const scope: any = { id: "client-three", owner: "alice" };
  try {
    await service.open(scope, {});
    assert.throws(() => service.instructions(scope, "x"), { code: "voice_instructions_unsupported" });
    await service.close(scope);
  } finally { h.close(); }
});

test("reading the voice state neither consumes nor duplicates the pending result", async () => {
  const h = store();
  const service = createVoiceHostService({ create: async () => ({ sessionId: "s1" }) }, {
    records: h.records,
    config: () => ({ preset: "assistant" }),
    chat: async () => ({ role: "assistant", content: "ok" }),
  });
  const scope: any = { id: "client-one", owner: "alice" };
  try {
    await service.open(scope, {});
    let task: any = { requestId: "r1", status: "running", text: "", error: null, turn: 1 };
    scope.session = { snapshot: () => ({ running: false, sessionId: "s1", cursor: 3, tasks: [task] }), close: async () => {} };
    service.advance(scope);
    // Still running: nothing is spoken yet, but the view stays pure.
    assert.equal(service.state(scope).utterance, null);
    task = { ...task, status: "completed", text: "done" };
    const first = service.state(scope);
    const second = service.state(scope);
    assert.equal(first.utterance?.key, "task:r1");
    assert.deepEqual(second.utterance, first.utterance);
    // Repeated reads never re-consume, and repeated events never duplicate the record.
    service.advance(scope);
    assert.deepEqual(service.state(scope).utterance, first.utterance);
    assert.equal(scope.voiceResults.length, 0);
    assert.equal(service.records(scope).records.filter((row: any) => row.role === "task").length, 1);
  } finally { h.close(); }
});
