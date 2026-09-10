import assert from "node:assert/strict";
import test from "node:test";
import {
  clockParts,
  createTurnMetrics,
  durationParts,
  latencySeconds,
  throughputTokens,
} from "@olares/lares-core/larepass/turn-metrics";
import { foldTranscript } from "@olares/lares-core/larepass/transcript";
import { metricsLine } from "../../packages/mobile/src/chat/format.js";
import { createT } from "../../packages/mobile/src/i18n.js";

// Local wall clock, so the rendered "21:42" holds in any test-runner zone.
const START = new Date(2026, 8, 10, 21, 42, 0).getTime();

/** One completed turn: two model calls, a tool between them, usage on each. */
function turnEvents() {
  return [
    { type: "turn/start", seq: 1, time: START, data: { turn: 1 } },
    { type: "user/message", seq: 2, time: START + 10, data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } } },
    { type: "step/start", seq: 3, time: START + 100, data: { turn: 1, step: 0 } },
    { type: "assistant/chunk", seq: 4, time: START + 2100, data: { turn: 1, step: 0, chunk: { type: "text-delta", text: "one " } } },
    {
      type: "assistant/message",
      seq: 5,
      time: START + 4100,
      data: { turn: 1, step: 0, message: { content: [{ type: "text", text: "one " }] }, usage: { outputTokens: 40 } },
    },
    { type: "step/start", seq: 6, time: START + 4200, data: { turn: 1, step: 1 } },
    { type: "assistant/chunk", seq: 7, time: START + 5200, data: { turn: 1, step: 1, chunk: { type: "text-delta", text: "two" } } },
    {
      type: "assistant/message",
      seq: 8,
      time: START + 7200,
      data: { turn: 1, step: 1, message: { content: [{ type: "text", text: "two" }] }, usage: { outputTokens: 60 } },
    },
    { type: "turn/end", seq: 9, time: START + 20000, data: { turn: 1, reason: { kind: "completed" } } },
  ];
}

test("a turn's readings come off the session log's own timestamps", () => {
  const metrics = createTurnMetrics();
  for (const event of turnEvents()) metrics.observe(event);

  const value = metrics.value(1);
  assert.equal(value?.runMs, 20000);
  // The first step's wait is the one a person sat through.
  assert.equal(value?.ttftMs, 2000);
  // 100 output tokens over 4s of decode across both steps.
  assert.equal(value?.tokensPerSecond, 25);
  assert.equal(value?.time, START + 7200);
});

test("an open turn and an untimed log report nothing rather than guessing", () => {
  const open = createTurnMetrics();
  for (const event of turnEvents().slice(0, -1)) open.observe(event);
  assert.equal(open.value(1), null);
  assert.equal(open.value(7), null);

  // Older hosts and synthetic events carry no `time`; no reading is derivable.
  const untimed = createTurnMetrics();
  for (const event of turnEvents()) untimed.observe({ ...event, time: undefined });
  assert.equal(untimed.value(1), null);

  // A turn whose steps never reported usage still shows when and how long.
  const partial = createTurnMetrics();
  for (const event of turnEvents()) {
    partial.observe(event.type === "assistant/message"
      ? { ...event, data: { ...event.data, usage: undefined } }
      : event);
  }
  const value = partial.value(1);
  assert.equal(value?.runMs, 20000);
  assert.equal(value?.tokensPerSecond, undefined);
});

test("the readings ride the reply that closes the turn", () => {
  const folded = foldTranscript(turnEvents());
  const replies = folded.items.filter((row) => row.type === "assistant");

  assert.equal(replies.length, 2);
  assert.equal(replies[0].metrics, undefined);
  assert.equal(replies[1].metrics.runMs, 20000);
});

test("the footer drops the readings the log never recorded", () => {
  const en = createT("en");
  const zh = createT("zh");
  const now = START + 60000;

  assert.equal(
    metricsLine({ time: START + 7200, runMs: 20000, ttftMs: 6000, tokensPerSecond: 36 }, en, now),
    "21:42 · Ran for 20s · TTFT 6s · 36 tok/s",
  );
  assert.equal(
    metricsLine({ time: START + 7200, runMs: 162000, ttftMs: 6000, tokensPerSecond: 36 }, en, now),
    "21:42 · Ran for 2m 42s · TTFT 6s · 36 tok/s",
  );
  assert.equal(
    metricsLine({ time: START + 7200, runMs: 20000 }, en, now),
    "21:42 · Ran for 20s",
  );
  assert.equal(metricsLine(null, en, now), "");
  assert.equal(
    metricsLine({ time: START + 7200, runMs: 20000, ttftMs: 6000 }, zh, now),
    "21:42 · 用时 20秒 · 首 token 6秒",
  );
  // Off today's calendar day the clock alone would be ambiguous.
  assert.equal(
    metricsLine({ time: START + 7200, runMs: 20000 }, en, START + 86400000 * 3),
    "9/10 21:42 · Ran for 20s",
  );
});

test("readings round the way the harness rounds them", () => {
  assert.deepEqual(durationParts(20400), { minutes: 0, seconds: "20" });
  assert.deepEqual(durationParts(162000), { minutes: 2, seconds: "42" });
  assert.equal(latencySeconds(6250), "6.3");
  assert.equal(latencySeconds(12400), "12");
  assert.equal(throughputTokens(36.4), "36");
  assert.equal(throughputTokens(3.44), "3.4");
  assert.equal(clockParts(START, START).scope, "day");
  assert.equal(clockParts(START, START + 86400000 * 400).scope, "ymd");
});
