// Compares three ways of routing a device turn on a live model: today's tool_choice "auto"
// (base), every reply as a tool with a speak tool and tool_choice "required" (A), and a forced
// route() call that only classifies (B). The request is the dialogue's own first request.
//   node scripts/voice-eval/route-probe.mjs <model> [runs] [base|A|B] > out.json   (inside the Lares pod)
import { createVoiceDialogue, voiceChat } from "../../packages/core/voice/dialogue.js";
import { DEVICE_TOOLS, PERSONA } from "./scenarios.mjs";

const [model, runs = "3", only = ""] = process.argv.slice(2);
// parallel_tool_calls rides on the request body; voiceChat does not pass it.
const send = globalThis.fetch;
globalThis.fetch = (url, init = {}) => {
  if (String(url).endsWith("/chat/completions") && typeof init.body === "string" && init.body.includes('"tool_choice":"required"')) init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), parallel_tool_calls: false }) };
  return send(url, init);
};
const yellow = [{ role: "user", text: "能帮我开下灯，并且把它变成黄色吗？" }, { role: "assistant", text: "灯已为您打开并调整为黄色。" }];
const cup = [{ role: "user", text: "看看我手上有啥。" }, { role: "assistant", text: "你手上拿着一个白色的杯子。" }];
const lit = [{ role: "user", text: "Turn on the light." }, { role: "assistant", text: "The living room light is on." }];
const CASES = [
  ["你好。", [], ["speak", "motion"]],
  ["你好，你能帮我开一下灯吗？", [], ["lares"]],
  ["帮我再关一下灯。", [], ["lares"]],
  ["能帮我开下灯，并且把它调整成白色吗？", [], ["lares"]],
  ["能把它变成白色吗？", yellow, ["lares"]],
  ["这个灯光并没有变成白色。", [...yellow, { role: "user", text: "能把它变成白色吗？" }, { role: "assistant", text: "将灯光调整为白色中。" }], ["lares"]],
  ["调亮一点。", yellow, ["lares"]],
  ["Make it warmer.", lit, ["lares"]],
  ["空调调到二十六度。", [], ["lares"]],
  ["北京今天天气怎么样？", [], ["lares"]],
  ["明天早上八点提醒我开会。", [], ["lares"]],
  ["What's the weather in Shanghai?", [], ["lares"]],
  ["Turn off the lights please.", [], ["lares"]],
  ["看看我手上有啥。", [], ["camera"]],
  ["你再看看，它不是杯子。", cup, ["camera"]],
  ["Look at me, what am I wearing?", [], ["camera"]],
  ["点点头。", [], ["motion"]],
  ["跳个舞吧。", [], ["motion"]],
  ["Can you nod your head?", [], ["motion"]],
  ["你是谁？", [], ["speak"]],
  ["讲个笑话吧。", [], ["speak"]],
  ["谢谢你。", [], ["speak", "motion"]],
  ["軍刀。", [], ["speak"]],
  ["你能飞起来吗？", [], ["speak", "motion"]],
  ["I'm feeling a bit tired today.", [], ["speak", "motion"]],
  ["What's your name?", [], ["speak"]],
];

const SPEAK = { type: "function", function: { name: "speak", description: "Say something to the user. Every reply that is only words goes here.", parameters: { type: "object", properties: { text: { type: "string", description: "What to say" } }, required: ["text"] } } };
const ROUTE = { type: "function", function: { name: "route", description: "Choose who handles the user's latest words.", parameters: { type: "object", properties: { route: { type: "string", enum: ["lares", "camera", "motion", "speak"], description: "lares: home devices (lights, air conditioning...), weather, news, time, reminders, schedules, anything looked up or done for the user. camera: the robot must look to answer. motion: move the head, show an emotion, dance. speak: chat or a question the robot answers in words itself." } }, required: ["route"] } } };

async function firstRequest(say, context) {
  let captured;
  const dialogue = createVoiceDialogue({ config: { chatModel: model }, agent: true, owner: "", context, chat: async (request) => { captured ??= request; return { role: "assistant", content: "ok" }; }, submit: async () => ({ status: "pending" }) });
  dialogue.setClientTools(DEVICE_TOOLS);
  dialogue.setInstructions(PERSONA, 8000);
  await dialogue.reply(say, "probe", undefined, () => {});
  return captured;
}

const routeOf = (answer, variant) => {
  const calls = (answer.tool_calls || []).map((call) => call.function?.name);
  if (variant === "B") {
    try { return JSON.parse(answer.tool_calls?.[0]?.function?.arguments || "{}").route || "none"; } catch { return "bad-json"; }
  }
  if (calls.includes("ask_lares")) return "lares";
  if (calls.includes("camera")) return "camera";
  if (calls.some((name) => name && name !== "speak")) return "motion";
  if (calls.includes("speak")) return "speak";
  return variant === "A" ? "no-tool" : "speak";
};

const rows = [];
// A greeting goes out with no tools (the dialogue's greeting gate); A and B still need them.
const reference = (await firstRequest("讲个笑话吧。", [])).tools;
for (const [say, context, expect] of CASES) {
  const captured = await firstRequest(say, context);
  const request = { ...captured, tools: captured.tools || reference };
  const variants = {
    base: { ...captured, onDelta: undefined },
    A: { ...request, onDelta: undefined, tools: [...request.tools, SPEAK], toolChoice: "required", messages: [{ ...request.messages[0], content: `${request.messages[0].content}\n\nReply only through tools: anything you say goes in speak(text).` }, ...request.messages.slice(1)] },
    B: { ...request, onDelta: undefined, tools: [ROUTE], toolChoice: { type: "function", function: { name: "route" } }, maxTokens: 40 },
  };
  for (let run = 0; run < Number(runs); run++) {
    for (const [variant, body] of Object.entries(variants)) {
      if (only && variant !== only) continue;
      const started = performance.now();
      let answer, error;
      try { answer = await voiceChat({ ...body, model, signal: AbortSignal.timeout(30000) }); } catch (e) { error = e.message; answer = {}; }
      const route = error ? "error" : routeOf(answer, variant);
      rows.push({ say, variant, run, route, ok: expect.includes(route), ms: Math.round(performance.now() - started), words: typeof answer.content === "string" ? answer.content.slice(0, 80) : "", calls: (answer.tool_calls || []).map((c) => `${c.function?.name}(${(c.function?.arguments || "").slice(0, 80)})`), error });
    }
  }
  process.stderr.write(".");
}
console.log(JSON.stringify(rows));
