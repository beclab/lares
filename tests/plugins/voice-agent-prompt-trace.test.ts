import assert from "node:assert/strict";
import test from "node:test";
import { createAgentPromptTrace } from "@olares/lares-core/voice/agent-prompt-trace";

const assembly = (persona: string, spoken = "rule") => ({ sections: [{ name: "persona", text: persona }, { name: "app:spoken-reply", text: spoken }], contexts: [{ name: "time", text: "noon" }], tools: [{ name: "bash" }] });

test("a Session's prompt is reported first in full and later only when a part changed, by name", () => {
  const reports: any[] = [];
  const trace = createAgentPromptTrace({ report: (fields: any) => reports.push(fields) });
  trace.assembled("s1", assembly("you are Lares"), { deviceRule: true });
  trace.assembled("s1", assembly("you are Lares"), { deviceRule: true });
  trace.assembled("s1", assembly("you are Lares, titled"), { deviceRule: true });
  assert.equal(reports.length, 2);
  assert.equal(reports[0].first, true);
  assert.equal(reports[0].deviceRule, true);
  assert.deepEqual(reports[1].changed, ["section:persona"]);
  assert.ok(!JSON.stringify(reports).includes("you are Lares"), "only hashes leave the process");
});

test("a request reports the first message that differs from the Session's previous request, by shape only", () => {
  const reports: any[] = [];
  const trace = createAgentPromptTrace({ report: (fields: any) => reports.push(fields) });
  const system = { role: "system", content: "you are Lares" }, user = { role: "user", content: "weather" };
  const result = { role: "tool", tool_call_id: "t1", content: "a long search result" };
  trace.request("s1", [system, user]);
  trace.request("s1", [system, user, result]);
  trace.request("s1", [system, user, { ...result, content: "[result omitted]" }, { role: "user", content: "light" }]);
  assert.deepEqual(reports.map((item) => item.firstChanged), [null, null, 2]);
  assert.equal(reports[2].changedRole, "tool");
  assert.equal(reports[2].before.keys, "content,role,tool_call_id");
  assert.ok(reports[2].before.chars > reports[2].after.chars);
  assert.ok(!JSON.stringify(reports).includes("search result") && !JSON.stringify(reports).includes("Lares"), "no content is reported");
});

test("the spoken rule is reported once per Session and again when it changes", () => {
  const reports: any[] = [];
  const trace = createAgentPromptTrace({ report: (fields: any) => reports.push(fields) });
  trace.rule("s1", true, false); trace.rule("s1", true, false); trace.rule("s1", false, false);
  assert.deepEqual(reports.map((item) => item.device), [true, false]);
});
