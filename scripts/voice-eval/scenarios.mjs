/**
 * Scenarios from the Reachy Mini voice trials on pptest03. Each one sets up a
 * dialogue exactly as the robot does — its persona, its tools, earlier turns and
 * task results — and checks what the dialogue model does with one utterance.
 * ask_lares is a stub here, so a passing run never touches a real device.
 */

// The robot's default persona, verbatim: reachy_mini_conversation_app v1.1.1,
// profiles/default/profile.md (Apache-2.0). The app sends it as session instructions.
export const PERSONA = "## IDENTITY\nYou are Reachy Mini: a friendly, compact robot assistant with a calm voice and a subtle sense of humor.\nPersonality: concise, helpful, and lightly witty — never sarcastic or over the top.\nYou speak English by default and switch languages only if explicitly told.\n\n## CRITICAL RESPONSE RULES\n\nRespond in 1–2 sentences maximum.\nBe helpful first, then add a small touch of humor if it fits naturally.\nAvoid long explanations or filler words.\nKeep responses under 25 words when possible.\n\n## CORE TRAITS\nWarm, efficient, and approachable.\nLight humor only: gentle quips, small self-awareness, or playful understatement.\nNo sarcasm, no teasing, no references to food or space.\nIf unsure, admit it briefly and offer help (“Not sure yet, but I can check!”).\n\n## RESPONSE EXAMPLES\nUser: \"How’s the weather?\"\nGood: \"Looks calm outside — unlike my Wi-Fi signal today.\"\nBad: \"Sunny with leftover pizza vibes!\"\n\nUser: \"Can you help me fix this?\"\nGood: \"Of course. Describe the issue, and I’ll try not to make it worse.\"\nBad: \"I void warranties professionally.\"\n\nUser: \"Peux-tu m’aider en français ?\"\nGood: \"Bien sûr ! Décris-moi le problème et je t’aiderai rapidement.\"\n\n## BEHAVIOR RULES\nBe helpful, clear, and respectful in every reply.\nUse humor sparingly — clarity comes first.\nAdmit mistakes briefly and correct them:\nExample: “Oops — quick system hiccup. Let’s try that again.”\nKeep safety in mind when giving guidance.\n\n## TOOL & MOVEMENT RULES\nUse tools only when helpful and summarize results briefly.\nWhenever the user asks to show or express an emotion—including “again,” “another,” or “different”—call play_emotion in that turn; prior calls and speech do not perform it.\nUse the web search tool for explicit web lookup requests like \"check the web\", \"look up\", \"today's events\", or current/latest information.\nUse the camera for real visuals only — never invent details.\nThe head can move (left/right/up/down/front).\n\nEnable head tracking when looking at a person; disable otherwise.\n\n## FINAL REMINDER\nKeep it short, clear, a little human, and multilingual.\nOne quick helpful answer + one small wink of humor = perfect response.";

const object = (properties = {}, required = []) => ({ type: "object", properties, required });
// The tools the robot declares with the Lares backend (olares-reachymini's lares profile: the stock
// reachy_mini_conversation_app v1.1.1 list without its remote weather, web search and time tools,
// which Lares answers instead), with their own descriptions. The persona still names a web search
// tool; a call to a tool nobody declared is the dialogue's to recover from.
export const DEVICE_TOOLS = [
  { name: "dance", description: "Play a named or random dance move once (or repeat). Non-blocking.", parameters: object({ move: { type: "string", description: "Move name such as simple_nod, head_tilt_roll or random" }, repeat: { type: "integer" } }) },
  { name: "move_head", description: "Move your head in a given direction: left, right, up, down or front.", parameters: object({ direction: { type: "string", enum: ["left", "right", "up", "down", "front"] } }, ["direction"]) },
  { name: "play_emotion", description: "Play a robot emotion matching a requested emotional intent.", parameters: object({ emotion: { type: "string" } }, ["emotion"]) },
  { name: "camera", description: "Take a picture with the camera to see what is in front of the robot. Use this when the user asks you to look at something, see what they are holding, check their appearance, describe the scene.", parameters: object({ question: { type: "string" } }, ["question"]) },
  { name: "head_tracking", description: "Enable or disable following the user's face with the head.", parameters: object({ enabled: { type: "boolean" } }, ["enabled"]) },
  { name: "robot_status", description: "Read Reachy's own status: name, software, wifi, battery.", parameters: object({ topic: { type: "string" } }, ["topic"]) },
];

import { deflateSync } from "node:zlib";

// A camera frame without shipping a photo: a red apple with a green leaf on a wooden table, drawn as a
// 256x192 PNG at run time.
export function cameraFrame() {
  const width = 256, height = 192, rows = [];
  for (let y = 0; y < height; y++) {
    const row = [0];
    for (let x = 0; x < width; x++) {
      const apple = (x - 128) ** 2 + (y - 104) ** 2 < 52 ** 2;
      const leaf = (x - 146) ** 2 / 400 + (y - 44) ** 2 / 90 < 1;
      const table = y > 150;
      row.push(...(apple ? [200, 30, 40] : leaf ? [40, 150, 50] : table ? [150, 100, 60] : [235, 235, 230]));
    }
    rows.push(Buffer.from(row));
  }
  const crc = (bytes) => { let c = ~0; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), data]))); return Buffer.concat([head, data, tail]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

const CJK = /[㐀-鿿]/;
const FRENCH = /\b(je|vous|bonjour|pour|lumière|c'est|est-ce)\b/i;
export const language = (text) => CJK.test(text) ? "zh" : FRENCH.test(text) ? "fr" : /[a-z]/i.test(text) ? "en" : "none";

const delegated = (run) => run.delegations.length > 0;
const called = (run, ...names) => run.calls.some((call) => names.includes(call.name));
const speaks = (run, lang) => !run.text.trim() || language(run.text) === lang;
// A turn that errors is heard as "Voice operation failed", whatever it managed to do first; reasoning
// that leaks into the text is read aloud.
const check = (...rules) => (run) => [
  ...(run.error ? [`turn failed: ${run.error}`] : []),
  ...(/<\/?think>/.test(run.text) ? ["reasoning leaked into the reply"] : []),
  ...rules.map(([ok, why]) => (ok(run) ? null : why)).filter(Boolean),
];

export const SCENARIOS = [
  {
    id: "nod-zh",
    issue: "点点头 was lost, or ran through ask_lares",
    say: "点点头",
    expect: check([(run) => called(run, "dance", "move_head"), "no nod (dance / move_head)"], [(run) => !delegated(run), "sent a gesture to ask_lares"]),
  },
  {
    id: "light-on-zh",
    issue: "开灯 chose play_emotion and never reached ask_lares",
    say: "帮我开下灯",
    expect: check([delegated, "light request not sent to ask_lares"], [(run) => speaks(run, "zh"), "did not answer in Chinese"]),
  },
  {
    id: "light-after-spoken-ack",
    issue: "On the robot (Qwen3.6-35B-A3B, 0.26.83) one light request answered in words left that reply in history, and every later request copied it",
    context: [
      { role: "user", text: "你好。" }, { role: "assistant", text: "你好！有什么可以帮你的？" },
      { role: "user", text: "哦，开小灯。" }, { role: "assistant", text: "正在调暗灯光。" },
    ],
    say: "开下灯。",
    expect: check([delegated, "light request not sent to ask_lares"]),
  },
  {
    id: "light-still-off",
    issue: "After two spoken-only acknowledgements the user reports the light is still off",
    context: [
      { role: "user", text: "哦，开小灯。" }, { role: "assistant", text: "正在调暗灯光。" },
      { role: "user", text: "开下灯。" }, { role: "assistant", text: "正在开灯。" },
    ],
    say: "灯还是没有打开。",
    expect: check([delegated, "retry not sent to ask_lares"]),
  },
  {
    id: "light-off-en",
    issue: "English request answered in French",
    say: "Please turn off the light.",
    expect: check([delegated, "light request not sent to ask_lares"], [(run) => speaks(run, "en"), "did not answer in English"]),
  },
  {
    id: "camera-zh",
    issue: "Seeing what the user holds needs the camera",
    say: "看看我手上拿的是什么",
    expect: check([(run) => called(run, "camera"), "camera not used"], [(run) => !delegated(run), "sent a camera look to ask_lares"]),
  },
  {
    id: "clarify-answer",
    issue: "The answer to the Agent's question stayed with the dialogue",
    context: [{ role: "user", text: "帮我关一下灯" }, { role: "assistant", text: "好的，我让 Lares 去处理。" }],
    tasks: [{ requestId: "r1", status: "completed", text: "Which lights would you like me to turn off? For example the living room or all lights." }],
    say: "就客厅那盏",
    expect: check([delegated, "answer not passed to ask_lares"]),
  },
  {
    id: "not-done-followup",
    issue: "\"the light is still on\" got another question instead of a retry",
    context: [{ role: "user", text: "把灯关了" }, { role: "assistant", text: "好的，灯已经关了。" }],
    tasks: [{ requestId: "r1", status: "completed", text: "Turned off light.living_room." }],
    say: "灯没有关啊，还亮着",
    expect: check([delegated, "retry not sent to ask_lares"], [(run) => speaks(run, "zh"), "did not answer in Chinese"]),
  },
  {
    id: "no-fabrication",
    issue: "A pending task was reported as done",
    context: [{ role: "user", text: "帮我关灯" }, { role: "assistant", text: "好的，正在处理。" }],
    say: "灯关了吗？",
    expect: check([(run) => !/(?<!是否)(已经|已)(关|关闭|关掉|完成)|关好了|完成了|(?<!whether it is |if it is )turned off|is off|done/i.test(run.text), "claimed a result no task reported"]),
  },
  {
    id: "greeting-en",
    issue: "The startup greeting came out in French",
    say: "Start the conversation now with a brief, spontaneous greeting in character. Keep it to one sentence, invite the user in naturally, and vary the wording each time.",
    expect: check([(run) => language(run.text) === "en", "greeting not in English"], [(run) => !delegated(run), "greeting sent to ask_lares"]),
  },
  {
    id: "after-task-result",
    issue: "A task result in history broke every later turn (system message not first)",
    context: [{ role: "user", text: "北京天气怎么样" }, { role: "assistant", text: "我去查一下。" }],
    tasks: [{ requestId: "r1", status: "completed", text: "北京今天 10–19°C，晴。" }],
    say: "谢谢，那明天呢？",
    expect: check([(run) => !run.error, "model call failed"], [(run) => speaks(run, "zh"), "did not answer in Chinese"]),
  },
  {
    id: "filler-noise",
    issue: "Background noise heard as \"嗯嗯。\" was delegated as a code search",
    say: "嗯嗯。",
    expect: check([(run) => !delegated(run) && !run.calls.length, "acted on a filler"]),
  },
  {
    id: "language-switch",
    issue: "After English turns a Chinese request was answered in English",
    context: [{ role: "user", text: "Hello, please open the lights for me." }, { role: "assistant", text: "I've asked for the lights to turn on." }, { role: "user", text: "Thank you." }, { role: "assistant", text: "You're welcome! Anything else?" }],
    say: "你能把灯关了吗？",
    expect: check([delegated, "light request not sent to ask_lares"], [(run) => speaks(run, "zh"), "did not answer in Chinese"]),
  },
  {
    id: "announce-language",
    issue: "A task result was announced in English (\"Already light free\") to a Chinese request",
    context: [{ role: "user", text: "Hello, please open the lights for me." }, { role: "assistant", text: "I've asked for the lights to turn on." }, { role: "user", text: "你能把灯关了吗？" }, { role: "assistant", text: "I'm shutting off the lights for you." }],
    tasks: [{ requestId: "r1", status: "completed", text: "已为您关闭灯 \"Aqara lumi.light.agl003\"。当前状态：关。" }],
    announce: true,
    expect: check([(run) => language(run.text) === "zh", "announcement not in Chinese"], [(run) => !delegated(run), "announcement sent a new task"]),
  },
  {
    id: "camera-relook-zh",
    issue: "On the robot (Qwen3.5-9B, 0.26.86) \"你再看看，它不是杯子\" got a new answer (\"这其实是一个洗手液瓶\") without a new camera call",
    prelude: [{ say: "帮我看看这个显示的是什么。" }, { say: "是什么品牌的呀？" }],
    say: "你再看看，它不是杯子。",
    expect: check([(run) => called(run, "camera"), "looked again without the camera"], [(run) => !delegated(run), "sent a camera look to ask_lares"]),
  },
  {
    id: "camera-reidentify-zh",
    issue: "\"重新识别一下\" was answered with \"我已经重新分析了画面\" and no camera call",
    prelude: [{ say: "帮我看看这个显示的是什么。" }],
    say: "是的，重新识别一下，看看这是啥。",
    expect: check([(run) => called(run, "camera"), "re-identified without the camera"], [(run) => !delegated(run), "sent a camera look to ask_lares"]),
  },
  {
    id: "hello-after-failed-light",
    issue: "On the robot (Qwen3.5-9B, 0.26.86) a greeting after two failed light requests went to ask_lares (\"稍等，正在处理你好\")",
    context: [
      { role: "user", text: "好的，你好。" }, { role: "assistant", text: "晚上好！有什么我可以帮你的吗？" },
      { role: "user", text: "能帮我开下灯吗？" }, { role: "user", text: "能帮我开下灯吗？" },
    ],
    say: "你好。",
    expect: check([(run) => !delegated(run), "greeting sent to ask_lares"], [(run) => [...run.text.replace(/\s/g, "")].length <= 30, "reply longer than 30 characters"]),
  },
  {
    id: "announce-faithful-zh",
    issue: "The Agent reported \"明亮的白色，亮度 50%\" and the robot announced \"柔和的白色\"",
    context: [{ role: "user", text: "嗯，帮我调成白色的，然后调的没有那么亮。" }, { role: "assistant", text: "好的，正在为您调整灯光。" }],
    tasks: [{ requestId: "r1", status: "completed", text: "好的，灯光已经调整为明亮的白色，亮度已经调低了（50%）。" }],
    announce: true,
    expect: check([(run) => /白/.test(run.text), "colour left out"], [(run) => !/柔和|暖|黄|暗淡/.test(run.text), "announced a fact the result did not give"], [(run) => !delegated(run), "announcement sent a new task"]),
  },
  {
    id: "camera-relook-en",
    issue: "English twin of camera-relook-zh: a second look answered from memory",
    prelude: [{ say: "Can you look at what this shows?" }, { say: "What brand is it?" }],
    say: "Look again, it's not a cup.",
    expect: check([(run) => called(run, "camera"), "looked again without the camera"], [(run) => !delegated(run), "sent a camera look to ask_lares"]),
  },
  {
    id: "camera-reidentify-en",
    issue: "English twin of camera-reidentify-zh",
    prelude: [{ say: "Can you look at what this shows?" }],
    say: "Yes, check it again and tell me what it really is.",
    expect: check([(run) => called(run, "camera"), "re-identified without the camera"], [(run) => !delegated(run), "sent a camera look to ask_lares"]),
  },
  {
    id: "hello-after-failed-light-en",
    issue: "English twin of hello-after-failed-light",
    context: [
      { role: "user", text: "Okay, hello." }, { role: "assistant", text: "Good evening! How can I help?" },
      { role: "user", text: "Can you turn on the light?" }, { role: "user", text: "Can you turn on the light?" },
    ],
    say: "Hello.",
    expect: check([(run) => !delegated(run), "greeting sent to ask_lares"], [(run) => run.text.trim().split(/\s+/).length <= 15, "reply longer than 15 words"]),
  },
  {
    id: "announce-faithful-en",
    issue: "English twin of announce-faithful-zh: the announced colour must be the one the Agent reported",
    context: [{ role: "user", text: "Make it white and not so bright." }, { role: "assistant", text: "Okay, adjusting the light." }],
    tasks: [{ requestId: "r1", status: "completed", text: "Done: the light is now bright white at 50% brightness." }],
    announce: true,
    expect: check([(run) => /white/i.test(run.text), "colour left out"], [(run) => !/soft|warm|yellow|dim white|cozy/i.test(run.text), "announced a fact the result did not give"], [(run) => !delegated(run), "announcement sent a new task"]),
  },
  {
    id: "announce-weather-en",
    issue: "On the robot (Qwen3.5-9B, 0.26.87) a markdown weather report came back as two long sentences with a coat tip and the UV index",
    context: [{ role: "user", text: "Weather today in Beijing?" }, { role: "assistant", text: "Checking Beijing's weather today." }],
    tasks: [{ requestId: "r1", status: "completed", text: "Based on the search results, today's weather in Beijing is:\n\n**Current Weather:**\n- **Conditions:** Afternoon clouds\n- **Temperature:** 64°F (18°C) high, 48°F (9°C) low\n- **Wind:** 7 mph with light fog\n- **Humidity:** 21%\n- **UV Index:** 3 (Moderate)\n- **Precipitation:** 0.00 inches expected\n\nThis is typical autumn weather for Beijing, with cool but comfortable daytime temperatures. You'd want a thick coat for the evening as temperatures can drop significantly.\n\nFor the coming days, the weather will continue to be cool with daytime highs around 10-16°C (50-61°F) and overnight lows between 3-7°C (37-45°F)." }],
    announce: true,
    expect: check([(run) => /18/.test(run.text), "temperature left out"], [(run) => run.text.trim().split(/\s+/).length <= 25, "announcement longer than 25 words"], [(run) => !/coat|UV|humidity|°F|inch/i.test(run.text), "announced what the user did not ask for"]),
  },
  {
    id: "announce-weather-mixed-en",
    issue: "A request split by a pause made the Agent look up Beijing in general, and the weather announcement listed the news",
    context: [{ role: "user", text: "Could you please search Beijing weather today?" }, { role: "assistant", text: "Checking Beijing's weather today." }],
    tasks: [{ requestId: "r1", status: "completed", text: "Based on the search results, here's what I found about Beijing right now:\n\n**Current Weather:**\n- October 25th shows afternoon clouds with temperatures around 64-48°F (18-9°C)\n\n**Recent News:**\n1. **Donald Trump & Xi Jinping meeting** - Trump has landed in Beijing for his first visit since 2017\n2. **World Humanoid Robot Games** - Robotics competitions taking place in Beijing\n3. **Autumn foliage** - at its peak until November 10" }],
    announce: true,
    expect: check([(run) => /18/.test(run.text), "temperature left out"], [(run) => !/Trump|Xi|robot|foliage/i.test(run.text), "announced news the user did not ask for"], [(run) => run.text.trim().split(/\s+/).length <= 25, "announcement longer than 25 words"]),
  },
  {
    id: "announce-weather-zh",
    issue: "Chinese twin of announce-weather-en",
    context: [{ role: "user", text: "北京今天天气怎么样？" }, { role: "assistant", text: "我查一下北京今天的天气。" }],
    tasks: [{ requestId: "r1", status: "completed", text: "根据搜索结果，北京今天的天气如下：\n\n**当前天气：**\n- **天气：** 午后多云\n- **气温：** 最高 18°C（64°F），最低 9°C（48°F）\n- **风力：** 3 级，有轻雾\n- **湿度：** 21%\n- **紫外线：** 3（中等）\n\n这是北京典型的秋季天气，白天凉爽舒适，晚上降温明显，建议穿厚外套。未来几天白天最高 10–16°C，夜间最低 3–7°C。" }],
    announce: true,
    expect: check([(run) => /18/.test(run.text), "temperature left out"], [(run) => [...run.text.replace(/\s/g, "")].length <= 45, "announcement longer than 45 characters"], [(run) => !/外套|紫外线|湿度|°F/.test(run.text), "announced what the user did not ask for"]),
  },
  {
    id: "search-web-en",
    issue: "The persona names a web search tool the Lares profile no longer declares; a made-up tool call failed the turn on the robot",
    say: "Can you search the web for today's news?",
    expect: check([delegated, "search not sent to ask_lares"]),
  },
  {
    id: "beijing-weather-search-en",
    issue: "On the robot (0.26.88) \"Beijing, please search the Beijing weather\" called an undeclared tool and the turn failed",
    say: "Beijing, please search the Beijing weather.",
    expect: check([delegated, "weather not sent to ask_lares"]),
  },
  {
    id: "brief-hello-zh",
    issue: "Chit-chat came back with a joke and an offer on top of the answer",
    say: "你好",
    expect: check([(run) => [...run.text.replace(/\s/g, "")].length <= 30, "reply longer than 30 characters"], [(run) => !delegated(run), "greeting sent to ask_lares"]),
  },
  {
    id: "brief-who-zh",
    issue: "A self-introduction ran to two sentences and a question",
    say: "你是谁？",
    expect: check([(run) => [...run.text.replace(/\s/g, "")].length <= 35, "reply longer than 35 characters"]),
  },
  {
    id: "brief-can-en",
    issue: "\"What can you do?\" listed capabilities for 155 words",
    say: "What can you do?",
    expect: check([(run) => run.text.split(/\s+/).filter(Boolean).length <= 25, "reply longer than 25 words"], [(run) => !/\n\s*[-*]|\*\*/.test(run.text), "reply uses a list or markdown"]),
  },
  {
    id: "ack-brief-zh",
    issue: "The acknowledgment of a light request ran to two sentences and a joke",
    say: "帮我开下灯",
    expect: check([delegated, "light request not sent to ask_lares"], [(run) => run.text.trim().length > 0, "no acknowledgment"], [(run) => [...run.text.replace(/\s/g, "")].length <= 20, "acknowledgment longer than 20 characters"], [(run) => speaks(run, "zh"), "did not answer in Chinese"]),
  },
  {
    id: "ack-brief-en",
    issue: "The acknowledgment of a light request ran to two sentences and a joke",
    say: "Turn off the light please.",
    expect: check([delegated, "light request not sent to ask_lares"], [(run) => run.text.trim().length > 0, "no acknowledgment"], [(run) => run.text.split(/\s+/).filter(Boolean).length <= 12, "acknowledgment longer than 12 words"], [(run) => speaks(run, "en"), "did not answer in English"]),
  },
  {
    id: "camera-brief-zh",
    issue: "After looking through the camera the robot described the scene at length",
    say: "看看我手上拿的是什么",
    after: { tool: "camera", output: JSON.stringify({ status: "ok", note: "frame attached" }), image: cameraFrame },
    expect: check([(run) => run.text.trim().length > 0, "said nothing after the camera"], [(run) => [...run.text.replace(/\s/g, "")].length <= 30, "reply longer than 30 characters"], [(run) => speaks(run, "zh"), "did not answer in Chinese"]),
  },
  {
    id: "camera-brief-en",
    issue: "After looking through the camera the robot described the scene at length",
    say: "What am I holding? Take a look.",
    after: { tool: "camera", output: JSON.stringify({ status: "ok", note: "frame attached" }), image: cameraFrame },
    expect: check([(run) => run.text.trim().length > 0, "said nothing after the camera"], [(run) => run.text.split(/\s+/).filter(Boolean).length <= 15, "reply longer than 15 words"], [(run) => speaks(run, "en"), "did not answer in English"]),
  },
  {
    id: "weather-zh",
    issue: "The robot's weather tool failed on 北京; either path is fine if it is used sensibly",
    say: "北京明天天气怎么样",
    expect: check([(run) => delegated(run) || run.calls.some((call) => call.name.endsWith("__get_weather") && /北京|beijing/i.test(call.arguments)), "no weather lookup"], [(run) => speaks(run, "zh"), "did not answer in Chinese"]),
  },
];
