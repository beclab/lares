import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantLeakedToolCall,
  leakedToolCallHint,
  leakedToolCallInTurn,
  leakedToolCallSteerText,
} from "@olares/lares-core/agent/leaked-tool-call";

const leaked = {
  content: [
    {
      type: "reasoning",
      text: "用户想了解有哪些灯。\n</parameter>\n<parameter=description>\nList all available lights\n</parameter>\n</function>\n</tool_call>",
    },
  ],
};

test("a tool-call tail in reasoning with no tool call is a leak", () => {
  assert.equal(assistantLeakedToolCall(leaked), true);
  assert.equal(leakedToolCallHint(leaked), "description=List all available lights");
  assert.match(leakedToolCallSteerText(leakedToolCallHint(leaked)), /List all available lights/);
});

test("a real tool call is not a leak", () => {
  assert.equal(assistantLeakedToolCall({
    content: [
      { type: "reasoning", text: "先查灯。</tool_call>" },
      { type: "tool-call", name: "bash", arguments: {} },
    ],
  }), false);
});

test("only the current turn's assistant message counts", () => {
  const events = [
    { type: "assistant/message", data: { turn: 1, message: leaked } },
    { type: "assistant/message", data: { turn: 2, message: { content: [{ type: "text", text: "好的" }] } } },
  ];
  assert.equal(leakedToolCallInTurn(events, 1), true);
  assert.equal(leakedToolCallInTurn(events, 2), false);
});
