#!/usr/bin/env node
/**
 * Runs the voice dialogue scenarios against live models through Router, using
 * Lares's own dialogue code, prompt and tool handling. Run it where Lares runs
 * (inside the Lares pod), so Router sees the same identity and network path.
 *
 *   node scripts/voice-eval/run.mjs                      # default-chat, 3 runs each
 *   node scripts/voice-eval/run.mjs --runs 5 --model default-chat --model Olares/x/y
 *   node scripts/voice-eval/run.mjs --only light-on-zh,clarify-answer
 */
import { createVoiceDialogue, voiceChat } from "../../packages/core/voice/dialogue.js";
import { DEVICE_TOOLS, PERSONA, SCENARIOS } from "./scenarios.mjs";

const args = process.argv.slice(2);
const values = (flag) => args.flatMap((value, index) => (args[index - 1] === flag ? [value] : []));
const models = values("--model").length ? values("--model") : ["default-chat"];
const runs = Number(values("--runs")[0] || 3);
const only = values("--only")[0]?.split(",");
const scenarios = SCENARIOS.filter((scenario) => !only || only.includes(scenario.id));

async function once(scenario, model) {
  const delegations = [];
  const dialogue = createVoiceDialogue({
    config: { chatModel: model },
    agent: true,
    owner: "",
    context: scenario.context || [],
    chat: voiceChat,
    submit: async (task, requestId, operation) => { delegations.push({ task, operation }); return { status: "pending", requestId: `${requestId}:delegate` }; },
  });
  dialogue.setClientTools(DEVICE_TOOLS);
  dialogue.setInstructions(PERSONA, 8000);
  for (const task of scenario.tasks || []) dialogue.observeTask(task);
  const started = performance.now();
  try {
    const reply = await dialogue.reply(scenario.say, "eval", undefined, () => {});
    return { ...reply, delegations, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { text: "", calls: [], delegations, error: error.message, ms: Math.round(performance.now() - started) };
  }
}

const describe = (run) => [
  ...run.delegations.map((item) => `ask_lares(${item.operation}${item.task ? `: ${item.task}` : ""})`),
  ...run.calls.map((call) => `${call.name}(${call.arguments})`),
  run.error ? `ERROR ${run.error}` : JSON.stringify(run.text.trim()),
].join(" · ");

let failed = 0;
for (const model of models) {
  console.log(`\n=== ${model} · ${runs} run(s) per scenario`);
  let passedAll = 0;
  for (const scenario of scenarios) {
    const results = [];
    for (let i = 0; i < runs; i++) {
      const run = await once(scenario, model);
      results.push({ run, problems: scenario.expect(run) });
    }
    const passed = results.filter((result) => !result.problems.length).length;
    if (passed === runs) passedAll++; else failed++;
    const ms = Math.round(results.reduce((sum, result) => sum + result.run.ms, 0) / runs);
    console.log(`${passed === runs ? "PASS" : "FAIL"} ${scenario.id.padEnd(18)} ${passed}/${runs}  ~${ms} ms  ${scenario.issue}`);
    for (const { run, problems } of results) console.log(`     ${problems.length ? `✗ ${problems.join("; ")}` : "✓"}  ${describe(run).slice(0, 260)}`);
  }
  console.log(`--- ${model}: ${passedAll}/${scenarios.length} scenarios passed every run`);
}
process.exitCode = failed ? 1 : 0;
