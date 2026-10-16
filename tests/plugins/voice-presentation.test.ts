import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("external presentation activity opens the official chat without manufacturing execution events", () => {
  const source = readFileSync(new URL("../../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js", import.meta.url), "utf8");
  const start = source.indexOf("var BoundConversation = class");
  const end = source.indexOf("/** Root service owning Conversation", start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start + "var BoundConversation = ".length, end).trim().replace(/;$/, "");
  let replacements = 0;
  const assembler = { activityTargets: () => new Set(), openTurn: () => null, replaceWindow: () => { replacements++; return "none"; } };
  const store = { createSnapshotStore(initial: any) { let value = initial; return { getSnapshot: () => value, set: (next: any) => { value = next; } }; } };
  const Bound = new Function("_deepseek_ai_dsh_client_store", `return (${body})`)(store);
  const bound = new Bound({ getSnapshot: () => ({ entries: [], revision: 0, hasMore: false }), subscribe: () => () => {} }, assembler);
  bound.setExternalActivity("voice", "chat", true); assert.equal(bound.snapshot.getSnapshot().activeTargets.has("chat"), true);
  bound.setExternalActivity("other", "chat", true); bound.setExternalActivity("voice", "chat", false);
  assert.equal(bound.snapshot.getSnapshot().activeTargets.has("chat"), true);
  bound.setExternalActivity("other", "chat", false); assert.equal(bound.snapshot.getSnapshot().activeTargets.size, 0);
  assert.equal(replacements, 1); bound.dispose();
});
