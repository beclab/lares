import assert from "node:assert/strict";
import test from "node:test";
import { hidesRunningClock, processFoldLabel, transcriptBlocks } from "@olares/lares-core/larepass/process-fold";
import { foldTranscript } from "@olares/lares-core/larepass/transcript";
import { createT } from "../../packages/mobile/src/i18n.js";

const zh = createT("zh");
const en = createT("en");

function events(end) {
  const rows = [
    { type: "turn/start", seq: 1, time: 1_000, data: { turn: 1 } },
    { type: "user/message", seq: 2, time: 1_000, data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
    { type: "assistant/chunk", seq: 3, time: 1_100, data: { turn: 1, chunk: { type: "reasoning-delta", text: "plan the file" } } },
    { type: "tool/call", seq: 4, time: 1_200, data: { turn: 1, callId: "c1", name: "read", arguments: "{}" } },
    { type: "tool/result", seq: 5, time: 1_300, data: { turn: 1, callId: "c1", message: { source: { callId: "c1" }, content: [] } } },
    { type: "assistant/chunk", seq: 6, time: 2_400, data: { turn: 1, chunk: { type: "text-delta", text: "done" } } },
  ];
  if (end) rows.push({ type: "turn/end", seq: 7, time: 3_000, data: { turn: 1, reason: end } });
  return rows;
}

function kinds(blocks) {
  return blocks.map((block) => (block.kind === "fold" ? "fold" : block.row.type));
}

test("a streaming reply keeps its row identity as chunks arrive", () => {
  const base = [
    { type: "turn/start", seq: 1, data: { turn: 1 } },
    { type: "user/message", seq: 2, data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
  ];
  const chunk = (seq, text) => ({
    type: "assistant/chunk",
    seq,
    data: { turn: 1, chunk: { type: "text-delta", text } },
  });
  const first = foldTranscript([...base, chunk(3, "hel")]);
  const second = foldTranscript([...base, chunk(3, "hel"), chunk(4, "lo")]);
  const reply = (snap) => snap.items.find((row) => row.type === "assistant");
  assert.equal(reply(first).key, reply(second).key);
  assert.equal(reply(second).text, "hello");
  const done = foldTranscript([
    ...base,
    chunk(3, "hel"),
    chunk(4, "lo"),
    { type: "assistant/message", seq: 5, data: { turn: 1, message: { content: [{ type: "text", text: "hello" }] } } },
    { type: "turn/end", seq: 6, data: { turn: 1, reason: { kind: "completed" } } },
  ]);
  assert.equal(reply(done).key, reply(first).key);

  const assistantKey = (items) => transcriptBlocks(items, { running: true })
    .find((block) => block.row?.type === "assistant")?.key;
  assert.equal(
    assistantKey(second.items),
    assistantKey([{ type: "user", text: "earlier", key: "voice:1" }, ...second.items]),
  );
});

test("a settled turn folds reasoning and tool calls behind one header", () => {
  const folded = foldTranscript(events({ kind: "completed" }));
  const blocks = transcriptBlocks(folded.items, { running: folded.running });
  assert.deepEqual(kinds(blocks), ["user", "fold", "assistant"]);
  const fold = blocks.find((block) => block.kind === "fold");
  assert.equal(fold.foldable, true);
  assert.deepEqual(fold.members.map((member) => member.row.type), ["reasoning", "tool"]);
  assert.equal(processFoldLabel(zh, fold), "已完成，用时 2秒");
  assert.equal(processFoldLabel(en, fold), "Completed in 2s");
});

test("reply chrome waits until the turn settles, not until one assistant message lands", () => {
  const mid = foldTranscript([
    { type: "turn/start", seq: 1, time: 1_000, data: { turn: 1 } },
    { type: "user/message", seq: 2, data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
    { type: "assistant/message", seq: 3, data: { turn: 1, message: { content: [{ type: "text", text: "looking" }] } } },
    { type: "tool/call", seq: 4, data: { turn: 1, callId: "c1", name: "read", arguments: "{}" } },
  ]);
  assert.equal(mid.running, true);
  const live = transcriptBlocks(mid.items, { running: true });
  const answer = live.find((block) => block.row?.type === "assistant");
  assert.equal(answer.row.pending, undefined);
  assert.equal(answer.settled, false);

  const done = foldTranscript(events({ kind: "completed" }));
  const closed = transcriptBlocks(done.items, { running: done.running });
  assert.equal(closed.find((block) => block.row?.type === "assistant").settled, true);

  const next = [
    ...done.items,
    { type: "user", text: "again", turn: 2 },
    { type: "assistant", text: "still going", turn: 2 },
  ];
  const answers = transcriptBlocks(next, { running: true }).filter((block) => block.row?.type === "assistant");
  assert.deepEqual(answers.map((block) => block.settled), [true, false]);
});

test("a running turn with a reply folds finished work and keeps the clock", () => {
  const open = foldTranscript(events());
  assert.equal(open.running, true);
  const blocks = transcriptBlocks(open.items, { running: true });
  assert.deepEqual(kinds(blocks), ["user", "fold", "assistant"]);
  const fold = blocks.find((block) => block.kind === "fold");
  assert.equal(fold.phase, "summary");
  assert.equal(processFoldLabel(zh, fold), "已读取文件");
  assert.equal(hidesRunningClock(blocks), false);

  const settled = foldTranscript(events({ kind: "completed" }));
  const pending = [...settled.items, { type: "user", text: "next", pending: true }];
  assert.deepEqual(kinds(transcriptBlocks(pending, { running: true })), ["user", "fold", "assistant", "user"]);
});

test("a running turn shows one live activity line instead of each step", () => {
  const thinking = foldTranscript([
    { type: "turn/start", seq: 1, time: 1_000, data: { turn: 1 } },
    { type: "user/message", seq: 2, data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
    { type: "assistant/chunk", seq: 3, data: { turn: 1, chunk: { type: "reasoning-delta", text: "plan the file" } } },
  ]);
  const thought = transcriptBlocks(thinking.items, { running: true });
  assert.deepEqual(kinds(thought), ["user", "fold"]);
  assert.equal(thought[1].phase, "live");
  assert.equal(processFoldLabel(zh, thought[1]), "正在分析请求 · plan the file");
  assert.equal(hidesRunningClock(thought), true);

  const calling = foldTranscript([
    { type: "turn/start", seq: 1, time: 1_000, data: { turn: 1 } },
    { type: "user/message", seq: 2, data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
    {
      type: "tool/call",
      seq: 3,
      data: { turn: 1, callId: "c1", name: "read", arguments: JSON.stringify({ path: "notes.md" }) },
    },
  ]);
  const tool = transcriptBlocks(calling.items, { running: true });
  assert.deepEqual(kinds(tool), ["user", "fold"]);
  assert.equal(processFoldLabel(zh, tool[1]), "正在读取文件 · notes.md");
  assert.equal(processFoldLabel(en, tool[1]), "Reading files · notes.md");

  const other = foldTranscript([
    { type: "turn/start", seq: 1, time: 1_000, data: { turn: 1 } },
    { type: "user/message", seq: 2, data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
    { type: "tool/call", seq: 3, data: { turn: 1, callId: "c1", name: "workspace_publish", arguments: "{}" } },
  ]);
  const generic = transcriptBlocks(other.items, { running: true });
  assert.equal(processFoldLabel(zh, generic[1]), "正在调用工具 · workspace_publish");
});

test("an answer with no process has no fold", () => {
  const folded = foldTranscript([
    { type: "turn/start", seq: 1, time: 1_000, data: { turn: 1 } },
    { type: "user/message", seq: 2, data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
    { type: "assistant/message", seq: 3, data: { turn: 1, message: { content: [{ type: "text", text: "hello" }] } } },
    { type: "turn/end", seq: 4, time: 2_000, data: { turn: 1, reason: { kind: "completed" } } },
  ]);
  assert.deepEqual(kinds(transcriptBlocks(folded.items)), ["user", "assistant"]);
});

test("a failed or stopped turn keeps its process visible", () => {
  const failed = transcriptBlocks(foldTranscript(events({ kind: "error" })).items);
  const failure = failed.find((block) => block.kind === "fold");
  assert.equal(failure.foldable, false);
  assert.equal(processFoldLabel(zh, failure), "处理失败");

  const stopped = transcriptBlocks(foldTranscript(events({ kind: "aborted" })).items);
  const abort = stopped.find((block) => block.kind === "fold");
  assert.equal(abort.foldable, false);
  assert.equal(processFoldLabel(zh, abort), "已停止");
});

test("context injected beside the work collapses with it", () => {
  const folded = foldTranscript([
    { type: "turn/start", seq: 1, time: 1_000, data: { turn: 1 } },
    { type: "user/message", seq: 2, data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
    {
      type: "user/message",
      seq: 3,
      data: {
        content: [{ type: "text", text: "note" }],
        source: { kind: "agent-instructions", form: "instructions", changes: [{ path: "AGENTS.md" }] },
      },
    },
    { type: "assistant/message", seq: 4, data: { turn: 1, message: { content: [{ type: "reasoning", text: "think" }, { type: "text", text: "ok" }] } } },
    { type: "turn/end", seq: 5, time: 2_000, data: { turn: 1, reason: { kind: "completed" } } },
  ]);
  const blocks = transcriptBlocks(folded.items);
  assert.deepEqual(kinds(blocks), ["user", "fold", "assistant"]);
  assert.deepEqual(
    blocks.find((block) => block.kind === "fold").members.map((member) => member.row.type),
    ["context", "reasoning"],
  );
});
