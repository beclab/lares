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

test("a step reports the first message its history rewrote, and null while history only grew", () => {
  const reports: any[] = [];
  const trace = createAgentPromptTrace({ report: (fields: any) => reports.push(fields) });
  trace.step("s1", [{ role: "user", content: "weather" }]);
  trace.step("s1", [{ role: "user", content: "weather" }, { role: "assistant", content: "18°C" }]);
  trace.step("s1", [{ role: "user", content: "[omitted]" }, { role: "assistant", content: "18°C" }, { role: "user", content: "light" }]);
  trace.step("s1", [{ role: "user", content: "[omitted]" }]);
  assert.deepEqual(reports.map((item) => item.firstChanged), [null, null, 0, 1]);
});

test("the spoken rule is reported once per Session and again when it changes", () => {
  const reports: any[] = [];
  const trace = createAgentPromptTrace({ report: (fields: any) => reports.push(fields) });
  trace.rule("s1", true, false); trace.rule("s1", true, false); trace.rule("s1", false, false);
  assert.deepEqual(reports.map((item) => item.device), [true, false]);
});
