#!/usr/bin/env node
/**
 * Runs the voice dialogue scenarios against live models through Router, using
 * Lares's own dialogue code, prompt and tool handling. Run it where Lares runs
 * (inside the Lares pod), so Router sees the same identity and network path.
 *
 *   node scripts/voice-eval/run.mjs                      # default-chat, 3 runs each
 *   node scripts/voice-eval/run.mjs --runs 5 --model default-chat --model Olares/x/y
 *   node scripts/voice-eval/run.mjs --only light-on-zh,clarify-answer
 *   node scripts/voice-eval/run.mjs --effort none          # force a reasoning_effort on every chat call
 *   node scripts/voice-eval/run.mjs --dialogue ../../packages/core/voice/dialogue.next.js   # a working copy
 *   node scripts/voice-eval/run.mjs --json /tmp/base.json  # also write every run's result, for compare.mjs
 *
 * From a workstation, scripts/voice-eval/remote.sh uploads these files and a working copy into the
 * pod, runs them there and fetches the results.
 */
import { writeFileSync } from "node:fs";
import { DEVICE_TOOLS, PERSONA, SCENARIOS, cameraFrame } from "./scenarios.mjs";

const args = process.argv.slice(2);
const values = (flag) => args.flatMap((value, index) => (args[index - 1] === flag ? [value] : []));
const models = values("--model").length ? values("--model") : ["default-chat"];
const runs = Number(values("--runs")[0] || 3);
const only = values("--only")[0]?.split(",");
const scenarios = SCENARIOS.filter((scenario) => !only || only.includes(scenario.id));
const effort = values("--effort")[0];
const json = values("--json")[0];
// A working copy placed beside the real module keeps its relative imports.
const { createVoiceDialogue, voiceChat } = await import(new URL(values("--dialogue")[0] || "../../packages/core/voice/dialogue.js", import.meta.url));

// voiceChat builds its own request body, so a trial parameter is added on the way out.
if (effort) {
  const send = globalThis.fetch;
  globalThis.fetch = (url, init = {}) => {
    if (String(url).endsWith("/chat/completions") && typeof init.body === "string") init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), reasoning_effort: effort }) };
    return send(url, init);
  };
}

// default-chat follows whatever model Router serves right now, so every pass records which model
// actually answered.
const served = new Set();
const sendChat = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const response = await sendChat(url, init);
  if (String(url).endsWith("/chat/completions")) response.clone().text().then((body) => {
    const name = body.match(/"model"\s*:\s*"([^"]+)"/)?.[1];
    if (name) served.add(name);
    // voiceChat reports any refusal as voice_chat_failed; what Router said is only visible here.
    if (!response.ok) console.error(`Router ${response.status}: ${body.slice(0, 300)}`);
  }, () => {});
  return response;
};

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
  // Earlier turns played the way the robot plays them, so history holds real tool calls, their outputs
  // and the camera frame rather than words alone. A camera call is answered with the frame; any other
  // device call with ok. Only the scored turn below is checked.
  try {
    for (const [index, turn] of (scenario.prelude || []).entries()) {
      let reply = await dialogue.reply(turn.say, `eval:prelude${index}`, undefined, () => {});
      for (let step = 0; step < 3 && reply.calls.length; step++) {
        for (const call of reply.calls) dialogue.toolOutput(call.call_id, call.name === "camera" ? JSON.stringify({ image_attached: true }) : JSON.stringify({ status: "ok" }));
        if (reply.calls.some((call) => call.name === "camera")) dialogue.observe([{ type: "image_url", image_url: { url: cameraFrame() } }]);
        reply = await dialogue.reply(null, `eval:prelude${index}:${step}`, undefined, () => {});
      }
    }
  } catch (error) {
    return { text: "", calls: [], delegations, error: `prelude: ${error.message}`, ms: 0 };
  }
  delegations.length = 0;
  const started = performance.now();
  try {
    if (scenario.after) {
      // The device's own flow: the user's turn calls a device tool, the device answers it (a camera
      // also sends its frame), and the dialogue continues on that result.
      const first = await dialogue.reply(scenario.say, "eval", undefined, () => {});
      const call = first.calls.find((item) => item.name === scenario.after.tool);
      if (!call) return { ...first, delegations, error: `no ${scenario.after.tool} call to continue from`, ms: Math.round(performance.now() - started) };
      for (const other of first.calls) dialogue.toolOutput(other.call_id, other === call ? scenario.after.output : JSON.stringify({ status: "ok" }));
      if (scenario.after.image) dialogue.observe([{ type: "image_url", image_url: { url: scenario.after.image() } }]);
      let reply = await dialogue.reply(null, "eval:after", undefined, () => {});
      // A gesture with no words is a step, not an answer: the device reports it and asks again.
      const gestures = [];
      for (let step = 0; step < 2 && !reply.text.trim() && reply.calls.length; step++) {
        gestures.push(...reply.calls);
        for (const item of reply.calls) dialogue.toolOutput(item.call_id, JSON.stringify({ status: "ok" }));
        reply = await dialogue.reply(null, `eval:after${step}`, undefined, () => {});
      }
      return { ...reply, calls: [...gestures, ...reply.calls], first, delegations, ms: Math.round(performance.now() - started) };
    }
    const reply = scenario.announce
      ? await dialogue.reply(null, "task:r1", undefined, undefined, { announce: true })
      : await dialogue.reply(scenario.say, "eval", undefined, () => {});
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
const report = { runs, effort: effort || null, dialogue: values("--dialogue")[0] || null, models: {} };
for (const model of models) {
  report.models[model] = {};
  console.log(`\n=== ${model} · ${runs} run(s) per scenario${effort ? ` · reasoning_effort=${effort}` : ""}`);
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
    report.models[model][scenario.id] = { passed, runs, ms, results: results.map(({ run, problems }) => ({ problems, did: describe(run) })) };
    for (const { run, problems } of results) console.log(`     ${problems.length ? `✗ ${problems.join("; ")}` : "✓"}  ${describe(run).slice(0, 260)}`);
  }
  report.models[model].served = [...served];
  console.log(`--- ${model} (served by ${[...served].join(", ") || "unknown"}): ${passedAll}/${scenarios.length} scenarios passed every run`);
  served.clear();
}
if (json) writeFileSync(json, JSON.stringify(report, null, 2));
process.exitCode = failed ? 1 : 0;
