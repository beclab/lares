import assert from "node:assert/strict";
import test from "node:test";
import {
  LARES_PUBLISHED_KEY,
  laresPublishedDefinition,
} from "../../packages/core/files/published-turn-data.js";

function result(turn: number, seq: number, callId: string, isError = false) {
  return {
    type: "tool/result",
    seq,
    surfaceOp: "append",
    data: {
      turn,
      message: {
        source: { callId },
        content: [{ type: "tool-result", isError }],
      },
    },
  };
}

function replay(events: any[]) {
  let state: any;
  for (const event of events) {
    const matched = laresPublishedDefinition.match(event);
    if (!matched) continue;
    const match = { ...matched, event };
    state = matched.role === "start"
      ? laresPublishedDefinition.start({}, match)
      : laresPublishedDefinition.update({ state }, match);
  }
  return state;
}

test("historical workspace_publish calls replay into turn data", () => {
  const state = replay([
    { type: "turn/start", seq: 1, data: { turn: 4 } },
    {
      type: "tool/call",
      seq: 2,
      surfaceOp: "append",
      data: {
        turn: 4,
        callId: "publish-1",
        name: "workspace_publish",
        arguments: JSON.stringify({ path: "drive/Data/flowstudio/output.webp" }),
      },
    },
    result(4, 3, "publish-1"),
  ]);
  assert.deepEqual(state.published, [{
    seq: 3,
    path: "drive/Data/flowstudio/output.webp",
    callId: "publish-1",
  }]);
  assert.deepEqual(
    laresPublishedDefinition.buildLocationData({ state }, "turn"),
    {
      kind: "turn",
      turn: 4,
      key: LARES_PUBLISHED_KEY,
      value: { published: state.published },
    },
  );
});

test("historical publish replay accepts persisted results without a surface operation", () => {
  const completed: any = result(1, 3, "publish");
  delete completed.surfaceOp;
  const state = replay([
    { type: "turn/start", seq: 1, data: { turn: 1 } },
    {
      type: "tool/call",
      seq: 2,
      data: {
        turn: 1,
        callId: "publish",
        name: "workspace_publish",
        arguments: { path: "drive/Data/flowstudio/clip.mp4" },
      },
    },
    completed,
  ]);
  assert.deepEqual(state.published, [{
    seq: 3,
    path: "drive/Data/flowstudio/clip.mp4",
    callId: "publish",
  }]);
});

test("replay drops research fetches, failures, replacements, and duplicates", () => {
  const state = replay([
    { type: "turn/start", seq: 1, data: { turn: 2 } },
    {
      type: "tool/call",
      seq: 2,
      data: {
        turn: 2,
        callId: "research",
        name: "url_fetch",
        arguments: JSON.stringify({ destination: "downloads/catalog.json" }),
      },
    },
    result(2, 3, "research"),
    {
      type: "tool/call",
      seq: 4,
      data: {
        turn: 2,
        callId: "media",
        name: "url_fetch",
        arguments: JSON.stringify({ destination: "downloads/card.png" }),
      },
    },
    result(2, 5, "media", true),
    {
      type: "tool/call",
      seq: 6,
      data: {
        turn: 2,
        callId: "publish-a",
        name: "workspace_publish",
        arguments: { path: "outputs/card.png" },
      },
    },
    { ...result(2, 7, "publish-a"), surfaceOp: "replace" },
    result(2, 8, "publish-a"),
    {
      type: "tool/call",
      seq: 9,
      data: {
        turn: 2,
        callId: "publish-b",
        name: "workspace_publish",
        arguments: JSON.stringify({ path: "outputs/card.png" }),
      },
    },
    result(2, 10, "publish-b"),
  ]);
  assert.deepEqual(state.published, [{
    seq: 8,
    path: "outputs/card.png",
    callId: "publish-a",
  }]);
});
