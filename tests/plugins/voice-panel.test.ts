import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVoicePanel } from "@olares/lares-core/voice/panel";
import { createVoiceController } from "@olares/lares-core/voice/controller";
import { createVoiceRecords } from "@olares/lares-core/voice/records";
import { projectVoiceRecords, mergeVoiceTranscript, subscribeVoiceHistory } from "@olares/lares-core/voice/projection";
import { createVoiceHostService } from "@olares/lares-core/voice/host-service";
const flush = () => new Promise((resolve) => setImmediate(resolve));
function panelHarness() {
  const calls: any[] = [], completed: any[] = [];
  const panel = createVoicePanel({ complete: async (value: any) => { completed.push(value); }, create: async (options: any) => {
    let say: any;
    const controller = createVoiceController({ onTranscript: options.onTranscript,
      input: { capture: () => new Promise((resolve) => { say = resolve; }), stop: () => say("dictated"), cancel: () => say("") },
      agent: { create: async () => "new", submit: async () => {}, running: async () => false, cancel: () => assert.fail("cancel task") }, output: { stop() {} } });
    const call = { controller, options, start: (args: any) => controller.start(args), stop: () => controller.disconnect(), pause: () => controller.pause(), resume: () => controller.resume(), say: (text: string) => say(text) };
    calls.push(call); return call;
  } });
  return { panel, calls, completed };
}
test("close finishes dictation into panel draft; reopening requires explicit capture", async () => {
  const h = panelHarness(); await h.panel.open({ sessionId: "old" }); await h.panel.start();
  await h.panel.close(); assert.equal(h.panel.getSnapshot().draft, "dictated"); assert.equal(h.completed.length, 0);
  assert.equal(h.panel.getSnapshot().snapshot.connection, "paused");
  await h.panel.open(); assert.equal(h.calls.length, 1); assert.equal(h.panel.getSnapshot().snapshot.capture, "idle");
  await h.panel.complete(); assert.deepEqual(h.completed, [{ sessionId: "old", text: "dictated" }]); await h.panel.dispose();
});
test("mode switching pauses first, retains dictation and never starts the second capture", async () => {
  const h = panelHarness(); await h.panel.open({ sessionId: "one" }); await h.panel.start();
  await h.panel.open({ mode: "continuous" }); assert.equal(h.calls[0].controller.getSnapshot().connection, "closed"); assert.equal(h.calls.length, 1);
  await h.panel.open({ mode: "single" }); assert.equal(h.panel.getSnapshot().draft, "dictated"); await h.panel.dispose();
});
test("session switch fences late draft callbacks to the original target", async () => {
  const h = panelHarness(); await h.panel.open({ sessionId: "one" }); await h.panel.start();
  await h.panel.bind("two"); h.calls[0].options.onTranscript({ text: "late" }); assert.equal(h.panel.getSnapshot().draft, "");
  await h.panel.bind("one"); assert.equal(h.panel.getSnapshot().draft, "dictated"); await h.panel.dispose();
});
test("double start and mount-independent reopening reuse one active connection", async () => {
  const h = panelHarness(); await h.panel.open({ mode: "continuous" }); await Promise.all([h.panel.start(), h.panel.start()]);
  assert.equal(h.calls.length, 1); await h.panel.close(); await h.panel.open(); assert.equal(h.calls.length, 1);
  await h.panel.start(); assert.equal(h.calls.length, 1); await h.panel.dispose();
});
test("records update in place, paginate, isolate owners and notify without audio", () => {
  const directory = mkdtempSync(join(tmpdir(), "panel-records-"));
  try {
    const store = createVoiceRecords({ directory }); let changes = 0; const off = store.subscribe("a", "s", () => changes++);
    const row = { id: "v:t:assistant", voiceId: "v", turnId: "t", role: "assistant", text: "hello", status: "streaming", anchorSeq: 8 };
    store.append("a", "s", row); store.append("a", "s", { ...row, text: "hello world", status: "completed" });
    store.append("a", "s", { ...row, id: "two" });
    const page = store.page("a", "s", { limit: 1 }); assert.equal(page.records[0].text, "hello world"); assert.equal(page.records[0].sequence, 1); assert.equal(page.next, 1);
    assert.equal(store.page("a", "s", { after: page.next }).records[0].id, "two"); assert.equal(store.page("b", "s").records.length, 0);
    assert.equal(changes, 3); off();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("native requests replace projected echoes; spoken task summaries attach to native result", () => {
  const records = [
    { id: "user", role: "user", text: "check", voiceId: "v", taskId: "req", sequence: 1, anchorSeq: 4 },
    { id: "reply", role: "assistant", text: "spoken summary", voiceId: "v", taskId: "req", taskTurn: 3, sequence: 2, anchorSeq: 8 },
  ];
  const native = [{ key: "input", type: "user", requestId: "req", anchorSeq: 5, turn: 3 }, { key: "output", type: "assistant", text: "full result", anchorSeq: 9, turn: 3 }];
  const rows = mergeVoiceTranscript(native, records); assert.equal(rows.length, 2); assert.equal(rows[1].voiceSummary, "spoken summary");
  assert.equal(projectVoiceRecords(records, []).length, 2);
});
test("stable server order places multi-client voice messages between native anchors", () => {
  const native = [{ type: "user", anchorSeq: 4 }, { type: "assistant", anchorSeq: 9 }];
  const records = [{ id: "a", role: "user", voiceId: "phone", text: "one", sequence: 1, anchorSeq: 4 }, { id: "b", role: "assistant", voiceId: "web", text: "two", sequence: 2, anchorSeq: 4 }];
  assert.deepEqual(mergeVoiceTranscript(native, records).map((r: any) => r.id || r.type), ["user", "a", "b", "assistant"]);
});
test("session history authorizes before reads and wakes on changes; no active voice required", async () => {
  const directory = mkdtempSync(join(tmpdir(), "panel-history-"));
  try {
    const records = createVoiceRecords({ directory }); let inspected = 0;
    const service = createVoiceHostService({ inspect: async (id: string) => { inspected++; if (id === "forbidden") throw new Error("denied"); } }, { records });
    const scope: any = { owner: "a" }; const pending = service.history(scope, { sessionId: "s", version: 0, waitMs: 1000 }); await flush();
    records.append("a", "s", { id: "one", voiceId: "v", turnId: "t", role: "user", text: "hello" });
    assert.equal((await pending).records.length, 1); assert.equal(inspected, 1);
    assert.equal((await service.history({ owner: "b" }, { sessionId: "s" })).records.length, 0);
    await assert.rejects(service.history(scope, { sessionId: "forbidden" }), /denied/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("history subscription has no playback path and fences results after unmount", async () => {
  let release: any, received = 0;
  const off = subscribeVoiceHistory({ sessionId: "s", request: () => new Promise((resolve) => { release = resolve; }), onRecords: () => received++ });
  off(); release({ ok: true, body: { records: [], version: 0 } }); await off.done; assert.equal(received, 0);
});

test("Lares creates a presentation session on first valid speech without prompting an agent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "panel-bind-")); let creates = 0; let prompts = 0;
  const api = { inspect: async () => ({}), create: async () => { creates++; return { sessionId: "new" }; }, prompt: async () => { prompts++; },
    async *follow(_: any, signal: AbortSignal) { yield { type: "snapshot", records: [] }; await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })); } };
  const service = createVoiceHostService(api, { records: createVoiceRecords({ directory }), config: () => ({ preset: "chat" }), chat: async () => ({ content: "hello" }) });
  const scope: any = { id: "v", owner: "a" };
  try {
    await service.open(scope, { presentationSession: true }); assert.equal(creates, 0);
    await assert.rejects(service.prompt(scope, { text: " ", requestId: "noise" })); assert.equal(creates, 0);
    await service.prompt(scope, { text: "hi", requestId: "valid" }); assert.equal(creates, 1); assert.equal(prompts, 0);
    assert.equal(service.state(scope).sessionId, "new"); assert.equal((await service.history(scope, { sessionId: "new" })).records.length, 2);
  } finally { await service.close(scope); rmSync(directory, { recursive: true, force: true }); }
});
